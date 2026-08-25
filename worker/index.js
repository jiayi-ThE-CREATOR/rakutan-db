/**
 * ラクハン LINE Bot（Cloudflare Workers 版・A案）
 *
 * line/bot.py（プロトタイプ）と同じロジックを Workers に移植したもの。
 * 既存の静的サイト（[assets]）と同じ Worker に同居させる:
 *   - POST /line/webhook  … LINE Messaging API の Webhook
 *   - GET  /line/health   … 死活監視
 *   - POST /api/feedback  … 意見箱（フッタのモーダル → Discord へ中継）
 *   - それ以外            … env.ASSETS.fetch() でこれまで通り静的配信
 *
 * データ取得は env.ASSETS 経由で /data/courses.built.json を同一オリジンから
 * 読む。外部URLへの fetch を挟まないので、build.py が焼き直すたびに
 * 反映される（bot側にデータを同梱しない）。
 *
 * 必要な環境変数（wrangler secret put で登録。wrangler.toml には書かない）:
 *   LINE_CHANNEL_SECRET
 *   LINE_CHANNEL_ACCESS_TOKEN
 *   FEEDBACK_DISCORD_WEBHOOK  … 意見箱の落とし先。未設定なら 503
 */

const PRESET_NAMES = ["バイト優先", "GPA重視", "とにかく軽い", "テストが苦手"];
const GRADE_KANJI = { 1: "1年", 2: "2年", 3: "3年", 4: "4年", 5: "5年", 6: "6年" };
const CACHE_TTL_MS = 5 * 60 * 1000;
const USAGE_HINT = "「1年 とにかく軽い」のように送ると、おすすめを返します。";
const DATA_UNAVAILABLE_MESSAGE =
  "只今データを取得できませんでした。少し時間をおいて試してください。";

// isolate内でのみ有効な簡易キャッシュ。Workers はリクエストごとに
// isolateが再利用されるとは限らないが、再利用されたときの節約として置く。
let cache = { data: null, fetchedAt: 0 };

async function loadData(env, request) {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
  const assetUrl = new URL("/data/courses.built.json", request.url);
  const res = await env.ASSETS.fetch(new Request(assetUrl));
  if (!res.ok) {
    throw new Error(`courses.built.json fetch failed: ${res.status}`);
  }
  const data = await res.json();
  cache = { data, fetchedAt: now };
  return data;
}

function gradeFromText(text) {
  const m = text.match(/([1-6１-６])\s*年/);
  if (!m) return "1";
  const zenkaku = "１２３４５６";
  const hankaku = "123456";
  const idx = zenkaku.indexOf(m[1]);
  return idx >= 0 ? hankaku[idx] : m[1];
}

function presetFromText(text) {
  return PRESET_NAMES.find((name) => text.includes(name)) || null;
}

// web/assets/app.js の koanUrl() と同じ形式（セッション不要で直接開ける）。
function koanUrl(id) {
  return `https://koan.osaka-u.ac.jp/campusweb/campussquare.do?_flowId=SYW4201600-flow&nendo=2026&j_s_cd=13&j_cd=${encodeURIComponent(id)}&langkbn=j`;
}

function formatCourse(c) {
  const r = c.rakutan || {};
  const overall = r.overall;
  const overallS = typeof overall === "number" ? `${Math.round(overall)}点` : "―";
  const band = r.band || "―";
  const day = c.day_period || "―";
  const instr = c.instructor || "―";
  return (
    `${c.title}（${day}／${instr}）\n` +
    ` 授業コード: ${c.id}\n` +
    ` ${band}・${overallS}\n` +
    ` KOAN: ${koanUrl(c.id)}`
  );
}

// grade は "1"〜"6"、preset は PRESET_NAMES のいずれか。
// handleText（自由入力）と postback（ボタン選択）の両方から呼ぶ共通ロジック。
export function buildRecommendation(grade, preset, data, siteOrigin) {
  const siteLine = siteOrigin ? `\nラクハン: ${siteOrigin}/` : "";
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const presetTop = data.preset_top || {};
  const ids = ((presetTop[grade] || presetTop["1"] || {})[preset] || []).slice(0, 5);
  if (ids.length === 0) {
    return `${GRADE_KANJI[grade] || grade}向けの「${preset}」データが見つかりませんでした。\n\n使い方: ${USAGE_HINT}`;
  }
  const lines = [`${GRADE_KANJI[grade] || grade}「${preset}」おすすめ TOP${ids.length}`];
  ids.forEach((id, i) => {
    const c = courses.get(id);
    if (c) lines.push(`${i + 1}. ${formatCourse(c)}`);
  });
  lines.push(`\n※最終判断は必ずKOAN公式シラバスで確認してください。${siteLine}`);
  return lines.join("\n");
}

export function handleText(text, data, siteOrigin) {
  const siteLine = siteOrigin ? `\nラクハン: ${siteOrigin}/` : "";
  const grade = gradeFromText(text);
  const preset = presetFromText(text);

  if (preset) {
    return buildRecommendation(grade, preset, data, siteOrigin);
  }

  const q = text.trim();
  if (!q) {
    return (
      "科目名で検索するか、「バイト優先」「GPA重視」「とにかく軽い」「テストが苦手」の" +
      "いずれかを送ってください（例:「1年 とにかく軽い」）。"
    );
  }
  let matched = data.courses.filter((c) => (c.title || "").includes(q));
  if (matched.length === 0) {
    return `「${q}」に一致する科目が見つかりませんでした。\n\n使い方: ${USAGE_HINT}`;
  }
  matched = matched
    .slice()
    .sort((a, b) => ((b.rakutan || {}).overall ?? -1) - ((a.rakutan || {}).overall ?? -1));
  const lines = [`「${q}」の検索結果（上位${Math.min(5, matched.length)}件）`];
  matched.slice(0, 5).forEach((c, i) => lines.push(`${i + 1}. ${formatCourse(c)}`));
  lines.push(`\n※最終判断は必ずKOAN公式シラバスで確認してください。${siteLine}`);
  return lines.join("\n");
}

// ── 友だち追加直後の質問フロー ──────────────────────────────
// サーバー側にセッションを持たない（KV等の追加インフラが要らない）ため、
// 「今どの質問段階か」は LINE の postback data にそのまま載せて往復させる。
// 例: "action=grade&grade=2" のように、次の質問に必要な情報を都度足していく。

function qrPostback(label, data, displayText) {
  return {
    type: "action",
    action: { type: "postback", label, data, displayText: displayText || label },
  };
}

// 検索結果・おすすめの返信に、ラクハンサイトを直接開けるボタンを付ける。
// 本文末尾の「ラクハン: URL」はテキストのままなので、タップしやすいボタンを別に添える。
export function withSiteButton(text, siteOrigin) {
  if (!siteOrigin) return text;
  return {
    type: "text",
    text,
    quickReply: {
      items: [
        {
          type: "action",
          action: { type: "uri", label: "ラクハンで見る", uri: `${siteOrigin}/` },
        },
      ],
    },
  };
}

export function greetingMessage() {
  return {
    type: "text",
    text:
      "友だち追加ありがとうございます！\n" +
      "阪大最強のAIコミュニティ「GUILD」による楽単情報bot「ラクハン」です。\n\n" +
      "学年や条件があれば絞れるよ！答えたくなければ" +
      "『とにかく楽単を知りたい』を選ぶだけでOK。",
    quickReply: {
      items: [
        qrPostback("学年などを教える", "action=start_personal", "学年などを教えて絞り込みたい"),
        qrPostback("とにかく楽単を知りたい", "action=quick_default", "とにかく楽単を知りたい"),
      ],
    },
  };
}

export function gradeQuestionMessage() {
  const items = [1, 2, 3, 4, 5, 6].map((g) =>
    qrPostback(`${g}年`, `action=grade&grade=${g}`, `${g}年です`)
  );
  items.push(qrPostback("答えたくない", "action=quick_default", "答えたくない"));
  return {
    type: "text",
    text: "今何年生？（答えたくなければ「答えたくない」でOK）",
    quickReply: { items },
  };
}

export function presetQuestionMessage(grade) {
  const items = PRESET_NAMES.map((name) =>
    qrPostback(name, `action=preset&grade=${grade}&preset=${encodeURIComponent(name)}`, name)
  );
  return {
    type: "text",
    text: "何を優先する？",
    quickReply: { items },
  };
}

export function handlePostback(data, evData, siteOrigin) {
  const params = new URLSearchParams(evData);
  const action = params.get("action");

  if (action === "start_personal") return { message: gradeQuestionMessage() };
  if (action === "grade") {
    const grade = params.get("grade") || "1";
    return { message: presetQuestionMessage(grade) };
  }
  if (action === "preset") {
    const grade = params.get("grade") || "1";
    const preset = params.get("preset") || "とにかく軽い";
    return { text: buildRecommendation(grade, preset, data, siteOrigin) };
  }
  if (action === "quick_default") {
    return { text: buildRecommendation("1", "とにかく軽い", data, siteOrigin) };
  }
  return { message: greetingMessage() };
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(secret, bodyText, signatureB64) {
  if (!secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(bodyText));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, signatureB64 || "");
}

// message は文字列（プレーンテキスト）か、LINE の message オブジェクト
// （quickReply 付きなど）のどちらでも渡せる。
async function replyToLine(env, replyToken, message) {
  const msg =
    typeof message === "string"
      ? { type: "text", text: message.slice(0, 5000) }
      : { ...message, text: message.text ? message.text.slice(0, 5000) : message.text };
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [msg] }),
  });
}

async function handleWebhook(request, env, ctx) {
  const bodyText = await request.text();
  const signature = request.headers.get("X-Line-Signature") || "";

  const ok = await verifySignature(env.LINE_CHANNEL_SECRET, bodyText, signature);
  if (!ok) return new Response("invalid signature", { status: 401 });

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // courses.built.json の取得に失敗しても、LINE には 200 を返す。
  // 500 を返すと LINE 側が Webhook をリトライし続けるため、失敗時は
  // 固定文言で応答して終える。
  let data = null;
  let dataError = null;
  try {
    data = await loadData(env, request);
  } catch (e) {
    dataError = e;
    console.error("loadData error", e);
  }

  const siteOrigin = new URL(request.url).origin;
  const tasks = [];
  for (const event of payload.events || []) {
    if (event.type === "follow") {
      tasks.push(replyToLine(env, event.replyToken, greetingMessage()));
      continue;
    }

    if (event.type === "postback") {
      let reply;
      if (dataError) {
        reply = DATA_UNAVAILABLE_MESSAGE;
      } else {
        try {
          const result = handlePostback(data, event.postback?.data || "", siteOrigin);
          reply = result.message || withSiteButton(result.text, siteOrigin);
        } catch (e) {
          reply = "エラーが発生しました。少し時間をおいて試してください。";
          console.error("handlePostback error", e);
        }
      }
      tasks.push(replyToLine(env, event.replyToken, reply));
      continue;
    }

    if (event.type !== "message") continue;
    if (!event.message || event.message.type !== "text") continue;
    let answer;
    if (dataError) {
      answer = DATA_UNAVAILABLE_MESSAGE;
    } else {
      try {
        answer = withSiteButton(handleText(event.message.text || "", data, siteOrigin), siteOrigin);
      } catch (e) {
        answer = "エラーが発生しました。少し時間をおいて試してください。";
        console.error("handleText error", e);
      }
    }
    tasks.push(replyToLine(env, event.replyToken, answer));
  }
  ctx.waitUntil(Promise.all(tasks));

  return new Response("ok");
}

/* ── 意見箱（POST /api/feedback） ──────────────────────────────
 * フッタのモーダルから来た自由記述を、Discord のチャンネルへ流すだけ。
 * 保存はしない（D1 未接続）。落とし先はチームが毎日見ている場所の方が読まれる。
 *
 * webhook URL は secret で入れる（wrangler.toml には書かない）:
 *   npx wrangler secret put FEEDBACK_DISCORD_WEBHOOK
 * 未設定なら 503 を返す。受け取ったふりをして捨てるのが一番たちが悪い。
 */
const FB_MAX_TEXT = 1000;
const FB_MAX_CONTACT = 200;
const FB_MAX_FROM = 200;

function fbClamp(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function fbJson(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleFeedback(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fbJson(400, { ok: false, error: "bad_json" });
  }

  // honeypot。人には見えない欄が埋まっていれば bot なので、
  // 200 を返して黙って捨てる。400 を返すと bot に検知を教えることになる。
  if (fbClamp(body.website, 200)) return fbJson(200, { ok: true });

  const text = fbClamp(body.text, FB_MAX_TEXT);
  if (!text) return fbJson(400, { ok: false, error: "empty" });

  const webhook = env.FEEDBACK_DISCORD_WEBHOOK;
  if (!webhook) return fbJson(503, { ok: false, error: "not_configured" });

  const contact = fbClamp(body.contact, FB_MAX_CONTACT);
  const from = fbClamp(body.from, FB_MAX_FROM);

  const lines = ["📮 **サイトへのご意見**"];
  if (from) lines.push(`> ${from}`);
  if (contact) lines.push(`> 返信先: ${contact}`);
  lines.push("", text);

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: lines.join("\n"),
      // 本文は利用者が書いたもの。@everyone と書かれても飛ばさない。
      allowed_mentions: { parse: [] },
    }),
  });
  if (!res.ok) {
    console.error("discord webhook failed", res.status);
    return fbJson(502, { ok: false, error: "relay_failed" });
  }
  return fbJson(200, { ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/line/webhook" && request.method === "POST") {
      return handleWebhook(request, env, ctx);
    }
    if (url.pathname === "/line/health") {
      return new Response("ok");
    }
    if (url.pathname === "/api/feedback") {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
      }
      return handleFeedback(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
