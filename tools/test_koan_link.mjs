/* 「KOANを開く」ボタン（2026-09-28）が押せて、コードがコピーされることを実ブラウザで見る。
 *   python3 tools/serve.py 8833 &
 *   node tools/test_koan_link.mjs http://127.0.0.1:8833
 *
 * 見ること:
 *   - 詳細の主ボタン（a.koanMain）が、その科目の KOAN 公式シラバスを新しいタブで開く
 *     （2026-10-25 に「KOANを開いて履修登録する」から置き換えた）
 *   - マイページの #mpKoan が同じ URL を指す
 *   - 360px 幅でマイページのツールバーが横にはみ出さない（ボタンが2つになったため）
 * KOAN へは実際には繋がない（新しいタブは開いた瞬間に中止する）。 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8833";
const KOAN = "https://koan.osaka-u.ac.jp/campusweb/campusportal.do";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();
for (const [label, viewport] of [["PC", { width: 1280, height: 900 }], ["スマホ", { width: 360, height: 780 }]]){
  const ctx = await browser.newContext({ viewport });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  /* KOAN には繋がない。 */
  /* 止めた宛先は控えておく ―― 開いたタブの URL は中止後 chrome-error:// になるので、
     「どこへ行こうとしたか」はこちらで見る。 */
  const koanHits = [];
  await ctx.route("https://koan.osaka-u.ac.jp/**", r => { koanHits.push(r.request().url()); r.abort(); });
  /* 初回案内（onboard.js）はスマホ幅で詳細の上にかぶる。他のテストと同じく見た扱いにする。 */
  await ctx.addInitScript(() => { try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {} });
  const page = await ctx.newPage();

  await page.goto(BASE + "/");
  await page.waitForSelector("#list > .card");
  const card = page.locator("#list > .card").first();
  const id = await card.getAttribute("data-id");
  await card.locator(".head .title").click();
  const main = page.locator(".detail a.koanMain, #inspector a.koanMain").first();
  await main.waitFor({ state: "visible" });
  const href = await main.getAttribute("href");
  check(href.includes("SYW4201600-flow") && href.includes(`j_cd=${id}`), `[${label}] 詳細の主ボタンがこの科目のシラバスを指していない: ${href}`);
  check(await main.getAttribute("target") === "_blank", `[${label}] 詳細の主ボタンが新しいタブで開かない`);
  const [popup] = await Promise.all([ctx.waitForEvent("page"), main.click()]);
  await popup.waitForLoadState().catch(() => {});
  check(koanHits.some(u => u.includes(`j_cd=${id}`)), `[${label}] 押してもシラバスのタブが開かない: ${JSON.stringify(koanHits)}`);
  await popup.close();
  check(await page.locator("a.koanReg").count() === 0, `[${label}] 詳細に「履修登録する」ボタンが残っている`);
  await page.screenshot({ path: `${process.env.SHOT_DIR || "."}/koan_detail_${label}.png` });

  /* ローカルの serve.py は /mypage → mypage.html を読み替えない（本番の Cloudflare は読み替える）。 */
  await page.goto(BASE + "/mypage.html");
  const mk = page.locator("#mpKoan");
  await mk.waitFor({ state: "attached" });
  check(await mk.getAttribute("href") === KOAN, `[${label}] マイページの KOAN ボタンの href が違う`);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!over, `[${label}] マイページが横にはみ出している`);
  await page.locator("#mpTimetable").screenshot({ path: `${process.env.SHOT_DIR || "."}/koan_mypage_${label}.png` });
  await ctx.close();
}
await browser.close();

if (fails.length){ console.log(`✗ ${fails.length}/${n}`); fails.forEach(f => console.log("  - " + f)); process.exit(1); }
console.log(`✓ ${n} 件すべて通過`);
