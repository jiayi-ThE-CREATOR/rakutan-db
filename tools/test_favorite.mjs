/* お気に入りの星が「押せて」「残って」「詳細を開かない」ことを実ブラウザで見る。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_favorite.mjs http://localhost:8140
 *
 * 静的配信に当てるのが肝。本番で動くのは web/assets/app.js のほう。
 *
 * 2026-08-26 追記：詳細パネル側の星（.panelBtn / .reviewBtn と並ぶもの）を
 * 足したとき、.favBtn に無scopeで position:absolute を書いてしまい、
 * 詳細を開くと一覧側の星の真上に重なるバグが出た。カード直下の星
 * （.card > .favBtn）と詳細内の星（.detail .favBtn）を別の場所に
 * 描き分けたので、その回帰を防ぐチェックをモバイル幅で足してある。
 *
 * 2026-08-26 追記2：main の「あなたに合う」枠（#list 内の section.picks）が
 * 入り、口コミ確認ずみの科目は #list の直下カードと picks 内カードの
 * 2枚に同時に描画されるようになった（renderPage が picks を #list の
 * 子として appendChild している）。「一覧の星」を指すセレクタは
 * bare な .card[data-id=…] ではなく #list > .card[data-id=…]（picks の
 * 孫要素は除く直下だけ）に絞る必要がある。加えて、同じ科目が2箇所に
 * 同時に星を持つようになったこと自体を回帰テストする（末尾の
 * 「picks/一覧 相互同期」ブロック）。
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

/* 2つの矩形が重なっているか。星が同じ場所に吸い寄せられるバグは
   これで見える（片方がもう片方の上にぴったり乗る＝完全重複も含む）。 */
const overlaps = (a, b) => !!a && !!b
  && a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

const bypassOnboarding = async (p) => {
  /* 開屏の問診に邪魔されないよう、済んだことにしてから開く。 */
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
};

const browser = await chromium.launch();

/* ── デスクトップ：一覧の星・#inspector の星・再読込での永続化 ── */
const page = await browser.newPage();
await bypassOnboarding(page);
await page.goto(BASE + "/");
await page.waitForSelector(".card .favBtn");

/* #list > .card ＝一覧直下のカードだけ（picks 内のカードは #list の孫）。
   「あなたに合う」に載っている科目は #list 直下にも重複して出るので、
   ただの .card[data-id=…] だと2枚ヒットして strict mode で落ちる。 */
const first = page.locator("#list > .card").first();
const star  = first.locator(".favBtn");
const id    = await first.getAttribute("data-id");
const cardSel = `#list > .card[data-id="${id}"]`;

check(await star.getAttribute("aria-pressed") === "false", "初期状態が押されている");

await star.click();
check(await star.getAttribute("aria-pressed") === "true", "押しても aria-pressed が変わらない");

/* 星は .head の外に在るので、押しても詳細が開いてはいけない。 */
const opened = await first.locator(".detail").evaluate(el => el.children.length > 0);
check(opened === false, "星を押したら詳細まで開いてしまった（.head の中に置いている）");

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rk_favorites") || "{}"));
check(saved.ids && saved.ids[id], "localStorage に入っていない");

/* 再読込しても残ること。 */
await page.reload();
await page.waitForSelector(".card .favBtn");
const star2 = page.locator(`${cardSel} .favBtn`);
check(await star2.getAttribute("aria-pressed") === "true", "再読込で消えた");

await star2.click();
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("rk_favorites") || "{}"));
check(!(after.ids && after.ids[id]), "もう一度押しても外れない");

/* ここまでで一覧の星は「外れた」状態。PC では詳細は #inspector に出る。
   星も .panelBtn / .reviewBtn と同じ並びに、浮かせずに出ているか
   （2026-08-26 修正：もとは無scopeの position:absolute で
   #inspector 内の星までカード側と同じ置き方を引きずっていた）。 */
await page.locator(`${cardSel} .head`).click();
await page.waitForSelector("#inspector .detail .favBtn");
const inspStar = page.locator("#inspector .favBtn");
check(await inspStar.count() === 1, "#inspector に星がちょうど1つ出ていない");

const inspPos = await inspStar.evaluate(el => getComputedStyle(el).position);
check(inspPos !== "absolute", "#inspector の星が浮いたまま（カード側の配置を引きずっている）");

const listStarBox = await page.locator(`${cardSel} > .favBtn`).boundingBox();
const inspStarBox = await inspStar.boundingBox();
check(!overlaps(listStarBox, inspStarBox), "一覧の星と #inspector の星が重なっている");

/* #inspector 側を押しても一覧側に反映されること（両方向の同期）。 */
await inspStar.click();
check(await inspStar.getAttribute("aria-pressed") === "true", "#inspector の星の aria-pressed が変わらない");
check(await page.locator(`${cardSel} > .favBtn`).getAttribute("aria-pressed") === "true",
      "#inspector の星を押しても一覧側に反映されない");

/* ── モバイル：カードを開いたとき、一覧側と詳細側の星が重ならないこと ──
   （2026-08-26 の CSS バグの回帰テスト。バグ再現時は2つの星がぴったり重なる。） */
const mpage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await bypassOnboarding(mpage);
await mpage.goto(BASE + "/");
await mpage.waitForSelector(".card .favBtn");

const mfirst  = mpage.locator("#list > .card").first();
const mid     = await mfirst.getAttribute("data-id");
const mCardSel = `#list > .card[data-id="${mid}"]`;

await mpage.locator(`${mCardSel} .head`).click();
await mpage.waitForSelector(`${mCardSel} .detail .favBtn`);

const cardStar   = mpage.locator(`${mCardSel} > .favBtn`);
const detailStar = mpage.locator(`${mCardSel} .detail .favBtn`);

const cardBox   = await cardStar.boundingBox();
const detailBox = await detailStar.boundingBox();
check(!overlaps(cardBox, detailBox), "モバイルでカード星と詳細星が重なっている");

/* 詳細側を押しても一覧側に、一覧側を押しても詳細側に反映されること。 */
await detailStar.click();
check(await detailStar.getAttribute("aria-pressed") === "true", "詳細の星の aria-pressed が変わらない");
check(await cardStar.getAttribute("aria-pressed") === "true", "詳細の星を押しても一覧側に反映されない");

await cardStar.click();
check(await cardStar.getAttribute("aria-pressed") === "false", "一覧の星の aria-pressed が変わらない");
check(await detailStar.getAttribute("aria-pressed") === "false", "一覧の星を押しても詳細側に反映されない");

/* ── Critical 回帰：相性スコア(.fit)と星(.card > .favBtn)の重なり ──
 * 星がカード右上に絶対配置（top:6px;right:6px、幅44px）されている一方、
 * カード右上にはもともと .head の子として .fit（相性の数字、.head の
 * 右列58px）があった。.head の右パディングを広げていないと、星が
 * .fit の上に乗り、数字をタップしたつもりが星に当たって詳細が開かず
 * 意図せずお気に入りが切り替わる（初期の閉じたカード状態で、モバイル・
 * デスクトップ両方の幅で発生）。カードごとに新規ページを開いて他の
 * チェックの状態変化から独立させ、モバイル幅・デスクトップ幅の両方で
 * 「重ならない」「中心をクリックしても星に当たらない」「クリックすると
 * 詳細は開くが星の状態は変わらない」を確かめる。 */
for (const [label, viewport] of [
  ["mobile 390px", { width: 390, height: 844 }],
  ["desktop 1280px", { width: 1280, height: 900 }],
]) {
  const fp = await browser.newPage({ viewport });
  await bypassOnboarding(fp);
  await fp.goto(BASE + "/");
  await fp.waitForSelector(".card .favBtn");

  const fcard = fp.locator("#list > .card").first();
  const fcardId = await fcard.getAttribute("data-id");
  const fcardSel = `#list > .card[data-id="${fcardId}"]`;

  /* 最初のカードはヘッダ類の下、ページのだいぶ下（2000px超）にある。
     boundingBox() は自動でスクロールしないので、elementFromPoint と
     マウスクリックを実座標で行うには先に画面内へスクロールしておく必要がある。
     html{scroll-behavior:smooth} が効いているため behavior:"instant" を
     明示しないとアニメーション中の座標を読んでしまう（実際にこれで
     ハマった：スクロール未完了のまま計算して elementFromPoint が
     null を返していた）。 */
  await fp.locator(fcardSel).evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));

  const favBox = await fp.locator(`${fcardSel} > .favBtn`).boundingBox();
  const fitBox = await fp.locator(`${fcardSel} .fit`).boundingBox();
  check(!!favBox, `[${label}] .card > .favBtn の boundingBox が取れない`);
  check(!!fitBox, `[${label}] .card .fit の boundingBox が取れない`);
  check(!overlaps(favBox, fitBox), `[${label}] .fit と星(.card > .favBtn)の矩形が重なっている`);

  const fitCenter = { x: fitBox.x + fitBox.width / 2, y: fitBox.y + fitBox.height / 2 };
  const hit = await fp.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return { isFit: false, isInHead: false, isFav: false, tag: "none" };
    return {
      isFit: !!el.closest(".fit"),
      isInHead: !!el.closest(".head"),
      isFav: !!el.closest(".favBtn"),
      tag: el.className || el.tagName,
    };
  }, fitCenter);
  check(!hit.isFav, `[${label}] .fit の中心が elementFromPoint で星(.favBtn)に当たる`);
  check(hit.isFit || hit.isInHead,
        `[${label}] .fit の中心が .fit にも .head 内の要素にも当たっていない: ${hit.tag}`);

  const pressedBefore = await fp.locator(`${fcardSel} > .favBtn`).getAttribute("aria-pressed");
  await fp.mouse.click(fitCenter.x, fitCenter.y);
  /* 開き先は幅で変わる（app.js の isDesktop()）：PC は #inspector、
     スマホはカード自身の .detail。ここは .fit がどちらの経路の
     クリックも .head 委譲まで正しく通っているかの確認なので、
     開いた先を見る場所も同じ分岐に合わせる。 */
  const openedByFit = viewport.width >= 1024
    ? await fp.locator("#inspector .detail").evaluate(el => el.children.length > 0)
    : await fp.locator(`${fcardSel} .detail`).evaluate(el => el.children.length > 0);
  check(openedByFit === true, `[${label}] .fit の中心をクリックしても詳細が開かない`);
  const pressedAfter = await fp.locator(`${fcardSel} > .favBtn`).getAttribute("aria-pressed");
  check(pressedAfter === pressedBefore, `[${label}] .fit をクリックしたら星の aria-pressed が変わった`);

  await fp.close();
}

/* ── picks/一覧 相互同期：同じ科目が「あなたに合う」枠と一覧本体の
 * 両方に描画されているとき、片方の星を押すともう片方にも即反映されること。
 *
 * 2026-08-26 追記2：main の「あなたに合う」枠が入るまでは1科目=1枚の
 * カードしか無く、この状況自体がテスト不能だった。今は topPicks() が
 * courses から選ぶだけで一覧本体から除外しないので、口コミ確認ずみの
 * 科目は構造的に両方へ重複して出る。app.js 側は
 * document.querySelectorAll(`.favBtn[data-id="…"]`) で同一 data-id の
 * 星を全部まとめて更新しているので同期して当然のはずだが、
 * それを固定しておかないと「星が2箇所に出るようになった」ことに
 * 気づかないまま、どちらかしか更新しない実装に退行しても検知できない。 */
const syncPage = await browser.newPage();
await bypassOnboarding(syncPage);
await syncPage.goto(BASE + "/");
await syncPage.waitForSelector("#list > .card");

const picksIds = await syncPage.$$eval("#list .picks .card", els => els.map(e => e.getAttribute("data-id")));
const mainListIds = await syncPage.$$eval("#list > .card", els => els.map(e => e.getAttribute("data-id")));
const dupIds = picksIds.filter(pid => mainListIds.includes(pid));

if (dupIds.length === 0) {
  console.log("  NOTE: 「あなたに合う」枠と一覧本体の両方に載る科目が現在のデータに無いため、picks/一覧 相互同期は検証できなかった（アサーション追加せず）。");
} else {
  const dupId = dupIds[0];
  const picksStar = syncPage.locator(`#list .picks .card[data-id="${dupId}"] > .favBtn`);
  const listStar  = syncPage.locator(`#list > .card[data-id="${dupId}"] > .favBtn`);

  check(await picksStar.count() === 1, `picks 側に科目${dupId}の星がちょうど1つ出ていない`);
  check(await listStar.count() === 1, `一覧側に科目${dupId}の星がちょうど1つ出ていない`);

  check(await picksStar.getAttribute("aria-pressed") === "false", "同期テストの初期状態（picks）が押されている");
  check(await listStar.getAttribute("aria-pressed") === "false", "同期テストの初期状態（一覧）が押されている");

  // picks 側を押す → 一覧側にも反映されること。
  await picksStar.click();
  check(await picksStar.getAttribute("aria-pressed") === "true", "picks の星の aria-pressed が変わらない");
  check(await picksStar.textContent() === "★", "picks の星の表示が★に変わらない");
  check(await listStar.getAttribute("aria-pressed") === "true",
        "picks の星を押しても一覧側の星の aria-pressed に反映されない");
  check(await listStar.textContent() === "★",
        "picks の星を押しても一覧側の星の表示（☆→★）に反映されない");

  // 一覧側を押して外す → picks 側にも反映されること（逆方向）。
  await listStar.click();
  check(await listStar.getAttribute("aria-pressed") === "false", "一覧の星の aria-pressed が変わらない");
  check(await listStar.textContent() === "☆", "一覧の星の表示が☆に戻らない");
  check(await picksStar.getAttribute("aria-pressed") === "false",
        "一覧の星を外しても picks 側の星の aria-pressed に反映されない");
  check(await picksStar.textContent() === "☆",
        "一覧の星を外しても picks 側の星の表示（★→☆）に反映されない");
}
await syncPage.close();

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
