/* 意見箱（フッタ → モーダル → Worker → Discord）の配線と境界値を確かめる。
 *   node tools/test_feedback.mjs
 *
 * ここで守りたいのは3つ。
 *  1. 入口はフッタの「一番下」にある（GUILD の運営表記より後ろ）
 *  2. 入口の正本は templates/shell.html ひとつで、両ページに注入ずみ
 *  3. Worker は クライアントを信じない ―― 長さも空も honeypot も自分で判定する
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const LABEL = "ご意見・改善要望";
const REDLINE = "学生団体 GUILD が運営しています";

// ── 1. 静的な配線 ──────────────────────────────
const shell = read("templates/shell.html");
check(shell.includes(LABEL), `shell.html に「${LABEL}」が無い`);
check(
  shell.indexOf(LABEL) > shell.indexOf(REDLINE),
  "意見箱の入口が GUILD の運営表記より前にある（図の指示は「一番下」）"
);
check(shell.includes("/assets/feedback.js"), "shell.html が feedback.js を読み込んでいない");
check(shell.includes("/assets/feedback.css"), "shell.html が feedback.css を読み込んでいない");
check(existsSync(path.join(ROOT, "web/assets/feedback.js")), "web/assets/feedback.js が無い");
check(existsSync(path.join(ROOT, "web/assets/feedback.css")), "web/assets/feedback.css が無い");

// ページを名指ししない。次の人がページを足したとき、
// 意見箱と CSS が付いてこなければここで落ちる（kuchikomi.html で実際に漏れた）。
const pages = readdirSync(path.join(ROOT, "web"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => "web/" + f);
check(pages.length >= 2, "web/*.html が見つからない");
for (const page of pages) {
  const html = read(page);
  check(html.includes(LABEL), `${page} に入口が無い（build.py を流していない）`);
  check(html.includes("/assets/feedback.css"), `${page} に feedback.css が入っていない`);
  check(html.includes("/assets/feedback.js"), `${page} に feedback.js が入っていない`);
}

// app.css / app.js は他の人の担当。意見箱がそこへ漏れていないこと。
check(!read("web/assets/app.css").includes(LABEL), "意見箱の見た目が app.css に漏れている");

// ── 2. Worker の POST /api/feedback ────────────
const worker = (await import(path.join(ROOT, "worker/index.js"))).default;

const ASSETS = { fetch: async () => new Response("asset", { status: 200 }) };
const WEBHOOK = "https://discord.test/webhook";

// Discord への送信を捕まえる。実際の外部通信はしない。
let sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(null, { status: 204 });
};

const post = (body, env = { ASSETS, FEEDBACK_DISCORD_WEBHOOK: WEBHOOK }) => {
  sent = [];
  return worker.fetch(
    new Request("https://rakutan.test/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil: () => {} }
  );
};

let res = await post({ text: "空きコマ表が見やすい", from: "/?year=1" });
check(res.status === 200, `正常な投稿が 200 でない: ${res.status}`);
check(sent.length === 1, "Discord へ送っていない");
check(sent[0]?.url === WEBHOOK, "送信先が webhook でない");
check(String(sent[0]?.body?.content).includes("空きコマ表が見やすい"), "本文が載っていない");
check(String(sent[0]?.body?.content).includes("/?year=1"), "送信元URLが載っていない");

res = await post({ text: "   " });
check(res.status === 400, `空の本文が 400 でない: ${res.status}`);
check(sent.length === 0, "空の本文を Discord へ送ってしまった");

res = await post({ text: "あ".repeat(3000), contact: "x".repeat(500) });
check(res.status === 200, `長文が 200 でない: ${res.status}`);
const long = sent[0]?.body?.content ?? "";
check((long.match(/あ/g) || []).length === 1000, "本文を1000字で切っていない（クライアントを信じている）");
check((long.match(/x/g) || []).length === 200, "連絡先を200字で切っていない");

// honeypot ―― 埋まっていたら bot。受け付けたふりをして捨てる。
res = await post({ text: "宣伝です", website: "http://spam.example" });
check(res.status === 200, "honeypot で 200 を返していない（bot に検知を教えている）");
check(sent.length === 0, "honeypot が埋まった投稿を Discord へ送ってしまった");

res = await post({ text: "意見" }, { ASSETS });
check(res.status === 503, `secret 未設定が 503 でない: ${res.status}`);

res = await worker.fetch(
  new Request("https://rakutan.test/api/feedback", { method: "GET" }),
  { ASSETS, FEEDBACK_DISCORD_WEBHOOK: WEBHOOK },
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
