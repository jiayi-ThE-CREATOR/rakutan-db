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

/* ② テストの目盛りを下げると、試験のある科目が上がってくる */
const pLow = await open(`${base}/?w=exam:25`);
const low = await snap(pLow);
check(low.ids.join() !== base0.ids.join(), "テストを 50→25 にしても並びが変わらない");

/* ③ レポートの目盛りを上げると、レポートのある科目が下がる */
const pRep = await open(`${base}/?w=report:30`);
const rep = await snap(pRep);
check(rep.ids.join() !== base0.ids.join(), "レポートを 15→30 にしても並びが変わらない");

/* ④ 数字と band は同じ好みで計算される（数字だけ動いて band が据え置きにならない） */
check(low.fit !== base0.fit || low.band !== base0.band,
      "好みを変えても先頭カードの数字も band も変わらない");

/* ⑤ URL の値は目盛りに入っていて、リロードしても残る（localStorage） */
const val = await pLow.$eval("#s_exam", e => e.value).catch(() => null);
check(val === null || val === "25", `URL の好みが目盛りに入っていない: ${val}`);
await pLow.goto(base, { waitUntil: "networkidle" });
await pLow.waitForSelector("#list > .card");
const again = await snap(pLow);
check(again.ids.join() === low.ids.join(), "リロードすると好みが消える（localStorage に残っていない）");

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

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
for (const m of fails) console.log("  NG ", m);
await b.close();
process.exit(fails.length ? 1 : 0);
