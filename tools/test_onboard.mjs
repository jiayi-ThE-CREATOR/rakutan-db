/* 開屏の問診。「降りるのは問診そのもの、設問ごとではない」を守れているか。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_onboard.mjs http://localhost:8140
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();

async function fresh() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // 演出は飛ばす。問診の門は rk_onboarded であって splash ではない。
  await page.addInitScript(() => {
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  return { ctx, page };
}

// ① 初回は出る
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/");
  await page.waitForSelector("#onboard[data-step='gate']", { timeout: 15000 });
  check(true, "初回に問診が出る");

  // ② 「そのまま使う」で降りると1問も聞かれず、profile も書かれない
  await page.click("#onboardSkip");
  check(await page.locator("#onboard").isHidden(), "降りたのに閉じない");
  const set = await page.evaluate(() => localStorage.getItem("osaka_u_settings"));
  check(!set || !JSON.parse(set).faculty, "降りたのに学部が書かれている");
  check(await page.evaluate(() => localStorage.getItem("rk_onboarded")) === "1",
        "降りたのに rk_onboarded が立っていない");

  // ③ 再訪では出ない
  await page.reload();
  await page.waitForSelector(".card", { timeout: 15000 });
  check(await page.locator("#onboard").isHidden(), "2回目にも問診が出た");
  await ctx.close();
}

// ④ 答えると settings に入り、絞り込みに反映される
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/");
  await page.waitForSelector("#onboard[data-step='gate']", { timeout: 15000 });
  await page.click("#onboardStart");

  await page.waitForSelector("#onboard[data-step='faculty']");
  const facs = await page.locator("#onboard [data-faculty]").count();
  check(facs === 11, `学部が11個出るべき（いま ${facs}）`);
  // 設問の中に逃げ道が無いこと ―― 降りるのは gate だけ
  check(await page.locator("#onboard[data-step='faculty'] #onboardSkip").count() === 0,
        "設問の中に「答えたくない」が居る（gate だけに置く約束）");

  await page.click("#onboard [data-faculty='law']");
  await page.waitForSelector("#onboard[data-step='grade']");
  await page.click("#onboard [data-grade='2']");

  check(await page.locator("#onboard").isHidden(), "答え終わっても閉じない");
  const set = JSON.parse(await page.evaluate(() => localStorage.getItem("osaka_u_settings")));
  check(set.faculty === "law", "学部が保存されていない");
  check(set.grade === "2", "学年が保存されていない");

  // 画面に反映されていること（学年チップの 2年 が選ばれている）
  await page.waitForSelector("#years .chip.on");
  const on = await page.locator("#years .chip.on").textContent();
  check(on.includes("2年"), `学年チップが反映されていない（いま ${on}）`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
