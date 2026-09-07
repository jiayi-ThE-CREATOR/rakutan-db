/* 口コミの中央モーダル。PC・スマホで同じ形になっていることを固定する。
 *   node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
 * 口コミ4件の科目 135327 を使う。件数が変わってもテストが落ちないよう、
 * 件数そのものは data から読んで期待値にする。 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8794";
const ID = "135327";
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

const browser = await chromium.launch();

async function page(w, h){
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  return p;
}

/* 幅を2つとも見る。「PC とスマホで同じ形」がこの PR の約束なので、
   片方だけ通っても意味がない。 */
for (const [label, w, h] of [["スマホ", 390, 844], ["PC", 1280, 900]]){
  const p = await page(w, h);
  await p.goto(`${base}/?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#panel.open", { timeout: 15000 });

  const box = await p.evaluate(() => {
    const el = document.querySelector("#panel .kBox");
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: window.innerHeight - r.bottom,
             left: r.left, right: window.innerWidth - r.right,
             width: r.width };
  });

  /* 上下中央：上下の余白の差が 40px 以内。下からのシート（top が大きく
     bottom が 0）に戻ったらここで落ちる。 */
  check(Math.abs(box.top - box.bottom) <= 40,
        `[${label}] モーダルが上下中央にない（上 ${Math.round(box.top)} / 下 ${Math.round(box.bottom)}）`);
  check(Math.abs(box.left - box.right) <= 2,
        `[${label}] モーダルが左右中央にない（左 ${Math.round(box.left)} / 右 ${Math.round(box.right)}）`);
  check(box.width <= 560 + 1, `[${label}] モーダルが 560px より広い（${Math.round(box.width)}px）`);

  /* 字の大きさ。「読みやすくした」を回帰させないために実測で固定する。
     いまの本文は 13px、集計の数字は 11.5px。 */
  const type = await p.evaluate(() => {
    const px = (el, prop) => el ? parseFloat(getComputedStyle(el)[prop]) : 0;
    const note = document.querySelector("#panelBody .pNote");
    const val  = document.querySelector("#panelBody .rvf b");
    return { note: px(note, "fontSize"),
             lh:   px(note, "lineHeight") / (px(note, "fontSize") || 1),
             val:  px(val, "fontSize"),
             /* 本文が属性より前にあること（DOM 順） */
             noteBeforeFacts: !!(note && note.compareDocumentPosition(
               note.parentElement.querySelector(".pFacts")) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  check(type.note >= 15, `[${label}] 口コミ本文が 15px 未満（${type.note}px）`);
  check(type.lh >= 1.75, `[${label}] 口コミ本文の行高が 1.75 未満（${type.lh.toFixed(2)}）`);
  check(type.val >= 15, `[${label}] 集計の数字が 15px 未満（${type.val}px）`);
  check(type.noteBeforeFacts, `[${label}] 口コミ本文が属性より後ろにある`);

  /* 集計がモーダルの中にあること（詳細から移したので、こちらに無いと消えたことになる） */
  check(await p.$("#panelBody .rvf"), `[${label}] モーダルに集計（.rvf）が無い`);

  /* 閉じる手段3つ。どれも ?c= が URL から消えること。 */
  await p.click("#panelClose");
  await p.waitForTimeout(300);
  check(!new URL(p.url()).searchParams.get("c"), `[${label}] ✕ で ?c= が消えない`);
  check(!(await p.evaluate(() => document.querySelector("#panel").classList.contains("open"))),
        `[${label}] ✕ でモーダルが閉じない`);

  await p.close();
}

/* ── カードの操作バー ───────────────────────── */
{
  const p = await page(390, 844);
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForSelector(".card");

  const bar = await p.evaluate(() => {
    const card = document.querySelector(".card .cardActs")?.closest(".card");
    if (!card) return null;
    const acts = card.querySelector(".cardActs");
    return {
      /* .head の中に押せる要素を入れない（入れ子ボタンにしない） */
      insideHead: !!card.querySelector(".head .cardActs, .head button, .head a"),
      hasTt: !!acts.querySelector(".ttAddBtn"),
      /* 口コミがある科目なら読むボタン、無ければ書くリンク */
      hasEntry: !!acts.querySelector(".rvBtn, .wrBtn"),
      writeHref: acts.querySelector(".wrBtn")?.getAttribute("href") || "",
      id: card.dataset.id,
    };
  });
  check(bar, "カードに .cardActs が無い");
  if (bar){
    check(!bar.insideHead, ".head の中に押せる要素がある（入れ子ボタン）");
    check(bar.hasTt, "操作バーに .ttAddBtn が無い");
    check(bar.hasEntry, "操作バーに口コミの入口が無い");
    check(bar.writeHref.startsWith(`/kuchikomi?c=${bar.id}`),
          `✎ の href が /kuchikomi?c=<id> でない（${bar.writeHref}）`);
  }

  /* 読むボタンでモーダルが開く。詳細を開かずに、が要件。
     押すカードを id で名指しする ―― 先頭のカードが口コミ0件だと
     .rvBtn がそこに無く、別のカードの状態を見て「通った」ことにしてしまう。 */
  const rvId = await p.evaluate(() =>
    document.querySelector(".card .cardActs .rvBtn")?.closest(".card")?.dataset.id || "");
  const rv = rvId ? await p.$(`.card[data-id="${rvId}"] .cardActs .rvBtn`) : null;
  check(rv, "口コミのある科目に .rvBtn が無い");
  if (rv){
    /* 2行目のプレビュー。空行のまま出ていないこと（先頭カードが何であっても
       ここは一般に成り立つべき最低限。長さまでは問わない）。 */
    const prevGeneric = await p.evaluate(id => {
      const s = document.querySelector(`.card[data-id="${id}"] .cardActs .rvBtn small`);
      return s ? s.textContent.trim() : null;
    }, rvId);
    check(prevGeneric === null || prevGeneric.length > 0, "プレビューの2行目が空のまま出ている");

    /* 1行に収まっていること（省略記号が効くこと）―― 実測で見る。
       white-space:nowrap / overflow:hidden / text-overflow:ellipsis が
       「宣言されている」だけでは足りない（max-width:100% が抜けても
       宣言は生きたまま幅だけ無制限になり得るので、その回帰は検知できない。
       2026-09-07 レビュー指摘）。実際に切れているかどうかは、切っていない
       ときの本来の幅 scrollWidth と、見えている幅 clientWidth の差で見る
       ―― nowrap で省略記号が効いているときこそ scrollWidth が clientWidth
       を上回る（孤立した最小再現で実測確認ずみ：幅100pxの箱に長文を
       流すと scrollWidth 467 / clientWidth 100）。逆に nowrap が無くて
       2行に折り返る壊れ方だと、幅には収まって scrollWidth ≈ clientWidth
       になる代わりに縦に伸びる ―― そちらは高さで見る。
       このアサーションには十分な長さの一言が要るので、先頭カードに頼らず
       口コミ 135312（実測49文字、390px 幅で scrollWidth 561px /
       clientWidth 142〜168px と、確実に切れる長さ）を id 名指しで使う。 */
    const LONG_NOTE_ID = "135312";
    const trunc = await p.evaluate(id => {
      const s = document.querySelector(`.card[data-id="${id}"] .cardActs .rvBtn small`);
      if (!s) return { none: true };
      const cs = getComputedStyle(s);
      return {
        none: false,
        scrollWidth: s.scrollWidth, clientWidth: s.clientWidth,
        height: s.getBoundingClientRect().height,
        lineHeight: parseFloat(cs.lineHeight),
        declaredOk: cs.whiteSpace === "nowrap" && cs.overflow === "hidden"
                    && cs.textOverflow === "ellipsis",
      };
    }, LONG_NOTE_ID);
    check(!trunc.none,
          `検証用の科目 ${LONG_NOTE_ID} の .rvBtn プレビューが一覧に見当たらない`);
    if (!trunc.none){
      /* 宣言そのものは崩れていないことの補助チェック（十分条件ではない。
         下の2つが本体）。 */
      check(trunc.declaredOk,
            "省略記号に必要なCSS（nowrap/overflow:hidden/ellipsis）が宣言されていない");
      /* 切れている本体：省略していれば scrollWidth > clientWidth になる。 */
      check(trunc.scrollWidth > trunc.clientWidth,
            `プレビューが切れていない（省略記号が効いていない。scrollWidth=${trunc.scrollWidth} clientWidth=${trunc.clientWidth}）`);
      /* 2行に折り返っていない：高さが1行ぶん（実測 line-height）の1.4倍以内
         （test_rail_toggle.mjs の「窓が2行ぶんになっていないか」と同じ考え方 ―
         1行と2行のあいだに閾値を置く）。 */
      check(trunc.height <= trunc.lineHeight * 1.4,
            `プレビューが2行に折り返っている（高さ ${Math.round(trunc.height)}px / 1行分 ${Math.round(trunc.lineHeight)}px）`);
    }

    await rv.click();
    await p.waitForTimeout(400);
    check(await p.evaluate(() => document.querySelector("#panel").classList.contains("open")),
          ".rvBtn を押してもモーダルが開かない");
    check(!(await p.evaluate(id =>
            document.querySelector(`.card[data-id="${id}"]`).classList.contains("open"), rvId)),
          ".rvBtn を押すと詳細まで開いてしまう");

    /* Task 1 の回帰確認は共有リンク（?c= 直開き＝push していない）の
       閉じ方しか見ていなかった。ページ内から .rvBtn で開く方は push している側で、
       history.back()/popstate の経路がこれまで未検証だった（2026-09-06）。 */
    check(new URL(p.url()).searchParams.get("c") === rvId,
          ".rvBtn を押しても URL に ?c=<id> が付かない");
    await p.goBack();
    await p.waitForTimeout(400);
    check(!(await p.evaluate(() => document.querySelector("#panel").classList.contains("open"))),
          "戻る（history.back）でモーダルが閉じない");
    check(!new URL(p.url()).searchParams.get("c"),
          "戻っても ?c= が消えない");
  }

  /* 時間割に追加が一覧から押せる */
  await p.evaluate(() => document.querySelector("#panelClose")?.click());
  await p.waitForTimeout(300);
  await p.click(".card .cardActs .ttAddBtn");
  await p.waitForTimeout(300);
  check(await p.evaluate(() =>
          document.querySelector(".card .cardActs .ttAddBtn").getAttribute("aria-pressed") === "true"),
        "一覧の「時間割に追加」を押しても aria-pressed が true にならない");

  await p.close();
}

await browser.close();
console.log(fails.length ? "NG" : `OK ${new Date().toISOString().slice(0,10)}`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
