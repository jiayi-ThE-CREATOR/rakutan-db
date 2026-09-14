import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8199";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.waitForSelector("#facSel");

// 1. 外国語学部を選ぶ → trackSel が出て、trackSel2 はまだ隠れている
await page.selectOption("#facSel", "foreign-s");
await page.waitForTimeout(200);
let state1 = await page.evaluate(() => ({
  trackHidden: document.querySelector("#trackSel").hidden,
  track2Hidden: document.querySelector("#trackSel2").hidden,
  rowSplit: document.querySelector("#trackRow").classList.contains("split"),
}));
console.log("after faculty=foreign-s:", state1);
if (state1.trackHidden !== false || state1.track2Hidden !== true || state1.rowSplit !== false) {
  console.error("FAIL: step1 unexpected state");
  process.exit(1);
}

// 2. 専攻語で日本語(fs_lang:R)を選ぶ → trackSel2 が出て、split クラスが付く
await page.selectOption("#trackSel", "fs_lang:R");
await page.waitForTimeout(200);
let state2 = await page.evaluate(() => ({
  track2Hidden: document.querySelector("#trackSel2").hidden,
  rowSplit: document.querySelector("#trackRow").classList.contains("split"),
  options: [...document.querySelectorAll("#trackSel2 option")].map(o => o.value),
}));
console.log("after track=fs_lang:R:", state2);
if (state2.track2Hidden !== false || state2.rowSplit !== true) {
  console.error("FAIL: step2 trackSel2 should be visible and row split");
  process.exit(1);
}
if (state2.options.includes("fs_lang:R")) {
  console.error("FAIL: 日本語自身が言語の選択肢に残っている");
  process.exit(1);
}

// 3. 言語=中国語(fs_lang:1) を選ぶ → 一覧が中国語専攻(fs_lang:1)を直接選んだ場合と一致するはず
await page.selectOption("#trackSel2", "fs_lang:1");
await page.waitForTimeout(300);
const viaLang2 = await page.evaluate(() => [...document.querySelectorAll("#list .card")].map(c => c.dataset.id || c.textContent.slice(0,20)).sort());
const countViaLang2 = await page.evaluate(() => document.querySelectorAll("#list .card").length);
console.log("via track2=fs_lang:1, card count:", countViaLang2);

// 4. 比較対象：学部を変えず、専攻語を直接「中国語」にした場合
await page.selectOption("#trackSel", "fs_lang:1");
await page.waitForTimeout(300);
const viaDirect = await page.evaluate(() => [...document.querySelectorAll("#list .card")].map(c => c.dataset.id || c.textContent.slice(0,20)).sort());
const countDirect = await page.evaluate(() => document.querySelectorAll("#list .card").length);
console.log("via track=fs_lang:1 directly, card count:", countDirect);

if (countViaLang2 === 0) {
  console.error("FAIL: track2 経由で0件（フィルタが効いていない可能性）");
  process.exit(1);
}
if (JSON.stringify(viaLang2) !== JSON.stringify(viaDirect)) {
  console.error("FAIL: track2=fs_lang:1 の結果が、直接 track=fs_lang:1 を選んだ場合と一致しない");
  process.exit(1);
}

// 5. 専攻語を工学部の学科に変える → trackSel2 は隠れて state.track2 も捨てられる
await page.selectOption("#facSel", "engineering");
await page.waitForTimeout(200);
let state3 = await page.evaluate(() => ({
  track2Hidden: document.querySelector("#trackSel2").hidden,
  rowSplit: document.querySelector("#trackRow").classList.contains("split"),
}));
console.log("after faculty=engineering:", state3);
if (state3.track2Hidden !== true || state3.rowSplit !== false) {
  console.error("FAIL: step5 trackSel2 should be hidden again for a faculty without the lang2 case");
  process.exit(1);
}

console.log("ALL OK");
await browser.close();
