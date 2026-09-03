/**
 * ラクハン LINE Bot（Cloudflare Workers 版・A案）
 *
 * line/bot.py（プロトタイプ）と同じロジックを Workers に移植したもの。
 * 既存の静的サイト（[assets]）と同じ Worker に同居させる:
 *   - POST /line/webhook  … LINE Messaging API の Webhook
 *   - GET  /line/health   … 死活監視
 *   - POST /api/feedback  … 意見箱（フッタのモーダル → Discord へ中継）
 *   - POST /api/kuchikomi … 口コミ投稿の中継（→ GAS。成功したら Discord へ通知）
 *   - POST /api/hit       … 実際に使われた回数（→ Analytics Engine）
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
 *   REVIEW_DISCORD_WEBHOOK    … 口コミ通知の落とし先。未設定なら通知しない
 *                               （投稿そのものは今まで通り成立する）
 */

// LINEに載せる「サイトのURL」は固定でこちらを使う。
// リクエストを受けたドメイン（request.url）を使うと、LINE Developersに
// 登録した旧URL（*.workers.dev）のままになってしまうため（2026-08-25 吉村さん申請の新ドメイン）。
const SITE_URL = "https://rakuhan.nocode-sol.co.jp";

const PRESET_NAMES = ["バイト優先", "GPA重視", "とにかく軽い", "テストが苦手"];
const GRADE_KANJI = { 1: "1年", 2: "2年", 3: "3年", 4: "4年", 5: "5年", 6: "6年" };
// 学部の問診用の一覧。表示用の写しで、正本は web/data/requirements.json の
// faculties。Worker は env.ASSETS 経由で requirements.json を読めるが、
// 問診の選択肢に必要なのは key と label の11組だけなので、そのために
// 200KB を毎回読むのは重い（tools/test_bot_flow.mjs が正本とのずれを見張る）。
const FACULTIES = [
  ["letters", "文学部"], ["human-sci", "人間科学部"], ["law", "法学部"],
  ["economics", "経済学部"], ["foreign-s", "外国語学部"], ["science", "理学部"],
  ["medicine", "医学部"], ["dentistry", "歯学部"], ["pharmacy", "薬学部"],
  ["engineering", "工学部"], ["engr-sci", "基礎工学部"],
];
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

// LINE の問診で答えた学部・学年を「ラクハンで見る」ボタンのURLに載せる。
// answers が無い／不正なときは今までどおりパラメータなしの ${siteOrigin}/
// のまま（quick_default・自由検索の呼び出し側はそもそも answers を渡してこない）。
// fac は FACULTIES に実在するキーであること、grade は1〜6であることをここで
// 検証する。どちらか片方でも壊れていたら黙って base URL に落とす ――
// 半端なURLでサイト側の osaka_u_settings を汚したくない
// （web/assets/app.js 側の検証はさらに別途 requirements.json で行う。
// ここは「載せる側」の門番）。from=line は「本人がLINEで答えた」印。
// これがあるURLだけをサイト側は本人のプロフィールとして書き込む
// （共有リンクとの区別。web/assets/app.js 参照）。
function siteUri(siteOrigin, answers) {
  const base = `${siteOrigin}/`;
  if (!answers) return base;
  const { grade, fac } = answers;
  const facValid = FACULTIES.some(([key]) => key === fac);
  const gradeNum = Number(grade);
  const gradeValid = Number.isInteger(gradeNum) && gradeNum >= 1 && gradeNum <= 6;
  if (!facValid || !gradeValid) return base;
  const qs = new URLSearchParams({ faculty: fac, year: String(gradeNum), from: "line" });
  return `${base}?${qs.toString()}`;
}

// 見出しテキスト＋Flexカルーセルの2通で返す（LINEは1回のreplyに複数メッセージを積める）。
// answers は省略可（第4引数）。渡すのは「ラクハンで見る」ボタンのURLだけで、
// courses の絞り込み・並び順には一切使わない。
function coursesReply(heading, courses, siteOrigin, answers) {
  const flex = {
    type: "flex",
    altText: heading,
    contents: { type: "carousel", contents: courses.map(courseBubble) },
  };
  if (siteOrigin) {
    flex.quickReply = {
      items: [
        { type: "action", action: { type: "uri", label: "ラクハンで見る", uri: siteUri(siteOrigin, answers) } },
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
// answers は省略可 ―― 問診で答えた学部・学年を「ラクハンで見る」ボタンの
// URLに載せたいときだけ handlePostback から渡ってくる。ここでも
// presetTop[grade] の grade 以外には使わない（学部はスコアリングに一切
// 入れない）。
export function buildRecommendation(grade, preset, data, siteOrigin, answers) {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const presetTop = data.preset_top || {};
  const ids = ((presetTop[grade] || presetTop["1"] || {})[preset] || []).slice(0, 5);
  if (ids.length === 0) {
    return `${GRADE_KANJI[grade] || grade}向けの「${preset}」データが見つかりませんでした。\n\n使い方: ${USAGE_HINT}`;
  }
  const matched = ids.map((id) => courses.get(id)).filter(Boolean);
  const heading = `${GRADE_KANJI[grade] || grade}「${preset}」おすすめ TOP${matched.length}`;
  return coursesReply(heading, matched, siteOrigin, answers);
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

// 「連携・要望」は QR を直接送る（2026-08-29 wangさんの依頼）。
// それまでは「サイト下部のフォームから送ってね」と案内していたが、
// サイトを開いて一番下まで行かせるのは遠すぎた。運営の窓口は GUILD の
// Instagram なので、その QR をこちらから出して1タップで済ませる。
const GUILD_INSTAGRAM_URL = "https://www.instagram.com/osaka_ai_commumity/";
function contactMessage(siteOrigin) {
  const qrUrl = `${siteOrigin || SITE_URL}/assets/guild-instagram-qr.png`;
  return [
    {
      type: "text",
      text:
        "ご意見・連携のご相談は、以下のQRコードからご連絡ください。\n" +
        "ラクハンを運営している学生団体 GUILD の公式Instagramです。",
    },
    {
      type: "image",
      originalContentUrl: qrUrl,
      previewImageUrl: qrUrl,
      // QRを読めない端末・画像を出せない環境のための逃げ道。
      quickReply: {
        items: [
          {
            type: "action",
            action: { type: "uri", label: "Instagramを開く", uri: GUILD_INSTAGRAM_URL },
          },
        ],
      },
    },
  ];
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
// answers は省略可（第3引数）。渡してきた呼び出し元（問診完了＝
// handlePostback の action==="preset"）だけ、ボタンのURLに学部・学年を
// 載せる。quick_default・handleText は渡してこないので今までどおり。
export function withSiteButton(result, siteOrigin, answers) {
  if (typeof result !== "string") return result;
  if (!siteOrigin) return result;
  return {
    type: "text",
    text: result,
    quickReply: {
      items: [
        {
          type: "action",
          action: { type: "uri", label: "ラクハンで見る", uri: siteUri(siteOrigin, answers) },
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

// 降り口はここには置かない ―― 降りるのは greeting の
// 「とにかく楽単を知りたい」1箇所だけ、というのがサイト側と揃えた線
// （設問ごとに逃げ道を作らない）。
export function gradeQuestionMessage() {
  const items = [1, 2, 3, 4, 5, 6].map((g) =>
    qrPostback(`${g}年`, `action=grade&grade=${g}`, `${g}年です`)
  );
  return {
    type: "text",
    text: "今何年生？",
    quickReply: { items },
  };
}

/* 学部。降り口はここにも置かない ―― 理由は gradeQuestionMessage と同じ。
   quick reply の上限は13件なので、11学部はそのまま入る
  （tools/test_bot_flow.mjs で確認）。 */
export function facultyQuestionMessage(grade) {
  return {
    type: "text",
    text: "学部はどこ？",
    quickReply: {
      items: FACULTIES.map(([key, label]) =>
        qrPostback(label, `action=faculty&grade=${grade}&fac=${key}`, label)
      ),
    },
  };
}

// fac は学部キー（省略可）。推薦結果には使わない ―― preset_top は学年だけで
// 引いているので、ここで受け取った fac は次の postback に引き継ぐだけ。
export function presetQuestionMessage(grade, fac) {
  const items = PRESET_NAMES.map((name) =>
    qrPostback(name,
      `action=preset&grade=${grade}&fac=${encodeURIComponent(fac || "")}&preset=${encodeURIComponent(name)}`,
      name)
  );
  return {
    type: "text",
    text: "何を優先する？",
    quickReply: { items },
  };
}

// 戻り値は handleText と同じ形（文字列 / メッセージオブジェクト / 配列）。
//
// save は省略可。渡すと「問診を最後まで答え終えた」時点で
// { grade, fac } を受け取る（呼び出し元が D1 へ保存する）。
// reset は省略可。渡すと「学年・学部を変える」を選んだ時点で呼ばれる。
export function handlePostback(data, evData, siteOrigin, save, reset) {
  const params = new URLSearchParams(evData);
  const action = params.get("action");

  if (action === "start_personal") return gradeQuestionMessage();
  if (action === "reset_profile") {
    if (reset) reset();
    return gradeQuestionMessage();
  }
  if (action === "grade") {
    const grade = params.get("grade") || "1";
    return facultyQuestionMessage(grade);
  }
  if (action === "faculty") {
    const grade = params.get("grade") || "1";
    return presetQuestionMessage(grade, params.get("fac") || "");
  }
  if (action === "preset") {
    const grade = params.get("grade") || "1";
    const preset = params.get("preset") || "とにかく軽い";
    const fac = params.get("fac") || "";
    // fac（学部）は推薦のロジックには一切入れない。preset_top は学年だけで
    // 引いており、buildRecommendation にはスコアリング用途では渡さない。
    // ここで answers として渡すのは「ラクハンで見る」ボタンのURLに
    // 学部・学年を載せるためだけ ―― 問診（学年→学部→優先度）を最後まで
    // 答え終えた、この経路だけが対象（quick_default・自由検索には渡さない）。
    const answers = { grade, fac };
    // ここが問診の終点。次に話しかけられたときに聞き直さずに済むよう覚えておく。
    if (save) save(answers);
    return withSiteButton(
      buildRecommendation(grade, preset, data, siteOrigin, answers),
      siteOrigin,
      answers
    );
  }
  if (action === "quick_default") {
    // grade "1" は「答えたかった学年」ではなく既定値の決め打ち
    // （とにかく楽単を知りたい＝何も聞いていない）。answers を渡すと
    // 「本人が1年と答えた」という嘘の記録をサイト側に残すことになるので、
    // ここは今までどおり answers なし。
    return withSiteButton(buildRecommendation("1", "とにかく軽い", data, siteOrigin), siteOrigin);
  }
  return greetingMessage();
}

/* ── 問診の回答を覚えておく（D1: line_profiles） ─────────────────
 * 2026-08-27 wangさんの依頼「初回でもらった情報をずっと記憶できるように」。
 *
 * これまで学年・学部の回答は postback data と「ラクハンで見る」の URL に
 * 載せて往復させるだけで、どこにも保存していなかった。だから会話が終わると
 * 忘れ、次に話しかけると毎回また学年から聞くことになっていた。
 *
 * 入れるのは学年（1〜6）と学部キー（FACULTIES の11種）だけ。名前・メール等は
 * 取らないし、LINE のプロフィール API も叩かない。
 *
 * D1 が無い／落ちているときは null を返して、これまで通り毎回聞く形に落とす。
 * 覚えられないことでボット自体が止まるのは割に合わない。
 */
async function loadProfile(env, lineUserId) {
  if (!env.DB || !lineUserId) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT grade, faculty FROM line_profiles WHERE line_user_id = ?"
    )
      .bind(lineUserId)
      .first();
    if (!row) return null;
    return { grade: row.grade || "", fac: row.faculty || "" };
  } catch (e) {
    console.error("loadProfile error", e);
    return null;
  }
}

async function saveProfile(env, lineUserId, { grade, fac }) {
  if (!env.DB || !lineUserId) return;
  try {
    await env.DB.prepare(
      "INSERT INTO line_profiles (line_user_id, grade, faculty, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (line_user_id) DO UPDATE SET " +
        "grade = excluded.grade, faculty = excluded.faculty, updated_at = excluded.updated_at"
    )
      .bind(lineUserId, grade || null, fac || null, Date.now())
      .run();
  } catch (e) {
    console.error("saveProfile error", e);
  }
}

async function clearProfile(env, lineUserId) {
  if (!env.DB || !lineUserId) return;
  try {
    await env.DB.prepare("DELETE FROM line_profiles WHERE line_user_id = ?")
      .bind(lineUserId)
      .run();
  } catch (e) {
    console.error("clearProfile error", e);
  }
}

// 覚えている人にだけ出す「前回の続き」の入口。
// 学年・学部を聞き直さず、優先度だけ選べば結果が出る。
export function knownProfileMessage(profile) {
  const gradeLabel = GRADE_KANJI[profile.grade] || `${profile.grade}年`;
  const facLabel = FACULTIES.find(([key]) => key === profile.fac)?.[1];
  const who = facLabel ? `${facLabel}・${gradeLabel}` : gradeLabel;
  return {
    type: "text",
    text: `おかえり！前に聞いた${who}で探すね。何を優先する？`,
    quickReply: {
      items: [
        ...PRESET_NAMES.map((name) =>
          qrPostback(
            name,
            `action=preset&grade=${profile.grade}&fac=${encodeURIComponent(profile.fac || "")}&preset=${encodeURIComponent(name)}`,
            name
          )
        ),
        qrPostback("学年・学部を変える", "action=reset_profile", "学年・学部を変える"),
      ],
    },
  };
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
      // ブロック → 解除で再追加した人には、また学年から聞かない。
      const profile = await loadProfile(env, event.source?.userId || "");
      tasks.push(
        replyToLine(
          env,
          event.replyToken,
          profile?.grade ? knownProfileMessage(profile) : greetingMessage()
        )
      );
      continue;
    }

    const lineUserId = event.source?.userId || "";

    if (event.type === "postback") {
      let reply;
      if (dataError) {
        reply = DATA_UNAVAILABLE_MESSAGE;
      } else {
        try {
          // 保存・削除は返信を待たせない（ctx.waitUntil で後ろに流す）。
          reply = handlePostback(
            data,
            event.postback?.data || "",
            siteOrigin,
            (answers) => ctx.waitUntil(saveProfile(env, lineUserId, answers)),
            () => ctx.waitUntil(clearProfile(env, lineUserId))
          );
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
        const text = (event.message.text || "").trim();
        // 「おすすめ」だけは、覚えている人には学年から聞き直さない。
        // それ以外（科目名の検索など）は今までどおり。
        if (text === "おすすめ") {
          const profile = await loadProfile(env, lineUserId);
          answer = profile?.grade
            ? knownProfileMessage(profile)
            : withSiteButton(handleText(text, data, siteOrigin), siteOrigin);
        } else {
          answer = withSiteButton(handleText(text, data, siteOrigin), siteOrigin);
        }
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

/* ── 口コミの中継（POST /api/kuchikomi） ───────────────────────
 * ブラウザ → Worker → GAS（しゅんやさんのスプレッドシート）。
 * 2026-09-02 まではブラウザから GAS を直接叩いていたので、Worker は
 * 投稿を一件も見られず「口コミが来た」を知る方法が無かった。
 *
 * ここでやることは2つだけ。**シートの列も payload の形も変えない。**
 *   1. 受け取った body をそのまま GAS へ渡し、GAS の応答をそのまま返す
 *   2. GAS が success と答えたときだけ、Discord へ1通鳴らす
 *
 * 優先順位は「投稿 ＞ 通知」。webhook が未設定でも、Discord が落ちていても、
 * body が壊れていても、投稿の中継だけは今まで通り成立させる
 * （通知のために投稿を落とすのは本末転倒）。
 *
 * webhook URL は secret で入れる:
 *   npx wrangler secret put REVIEW_DISCORD_WEBHOOK
 */
const KUCHIKOMI_GAS_URL =
  "https://script.google.com/macros/s/AKfycbwopsnpuXTF6AS7hSxizw4euceYsD1Z_-FVuK4vxCaZHmosmcn2yBqkolUN3UWjENtZ/exec";

const KK_MAX_NAME = 100;   // 科目名
const KK_MAX_LABEL = 40;   // 学部・学科・学年・学期・教員名
const KK_MAX_LINES = 10;   // 1通に並べる科目の数。超えた分は「ほか N 科目」
const KK_MAX_CONTENT = 1900; // Discord の上限は 2000。余白を取る

const KK_SEMESTER = { spring: "春・夏学期", autumn: "秋・冬学期" };

function kkClamp(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/* 通知の本文を組む。自由記述（comment）は載せない ―― 学生が書いた原文を
   チャンネルに転載する必要は無く、読みたければシートを開けばよい。 */
function kkMessage(payload) {
  const sels = Array.isArray(payload && payload.selections) ? payload.selections : [];
  if (!sels.length) return null;

  // 学科は「全学科」（＝学科を分けていない学部の既定値）のときだけ落とす。
  // 見出しに情報を足さないうえ、毎回同じ文字列が並んで読みにくくなる。
  const department = kkClamp(payload.department, KK_MAX_LABEL);
  const head = [
    kkClamp(payload.faculty, KK_MAX_LABEL),
    department === "全学科" ? "" : department,
    kkClamp(payload.grade, KK_MAX_LABEL),
    KK_SEMESTER[payload.semester] || kkClamp(payload.semester, KK_MAX_LABEL),
  ]
    .filter(Boolean)
    .join("・");

  const lines = [`📝 口コミが1件（${sels.length}科目）${head ? "  " + head : ""}`];
  for (const s of sels.slice(0, KK_MAX_LINES)) {
    const sub = (s && s.subject) || {};
    const name = kkClamp(sub.name, KK_MAX_NAME) || "（科目名なし）";
    const teacher = kkClamp(sub.teacher, KK_MAX_LABEL);
    lines.push(`・${name}${teacher ? `（${teacher}）` : ""}`);
  }
  if (sels.length > KK_MAX_LINES) {
    lines.push(`… ほか ${sels.length - KK_MAX_LINES} 科目`);
  }
  return lines.join("\n").slice(0, KK_MAX_CONTENT);
}

/* 通知は投稿の応答を待たせない（ctx.waitUntil）。失敗はログだけ。
   ここで投げると投稿まで巻き添えになるので、外へは絶対に投げない。 */
async function kkNotify(webhook, content) {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content,
        // 本文には科目名（＝KOAN の原文）が入る。@everyone と読める並びが
        // 来ても飛ばさない。
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) console.error("review webhook failed", res.status);
  } catch (e) {
    console.error("review webhook error", e);
  }
}

function kkError(message) {
  return new Response(JSON.stringify({ status: "error", message }), {
    status: 502,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleKuchikomi(request, env, ctx) {
  // body は書き換えない。GAS 側のパースも列も 2026-09-02 以前のまま。
  const raw = await request.text();

  let gasRes;
  try {
    gasRes = await fetch(env.KUCHIKOMI_GAS_URL || KUCHIKOMI_GAS_URL, {
      method: "POST",
      // ブラウザが直接叩いていたときと同じ content-type を保つ
      // （GAS は e.postData.contents を読む）。
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: raw,
    });
  } catch (e) {
    console.error("gas relay error", e);
    return kkError("relay_failed");
  }
  if (!gasRes.ok) {
    console.error("gas relay status", gasRes.status);
    return kkError("relay_failed");
  }

  const body = await gasRes.text();

  // ここから先は付随。何が起きても投稿の応答（下の return）には影響させない。
  const webhook = env.REVIEW_DISCORD_WEBHOOK;
  if (webhook) {
    let ok = false;
    try {
      ok = JSON.parse(body)?.status === "success";
    } catch {
      ok = false; // GAS が JSON を返さなかった＝入ったか分からない。鳴らさない
    }
    if (ok) {
      let content = null;
      try {
        content = kkMessage(JSON.parse(raw));
      } catch {
        content = null; // 中身が読めないなら通知は諦める。投稿は通す
      }
      if (content) ctx.waitUntil(kkNotify(webhook, content));
    }
  }

  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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
 *
 * 🚨 ただし、ここで付ける noindex が届くのは **Worker が走る経路だけ**。
 * Workers の静的アセットは Worker スクリプトより先に配られるので、
 * `/` や `/about` のような「アセットが存在するパス」はこの関数を通らない
 * （2026-08-26 に本番で実測。`/l/kasai` には付くのに `/` には付かなかった）。
 * つまり旧ドメインのページを検索から外しているのは、実際には
 * 各ページの <link rel="canonical"> のほう。ここが効くのは
 * /l/<slug>・/api/*・/line/* といった Worker 側のURLに限られる。
 *
 * ページにも確実に付けたいなら wrangler.toml の [assets] に
 * run_worker_first = ["/", "/about", "/ads", "/kuchikomi", "/partners"]
 * を足す（＝ページ表示1回ごとに Worker が1回走る）。9/2 のピークを前に
 * 配信経路を変えたくないので、今日は入れていない。
 */
const CANONICAL_HOST = "rakuhan.nocode-sol.co.jp";

/* ── 実際に使われた回数（POST /api/hit） ──────────────────
 *
 * Cloudflare Web Analytics の数字は下限にしかならない。beacon が
 * cloudflareinsights.com にあるので、広告ブロッカー（Brave / uBlock /
 * DuckDuckGo）が塞ぐ。ここは同じドメインなので塞がれない。
 *
 * クローラは JS を動かさないので、そもそもここには来ない。
 * 来たとしても UA と Origin で落とす。
 *
 * 置かないもの: Cookie・端末ID・IP・検索語・科目ID。
 * 残すのは「いつ・どの種類の操作が・どのパスで」の3つだけ。
 */
const HIT_EVENTS = new Set(["pv", "search", "detail"]);

// JS を動かすクローラ（Googlebot のレンダリング・監視サービス・Lighthouse）を落とす。
const HIT_BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|monitor|uptime|preview/i;

/* 「合わない Origin だけを弾く」。付いていないものまで弾かないのは、
   独自ドメインが nginx（VPS）を通って Worker へ来るため
   ―― 中継のヘッダ設定ひとつで集計が静かにゼロになるのが一番まずい。
   Origin が無いときは Referer を見て、どちらも無ければ通す。
   ここを通り抜けられるのは「JSON を POST できる誰か」だけで、
   その量は UA の判定と MAX（クライアント側60件/ページ）で頭打ちになる。 */
function hitFromOurSite(request) {
  const raw = request.headers.get("Origin") || request.headers.get("Referer");
  if (!raw) return true;
  let host;
  try { host = new URL(raw).hostname; } catch (e) { return false; }
  return host === CANONICAL_HOST || host.endsWith(".workers.dev")
      || host === "localhost" || host === "127.0.0.1";
}

async function handleHit(request, env) {
  /* 返すのは常に 204。数えられなかったことを画面に出す意味は無い
     ―― 計測の失敗で利用者の操作を止めない。 */
  const done = () => new Response(null, { status: 204 });

  if (request.method !== "POST") return done();
  if (HIT_BOT_UA.test(request.headers.get("User-Agent") || "")) return done();
  if (!hitFromOurSite(request)) return done();

  let body;
  try { body = await request.json(); } catch (e) { return done(); }
  const event = String(body?.e ?? "");
  if (!HIT_EVENTS.has(event)) return done();

  /* パスだけを残し、クエリは落とす。?c=<科目id> まで残すと
     「誰が何を見たか」に近づく。/l/<slug> は残るので、チャネルごとの
     効き目は自前の数字でも比較できる。 */
  let path = "/";
  try { path = new URL(String(body?.p ?? "/"), "https://x").pathname.slice(0, 64); } catch (e) {}

  const fresh = body?.n === 1 ? 1 : 0;   // その訪問の1回目（クライアントの sessionStorage 判定）

  /* 束ねていないので1リクエスト1件。writeDataPoint は投げっぱなしで
     例外も返り値も無いが、束縛が無い env（ローカル・テスト）では
     undefined になるので ?. で守る。計測のために本番を落とさない。 */
  try {
    env.STATS?.writeDataPoint({
      blobs: [event, path],
      doubles: [1, fresh],
      indexes: [event],
    });
  } catch (e) {}

  return done();
}

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
  if (url.pathname === "/api/kuchikomi") {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
    }
    return handleKuchikomi(request, env, ctx);
  }
  if (url.pathname === "/api/favorites") {
    return handleFavorites(request, env);
  }
  if (url.pathname === "/api/hit") {
    return handleHit(request, env);
  }
  return env.ASSETS.fetch(request);
}
