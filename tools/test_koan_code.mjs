/* 時間割コード（KOAN の履修登録で打ち込む6桁）が各科目に出ていること。
 *
 *   cd web && python3 -m http.server 8203 &
 *   node tools/test_koan_code.mjs http://localhost:8203
 *
 * 見ているのは4か所：一覧カード／詳細のコピーチップ／検索／マイページの時間割。
 * データ側（courses.built.json の id）は 7,906件すべてに入っていて重複が無い
 * ことを確認ずみなので、ここで試すのは「出ているか」だけ。
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8203";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
/* コピーの確認にクリップボードを読む。localhost は secure context なので
   navigator.clipboard は使えるが、読み書きの許可は明示的に要る。 */
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("rk_onboarded", "1");
    localStorage.setItem("osaka_u_settings",
      JSON.stringify({ faculty: "law", grade: "2", semester: "autumn" }));
  } catch (e) {}
});

// ── ① 一覧カード ───────────────────────────────
await page.goto(BASE + "/");
await page.waitForSelector(".card");

const cards = await page.locator(".card").count();
const codes = await page.locator(".card .mCode").count();
check(cards > 0, "カードが1枚も出ていない（前提が崩れている）");
check(cards === codes, `コードが出ていないカードがある（カード${cards}枚・コード${codes}個）`);

const firstId = await page.locator(".card").first().getAttribute("data-id");
const firstCode = (await page.locator(".card").first().locator(".mCode").textContent()).trim();
check(firstCode === firstId,
      `カードのコードが data-id と違う（表示 ${firstCode} / 実体 ${firstId}）`);
check(/^\d{6}$/.test(firstCode), `コードが6桁の数字でない（${firstCode}）`);

/* コードは .head（role="button"）の中に置く＝押せる要素の入れ子を作らない。
   一覧では「見えるだけ」で、押したらカードが開くのが正しい挙動。 */
check(await page.locator(".card .head .mCode").count() === codes,
      "コードが .meta（.head の中）に無い");
check(await page.locator(".card .mCode button, .card .head .codeChip").count() === 0,
      "一覧カードに押せるコード要素がある（.head は role=button なので入れ子になる）");

// ── ② 詳細のコピーチップ ────────────────────────
await page.locator(".card").first().locator(".head").click();
await page.waitForSelector(".detail .dSec, #inspector .dSec");

const chip = page.locator(".codeChip").first();
check(await chip.count() === 1 || await page.locator(".codeChip").count() > 0,
      "詳細に .codeChip が無い");
check(await chip.getAttribute("data-code") === firstId,
      "詳細のチップの data-code が科目の id と違う");
check((await chip.textContent()).includes(firstId),
      "詳細のチップに6桁が出ていない");
check((await chip.textContent()).includes("時間割コード"),
      "詳細のチップに「時間割コード」の呼び名が無い");

/* KOAN リンクの真上にあること（コードを控える→KOANを開く、の順） */
const order = await page.evaluate(() => {
  const acts = document.querySelector(".dActs");
  if (!acts) return null;
  return [...acts.children].map(el => el.className.split(" ")[0]);
});
check(order && order.indexOf("codeChip") >= 0 && order.indexOf("koanLink") >= 0
      && order.indexOf("codeChip") < order.indexOf("koanLink"),
      `チップが KOAN リンクの上に無い（${JSON.stringify(order)}）`);

await chip.click();
await page.waitForTimeout(150);
const copied = await page.evaluate(() => navigator.clipboard.readText());
check(copied === firstId, `コピーされたのが id と違う（${copied} / ${firstId}）`);
check((await chip.textContent()).includes("コピーしました"),
      "コピーした手応え（文言の切り替え）が出ない");

// ── ③ コードで検索 ──────────────────────────────
await page.fill("#q", firstId);
await page.waitForTimeout(400);
const hit = await page.locator(".card").count();
check(hit === 1, `コード検索の結果が1件でない（${hit}件）`);
check(await page.locator(`.card[data-id="${firstId}"]`).count() === 1,
      "コードで検索したのに当の科目が出ていない");

// 科目名での検索が壊れていないこと（回帰）
await page.fill("#q", "統計");
await page.waitForTimeout(400);
check(await page.locator(".card").count() > 0, "科目名での検索が効かなくなっている（回帰）");

// ── ④ マイページの時間割 ───────────────────────
await page.goto(BASE + "/mypage.html");
await page.waitForSelector(".mpCell[data-slot='月2']");
await page.click(".mpCell[data-slot='月2']");
await page.waitForSelector("#mpPicker[open]");

const pick = page.locator("#mpPicker .mpPick").first();
const pickedId = await pick.getAttribute("data-id");
check((await pick.textContent()).includes(pickedId),
      "科目ピッカーの行にコードが出ていない");

await pick.click();
const cellCode = await page.locator(".mpCell[data-slot='月2'] .mpCellCode").textContent();
check(cellCode.trim() === pickedId,
      `時間割のマスにコードが出ていない（${cellCode} / ${pickedId}）`);

// お気に入り欄にも出ること
await page.evaluate(id => {
  localStorage.setItem("rk_favorites", JSON.stringify({ v: 1, ids: { [id]: Date.now() } }));
}, pickedId);
await page.reload();
await page.waitForSelector("#mpFavList");
const favTxt = await page.locator("#mpFavList").textContent();
check(favTxt.includes(pickedId), "お気に入り欄にコードが出ていない");

await browser.close();

if (fails.length){
  console.error(`FAIL ${fails.length}/${n}`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK ${n} checks`);
