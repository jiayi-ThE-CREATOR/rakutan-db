/* 口コミ投稿の中継（ブラウザ → Worker → GAS）と Discord 通知を確かめる。
 *   node tools/test_kuchikomi_relay.mjs
 *
 * ここで守りたいのは3つ。
 *  1. 投稿が最優先 ―― Discord が落ちていても、JSON が壊れていても、
 *     GAS への中継とクライアントへの応答は今まで通り成り立つ
 *  2. GAS が success を返したときだけ鳴らす ―― 入っていない口コミを
 *     「入りました」と通知しない
 *  3. Worker はクライアントを信じない ―― 長さも件数も自分で切る
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

// ── 1. 静的な配線 ──────────────────────────────
// 投稿先が Worker になっていること。ここが script.google.com のままだと
// Worker は投稿を一件も見られず、通知は永久に鳴らない。
const client = read("web/assets/kuchikomi.js");
check(client.includes("/api/kuchikomi"), "kuchikomi.js が /api/kuchikomi へ送っていない");
check(
  !/fetch\(\s*GAS_URL/.test(client) && !/https:\/\/script\.google\.com[^\n]*',\s*\{/.test(client),
  "kuchikomi.js が GAS を直接叩いたままになっている"
);

// ── 2. Worker の POST /api/kuchikomi ───────────
const worker = (await import(path.join(ROOT, "worker/index.js"))).default;

const ASSETS = { fetch: async () => new Response("asset", { status: 200 }) };
const WEBHOOK = "https://discord.test/webhook";
const GAS = "https://gas.test/exec";

const PAYLOAD = {
  grade: "2年",
  semester: "spring",
  faculty: "基礎工学部",
  department: "電子物理科学科",
  selections: [
    { day: "月", period: 1, subject: { id: "135761", name: "線形代数学I", teacher: "佐藤", review: { comment: "毎回出席が取られる" } } },
    { day: "火", period: 2, subject: { id: "135762", name: "基礎工学のための数学A", teacher: "田中", review: { comment: "" } } },
  ],
};

// 外部通信は全部ここで捕まえる。GAS の応答は差し替えられるようにしておく。
let sent = [];
let gasReply = () => new Response(JSON.stringify({ status: "success" }), { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  sent.push({ url: u, init, body: init?.body });
  if (u === GAS) return gasReply(init);
  return new Response(null, { status: 204 });
};

const waits = [];
const post = (body, env = { ASSETS, REVIEW_DISCORD_WEBHOOK: WEBHOOK, KUCHIKOMI_GAS_URL: GAS }) => {
  sent = [];
  waits.length = 0;
  return worker.fetch(
    new Request("https://rakutan.test/api/kuchikomi", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
    { waitUntil: (p) => waits.push(p) }
  );
};
// 通知は waitUntil に載せて応答を待たせない。テスト側で明示的に待つ。
const settle = () => Promise.all(waits);

const toGas = () => sent.find((s) => s.url === GAS);
const toDiscord = () => sent.filter((s) => s.url === WEBHOOK);
const discordText = () => String(JSON.parse(toDiscord()[0].body).content);

// ── 正常系 ──
let res = await post(PAYLOAD);
await settle();
check(res.status === 200, `正常な投稿が 200 でない: ${res.status}`);
check((await res.clone().json())?.status === "success", "GAS の応答をそのまま返していない");
check(!!toGas(), "GAS へ中継していない");
check(toGas()?.body === JSON.stringify(PAYLOAD), "GAS へ渡す body を書き換えている（列が壊れる）");
check(toDiscord().length === 1, `Discord への通知が1通でない: ${toDiscord().length}`);

const text = discordText();
check(text.includes("2科目"), "科目数が載っていない");
check(text.includes("線形代数学I"), "科目名が載っていない");
check(text.includes("佐藤"), "教員名が載っていない");
check(text.includes("基礎工学部"), "学部が載っていない");
check(text.includes("2年"), "学年が載っていない");
check(text.includes("春・夏学期"), "学期が日本語になっていない");
check(!text.includes("毎回出席が取られる"), "自由記述を Discord に転載している（設計では載せない）");
check(
  JSON.parse(toDiscord()[0].body)?.allowed_mentions?.parse?.length === 0,
  "allowed_mentions を閉じていない（@everyone を飛ばしうる）"
);

// 学科を分けていない学部は department が「全学科」で来る。見出しに情報を
// 足さないので落とす（学科がある学部はそのまま出す ―― 上の 電子物理科学科）。
check(text.includes("電子物理科学科"), "学科が載っていない");
res = await post({ ...PAYLOAD, department: "全学科" });
await settle();
check(!discordText().includes("全学科"), "「全学科」を見出しに出している（毎回同じ文字列で読みにくい）");
check(discordText().includes("基礎工学部"), "学科を落とすときに学部まで消えている");

// ── GAS が success を返さない ──
gasReply = () => new Response(JSON.stringify({ status: "error", message: "sheet locked" }), { status: 200 });
res = await post(PAYLOAD);
await settle();
check(res.status === 200, "GAS のエラー応答をそのまま返していない");
check((await res.clone().json())?.message === "sheet locked", "GAS のエラー内容が失われている");
check(toDiscord().length === 0, "シートに入っていない口コミを「入った」と通知している");

// ── GAS が HTTP エラー ──
gasReply = () => new Response("boom", { status: 500 });
res = await post(PAYLOAD);
await settle();
check(res.status === 502, `GAS が 500 のとき 502 を返していない: ${res.status}`);
check(toDiscord().length === 0, "GAS が失敗したのに通知している");

// ── GAS へ届かない（ネットワーク断） ──
gasReply = () => { throw new Error("network"); };
res = await post(PAYLOAD);
await settle();
check(res.status === 502, `GAS へ到達できないとき 502 を返していない: ${res.status}`);
check(toDiscord().length === 0, "GAS へ届いていないのに通知している");

gasReply = () => new Response(JSON.stringify({ status: "success" }), { status: 200 });

// ── 投稿が最優先：JSON が壊れていても中継は通す ──
res = await post("これはJSONではない");
await settle();
check(res.status === 200, "壊れた本文で中継を止めている（投稿より通知を優先している）");
check(toGas()?.body === "これはJSONではない", "壊れた本文を書き換えて GAS へ渡している");
check(toDiscord().length === 0, "中身が読めないのに通知を組み立てている");

// ── 投稿が最優先：webhook 未設定でも投稿は成功する ──
res = await post(PAYLOAD, { ASSETS, KUCHIKOMI_GAS_URL: GAS });
await settle();
check(res.status === 200, "webhook 未設定で投稿が失敗している");
check(toDiscord().length === 0, "webhook 未設定なのに送信を試みている");

// ── 投稿が最優先：Discord が落ちていても投稿は成功する ──
const realDiscord = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === WEBHOOK) throw new Error("discord down");
  return realDiscord(url, init);
};
res = await post(PAYLOAD);
await settle();
check(res.status === 200, "Discord が落ちていると投稿まで失敗する");
globalThis.fetch = realDiscord;

// ── クライアントを信じない ──
const many = {
  ...PAYLOAD,
  faculty: "学".repeat(200),
  selections: Array.from({ length: 25 }, (_, i) => ({
    day: "月", period: 1,
    subject: { id: String(i), name: "科".repeat(300) + i, teacher: "教".repeat(300), review: {} },
  })),
};
res = await post(many);
await settle();
const long = discordText();
check(long.length <= 2000, `Discord の 2000字上限を超えている: ${long.length}`);
check((long.match(/^・/gm) || []).length <= 10, "科目の行を10件で切っていない");
check(long.includes("ほか"), "切り捨てた件数を「ほか N 件」で示していない");
check(long.includes("25科目"), "実際の科目数（25）を伝えていない");

// ── メソッド ──
res = await worker.fetch(
  new Request("https://rakutan.test/api/kuchikomi", { method: "GET" }),
  { ASSETS, REVIEW_DISCORD_WEBHOOK: WEBHOOK, KUCHIKOMI_GAS_URL: GAS },
  { waitUntil: () => {} }
);
check(res.status === 405, `GET が 405 でない: ${res.status}`);

globalThis.fetch = realFetch;

if (fails.length) {
  console.log("NG");
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log(`  通過 ${n} 件`);
console.log("OK");
