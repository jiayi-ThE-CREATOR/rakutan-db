/* 「成績評価の内訳」が、シラバスの成績評価テーブルと**一字一句・一数字**
 * 一致していることを実ブラウザで見る。
 *
 *   python3 server.py --port 8149 &
 *   node tools/test_eval_raw.mjs http://127.0.0.1:8149
 *
 * なぜこのテストが要るか
 * ──────────────────────
 * 2026-09-07 まで、この欄は採点用の4区分（出席・平常点／期末テスト／小テスト／
 * レポート）へ**振り分け直したあとの数字**を出していた。振り分けは採点の都合で
 * あって学生が見るべき事実ではなく、実際に3つのズレが出ていた:
 *   ・`発表` が report に入るので「発表80%」の科目が「レポート 80%」と出ていた
 *   ・`期末レポート` が試験ルールの裸の「期末」に当たり「期末テスト」と出ていた
 *   ・振り分けられなかった項目は灰色の「不明」に消えていた（中央値で35%の配点）
 * どれも「画面には出ているが数字の意味が違う」ので、**目視でも既存のテストでも
 * 気づけない**。だから機械に持たせる。
 *
 * 見張っている回帰:
 *   1. 項目名がシラバスの文言と違う（言い換え・省略・付け替え）
 *   2. 数字がシラバスと違う（合算・按分・丸め）
 *   3. 項目の数が違う（まとめて減る／勝手に増える）
 *   4. 並び順がシラバスと違う
 *   5. 表が100%に届かない科目で、残りを他の項目へ按分してしまう
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8149";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const api = async path => (await fetch(BASE + path)).json();

const open = async browser => {
  const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#list .card");
  return p;
};

/* 凡例を [名前, 数字] の並びで読む。DOM の構造ではなく**見えている文字**を
   読むこと ―― 内部でどう持っていようが、学生が読むのはこの文字列なので。 */
const legendOf = p => p.$$eval(".compLegend span", els => els.map(e => {
  const b = e.querySelector("b");
  const pct = b ? b.textContent.trim() : "";
  return [e.textContent.replace(pct, "").trim(), pct];
}));

const browser = await chromium.launch();
const p = await open(browser);

/* ── ① 一覧に出ている科目を片っ端から突き合わせる ── */
const ids = await p.$$eval("#list .card", els =>
  els.map(e => e.dataset.id).filter(Boolean));
check(ids.length >= 10, `一覧のカードが少なすぎて検査にならない: ${ids.length}件`);

let withRaw = 0;
for (const id of ids.slice(0, 40)) {
  const c = await api(`/api/courses/${id}`);
  const raw = c.eval_raw || {};
  const rows = Object.entries(raw);

  await p.click(`.card[data-id="${id}"]`);
  await p.waitForTimeout(120);
  const legend = await legendOf(p);

  if (!rows.length) {
    check(legend.length === 0,
          `${id} シラバスに内訳が無いのに凡例が出ている: ${JSON.stringify(legend)}`);
    continue;
  }
  withRaw++;

  const sum = rows.reduce((s, [, v]) => s + v, 0);
  const gap = Math.round((100 - sum) * 10) / 10;
  const hasGap = gap >= 1;

  /* 期待値はシラバスの行そのもの。振り分けも合算も並べ替えもしない。 */
  const want = rows.map(([k, v]) => [k, `${v}%`]);
  if (hasGap) want.push(["記載なし", `${gap}%`]);

  check(JSON.stringify(legend) === JSON.stringify(want),
        `${id} ${c.title} の内訳がシラバスと違う\n` +
        `      画面: ${JSON.stringify(legend)}\n` +
        `      表  : ${JSON.stringify(want)}`);

  /* 採点用の4区分（eval_ratio）が漏れていないこと。「レポート 50%」のような
     振り分け後のラベルが1つでも出ていたら、この欄の作りが戻っている。 */
  const names = legend.map(([k]) => k);
  for (const label of ["出席・平常点", "期末テスト"]) {
    check(!names.includes(label) || Object.keys(raw).includes(label),
          `${id} シラバスに無い区分名「${label}」が出ている（振り分けが復活した）`);
  }
}
check(withRaw >= 10, `内訳のある科目が少なすぎる: ${withRaw}件`);

/* ── ② シラバスの表が100%に届かない科目（実測18件）── */
await p.fill("#q", "政治の世界");
await p.waitForTimeout(500);
let gapChecked = false;
const gapCard = await p.$("#list .card");
if (gapCard) {
  const id = await gapCard.getAttribute("data-id");
  const c = await api(`/api/courses/${id}`);
  const sum = Object.values(c.eval_raw || {}).reduce((s, v) => s + v, 0);
  if (sum < 100) {
    gapChecked = true;
    await gapCard.click();
    await p.waitForTimeout(150);
    const legend = await legendOf(p);
    const last = legend[legend.length - 1];
    check(last && last[0] === "記載なし",
          `${id} 表が${sum}%しか無いのに「記載なし」が出ていない: ${JSON.stringify(legend)}`);
    /* 残りを他の項目へ按分していないこと ―― シラバスに無い数字を出さない。 */
    const shown = legend.slice(0, -1).map(([k, v]) => [k, parseFloat(v)]);
    check(JSON.stringify(shown) === JSON.stringify(Object.entries(c.eval_raw)),
          `${id} 「記載なし」のぶんを他の項目へ按分している: ${JSON.stringify(shown)}`);
    check(await p.$(".compNote") !== null,
          `${id} 表が埋まっていない注記が出ていない`);
  }
}

await browser.close();
console.log(`  通過 ${n - fails.length} 件 / ${n} 件` +
            `（内訳のある科目 ${withRaw}件を検査` +
            `／表が100%に届かない科目 ${gapChecked ? "検査した" : "★見つからず未検査"}）`);
for (const f of fails) console.log("  NG  " + f);
process.exit(fails.length ? 1 : 0);
