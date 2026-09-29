/* 口コミフォームの設問8「教科書」。出し入れ・必須・復元・送信データを固定する。
 *   cd web && python3 -m http.server 8795 &
 *   node tools/test_kuchikomi_textbook.mjs http://127.0.0.1:8795
 *
 * 合格条件（2026-09-28 松下と確定）:
 *   1. 設問8で3択（必要／指定はあったが不要／教科書なし）が選べる
 *   2. 「必要」のときだけ 金額（11段階のスライダー）と購入場所（複数選択）が出る。
 *      他へ切り替えると引っ込み、中身も消える。「その他」のときだけ記入欄
 *   3. 設問8そのものは必須。「必要」のときに出る金額・場所・（その他の）記入は任意
 *      （2026-09-29 松下と変更。答えなくても保存でき、答えなかった分は null で送る）
 *   4. 保存した科目を開き直すと元に戻る
 *   5. 送信データに textbook / textbookPrice / textbookPlaces が入る
 *
 * 科目は test_kuchikomi_param.mjs と同じ 138531（水2・common・haru）を使う。
 * 送信は page.route で横取りし、GAS にもシートにも届かせない。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8795";
const ID = "138531";
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
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

const visible = (sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && el.offsetParent !== null;
}, sel);
const saveEnabled = () => p.evaluate(() => !document.getElementById("save-review-btn").disabled);
const click = (group, value) => p.click(`#${group} .form-btn[data-value="${value}"]`);
const selectedIn = (group) => p.evaluate((g) =>
  [...document.querySelectorAll(`#${g} .form-btn.selected`)].map(b => b.dataset.value), group);

// 設問8以外を埋める
await p.selectOption("#modal-year-select", { index: 1 });
await click("group-attendance", "毎回");
await click("group-assignment-inclass", "ふつう");
await click("group-assignment-outclass", "軽い");
await click("group-exam-presence", "なし");
await click("group-report", "なし");

// ── 1. 設問8がある・未回答では保存できない ──
check(await visible("#group-textbook"), "[1] 設問8（#group-textbook）が見えない");
const choices = await p.evaluate(() =>
  [...document.querySelectorAll("#group-textbook .form-btn")].map(b => b.dataset.value));
check(JSON.stringify(choices) === JSON.stringify(["必要", "指定あり・不要", "なし"]),
  `[1] 設問8の選択肢が違う: ${choices}`);
check(!(await saveEnabled()), "[3] 設問8が未回答なのに保存できる");
check(!(await visible("#textbook-details-section")), "[2] 最初から金額・場所が出ている");

// 「なし」なら追加の設問なしで保存できる
await click("group-textbook", "なし");
check(!(await visible("#textbook-details-section")), "[2] 「なし」で金額・場所が出ている");
check(await saveEnabled(), "[3] 「なし」を選んだのに保存できない");

// ── 2. 必要 → 詳細が出る。金額は11択 ──
await click("group-textbook", "必要");
check(await visible("#textbook-details-section"), "[2] 「必要」で金額・場所が出ない");
// 金額はスライダー（2026-09-28 にプルダウンから変更）。0〜10 の11段階。
const priceText = () => p.textContent("#textbook-price-display");
check((await priceText()) === "未選択", `[2] 動かす前の金額が「未選択」でない: ${await priceText()}`);
const steps = await p.evaluate(() => {
  const r = document.getElementById("textbook-price");
  return Number(r.max) - Number(r.min) + 1;
});
check(steps === 11, `[2] 金額の段階が11でない: ${steps}`);
await p.fill("#textbook-price", "0");
const lo = await priceText();
await p.fill("#textbook-price", "10");
const hi = await priceText();
check(lo === "500円未満" && hi === "5,000円以上", `[2] 金額の両端が違う: ${lo} / ${hi}`);
// ここで一度「答えた」状態になったので、切り替えで消して未回答に戻す
await click("group-textbook", "なし");
await click("group-textbook", "必要");
const places = await p.evaluate(() =>
  [...document.querySelectorAll("#group-textbook-place .form-btn")].map(b => b.dataset.value));
check(JSON.stringify(places) === JSON.stringify(
  ["生協", "書店（生協以外）", "Amazon", "メルカリ", "古本屋", "電子書籍", "その他"]),
  `[2] 購入場所の選択肢が違う: ${places}`);

// ── 3. 追加の質問は任意 ──
check(await saveEnabled(), "[3] 金額・場所が任意なのに、答えないと保存できない");
await p.fill("#textbook-price", "3");
check(await saveEnabled(), "[3] 金額だけ答えると保存できない");

// 複数選択できる（押しても他が外れない）・もう一度押すと外れる
await click("group-textbook-place", "生協");
await click("group-textbook-place", "メルカリ");
await click("group-textbook-place", "Amazon");
await click("group-textbook-place", "Amazon");
const sel = await selectedIn("group-textbook-place");
check(JSON.stringify(sel) === JSON.stringify(["生協", "メルカリ"]),
  `[2] 複数選択・解除が効いていない: ${sel}`);
check(await saveEnabled(), "[3] 金額・場所がそろったのに保存できない");

// その他 → 記入欄。空でも保存できる
check(!(await visible("#textbook-place-other-text")), "[2] 「その他」前から記入欄が出ている");
await click("group-textbook-place", "その他");
check(await visible("#textbook-place-other-text"), "[2] 「その他」で記入欄が出ない");
check(await saveEnabled(), "[3] 「その他」の記入が空だと保存できない");
await p.fill("#textbook-place-other-text", "先輩から");
check(await saveEnabled(), "[3] 「その他」を記入したのに保存できない");

// 切り替えると中身が消える
await click("group-textbook", "指定あり・不要");
check(!(await visible("#textbook-details-section")), "[2] 切り替えても金額・場所が引っ込まない");
await click("group-textbook", "必要");
const cleared = await p.evaluate(() => ({
  price: document.getElementById("textbook-price").dataset.set || "",
  places: document.querySelectorAll("#group-textbook-place .form-btn.selected").length,
  other: document.getElementById("textbook-place-other-text").value,
}));
check(!cleared.price && cleared.places === 0 && !cleared.other,
  `[2] 切り替えたのに中身が残っている: ${JSON.stringify(cleared)}`);

// 入れ直して保存
await p.fill("#textbook-price", "3");
await click("group-textbook-place", "生協");
await click("group-textbook-place", "メルカリ");
await click("group-textbook-place", "その他");
await p.fill("#textbook-place-other-text", "先輩から");
await p.click("#save-review-btn");

// ── 4. 開き直すと元に戻る ──
await p.click('.td-cell[data-day="2"][data-period="1"]');   // 水2
const back = await p.evaluate(() => ({
  tb: [...document.querySelectorAll("#group-textbook .form-btn.selected")].map(b => b.dataset.value),
  shown: document.getElementById("textbook-details-section").offsetParent !== null,
  price: document.getElementById("textbook-price-display").textContent,
  places: [...document.querySelectorAll("#group-textbook-place .form-btn.selected")].map(b => b.dataset.value),
  other: document.getElementById("textbook-place-other-text").value,
}));
check(JSON.stringify(back) === JSON.stringify({
  tb: ["必要"], shown: true, price: "1,500〜1,999円",
  places: ["生協", "メルカリ", "その他"], other: "先輩から" }),
  `[4] 開き直すと元に戻らない: ${JSON.stringify(back)}`);
await p.click("#close-modal");

// ── 5. 送信データ ──
await p.click("#submit-survey");
await p.waitForTimeout(300);
const review = posted && posted.selections && posted.selections[0] && posted.selections[0].subject.review;
check(review, "[5] 送信データが取れない");
if (review) {
  check(review.textbook === "必要", `[5] textbook: ${review.textbook}`);
  check(review.textbookPrice === "1,500〜1,999円", `[5] textbookPrice: ${review.textbookPrice}`);
  check(review.textbookPlaces === "生協、メルカリ、その他（先輩から）",
    `[5] textbookPlaces: ${review.textbookPlaces}`);
}

check(errors.length === 0, `コンソールエラー: ${errors.join(" / ")}`);

await browser.close();
console.log(fails.length ? "NG" : "OK");
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
