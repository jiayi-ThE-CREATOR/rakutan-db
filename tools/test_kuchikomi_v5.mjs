/* 口コミフォームの設問3（form v5・2026-10-14）。行の出し方・必須・送信データ・復元を固定する。
 *   python3 tools/serve.py 8150 &
 *   node tools/test_kuchikomi_v5.mjs http://localhost:8150
 *
 * 合格条件（設計: docs/superpowers/specs/2026-10-13-futan-rank-design.md §3）:
 *   1. シラバスの内訳にある項目だけが行になり、見出しに「（シラバス：成績の70%）」が付く
 *   2. 残りの項目は「シラバスに無いけど、実際にはあったもの」から足せる
 *   3. 出ている行すべてに答えるまで保存できない。テストに 1〜5 を付けたら持ち込みも必須
 *   4. テストを「実際はなかった」にすると持ち込みの質問が引っ込む
 *   5. 送信データは form_v:5 と、5項目すべてに 0〜5 が入った items。古い設問の鍵は送らない
 *   6. 保存した科目を開き直すと、足した行も含めて答えが戻る
 *   7. 内訳が読めない科目は5項目すべてが行になる
 *
 * 科目は 135337（文理融合に向けた数理科学 I・火1・試験70%＋小テスト30%）と
 * 131737（学問への扉・金5・内訳なし）。送信は page.route で横取りし、GAS に届かせない。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8150";
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const errors = [];

const browser = await chromium.launch();

async function open(id) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => {
    localStorage.setItem("osaka_u_settings",
      JSON.stringify({ grade: "2", semester: "spring", faculty: "letters", department: "all" }));
  });
  await p.goto(`${base}/kuchikomi.html?c=${id}`, { waitUntil: "networkidle" });
  await p.waitForFunction(
    () => !document.getElementById("class-modal").classList.contains("hidden"),
    { timeout: 5000 }).catch(() => {});
  return p;
}

const state = (p) => p.evaluate(() => ({
  rows: [...document.querySelectorAll(".v5Row")].map(r => r.dataset.item),
  labels: [...document.querySelectorAll(".v5Row label")].map(l => l.textContent.trim()),
  more: [...document.querySelectorAll("#v5-more-btns .form-btn")].map(b => b.dataset.value),
  exam: !document.getElementById("exam-details-section").classList.contains("hidden"),
  save: !document.getElementById("save-review-btn").disabled,
  picked: Object.fromEntries([...document.querySelectorAll(".v5Row")].map(r =>
    [r.dataset.item, (r.querySelector(".form-btn.selected") || {}).dataset?.value ?? null])),
}));
/* 実ブラウザのクリックだとオンボーディングの覆いに当たることがあるので、要素の click() を呼ぶ */
const press = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const row = (item, v) => `.v5Row[data-item="${item}"] .form-btn[data-value="${v}"]`;

// ── 1〜6：文理融合 ──
const p = await open("135337");
let posted = null;
await p.route("**/api/kuchikomi", async (route) => {
  posted = JSON.parse(route.request().postData() || "null");
  await route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"success"}' });
});

let s = await state(p);
check(JSON.stringify(s.rows) === '["exam","quiz"]', `[1] 行が exam・quiz でない: ${s.rows}`);
check(s.labels[0].includes("（シラバス：成績の70%）"), `[1] テストの見出しに割合が無い: ${s.labels[0]}`);
check(JSON.stringify(s.more) === '["report","attendance","presentation"]', `[2] 足せる項目: ${s.more}`);

await p.selectOption("#modal-year-select", { index: 1 });
await press(p, "#group-textbook .form-btn[data-value=\"なし\"]");
await press(p, row("exam", 2));
s = await state(p);
check(!s.save, "[3] 小テストが未回答なのに保存できる");
check(s.exam, "[3] テストに 2 を付けたのに持ち込みが出ない");

await press(p, row("quiz", 0));
s = await state(p);
check(!s.save, "[3] 持ち込みが未回答なのに保存できる");

await press(p, row("exam", 0));
s = await state(p);
check(!s.exam, "[4] テストを「実際はなかった」にしても持ち込みが引っ込まない");
check(s.save, "[4] テストなし・小テスト回答ずみなのに保存できない");

await press(p, row("exam", 2));
await press(p, "#group-exam .form-btn[data-value=\"可\"]");
await press(p, '#v5-more-btns .form-btn[data-value="attendance"]');
s = await state(p);
check(s.rows.includes("attendance"), "[2] 足した出席の行が出ない");
check(!s.more.includes("attendance"), "[2] 足した出席が折りたたみに残っている");
check(!s.save, "[3] 足した行が未回答なのに保存できる");
await press(p, row("attendance", 4));
s = await state(p);
check(s.save, "[3] 全部答えたのに保存できない");

await press(p, "#save-review-btn");
await p.waitForTimeout(200);

// ── 6：開き直すと戻る ──
await press(p, '.td-cell[data-day="1"][data-period="0"]');   // 火1
await p.waitForTimeout(200);
s = await state(p);
check(JSON.stringify(s.picked) === '{"exam":"2","quiz":"0","attendance":"4"}',
  `[6] 開き直したときの答え: ${JSON.stringify(s.picked)}`);
check(s.exam, "[6] 開き直したとき持ち込みの質問が出ていない");
await press(p, "#close-modal");

// ── 5：送信データ ──
await p.evaluate(() => {
  const g = document.getElementById("grade-select");
  if (!g.value) { g.selectedIndex = 1; g.dispatchEvent(new Event("change")); }
});
await press(p, "#submit-survey");
await p.waitForTimeout(500);
const review = posted && posted.selections && posted.selections[0]
  && posted.selections[0].subject.review;
check(!!review, "[5] 送信データが取れない");
if (review) {
  check(review.form_v === 5, `[5] form_v: ${review.form_v}`);
  check(JSON.stringify(review.items)
    === '{"exam":2,"report":0,"attendance":4,"quiz":0,"presentation":0}',
    `[5] items: ${JSON.stringify(review.items)}`);
  check(review.exam === "可", `[5] 持ち込み: ${review.exam}`);
  const old = ["attendance", "assignmentInClass", "assignmentOutClass", "examPresence",
               "examDifficulty", "reportPresence", "reportWordCount"].filter(k => k in review);
  check(old.length === 0, `[5] 古い設問の鍵が残っている: ${old}`);
}
await p.close();

// ── 7：内訳が読めない科目 ──
const q = await open("131737");
s = await state(q);
check(s.rows.length === 5, `[7] 内訳なしの科目の行が5つでない: ${s.rows}`);
check(s.more.length === 0, `[7] 内訳なしの科目に折りたたみの項目がある: ${s.more}`);
await q.close();

check(errors.length === 0, `コンソールエラー: ${errors.join(" / ")}`);
await browser.close();
console.log(fails.length ? "NG" : "OK");
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
