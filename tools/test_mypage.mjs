/* マイページ。まずは「在ること」と「プロフィールが往復すること」。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_mypage.mjs http://localhost:8140
 */
import { chromium } from "playwright";

const DAYS_X_PERIODS = 5 * 6;   // 月〜金 × 1〜6限

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("rk_onboarded", "1");
    localStorage.setItem("osaka_u_settings",
      JSON.stringify({ faculty: "law", grade: "2", semester: "autumn" }));
  } catch (e) {}
});

await page.goto(BASE + "/mypage.html");
await page.waitForSelector("#mpProfile");

check(await page.locator("#mpTimetable").count() === 1, "時間割の入れ物が無い");
check(await page.locator("#mpFavorites").count() === 1, "お気に入りの入れ物が無い");

// ナビが5項目で、現在地が付いていること（main の /ads 追加で 4→5）
check(await page.locator(".nav a").count() === 5, "ナビが5項目でない");
check(await page.locator('.nav a[data-nav="mypage"][aria-current="page"]').count() === 1,
      "マイページに現在地が付いていない");

// プロフィールが読めていること
check(await page.locator("#mpFaculty").inputValue() === "law", "学部が読めていない");
check(await page.locator("#mpGrade").inputValue() === "2", "学年が読めていない");

// 変えると保存され、kuchikomi の semester を壊さないこと
await page.selectOption("#mpGrade", "3");
const set = JSON.parse(await page.evaluate(() => localStorage.getItem("osaka_u_settings")));
check(set.grade === "3", "学年の変更が保存されない");
check(set.semester === "autumn", "kuchikomi の semester を壊した");

// ── 時間割 ────────────────────────────────
await page.waitForSelector(".mpCell[data-slot='月2']");
check(await page.locator(".mpCell").count() === DAYS_X_PERIODS,
      `マスが ${DAYS_X_PERIODS} 個であるべき`);

await page.click(".mpCell[data-slot='月2']");
await page.waitForSelector("#mpPicker[open]");
const opts = await page.locator("#mpPicker .mpPick").count();
check(opts > 0, "月2 の科目が1つも出てこない");

const pickedId = await page.locator("#mpPicker .mpPick").first().getAttribute("data-id");
await page.locator("#mpPicker .mpPick").first().click();
check(await page.locator(".mpCell[data-slot='月2']").textContent() !== "",
      "選んだのにマスが空のまま");

let tt = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt.aki.slots["月2"] === pickedId, "aki の 月2 に入っていない");
check(!tt.haru.slots["月2"], "haru にも漏れている（学期は別の表）");

// 学期を切り替えると空であること
await page.click("[data-term='haru']");
check(await page.locator(".mpCell[data-slot='月2']").textContent().then(t => t.trim()) === "",
      "春学期に秋学期の科目が出ている");
await page.click("[data-term='aki']");

// 再読込しても残る
await page.reload();
await page.waitForSelector(".mpCell[data-slot='月2']");
check((await page.locator(".mpCell[data-slot='月2']").textContent()).trim() !== "",
      "再読込で時間割が消えた");

// ── 複数コマの科目は、外すときも全コマ対称に外れること ──────────
// 137103（'【社会】心理学基礎実験'）は web/data/timetable.json で
// slots:["金4","金5","金6"]・term_group:"aki" の実在の科目。
const MULTI_ID = "137103";
const MULTI_SLOTS = ["金4", "金5", "金6"];

await page.click(".mpCell[data-slot='金4']");
await page.waitForSelector("#mpPicker[open]");
check(await page.locator(`#mpPicker .mpPick[data-id='${MULTI_ID}']`).count() === 1,
      "137103 が 金4 の候補に出てこない（テストデータ側の前提が崩れている）");
await page.click(`#mpPicker .mpPick[data-id='${MULTI_ID}']`);

for (const s of MULTI_SLOTS){
  check((await page.locator(`.mpCell[data-slot='${s}']`).textContent()).trim() !== "",
        `複数コマ科目を置いたのに ${s} が空のまま`);
}

// クリックしたのは1コマだけ。外すときは科目ごと ―― 全コマ対称に外れるべき。
await page.click(".mpCell[data-slot='金5']");
for (const s of MULTI_SLOTS){
  check((await page.locator(`.mpCell[data-slot='${s}']`).textContent()).trim() === "",
        `${s} をクリックして外したのに ${s === "金5" ? "同じマス" : s + " が"} 埋まったまま（複数コマの片外れ）`);
}

tt = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(!Object.values(tt.aki.slots).includes(MULTI_ID),
      "外したはずの複数コマ科目が aki.slots のどこかに残っている");

// ── 単一コマの科目は、これまで通り1コマだけで置ける・外れること（回帰）──
// 月2 は上のテストで pickedId（単一コマの科目）が入ったまま。
check((await page.locator(".mpCell[data-slot='月2']").textContent()).trim() !== "",
      "単一コマ科目の回帰確認の前提が崩れている（月2 が既に空）");
await page.click(".mpCell[data-slot='月2']");
check((await page.locator(".mpCell[data-slot='月2']").textContent()).trim() === "",
      "単一コマ科目が1タップで外れない（回帰）");

tt = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(!Object.values(tt.aki.slots).includes(pickedId),
      "外したはずの単一コマ科目が aki.slots のどこかに残っている（回帰）");

// ── ピッカー経由の上書きも確認すること（前タスクの持ち越し不具合の回帰）──
// 137103（金4・金5・金6）を、金5 だけ別の科目で先に埋めた状態でピッカーから
// 選ぶと、他コマを黙って上書きしないこと。お気に入り側と同じ確認を
// putCourse（両方の入り口の合流点）が出すはず。
await page.evaluate(() => localStorage.setItem("rk_timetable", JSON.stringify({
  v: 1,
  aki: { slots: { "金5": "999999" }, extra: [] },
  haru: { slots: {}, extra: [] },
})));
await page.reload();
await page.waitForSelector(".mpCell[data-slot='金4']");

let dialogSeen = false;
page.once("dialog", d => { dialogSeen = true; d.dismiss(); });
await page.click(".mpCell[data-slot='金4']");
await page.waitForSelector("#mpPicker[open]");
await page.click(`#mpPicker .mpPick[data-id='${MULTI_ID}']`);
await page.waitForTimeout(100);
check(dialogSeen, "ピッカー経由の上書きで確認ダイアログが出ない（持ち越し不具合が残っている）");
check((await page.locator(".mpCell[data-slot='金4']").textContent()).trim() === "",
      "確認をキャンセルしたのに 金4 に置かれた");
check((await page.locator(".mpCell[data-slot='金5']").textContent()).trim() === "",
      "確認をキャンセルしたのに 金5 の表示が変わった");

// 承諾すれば、確認どおり全コマに置かれる
await page.click(".mpCell[data-slot='金4']");
await page.waitForSelector("#mpPicker[open]");
page.once("dialog", d => d.accept());
await page.click(`#mpPicker .mpPick[data-id='${MULTI_ID}']`);
for (const s of MULTI_SLOTS){
  check((await page.locator(`.mpCell[data-slot='${s}']`).textContent()).trim() !== "",
        `確認を承諾したのに ${s} が空のまま`);
}
tt = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt.aki.slots["金5"] === MULTI_ID, "承諾後も 金5 が上書きされていない");

// ── お気に入り → 時間割 ──────────────────────
await page.evaluate(() => {
  localStorage.setItem("rk_favorites",
    JSON.stringify({ v:1, ids:{ "137094": Date.now() } }));   // 木6・haru
});
await page.reload();
await page.waitForSelector("#mpFavList .mpFav");
check(await page.locator("#mpFavList .mpFav").count() === 1, "お気に入りが出ない");

// 木6 は春学期。秋学期のままだと入れられない旨が出ること
// （ブリーフのコメントはこう書いてあったが、テスト本体は学期を
//   切り替える前の状態を確かめていなかったので、ここで確かめる）
check(await page.locator("#mpFavList .mpFav .mpNote").count() === 1,
      "学期違いの科目なのに理由が出ない（秋学期のまま）");
check(await page.locator("#mpFavList .mpFav [data-add]").count() === 0,
      "学期違いなのに時間割に入れるボタンが出ている");
await page.click("[data-term='haru']");
await page.click("#mpFavList .mpFav [data-add='137094']");
let tt2 = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt2.haru.slots["木6"] === "137094", "お気に入りから時間割に入らない");

// 外すと一覧から消える
await page.click("#mpFavList .mpFav [data-fav='137094']");
check(await page.locator("#mpFavList .mpFav").count() === 0, "お気に入りを外せない");

// ── fix round 1: 曜限なし（extra 行き）の favorite も、コマと同じ学期
//    判定（inTerm）を通ること。以前は曜限の有無を先に見ていたため、
//    今見ている学期と無関係に addExtra(term, id) が現在の学期へ積んでいた。
// 138537（'"見る"を神経科学するⅠ'・曜限なし・haru専用）と
// 135345（'【総合】大阪の防災...'・曜限なし・full＝両学期）は
// web/data/timetable.json の実在データ。
const HARU_ONLY_ID = "138537";
const FULL_ID = "135345";
await page.evaluate(({ haru, full }) => {
  localStorage.setItem("rk_favorites", JSON.stringify({
    v: 1,
    ids: { [haru]: Date.now(), [full]: Date.now() - 1 },
  }));
  localStorage.setItem("rk_timetable", JSON.stringify({
    v: 1, aki: { slots: {}, extra: [] }, haru: { slots: {}, extra: [] },
  }));
}, { haru: HARU_ONLY_ID, full: FULL_ID });
await page.reload();
await page.waitForSelector("#mpFavList .mpFav");
// reload直後の既定学期は秋（term = "aki" が mypage.js の初期値）。

check(await page.locator(`#mpFavList .mpFav [data-addextra='${HARU_ONLY_ID}']`).count() === 0,
      "秋なのに haru専用の曜限なし科目に「時間割に入れる」ボタンが出ている");
check(await page.locator(`#mpFavList .mpFav:has([data-fav='${HARU_ONLY_ID}']) .mpNote`).count() === 1,
      "秋なのに haru専用の曜限なし科目に学期違いの案内が出ない");

let tt3 = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(!tt3.aki.extra.includes(HARU_ONLY_ID),
      "秋の extra に haru専用の曜限なし科目が紛れ込んでいる");

// full（通年）の曜限なし科目は、秋でも普通に追加できること。
await page.click(`#mpFavList .mpFav [data-addextra='${FULL_ID}']`);
tt3 = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt3.aki.extra.includes(FULL_ID), "full の曜限なし科目が秋の extra に追加できない");

// 春に切り替えると、haru専用の曜限なし科目は追加でき、春の extra に入ること。
await page.click("[data-term='haru']");
await page.waitForSelector(`#mpFavList .mpFav [data-addextra='${HARU_ONLY_ID}']`);
await page.click(`#mpFavList .mpFav [data-addextra='${HARU_ONLY_ID}']`);
tt3 = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt3.haru.extra.includes(HARU_ONLY_ID),
      "春に切り替えても haru専用の曜限なし科目が春の extra に追加できない");

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
