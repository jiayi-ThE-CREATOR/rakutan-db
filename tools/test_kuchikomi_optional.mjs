/* 口コミフォームの「あり／必要を押すと出る追加の質問」が任意であることを固定する。
 *   cd web && python3 -m http.server 8795 &
 *   node tools/test_kuchikomi_optional.mjs http://127.0.0.1:8795
 *
 * 合格条件（2026-09-29 松下と確定）:
 *   （1・5 の「レポートの語数」は 2026-10-14 の form v5 で質問ごと無くなった）
 *   2. 4の金額・購入場所は答えなくても保存できる
 *   3. 答えなかった分は null で送る（最初の位置の値を答えとして送らない）
 *   4. 購入場所の「その他」は記入が空でも保存でき、「その他」とだけ送る
 *
 * 科目は test_kuchikomi_textbook.mjs と同じ 138531（水2）。
 * 送信は page.route で横取りし、GAS にもシートにも届かせない。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8795";
const ID = "138531";
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const errors = [];

const browser = await chromium.launch();

/* 1回分：フォームを開いて fill(p) で答え、保存して送信し、送った review を返す。 */
async function run(fill, afterSave) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => {
    localStorage.setItem("osaka_u_settings",
      JSON.stringify({ grade: "2", semester: "spring", faculty: "letters", department: "all" }));
  });
  let posted = null;
  await p.route("**/api/kuchikomi", async (route) => {
    posted = JSON.parse(route.request().postData() || "null");
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"success"}' });
  });
  await p.goto(`${base}/kuchikomi.html?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForFunction(
    () => !document.getElementById("class-modal").classList.contains("hidden"),
    { timeout: 5000 }).catch(() => {});

  const click = (group, value) => p.click(`#${group} .form-btn[data-value="${value}"]`);
  await p.selectOption("#modal-year-select", { index: 1 });
  /* 設問3（form v5）：出ている行すべてに「実際はなかった」（0）を付ける ――
     テストの行に 1〜5 を付けると持ち込みの質問が増えるので、それを避けている。 */
  await p.evaluate(() => document.querySelectorAll('.v5Row .form-btn[data-value="0"]')
    .forEach(b => b.click()));
  await click("group-textbook", "必要");
  await fill(p, click);

  const enabled = await p.evaluate(() => !document.getElementById("save-review-btn").disabled);
  if (!enabled) { await p.close(); return { enabled }; }
  await p.click("#save-review-btn");
  const reopened = afterSave ? await afterSave(p) : null;
  await p.click("#submit-survey");
  await p.waitForTimeout(300);
  await p.close();
  const review = posted && posted.selections && posted.selections[0]
    && posted.selections[0].subject.review;
  return { enabled, review, reopened };
}

// ── 何も答えない ──
const a = await run(async () => {}, async () => null);
check(a.enabled, "[2] 追加の質問に答えないと保存できない");
if (a.review) {
  check(a.review.textbookPrice === null, `[3] 金額が null でない: ${a.review.textbookPrice}`);
  check(a.review.textbookPlaces === null, `[3] 場所が null でない: ${a.review.textbookPlaces}`);
} else if (a.enabled) {
  check(false, "[3] 送信データが取れない");
}

// ── 「その他」を空のまま ──
const b = await run(async (p, click) => {
  await click("group-textbook-place", "生協");
  await click("group-textbook-place", "その他");
});
check(b.enabled, "[4] 「その他」が空だと保存できない");
if (b.review) {
  check(b.review.textbookPlaces === "生協、その他", `[4] 場所: ${b.review.textbookPlaces}`);
} else if (b.enabled) {
  check(false, "[4] 送信データが取れない");
}

check(errors.length === 0, `コンソールエラー: ${errors.join(" / ")}`);

await browser.close();
console.log(fails.length ? "NG" : "OK");
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
