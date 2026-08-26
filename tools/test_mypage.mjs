/* マイページ。まずは「在ること」と「プロフィールが往復すること」。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_mypage.mjs http://localhost:8140
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("rk_onboarded", "1");
    localStorage.setItem("osaka_u_settings",
      JSON.stringify({ faculty: "law", grade: "2", semester: "autumn" }));
  } catch (e) {}
});

await page.goto(BASE + "/mypage.html");
await page.waitForSelector("#mpProfile");

check(await page.locator("#mpTimetable").count() === 1, "時間割の入れ物が無い");
check(await page.locator("#mpFavorites").count() === 1, "お気に入りの入れ物が無い");

// ナビが4項目で、現在地が付いていること
check(await page.locator(".nav a").count() === 4, "ナビが4項目でない");
check(await page.locator('.nav a[data-nav="mypage"][aria-current="page"]').count() === 1,
      "マイページに現在地が付いていない");

// プロフィールが読めていること
check(await page.locator("#mpFaculty").inputValue() === "law", "学部が読めていない");
check(await page.locator("#mpGrade").inputValue() === "2", "学年が読めていない");

// 変えると保存され、kuchikomi の semester を壊さないこと
await page.selectOption("#mpGrade", "3");
const set = JSON.parse(await page.evaluate(() => localStorage.getItem("osaka_u_settings")));
check(set.grade === "3", "学年の変更が保存されない");
check(set.semester === "autumn", "kuchikomi の semester を壊した");

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
