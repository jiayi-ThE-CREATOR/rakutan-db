/* 配点スライダーと条件チップが「同じ1つの状態」を指しているかを実ブラウザで確かめる。
 *
 *   cd web && python3 -m http.server 8146 &
 *   node tools/test_haiten_ui.mjs http://localhost:8146
 *
 * ■ なぜブラウザ側にも要るか
 * 判定は score.py（passes_caps）にも web/assets/app.js にもある。
 * **本番は静的配信なので、実際に絞り込んでいるのは app.js のほう。**
 * Python 側だけ直しても本番は直らない。
 *
 * ■ とくに見張っていること
 * チップとスライダーを別々の状態として持つと、片方を押したときにもう片方が
 * 食い違う。ここでは「押した結果、もう片方も動いたか」を毎回確かめる。
 *
 * 設計は docs/plans/2026-09-03-haiten-filter-design.md
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8146";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
const errs = [];
p.on("pageerror", e => errs.push(String(e)));

let n = 0;
const fails = [];
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

await p.addInitScript(() => {
  try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
  try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
});
await p.goto(base, { waitUntil: "networkidle" });
await p.waitForSelector("#list > .card");

const count = () => p.$eval("#count", e => parseInt(e.textContent.replace(/\D/g, ""), 10));
const capOf = k => p.$eval(`#s_${k}`, e => Number(e.value));
const labelOf = k => p.$eval(`#v_${k}`, e => e.textContent.trim());
const chipOn = name => p.$$eval("#conds .chip", (els, nm) =>
  els.some(e => e.textContent.includes(nm) && e.classList.contains("on")), name);
const chipCount = name => p.$$eval("#conds .chip", (els, nm) => {
  const e = els.find(x => x.textContent.includes(nm));
  return e ? parseInt(e.querySelector(".n").textContent.replace(/\D/g, ""), 10) : -1;
}, name);
const clickChip = name => p.$$eval("#conds .chip", (els, nm) => {
  const e = els.find(x => x.textContent.includes(nm));
  if (e) e.click();
}, name);
// input[type=range] は fill が効かないので値を入れて input を発火させる。
const setCap = (k, v) => p.$eval(`#s_${k}`, (e, val) => {
  e.value = String(val);
  e.dispatchEvent(new Event("input", { bubbles: true }));
}, v);

/* ── ① 4本のスライダーがあり、既定は 100%（＝制限なし） ── */
const AXES = ["attendance", "exam", "quiz", "report"];
for (const k of AXES) {
  check(await p.$(`#s_${k}`) !== null, `スライダー #s_${k} が無い`);
}
check(await p.$("#presets") === null || await p.$$eval("#presets .chip", e => e.length) === 0,
      "「あなたの優先度」のプリセットチップがまだ残っている");

/* 目盛りは「100%」まで入る。`.sl` の3列目は元は 16px（1桁ぶん）しか無く、
   % を付けたときに数字が枠の外へはみ出して「1」しか見えなかった。
   はみ出しは行の scrollWidth が clientWidth を超えるかで検出できる。 */
for (const k of AXES) {
  const fits = await p.$eval(`#s_${k}`, e => {
    const row = e.closest(".sl");
    return row.scrollWidth <= row.clientWidth + 1;
  });
  check(fits, `${k} の行がはみ出している（目盛りの % が読めない）`);
}

const all = await count();
for (const k of AXES) {
  check(await capOf(k) === 100, `${k} の既定が 100% でない`);
  check((await labelOf(k)).includes("100%"), `${k} の目盛りが % 表示になっていない`);
}
check(all > 7000, `既定で全件出ていない: ${all}件`);

/* ── ② スライダーを 0% にすると、対応するチップが点灯する ── */
await setCap("quiz", 0);
await p.waitForTimeout(200);
check(await chipOn("小テストなし"),
      "小テストを0%にしたのにチップ「小テストなし」が点灯しない");
const quizChip = await chipCount("小テストなし");
check(await count() === quizChip,
      `小テスト0%の件数 ${await count()} がチップの表示 ${quizChip} と違う`);

/* ── ③ 0% から動かすと、チップが消灯する ── */
await setCap("quiz", 100);
await p.waitForTimeout(200);
check(!(await chipOn("小テストなし")),
      "小テストを100%に戻したのにチップ「小テストなし」が点いたまま");
check(await count() === all, "上限を戻したのに全件に戻らない");

/* ── ④ チップを押すと、対応するスライダーが 0% へ動く ── */
await clickChip("出席なし");
await p.waitForTimeout(200);
check(await capOf("attendance") === 0,
      `チップ「出席なし」を押したのに出席スライダーが ${await capOf("attendance")}%`);
check(await chipOn("出席なし"), "チップ「出席なし」が点灯していない");

/* 「レポートのみ」は3本まとめて 0% にする */
await clickChip("出席なし");                 // 解除してから
await p.waitForTimeout(150);
await clickChip("レポートのみ");
await p.waitForTimeout(200);
for (const k of ["exam", "attendance", "quiz"]) {
  check(await capOf(k) === 0,
        `「レポートのみ」なのに ${k} が ${await capOf(k)}%`);
}
check(await capOf("report") === 100, "「レポートのみ」でレポートまで0%になっている");

/* ── ⑤ 上限の合計が100%を下回ると0件になり、先に警告が出る ── */
await clickChip("レポートのみ");             // 解除
await p.waitForTimeout(150);
for (const k of AXES) await setCap(k, 20);
await p.waitForTimeout(250);
check(await p.$eval("#capWarn", e => !e.hidden),
      "上限の合計が80%なのに警告が出ていない");
check(await count() === 0, `合計80%なのに ${await count()}件 出ている`);

/* 1本でも戻せば警告は消える */
await setCap("exam", 100);
await p.waitForTimeout(200);
check(await p.$eval("#capWarn", e => e.hidden),
      "上限の合計が100%以上に戻ったのに警告が残っている");

/* ── ⑥ URL に上限が載り、開き直しても同じ状態になる ── */
const url = p.url();
check(/cap_attendance=20/.test(url), `URL に上限が載っていない: ${url}`);
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForSelector("#list > .card, #list");
check(await capOf("attendance") === 20, "URL から開き直すと上限が復元されない");

check(errs.length === 0, `ページ内で例外: ${errs.join(" / ")}`);

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
for (const m of fails) console.log("  NG ", m);
await b.close();
process.exit(fails.length ? 1 : 0);
