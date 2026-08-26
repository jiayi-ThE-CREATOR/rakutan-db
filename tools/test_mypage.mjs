/* マイページ。まずは「在ること」と「プロフィールが往復すること」。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_mypage.mjs http://localhost:8140
 */
import { chromium } from "playwright";

const DAYS_X_PERIODS = 5 * 6;   // 月〜金 × 1〜6限

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

// ── 時間割 ────────────────────────────────
await page.waitForSelector(".mpCell[data-slot='月2']");
check(await page.locator(".mpCell").count() === DAYS_X_PERIODS,
      `マスが ${DAYS_X_PERIODS} 個であるべき`);

await page.click(".mpCell[data-slot='月2']");
await page.waitForSelector("#mpPicker[open]");
const opts = await page.locator("#mpPicker .mpPick").count();
check(opts > 0, "月2 の科目が1つも出てこない");

const pickedId = await page.locator("#mpPicker .mpPick").first().getAttribute("data-id");
await page.locator("#mpPicker .mpPick").first().click();
check(await page.locator(".mpCell[data-slot='月2']").textContent() !== "",
      "選んだのにマスが空のまま");

let tt = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt.aki.slots["月2"] === pickedId, "aki の 月2 に入っていない");
check(!tt.haru.slots["月2"], "haru にも漏れている（学期は別の表）");

// 学期を切り替えると空であること
await page.click("[data-term='haru']");
check(await page.locator(".mpCell[data-slot='月2']").textContent().then(t => t.trim()) === "",
      "春学期に秋学期の科目が出ている");
await page.click("[data-term='aki']");

// 再読込しても残る
await page.reload();
await page.waitForSelector(".mpCell[data-slot='月2']");
check((await page.locator(".mpCell[data-slot='月2']").textContent()).trim() !== "",
      "再読込で時間割が消えた");

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
