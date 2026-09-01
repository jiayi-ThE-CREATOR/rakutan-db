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

// ⑤ requirements.json が壊れていても行き止まりにしない（Critical 回帰）
{
  const { ctx, page } = await fresh();
  // 学部データの読み込みだけを落とす。courses.built.json は生きているので
  // 裏のページ自体は普通に描画される ―― 「問診だけが行き止まりになる」を再現する。
  await page.route("**/data/requirements.json", route => route.abort());
  await page.goto(BASE + "/");
  await page.waitForSelector(".card", { timeout: 15000 }); // 裏のページは動いている
  // splash 演出の完了（最長 1.4s + トランジション/フォールバック 600ms）を待ってから見る。
  await page.waitForTimeout(2500);
  check(await page.locator("#onboard").count() === 0,
        "requirements.json が壊れているのに問診が出た（ボタン0個の行き止まり）");
  check(await page.evaluate(() => localStorage.getItem("rk_onboarded")) !== "1",
        "requirements.json が壊れているのに rk_onboarded を立てた（次回も同じ行き止まりを踏む）");
  // 裏のページがまだ操作できること（星を押せる＝上に覆いが乗っていない）。
  await page.click(".card .favBtn");
  const pressed = await page.locator(".card .favBtn").first().getAttribute("aria-pressed");
  check(pressed === "true", "裏のページが操作できない（問診オーバーレイが塞いでいる）");
  await ctx.close();
}

// ⑥ rk:splash-done は一度だけ（transitionend と setTimeout の二重発火ガード）
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // splash.js より前にリスナーを仕込む。addInitScript はどのページスクリプトより先に走る。
  await page.addInitScript(() => {
    window.__splashDoneCount = 0;
    window.addEventListener("rk:splash-done", () => { window.__splashDoneCount++; });
  });
  await page.goto(BASE + "/");
  // 演出を実際に流させる（sessionStorage に rk_splash_seen を仕込まない）。
  await page.waitForTimeout(2500);
  const cnt = await page.evaluate(() => window.__splashDoneCount);
  check(cnt === 1, `rk:splash-done が1回でない（いま ${cnt} 回）`);
  await ctx.close();
}

// ⑦ フォーカストラップ：カードの境界から Tab / Shift+Tab しても #onboard の外に出ない
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/");
  await page.waitForSelector("#onboard[data-step='gate']", { timeout: 15000 });

  // 最後のボタン（そのまま使う）から Tab → 裏のページに抜けないこと
  await page.locator("#onboardSkip").focus();
  await page.keyboard.press("Tab");
  const afterTab = await page.evaluate(() =>
    document.getElementById("onboard").contains(document.activeElement));
  check(afterTab, "gate の最後のボタンから Tab すると #onboard の外に出る");

  // 最初のボタン（教える）から Shift+Tab → 裏のページに抜けないこと
  await page.locator("#onboardStart").focus();
  await page.keyboard.press("Shift+Tab");
  const afterShiftTab = await page.evaluate(() =>
    document.getElementById("onboard").contains(document.activeElement));
  check(afterShiftTab, "gate の最初のボタンから Shift+Tab すると #onboard の外に出る");

  // 設問側（学部11個）でも同じ境界が効くこと。「見えているカードだけ」を見ているかの確認。
  await page.click("#onboardStart");
  await page.waitForSelector("#onboard[data-step='faculty']");
  const facButtons = page.locator("#onboard[data-step='faculty'] [data-faculty]");
  await facButtons.last().focus();
  await page.keyboard.press("Tab");
  const afterFacTab = await page.evaluate(() =>
    document.getElementById("onboard").contains(document.activeElement));
  check(afterFacTab, "faculty の最後のボタンから Tab すると #onboard の外に出る");
  await ctx.close();
}

// ⑧ LINE 公式アカウントの問診経由（from=line 付き）は、問診を出さずに
//    その回答をそのまま「本人の回答」として確定する。
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/?faculty=law&year=2&from=line");
  await page.waitForSelector(".card", { timeout: 15000 });
  // splash演出＋app-ready が揃うまで待つ（④⑤と同じ待ち方）。
  await page.waitForTimeout(2500);
  check(await page.locator("#onboard").count() === 0,
        "from=line で届いたのに問診が出た（二重に聞いている）");
  const set = JSON.parse(await page.evaluate(() => localStorage.getItem("osaka_u_settings")) || "{}");
  check(set.faculty === "law", "from=line の学部が osaka_u_settings に書かれていない");
  check(set.grade === "2", "from=line の学年が osaka_u_settings に書かれていない");
  check(await page.evaluate(() => localStorage.getItem("rk_onboarded")) === "1",
        "from=line で届いたのに rk_onboarded が立っていない");
  // bot のボタンから来た＝公式アカウントと繋がっている。マイページの
  // 「LINE 連携済み」はこの印だけを見る（web/assets/store.js の rk_line_linked）。
  check(await page.evaluate(() => localStorage.getItem("rk_line_linked")) === "1",
        "from=line で届いたのに rk_line_linked が立っていない");
  await page.waitForSelector("#years .chip.on");
  const on = await page.locator("#years .chip.on").textContent();
  check(on.includes("2年"), `from=line の絞り込みが反映されていない（いま ${on}）`);

  // ⑨ 同じブラウザで、クエリ無しの2回目の訪問でも問診は出ず、絞り込みも残る
  //    （from=line で書いた osaka_u_settings / rk_onboarded がそのまま効く）。
  await page.goto(BASE + "/");
  await page.waitForSelector(".card", { timeout: 15000 });
  await page.waitForTimeout(2500);
  check(await page.locator("#onboard").count() === 0,
        "2回目の訪問（クエリ無し）で問診が出た");
  await page.waitForSelector("#years .chip.on");
  const on2 = await page.locator("#years .chip.on").textContent();
  check(on2.includes("2年"), `2回目の訪問で絞り込みが消えている（いま ${on2}）`);
  await ctx.close();
}

// ⑩ from=line マーカーが無い共有リンク（?faculty=&year= だけ）は、絞り込みには
//    使うが、受け取った側のプロフィールを黙って書き換えてはいけない
//    （A が B に自分用の絞り込みリンクを送っても、B の学部・学年は保護される）。
//    初回訪問者には、このときも問診がちゃんと出ること。
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/?faculty=law&year=2");
  await page.waitForSelector("#onboard[data-step='gate']", { timeout: 15000 });
  check(true, "マーカー無しの共有リンクでも初回は問診が出る");
  const set = await page.evaluate(() => localStorage.getItem("osaka_u_settings"));
  check(!set || !JSON.parse(set).faculty,
        "マーカー無しの共有リンクなのに学部が osaka_u_settings に書かれている");
  // 学部・学年と同じ理由で、連携の印も共有リンクでは立ててはいけない
  // （友だち追加していない人のマイページに「連携済み」と出てしまう）。
  check(await page.evaluate(() => localStorage.getItem("rk_line_linked")) !== "1",
        "マーカー無しの共有リンクなのに rk_line_linked が立っている");
  await page.waitForSelector("#years .chip.on");
  const on = await page.locator("#years .chip.on").textContent();
  check(on.includes("2年"), `マーカー無しでも絞り込みは効くべき（いま ${on}）`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
