/* 時間割コード（KOAN の履修登録で打ち込む6桁）が各科目に出ていること。
 *
 *   python3 tools/serve.py 8203 &
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
/* 数字は .mCode の中の地のテキスト、コピー先の値は .ccC の data-code。
   2つがズレると「見ている数字と違うものがコピーされる」ので両方見る。 */
const firstCode = await page.locator(".card").first().locator(".mCode").evaluate(
  el => el.childNodes[0].textContent.trim());
check(await page.locator(".card").first().locator(".ccC").getAttribute("data-code") === firstId,
      "コピー先の data-code が科目の id と違う");
check(firstCode === firstId,
      `カードのコードが data-id と違う（表示 ${firstCode} / 実体 ${firstId}）`);
check(/^\d{6}$/.test(firstCode), `コードが6桁の数字でない（${firstCode}）`);

/* コードは .head（role="button"）の中＝ .meta の行に置く。
   一覧側は <span>（押せる要素の入れ子を作らない）、PCの右ペインは <button>。 */
check(await page.locator(".card .head .mCode").count() === codes,
      "コードが .meta（.head の中）に無い");
check(await page.locator(".card .head button").count() === 0,
      "一覧カードの .head の中に <button> がある（role=button の入れ子になる）");
check(await page.locator(".dActs .codeChip, .codeChip").count() === 0,
      "詳細の全幅チップが残っている（この行へ移したはず）");

// ── ② 行の中でコピーできる ────────────────────
const codeEl = page.locator(".card").first().locator(".mCode");
const copyEl = codeEl.locator(".ccC");
check((await copyEl.textContent()).includes("コピー"),
      "数字の右に「コピー」が出ていない");

await copyEl.click();
await page.waitForTimeout(150);
const copied = await page.evaluate(() => navigator.clipboard.readText());
check(copied === firstId, `コピーされたのが id と違う（${copied} / ${firstId}）`);
check((await copyEl.textContent()).includes("コピー済"),
      "コピーした手応え（文言の切り替え）が出ない");
/* コードを押してカードが開いてしまわないこと（capture 段で止めている）。
   ここが崩れると、コピーのたびに詳細が開いて一覧が飛ぶ。 */
check(await page.locator(".card").first().locator(".detail .dSec").count() === 0,
      "「コピー」を押しただけでカードが開いた（stopPropagation が効いていない）");

/* 数字そのものは押せない＝押せばカードが開く（誤爆防止の要）。 */
await page.locator(".card").first().locator(".title").click();
await page.waitForSelector(".detail .dSec, #inspector .dSec");
check(await page.locator(".detail .dSec, #inspector .dSec").count() > 0,
      "科目名を押してもカードが開かない（回帰）");

/* 押せる面が広がりすぎていないこと。ここはカードの本文の中なので、
   大きくすると「カードを開こうとした指がコピーに当たる」が増える。
   ラベル1つぶん（だいたい 70×30px）を超えたら作り直しを疑う。 */
const box = await copyEl.boundingBox();
check(box && box.width <= 90 && box.height <= 34,
      `コピーの当たり判定が広すぎる（${box && Math.round(box.width)}×${box && Math.round(box.height)}px）`);

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
