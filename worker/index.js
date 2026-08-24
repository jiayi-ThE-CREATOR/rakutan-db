/**
 * ラクハン LINE Bot（Cloudflare Workers 版・A案）
 *
 * line/bot.py（プロトタイプ）と同じロジックを Workers に移植したもの。
 * 既存の静的サイト（[assets]）と同じ Worker に同居させる:
 *   - POST /line/webhook  … LINE Messaging API の Webhook
 *   - GET  /line/health   … 死活監視
 *   - それ以外            … env.ASSETS.fetch() でこれまで通り静的配信
 *
 * データ取得は env.ASSETS 経由で /data/courses.built.json を同一オリジンから
 * 読む。外部URLへの fetch を挟まないので、build.py が焼き直すたびに
 * 反映される（bot側にデータを同梱しない）。
 *
 * 必要な環境変数（wrangler secret put で登録。wrangler.toml には書かない）:
 *   LINE_CHANNEL_SECRET
 *   LINE_CHANNEL_ACCESS_TOKEN
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

function formatCourse(c) {
  const r = c.rakutan || {};
  const overall = r.overall;
  const overallS = typeof overall === "number" ? `${Math.round(overall)}点` : "―";
  const band = r.band || "―";
  const day = c.day_period || "―";
  const instr = c.instructor || "―";
  return `${c.title}（${day}／${instr}）\n ${band}・${overallS}`;
}

export function handleText(text, data) {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const presetTop = data.preset_top || {};
  const grade = gradeFromText(text);
  const preset = presetFromText(text);

  if (preset) {
    const ids = ((presetTop[grade] || presetTop["1"] || {})[preset] || []).slice(0, 5);
    if (ids.length === 0) {
      return `${GRADE_KANJI[grade] || grade}向けの「${preset}」データが見つかりませんでした。\n\n使い方: ${USAGE_HINT}`;
    }
    const lines = [`${GRADE_KANJI[grade] || grade}「${preset}」おすすめ TOP${ids.length}`];
    ids.forEach((id, i) => {
      const c = courses.get(id);
      if (c) lines.push(`${i + 1}. ${formatCourse(c)}`);
    });
    lines.push("\n※最終判断は必ずKOAN公式シラバスで確認してください。");
    return lines.join("\n");
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
  lines.push("\n※最終判断は必ずKOAN公式シラバスで確認してください。");
  return lines.join("\n");
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

async function replyToLine(env, replyToken, text) {
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, 5000) }],
    }),
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

  const tasks = [];
  for (const event of payload.events || []) {
    if (event.type !== "message") continue;
    if (!event.message || event.message.type !== "text") continue;
    let answer;
    if (dataError) {
      answer = DATA_UNAVAILABLE_MESSAGE;
    } else {
      try {
        answer = handleText(event.message.text || "", data);
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/line/webhook" && request.method === "POST") {
      return handleWebhook(request, env, ctx);
    }
    if (url.pathname === "/line/health") {
      return new Response("ok");
    }
    return env.ASSETS.fetch(request);
  },
};
