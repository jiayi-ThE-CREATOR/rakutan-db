/* 好みの目盛り・✕・条件チップが「役割どおりの状態」を指しているかを実ブラウザで確かめる。
 *
 * 2026-09-21: 目盛りは「上限%」から「好みの重さ」になった（相性度の重み。既定は
 * score.py と同じ テスト50・発表20・レポート15・出席15・小テスト10）。しぼり込みは
 * 各軸の ✕（#x_<軸>）が引き継いでいて、これが caps を 0 か 100 にする。
 * **目盛りと ✕ は同じ行にあるが状態は別**（混ぜると「しぼったら好みまで変わった」になる）。
 *
 *   python3 tools/serve.py 8146 &
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
const setPref = (k, v) => p.$eval(`#s_${k}`, (e, val) => {
  e.value = String(val);
  e.dispatchEvent(new Event("input", { bubbles: true }));
}, v);
const xOn = k => p.$eval(`#x_${k}`, e => e.getAttribute("aria-pressed") === "true");

/* ── ① 5本の目盛りと5つの ✕ があり、目盛りの既定はみんなの重さ ── */
const AXES = ["attendance", "exam", "quiz", "report", "presentation"];
for (const k of AXES) {
  check(await p.$(`#s_${k}`) !== null, `目盛り #s_${k} が無い`);
  check(await p.$(`#x_${k}`) !== null, `✕ ボタン #x_${k} が無い`);
}
check(await p.$("#presets") === null || await p.$$eval("#presets .chip", e => e.length) === 0,
      "「あなたの優先度」のプリセットチップがまだ残っている");

/* 行からはみ出さないこと。`.sl` の3列目は元は 16px（1桁ぶん）しか無く、
   数字が枠の外へはみ出して「1」しか見えなかった。2026-09-21 に4列目（✕）が
   増えたので、同じ見張りで幅が足りているかを確かめる。
   はみ出しは行の scrollWidth が clientWidth を超えるかで検出できる。 */
for (const k of AXES) {
  const fits = await p.$eval(`#s_${k}`, e => {
    const row = e.closest(".sl");
    return row.scrollWidth <= row.clientWidth + 1;
  });
  check(fits, `${k} の行がはみ出している（数字か ✕ が読めない）`);
}

/* 好みの目盛りは 5 刻み（app.js の PREF_STEP）。5本とも同じ刻みであること。 */
const STEP = await p.$eval("#s_attendance", e => Number(e.step));
check(STEP === 5, `目盛りが 5 刻みでない: ${STEP}`);
for (const k of AXES) {
  check(await p.$eval(`#s_${k}`, e => Number(e.step)) === STEP,
        `${k} の刻みが他と違う`);
}

const all = await count();
/* 既定は score.py の EXAM_SHARE と OTHER_WEIGHTS そのもの。ここが score.py と
   ずれると、初めて来た人の並び（＝好みを触っていない人の相性度）と画面の
   説明が食い違う。 */
const PREF_DEF = { attendance:15, exam:50, quiz:10, report:15, presentation:20 };
for (const k of AXES) {
  check(await capOf(k) === PREF_DEF[k], `${k} の目盛りの既定が ${PREF_DEF[k]} でない`);
  check((await labelOf(k)) === String(PREF_DEF[k]), `${k} の数字が目盛りと合っていない`);
  check(await xOn(k) === false, `${k} の ✕ が最初から入っている`);
}
check(all > 7000, `既定で全件出ていない: ${all}件`);

/* ── ② ✕ を押すとチップが点き、もう一度押すと消える ── */
await p.click("#x_quiz");
await p.waitForTimeout(250);
check(await chipOn("小テストなし"),
      "小テストに ✕ を入れたのにチップ「小テストなし」が点灯しない");
const quizChip = await chipCount("小テストなし");
check(await count() === quizChip,
      `小テストに ✕ を入れた件数 ${await count()} がチップの表示 ${quizChip} と違う`);
await p.click("#x_quiz");
await p.waitForTimeout(250);
check(!(await chipOn("小テストなし")), "✕ を外したのにチップが点いたまま");
check(await count() === all, "✕ を外したのに全件に戻らない");

/* ── ③ チップを押すと ✕ が入る（同じ1つの状態を見ていること） ── */
await clickChip("出席なし");
await p.waitForTimeout(250);
check(await xOn("attendance"), "チップ「出席なし」を押したのに出席の ✕ が入らない");
check(await chipOn("出席なし"), "チップ「出席なし」が点灯していない");

/* 「レポートのみ」は4本まとめて ✕ にする（2026-09-16 に発表が加わった） */
await clickChip("出席なし");                 // 解除してから
await p.waitForTimeout(150);
await clickChip("レポートのみ");
await p.waitForTimeout(250);
for (const k of ["exam", "attendance", "quiz", "presentation"]) {
  check(await xOn(k), `「レポートのみ」なのに ${k} に ✕ が入っていない`);
}
check(!(await xOn("report")), "「レポートのみ」でレポートまで ✕ になっている");
await clickChip("レポートのみ");             // 解除
await p.waitForTimeout(200);

/* ── ④ ✕ は好みを動かさない（役割が混ざっていないこと） ── */
await p.click("#x_exam");
await p.waitForTimeout(250);
check(await capOf("exam") === PREF_DEF.exam,
      "✕ を押したらテストの目盛り（好み）まで動いた");
await p.click("#x_exam");
await p.waitForTimeout(200);

/* ── ⑤ 全部に ✕ を入れると0件になり、先に警告が出る ── */
for (const k of AXES) await p.click(`#x_${k}`);
await p.waitForTimeout(300);
check(await p.$eval("#capWarn", e => !e.hidden),
      "全部に ✕ を入れたのに警告が出ていない");
check(await count() === 0, `全部に ✕ を入れたのに ${await count()}件 出ている`);

/* 1本でも外せば警告は消える */
await p.click("#x_exam");
await p.waitForTimeout(250);
check(await p.$eval("#capWarn", e => e.hidden),
      "✕ を1つ外したのに警告が残っている");
for (const k of AXES) if (await xOn(k)) await p.click(`#x_${k}`);
await p.waitForTimeout(300);

/* ── ⑥ URL に載り、開き直しても同じ状態になる ── */
await p.click("#x_attendance");
await p.waitForTimeout(250);
const url = p.url();
check(/cap_attendance=0/.test(url), `URL に ✕ が載っていない: ${url}`);
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForSelector("#list > .card, #list");
check(await xOn("attendance"), "URL から開き直すと ✕ が復元されない");

/* 好みも URL に載って往復すること（?w=exam:25）。**刻みをここに直書きしない** ――
   app.js の PREF_STEP を見て、丸めた結果が目盛りに乗っているかだけを見る。 */
await p.goto(`${base}?w=exam:25`, { waitUntil: "networkidle" });
await p.waitForSelector("#list > .card, #list");
check(await capOf("exam") === 25, `URL の好みが目盛りに入っていない: ${await capOf("exam")}`);
check(await capOf("exam") % STEP === 0,
      `URL の好みが目盛り（${STEP}刻み）に乗っていない`);
check((await labelOf("exam")) === "25", "つまみの位置と表示している数字が食い違っている");

check(errs.length === 0, `ページ内で例外: ${errs.join(" / ")}`);

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
for (const m of fails) console.log("  NG ", m);
await b.close();
process.exit(fails.length ? 1 : 0);
