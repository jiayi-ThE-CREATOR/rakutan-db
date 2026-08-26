/* 並び替えが実際にその順で並ぶかを実ブラウザで確かめる。
 *
 *   cd web && python3 -m http.server 8140 &     # 静的＝本番と同じ経路
 *   node tools/test_sort.mjs http://localhost:8140
 *
 * **静的配信で確かめるのが肝**。本番は Cloudflare の静的アセットなので、
 * 並び替えを実行しているのは server.py ではなく web/assets/app.js のほう。
 * 2026-08-26 まで app.js に title の分岐が無く、「科目名順」を選んでも
 * 相性順のままだった ―― server.py だけ見ていると気付けない種類のバグ。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8140";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
const errs = [];
p.on("pageerror", e => errs.push(String(e)));

let n = 0;
const fails = [];
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

// 開屏の問診に邪魔されないよう、済んだことにしてから開く（test_favorite.mjs と同じ）。
await p.addInitScript(() => {
  try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
  try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
});

await p.goto(base, { waitUntil: "networkidle" });
// 既定の絞り込み（1年・秋冬）だと口コミつきが少ないので、まず全部にする。
await p.click('#years button[data-y="all"]');
await p.click('#sems button[data-s="all"]');
await p.waitForTimeout(400);

const optState = async v => p.$eval(`#sort option[value="${v}"]`, o => o.hidden);
check(await optState("reviews_many"), "「口コミあり」を押す前に 口コミが多い順 が出ている");
check(await optState("reviews_few"),  "「口コミあり」を押す前に 口コミが少ない順 が出ている");

// 「口コミあり」を押す
await p.click('#trust .chip');
await p.waitForTimeout(500);
check(!(await optState("reviews_many")), "「口コミあり」を押しても 口コミが多い順 が出ない");
check(!(await optState("reviews_few")),  "「口コミあり」を押しても 口コミが少ない順 が出ない");

/* 一覧の先頭には「あなたに合う N件」（.picks）が別枠で出る。あれは
   利用者の並び替えに追従しない ―― 追従させると「科目名順」のときに
   “名前が前の5件” を「あなたに合う5件」と呼ぶことになるため（app.js の
   topPicks() の注記）。並び順を確かめるのは、その下の本体だけ。 */
const counts = () => p.$$eval("#list > .card", cs =>
  cs.map(c => { const m = /口コミ\s*(\d+)\s*件/.exec(c.textContent); return m ? +m[1] : null; }));
const titles = () => p.$$eval("#list > .card .title", ts => ts.map(t => t.textContent.trim()));

const sortBy = async v => { await p.selectOption("#sort", v); await p.waitForTimeout(500); };

await sortBy("reviews_many");
const many = await counts();
check(many.length > 1, `並べ替える対象が足りない（${many.length}件）`);
check(many.every(x => x !== null), "「口コミあり」なのに件数の出ていないカードがある");
check(many.every((x, i) => i === 0 || many[i - 1] >= x),
      `多い順になっていない: ${many.slice(0, 12).join(",")}`);

await sortBy("reviews_few");
const few = await counts();
check(few.every((x, i) => i === 0 || few[i - 1] <= x),
      `少ない順になっていない: ${few.slice(0, 12).join(",")}`);
check(many[0] >= few[0], "多い順の先頭が、少ない順の先頭より少ない");

/* 科目名順。2026-08-26 に直したぶん（app.js に分岐が無く相性順のままだった）。
   **並べているのがどちらかでルールが違う**ので、モードで期待値を変える。
     静的（＝本番）… app.js の localeCompare("ja")。ラテン→かな→漢字
     API           … server.py の Python 既定＝コードポイント順
   標準ライブラリに日本語の照合順序が無いため揃えられない。
   本番の並びを悪くして開発用サーバに合わせるのは本末転倒なので、
   差があること自体をここで固定しておく。 */
await sortBy("title");
const ts = await titles();
const mode = await p.evaluate(() => DATA.mode);
const sorted = mode === "api"
  ? [...ts].sort()                                        // コードポイント順
  : [...ts].sort((a, x) => a.localeCompare(x, "ja"));     // ICU 日本語
check(JSON.stringify(ts) === JSON.stringify(sorted),
      `科目名順になっていない（${mode} モード）: ${ts.slice(0, 3).join(" / ")}`);
console.log(`  （科目名順は ${mode} モードの規則で確認）`);

// 「口コミあり」を外したら、意味を失った並び順のまま残さない
await sortBy("reviews_many");
await p.click('#trust .chip');
await p.waitForTimeout(500);
check(await p.$eval("#sort", s => s.value) === "fit",
      "「口コミあり」を外しても並び替えが 口コミが多い順 のまま");
check(await optState("reviews_many"), "「口コミあり」を外しても選択肢が残っている");

check(!errs.length, "コンソールに例外: " + errs.join(" | "));

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
fails.forEach(f => console.log("  NG  " + f));
console.log(fails.length ? "NG" : "OK");
await b.close();
process.exit(fails.length ? 1 : 0);
