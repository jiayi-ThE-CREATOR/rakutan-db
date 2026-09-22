/* 好みの目盛り（配点でしぼる）が相性度と band に効くことを実ブラウザで確かめる。
 *
 *   python3 -m http.server 8791 --directory web &
 *   node tools/test_konomi.mjs http://localhost:8791
 *
 * 好みはブラウザの中だけで効く（score.py は触らない）。だから静的配信で確かめられる。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8791";
const b = await chromium.launch();
let n = 0; const fails = [];
const check = (c, m) => { n++; if (!c) fails.push(m); };

async function open(url){
  const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForSelector("#list > .card");
  return p;
}
/* 先頭20件の id と、先頭カードの数字・band */
const snap = p => p.$$eval("#list > .card", cs => ({
  ids: cs.slice(0, 20).map(c => c.dataset.id),
  fit: cs[0].querySelector(".fit b")?.textContent.trim(),
  band: cs[0].querySelector(".band")?.textContent.trim(),
}));

/* ① 既定では今までと同じ並び（好みを入れていない人の画面は変わらない） */
const p0 = await open(base);
const base0 = await snap(p0);
check(base0.ids.length === 20, "先頭20件が取れない");

/* ② テストの目盛りは「試験のある科目」に効く。**一覧の先頭では測らない** ――
   おすすめ順の第1キーは needs_review（難しさ未確認の試験）なので、試験のある
   科目はもともと下のかたまりに居り、目盛りを動かしても先頭20件は入れ替わらない
   （実測 20/20 据え置き）。動くのは数字と band のほう。
   「【人文】世界の思想」は成績の100%が試験の科目（既定 70.0・やや重め）。 */
/* 検索語は URL（?q=）からは復元されないので、検索欄に打ち込んで1件に絞る。 */
const EXAM_Q = "世界の思想", EXAM_ID = "137001";
async function findExam(p){
  await p.fill("#q", EXAM_Q);
  await p.waitForSelector(`.card[data-id="${EXAM_ID}"]`);
  return p.$eval(`.card[data-id="${EXAM_ID}"]`, c => ({
    fit: c.querySelector(".fit b")?.textContent.trim(),
    band: c.querySelector(".band")?.textContent.trim(),
  }));
}
const examFit = async w => {
  const p = await open(base + (w ? `/?w=${w}` : "/"));
  return [p, await findExam(p)];
};
const [pExam0, exam0] = await examFit("");
const [pLow, low] = await examFit("exam:25");
check(Number(low.fit) > Number(exam0.fit),
      `テストを 50→25 にしても試験だけの科目が上がらない: ${exam0.fit} → ${low.fit}`);
const [, high] = await examFit("exam:75");
check(Number(high.fit) < Number(exam0.fit),
      `テストを 50→75 にしても試験だけの科目が下がらない: ${exam0.fit} → ${high.fit}`);

/* テストの目盛りは、試験の無い科目を動かしてはいけない（取り分ではなく倍率だから）。 */
const noExam = await open(`${base}/?w=exam:75`);
check((await snap(noExam)).ids.join() === base0.ids.join(),
      "テストの目盛りで、試験の無い科目（先頭20件）まで動いている");

/* ③ レポートの目盛りを上げると、レポートのある科目が下がる */
const pRep = await open(`${base}/?w=report:30`);
const rep = await snap(pRep);
check(rep.ids.join() !== base0.ids.join(), "レポートを 15→30 にしても並びが変わらない");

/* ④ 数字と band は同じ好みで計算される（数字だけ動いて band が据え置きにならない） */
check(low.band !== exam0.band,
      `数字は動いたのに band が据え置き: ${exam0.fit}${exam0.band} → ${low.fit}${low.band}`);

/* ⑤ URL の値は目盛りに入っていて、別のページへ移っても残る（localStorage） */
const val = await pLow.$eval("#s_exam", e => e.value);
check(val === "25", `URL の好みが目盛りに入っていない: ${val}`);
/* ?w= の付いていない URL へ移る ―― 好みが localStorage から戻るかを見る。 */
await pLow.goto(base, { waitUntil: "networkidle" });
await pLow.waitForSelector("#list > .card");
check(await pLow.$eval("#s_exam", e => e.value) === "25",
      "移動すると好みが消える（localStorage に残っていない）");
check((await findExam(pLow)).fit === low.fit, "好みは戻ったのに数字が既定のまま");

/* ⑥ 目盛りは好み、✕ はしぼり込み。役割が分かれていること */
const p6 = await open(base);
check(await p6.$eval("#s_exam", e => e.value) === "50", "テストの目盛りの既定が 50 でない");
check(await p6.$("#x_exam") !== null, "テストの ✕ が無い");
const before = (await p6.$$("#list > .card")).length;
await p6.click("#x_exam");
await p6.waitForTimeout(400);
const after = (await p6.$$("#list > .card")).length;
check(after <= before, "✕ を押しても件数が減らない");
check(await p6.$eval("#s_exam", e => e.value) === "50",
      "✕ を押したら目盛り（好み）まで動いた ―― 役割が混ざっている");

/* ⑦ 目盛りは誰でも動く。静的配信では /api/me が無いので fail-open（✕ も動く）。
   ここで見るのは「目盛りが門の中に入っていないこと」だけ。 */
const p7 = await open(base);
check(await p7.$eval("#s_exam", e => !e.closest("[inert]") && !e.closest("[data-gate]")),
      "好みの目盛りが門（data-gate / inert）の中に入っている");

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
for (const m of fails) console.log("  NG ", m);
await b.close();
process.exit(fails.length ? 1 : 0);
