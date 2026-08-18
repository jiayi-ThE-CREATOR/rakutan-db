/* 静的モードとAPIモードの両方で画面が成立するかを実ブラウザで確認する。
 *   node tools/smoke.mjs http://localhost:8140   （静的：Cloudflare相当）
 *   node tools/smoke.mjs http://localhost:8000   （server.py）
 * コンソールエラーが1件でもあれば異常終了する。 */
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8140";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });  // iPhone相当
const errs = [];
// /api/health への 404 は「静的配信かどうか」を判定するための想定内の失敗。
const expected = t => /\/api\/(health|meta)/.test(t) || /status of 404/.test(t);
p.on("console", m => m.type() === "error" && !expected(m.text()) && errs.push(m.text()));
p.on("pageerror", e => errs.push(String(e)));

await p.goto(url, { waitUntil: "networkidle" });
await p.waitForSelector(".card", { timeout: 15000 });

const r = await p.evaluate(() => ({
  mode: DATA.mode,
  canPost: CAN_POST,
  count: $("#count").textContent,
  cards: document.querySelectorAll(".card").length,
  fab: $("#fab").textContent,
  first: document.querySelector(".card .title")?.textContent,
  fit: document.querySelector(".card .fit b")?.textContent,
}));

console.log(`  mode      ${r.mode}`);
console.log(`  件数      ${r.count}（カード ${r.cards}枚）`);
console.log(`  投稿      CAN_POST=${r.canPost} / FAB「${r.fab}」`);
console.log(`  先頭      ${r.first}  相性 ${r.fit}`);
console.log(errs.length ? `  ✗ エラー ${errs.length}件\n    ${errs.join("\n    ")}`
                        : "  ✓ コンソールエラーなし");
await b.close();
process.exit(errs.length ? 1 : 0);
