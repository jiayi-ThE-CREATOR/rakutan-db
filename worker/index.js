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

// LINEに載せる「サイトのURL」は固定でこちらを使う。
// リクエストを受けたドメイン（request.url）を使うと、LINE Developersに
// 登録した旧URL（*.workers.dev）のままになってしまうため（2026-08-25 吉村さん申請の新ドメイン）。
const SITE_URL = "https://rakuhan.nocode-sol.co.jp";

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
// j_s_cd（所属コード）は科目ごとに違う。courses.built.json の shozoku_cd を
// 使い、無ければ13にフォールバック（2026-08-26 wangさん報告：固定値13だと
// 全学教育推進機構以外の科目でリンクが無効になっていた）。
function koanUrl(c) {
  const shozokuCd = c.shozoku_cd || "13";
  return `https://koan.osaka-u.ac.jp/campusweb/campussquare.do?_flowId=SYW4201600-flow&nendo=2026&j_s_cd=${encodeURIComponent(shozokuCd)}&j_cd=${encodeURIComponent(c.id)}&langkbn=j`;
}

// 科目1件ぶんのFlex Messageバブル。
// 🚨 これ以前は「KOAN: <生URL>」をテキストにそのまま貼っていたが、
// LINEアプリ側でリンクプレビューが失敗し「認証エラー／リンクを開くには
// こちらをタップ」という壊れた表示になった（2026-08-26 しゅんやさん報告）。
// URIアクションのボタンにすると同じ問題は起きない。
function courseBubble(c) {
  const r = c.rakutan || {};
  const overall = r.overall;
  const overallS = typeof overall === "number" ? `${Math.round(overall)}点` : "―";
  const band = r.band || "―";
  const nReviews = c.reviews && typeof c.reviews.n === "number" ? c.reviews.n : 0;
  return {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: c.title, weight: "bold", size: "md", wrap: true },
        {
          type: "text",
          text: `${c.day_period || "―"}／${c.instructor || "―"}`,
          size: "sm",
          color: "#666666",
          wrap: true,
        },
        {
          type: "box",
          layout: "baseline",
          margin: "md",
          contents: [
            { type: "text", text: band, size: "sm", color: "#DB6209", flex: 0, weight: "bold" },
            { type: "text", text: overallS, size: "sm", margin: "sm", color: "#666666" },
          ],
        },
        {
          type: "text",
          text: `授業コード ${c.id}${nReviews ? ` ／ 口コミ${nReviews}件` : ""}`,
          size: "xs",
          color: "#999999",
          margin: "sm",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: "#DB6209",
          action: { type: "uri", label: "KOAN公式シラバス", uri: koanUrl(c) },
        },
      ],
    },
  };
}

// 見出しテキスト＋Flexカルーセルの2通で返す（LINEは1回のreplyに複数メッセージを積める）。
function coursesReply(heading, courses, siteOrigin) {
  const flex = {
    type: "flex",
    altText: heading,
    contents: { type: "carousel", contents: courses.map(courseBubble) },
  };
  if (siteOrigin) {
    flex.quickReply = {
      items: [
        { type: "action", action: { type: "uri", label: "ラクハンで見る", uri: `${siteOrigin}/` } },
      ],
    };
  }
  return [
    { type: "text", text: `${heading}\n\n※最終判断は必ずKOAN公式シラバスで確認してください。` },
    flex,
  ];
}

// grade は "1"〜"6"、preset は PRESET_NAMES のいずれか。
// handleText（自由入力）と postback（ボタン選択）の両方から呼ぶ共通ロジック。
// 戻り値は「見つからなかった」場合は文字列、見つかった場合はLINEメッセージの配列。
export function buildRecommendation(grade, preset, data, siteOrigin) {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const presetTop = data.preset_top || {};
  const ids = ((presetTop[grade] || presetTop["1"] || {})[preset] || []).slice(0, 5);
  if (ids.length === 0) {
    return `${GRADE_KANJI[grade] || grade}向けの「${preset}」データが見つかりませんでした。\n\n使い方: ${USAGE_HINT}`;
  }
  const matched = ids.map((id) => courses.get(id)).filter(Boolean);
  const heading = `${GRADE_KANJI[grade] || grade}「${preset}」おすすめ TOP${matched.length}`;
  return coursesReply(heading, matched, siteOrigin);
}

function usageMessage() {
  return (
    "使い方だよ📖\n\n" +
    "・科目名を送る → 検索\n" +
    "・「1年 とにかく軽い」のように学年＋条件を送る → おすすめ\n" +
    "・条件は「バイト優先」「GPA重視」「とにかく軽い」「テストが苦手」の4つ\n" +
    "・下のメニューの「科目を検索」「おすすめ」からも同じことができるよ"
  );
}

function contactMessage(siteOrigin) {
  return {
    type: "text",
    text: "ご意見・連携のご相談はサイト下部の「サイトへのご意見・改善要望」フォームから送れるよ。",
    quickReply: siteOrigin
      ? {
          items: [
            { type: "action", action: { type: "uri", label: "サイトを開く", uri: `${siteOrigin}/` } },
          ],
        }
      : undefined,
  };
}

// リッチメニューのC〜Fの各ボタンは、この決まった文言をテキストとして送ってくる
// （wangさん・しゅんやさん 2026-08-26 のリッチメニュー設計）。
const MENU_KEYWORDS = {
  科目を検索: () => "科目名を入力して送ってね。例:「統計学」",
  おすすめ: () => gradeQuestionMessage(),
  使い方: () => usageMessage(),
  連携・要望: (siteOrigin) => contactMessage(siteOrigin),
};

// 戻り値: 文字列 / LINEメッセージオブジェクト / メッセージ配列、のいずれか。
export function handleText(text, data, siteOrigin) {
  const trimmed = text.trim();

  if (MENU_KEYWORDS[trimmed]) {
    return MENU_KEYWORDS[trimmed](siteOrigin);
  }

  const grade = gradeFromText(text);
  const preset = presetFromText(text);

  if (preset) {
    return buildRecommendation(grade, preset, data, siteOrigin);
  }

  const q = trimmed;
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
    .sort((a, b) => ((b.rakutan || {}).overall ?? -1) - ((a.rakutan || {}).overall ?? -1))
    .slice(0, 5);
  const heading = `「${q}」の検索結果（上位${matched.length}件）`;
  return coursesReply(heading, matched, siteOrigin);
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

// 単純な文字列の返信に、ラクハンサイトを直接開けるボタンを付ける。
// handleText/handlePostbackがオブジェクトや配列（Flexメッセージなど）を
// 返してきた場合は、それ自体が既に自前のquickReply/ボタンを持っているので
// 何もしない。
export function withSiteButton(result, siteOrigin) {
  if (typeof result !== "string") return result;
  if (!siteOrigin) return result;
  return {
    type: "text",
    text: result,
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

// 戻り値は handleText と同じ形（文字列 / メッセージオブジェクト / 配列）。
export function handlePostback(data, evData, siteOrigin) {
  const params = new URLSearchParams(evData);
  const action = params.get("action");

  if (action === "start_personal") return gradeQuestionMessage();
  if (action === "grade") {
    const grade = params.get("grade") || "1";
    return presetQuestionMessage(grade);
  }
  if (action === "preset") {
    const grade = params.get("grade") || "1";
    const preset = params.get("preset") || "とにかく軽い";
    return withSiteButton(buildRecommendation(grade, preset, data, siteOrigin), siteOrigin);
  }
  if (action === "quick_default") {
    return withSiteButton(buildRecommendation("1", "とにかく軽い", data, siteOrigin), siteOrigin);
  }
  return greetingMessage();
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

// message は 文字列 / LINEのmessageオブジェクト（quickReply付きなど）/
// それらの配列（1回のreplyで複数メッセージを送る場合）のどれでも渡せる。
// LINEのreply APIは1回に最大5メッセージまで。
async function replyToLine(env, replyToken, message) {
  const items = Array.isArray(message) ? message : [message];
  const messages = items.slice(0, 5).map((m) =>
    typeof m === "string"
      ? { type: "text", text: m.slice(0, 5000) }
      : { ...m, text: m.text ? m.text.slice(0, 5000) : m.text }
  );
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
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

  const siteOrigin = SITE_URL;
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
          reply = handlePostback(data, event.postback?.data || "", siteOrigin);
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

/* ── お気に入り（GET/POST/DELETE /api/favorites） ──────────────────
 * D1（binding: DB）に保存する。2026-08-25 wangさんの登録制の方針の第一弾。
 * まずお気に入りだけ。検索履歴は同じテーブル構成の要領で後から足す。
 *
 * line_user_id はサイト側（LIFF経由）から渡ってくる想定。
 * ここでは形式チェックのみ行い、LINEのアクセストークンでの検証はしない
 * （検証にはLIFF側のIDトークンをサーバーで確認する必要があり、今回は
 *   スコープ外。うそのuserIdを送られても、他人のお気に入りが見えたり
 *   壊れたりはしない設計だが、なりすまし追加はできてしまう点は既知の制約）。
 */
const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/;

function favJson(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleFavorites(request, env) {
  if (!env.DB) return favJson(503, { ok: false, error: "not_configured" });

  if (request.method === "GET") {
    const lineUserId = new URL(request.url).searchParams.get("lineUserId") || "";
    if (!LINE_USER_ID_RE.test(lineUserId)) {
      return favJson(400, { ok: false, error: "invalid_line_user_id" });
    }
    const { results } = await env.DB.prepare(
      "SELECT course_id FROM favorites WHERE line_user_id = ? ORDER BY created_at DESC"
    )
      .bind(lineUserId)
      .all();
    return favJson(200, { ok: true, courseIds: results.map((r) => r.course_id) });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return favJson(400, { ok: false, error: "bad_json" });
  }
  const lineUserId = typeof body.lineUserId === "string" ? body.lineUserId : "";
  const courseId = typeof body.courseId === "string" ? body.courseId.trim().slice(0, 20) : "";
  if (!LINE_USER_ID_RE.test(lineUserId)) {
    return favJson(400, { ok: false, error: "invalid_line_user_id" });
  }
  if (!courseId) return favJson(400, { ok: false, error: "invalid_course_id" });

  if (request.method === "POST") {
    await env.DB.prepare(
      "INSERT INTO favorites (line_user_id, course_id, created_at) VALUES (?, ?, ?) " +
        "ON CONFLICT (line_user_id, course_id) DO NOTHING"
    )
      .bind(lineUserId, courseId, Date.now())
      .run();
    return favJson(200, { ok: true });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM favorites WHERE line_user_id = ? AND course_id = ?")
      .bind(lineUserId, courseId)
      .run();
    return favJson(200, { ok: true });
  }

  return new Response("method not allowed", {
    status: 405,
    headers: { allow: "GET, POST, DELETE" },
  });
}

/* ── 計測リンク（/l/<slug>） ──────────────────────────────
 * 宣伝マニュアル §3。人ごと・チャネルごとに違う URL を配り、
 * 「どのチャネルが効いたか」を Cloudflare Web Analytics で数える。
 *
 * 転送（302）はしない。転送するとアドレス欄が「/」に変わり、
 * Analytics のページ別集計から slug が消えて数えられなくなるため
 * （マニュアルにも明記）。/l/kasai のまま、中身はトップと同じものを返す。
 * クエリ文字列（/?s=kasai）でも同じ理由で数えられない。
 */
const TRACKING_SLUGS = new Set([
  "kasai", "shunya", "kimura", "wang",
  "oc1", "oc2", "oc3", "oc4", "oc5",
  "ig", "story", "dm-a", "dm-b", "x",
]);

async function handleTrackingLink(request, env, slug) {
  if (!TRACKING_SLUGS.has(slug)) return null;
  // トップページの中身をそのまま返す。アドレス欄は /l/<slug> のまま残る。
  // ASSETS は /index.html を / へ 307 で寄せるので、リダイレクトは
  // ここで解決して「本文」を取りに行く（そのまま返すとブラウザが / へ飛び、
  // アドレス欄から slug が消えて数えられなくなる）。
  const res = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));
  const headers = new Headers(res.headers);
  // 同じ本文でも「別のURL」として数えたいので、キャッシュはさせない。
  headers.set("cache-control", "no-store");
  // 検索には載せない。本文はトップと同じなので、14本ぶんの重複ページを
  // 作ることになる。web/_headers のパス規則は効かない ―― ここは ASSETS から
  // 「/」を引いているので、付くヘッダも「/」のものになるため。
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(res.body, { status: res.status, headers });
}

/* ── 正本のホスト ───────────────────────────────────────
 * 旧ドメイン（rakutan-db.*.workers.dev）はいまも生きていて、独自ドメインと
 * 同じ本文を配っている。LINE Developers に登録した Webhook URL がこちらの
 * 可能性があるので止められない ―― だから「動かすが、検索には載せない」。
 * 各ページの <link rel="canonical"> と合わせて二重に効かせている。
 */
const CANONICAL_HOST = "rakuhan.nocode-sol.co.jp";

function markNoindex(res) {
  const headers = new Headers(res.headers);
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const res = await route(request, env, ctx);
    // 独自ドメイン以外（旧 workers.dev・ローカル）は検索に載せない。
    return new URL(request.url).hostname === CANONICAL_HOST ? res : markNoindex(res);
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/l/")) {
    const slug = url.pathname.slice(3);
    const res = await handleTrackingLink(request, env, slug);
    if (res) return res;
    return new Response("not found", { status: 404 });
  }

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
  if (url.pathname === "/api/favorites") {
    return handleFavorites(request, env);
  }
  return env.ASSETS.fetch(request);
}
