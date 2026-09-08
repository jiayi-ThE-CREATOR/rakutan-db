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

/* railOff: 絞り込みを畳んだ状態で開く。#list の実効幅は
   「viewport - 絞り込み(260px) - gap」なので、同じ viewport 幅でも
   畳む／畳まないで列数が変わる（cardMin:380px、2列には760px前後が要る）。
   Change 4 の等高検証で「◯◯px幅で2列」を再現するのに必要になる
   （2026-09-08）。 */
async function page(w, h, railOff = false){
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript((railOff) => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
    if (railOff){
      try { localStorage.setItem("rk_ui", JSON.stringify({ v: 1, railOpen: false })); } catch (e) {}
    }
  }, railOff);
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

  /* 閉じる手段。どれも ?c= が URL から消えること。 */
  await p.click("#panelClose");
  await p.waitForTimeout(300);
  check(!new URL(p.url()).searchParams.get("c"), `[${label}] ✕ で ?c= が消えない`);
  check(!(await p.evaluate(() => document.querySelector("#panel").classList.contains("open"))),
        `[${label}] ✕ でモーダルが閉じない`);

  /* Esc。document 側のキーハンドラ1本で閉じる経路（2026-09-07 追加）。 */
  await p.goto(`${base}/?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#panel.open", { timeout: 15000 });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  check(!(await p.evaluate(() => document.querySelector("#panel").classList.contains("open"))),
        `[${label}] Esc でモーダルが閉じない`);
  check(!new URL(p.url()).searchParams.get("c"), `[${label}] Esc で ?c= が消えない`);

  /* 幕クリック。#panel 自身が幕（.kModal）で、e.target === $("#panel") が
     ガードなので、.kBox の外（#panel の padding 分＝スマホでも確実に空いている
     隅）を突く。2026-09-07 まで無テストだった。 */
  await p.goto(`${base}/?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#panel.open", { timeout: 15000 });
  await p.mouse.click(2, 2);
  await p.waitForTimeout(300);
  check(!(await p.evaluate(() => document.querySelector("#panel").classList.contains("open"))),
        `[${label}] 幕クリックでモーダルが閉じない`);

  /* .kBox の中は幕ではないので、押しても閉じないこと（同じガードの逆側）。 */
  await p.goto(`${base}/?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#panel.open", { timeout: 15000 });
  await p.click("#panelBody");
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.querySelector("#panel").classList.contains("open")),
        `[${label}] .kBox の中を押すとモーダルが閉じてしまう`);

  /* #panelWrite の href。PR-2 との継ぎ目で、いちばん重要な導線なのに
     2026-09-07 までアサーションが無かった。 */
  const writeHref = await p.evaluate(() => document.querySelector("#panelWrite")?.getAttribute("href") || "");
  check(writeHref === `/kuchikomi?c=${ID}`,
        `[${label}] #panelWrite の href が /kuchikomi?c=<id> でない（${writeHref}）`);

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

  /* 時間割に追加が一覧から押せる。2026-09-08：押すだけ（追加専用）だったのを
     トグルにした。往復（追加→localStorageに入る→外す→消える）で確認する。 */
  await p.evaluate(() => document.querySelector("#panelClose")?.click());
  await p.waitForTimeout(300);
  const ttId = await p.evaluate(() =>
    document.querySelector(".card .cardActs .ttAddBtn")?.closest(".card")?.dataset.id);
  await p.click(".card .cardActs .ttAddBtn");
  await p.waitForTimeout(300);
  check(await p.evaluate(() =>
          document.querySelector(".card .cardActs .ttAddBtn").getAttribute("aria-pressed") === "true"),
        "一覧の「時間割に追加」を押しても aria-pressed が true にならない");

  /* id が rk_timetable のどこか（コマ or 曜限なし枠）に実際に入っているか。 */
  const inTT = (tt, id) => !!tt && ["aki", "haru"].some(t =>
    (tt[t]?.extra || []).includes(id) || Object.values(tt[t]?.slots || {}).includes(id));
  const afterAdd = await p.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("rk_timetable") || "{}"); } catch (e) { return null; }
  });
  check(inTT(afterAdd, ttId), "追加しても localStorage(rk_timetable) に入っていない");

  /* もう一度押すと外れる。同じ id の全ボタン（推薦枠＋通常一覧の重複ぶんも
     含む）が揃って戻ること。 */
  await p.click(".card .cardActs .ttAddBtn");
  await p.waitForTimeout(300);
  const afterRemove = await p.evaluate(id => {
    const btns = [...document.querySelectorAll(`.ttAddBtn[data-id="${CSS.escape(id)}"]`)];
    let tt = null;
    try { tt = JSON.parse(localStorage.getItem("rk_timetable") || "{}"); } catch (e) {}
    return {
      allUnpressed: btns.length > 0 && btns.every(b => b.getAttribute("aria-pressed") === "false"),
      allLabelReset: btns.every(b => b.textContent.trim() === "＋ 時間割"),
      tt,
    };
  }, ttId);
  check(afterRemove.allUnpressed, "もう一度押しても aria-pressed が false に戻らない");
  check(afterRemove.allLabelReset, "もう一度押してもラベルが「＋ 時間割」に戻らない");
  check(!inTT(afterRemove.tt, ttId),
        "外した後も localStorage(rk_timetable) に id が残っている（空スロットやextraの掃除漏れ）");

  /* 詳細に口コミの入口や操作ボタンが残っていないこと（同じ操作を2箇所に置かない）。 */
  await p.evaluate(() => document.querySelector(".card .head").click());
  await p.waitForTimeout(400);
  const dup = await p.evaluate(() => {
    const d = document.querySelector(".card.open .detail") || document.querySelector(".card .detail");
    return { panelBtn: !!d?.querySelector(".panelBtn"),
             tt: !!d?.querySelector(".ttAddBtn"),
             review: !!d?.querySelector(".reviewBtn"),
             rv: !!d?.querySelector(".rv"),
             koan: !!d?.querySelector(".koanLink") };
  });
  check(!dup.panelBtn, "詳細に .panelBtn が残っている");
  check(!dup.tt, "詳細に .ttAddBtn が残っている（操作バーと重複）");
  check(!dup.review, "詳細に .reviewBtn が残っている（本番では出せないフォームを開く）");
  check(!dup.rv, "詳細に口コミの集計（.rv）が残っている");
  check(dup.koan, "詳細から KOAN リンクまで消えている");

  await p.close();
}

/* 口コミ＝本人が書いた一言（2026-09-08、オーナーの依頼で定義を揃えた）。
   id ごとの実際の件数は data から読む（このファイル冒頭のコメントと同じ理由・
   ビルドで口コミ件数が変わってもテストが落ちないように）。API モード
   （/api/courses/<id>）と静的モード（/data/courses.built.json）の両方で
   このファイルを走らせるので、両対応にする。 */
async function readableCount(p, id){
  return p.evaluate(async (id) => {
    try {
      const r = await fetch(`/api/courses/${encodeURIComponent(id)}`);
      if (r.ok){
        const c = await r.json();
        if (c && c.id) return (c.reviews?.notes || []).length;
      }
    } catch (e) {}
    const all = await (await fetch("/data/courses.built.json")).json();
    const c = (all.courses || []).find(x => x.id === id);
    return (c?.reviews?.notes || []).length;
  }, id);
}

/* ── Change 1: 書かれた口コミが無い科目（回答はある）── */
{
  /* 135059：n=1・notes=[]（readable=0）。Change 1 の実測で
     reviews.notes.length と reviews.built.json の non-empty note 行数が
     全141件で一致することを確認したうえで採用（owner-round-report.md 参照）。 */
  const ID = "135059";
  const p = await page(390, 844);

  await p.goto(`${base}/?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#panel.open", { timeout: 15000 });
  const modal = await p.evaluate(() => ({
    sub: document.querySelector("#panelSub")?.textContent || "",
    hasAgg: !!document.querySelector("#panelBody .rvf"),
    hasList: !!document.querySelector("#panelBody .pList"),
    hasEmpty: !!document.querySelector("#panelBody .pEmpty"),
  }));
  check(!modal.sub.includes("実際に取った人が書いたもの"),
        `[readable=0] #panelSub が本文の存在を約束したままになっている（${modal.sub}）`);
  check(modal.sub.includes("回答") && modal.sub.includes("集計"),
        `[readable=0] #panelSub が集計であることを説明していない（${modal.sub}）`);
  check(modal.hasAgg, "[readable=0] モーダルに集計（.rvf）が無い");
  check(!modal.hasList, "[readable=0] モーダルに1件ずつの一覧（.pList）が出ている（書かれた一言が無いのに）");
  check(!modal.hasEmpty,
        "[readable=0] モーダルに「まだ誰も書いていない」が出ている（回答自体はあるので嘘になる）");

  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.fill("#q", "考古学基礎");
  await p.waitForTimeout(500);
  const cardBtn = await p.evaluate(id =>
    document.querySelector(`.card[data-id="${id}"] .cardActs .rvBtn`)?.textContent.trim() || null,
    ID);
  check(cardBtn === "📊 みんなの回答を見る",
        `[readable=0] カードのボタン文言が違う（${cardBtn}）`);
  await p.close();
}

/* ── Change 1: 書かれた口コミがある科目 ── 件数はwritten commentの数と一致 */
{
  const ID = "135327"; // 冒頭の口コミ4件の科目（このファイル既存の定番ID）
  const p = await page(390, 844);
  await p.goto(base + "/", { waitUntil: "networkidle" });
  const expected = await readableCount(p, ID);
  check(expected > 0, `検証用科目 ${ID} に書かれた口コミが無い（データが変わった？）`);

  await p.fill("#q", "カーボンニュートラル");
  await p.waitForTimeout(500);
  const label = await p.evaluate(id =>
    document.querySelector(`.card[data-id="${id}"] .cardActs .rvBtn span`)?.textContent.trim() || null,
    ID);
  check(label === `💬 口コミ ${expected}件を読む ›`,
        `[readable>0] カードの件数がwritten commentの数(${expected})と違う（${label}）`);
  await p.close();
}

/* ── Change 3: 「1限（体感コスト大）」チップが消えていること ── */
{
  const p = await page(390, 844);
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.fill("#q", "考古学基礎"); // 135059＝day_period が「1」で終わる1限の科目
  await p.waitForTimeout(500);
  const tags1 = await p.evaluate(() =>
    [...document.querySelectorAll(".card .tags .tag")].map(t => t.textContent));
  check(!tags1.some(t => t.includes("1限")),
        `1限の科目のカードに「1限」チップが残っている（${JSON.stringify(tags1)}）`);

  // 未フィルタの一覧（複数枚）でも、rakutan.notes 由来のチップが1件も出ないこと。
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForSelector(".card");
  const tagsAll = await p.evaluate(() =>
    [...document.querySelectorAll(".card .tags .tag")].map(t => t.textContent));
  check(!tagsAll.some(t => t.includes("1限（体感コスト大）")),
        `一覧のどこかに「1限（体感コスト大）」チップが残っている（${JSON.stringify(tagsAll)}）`);
  check(!tagsAll.some(t => t.includes("キャンパス（移動あり）")),
        `一覧のどこかに「<キャンパス>キャンパス（移動あり）」チップが残っている（${JSON.stringify(tagsAll)}）`);
  await p.close();
}

/* ── Change 4: 同じ行のカードは高さが揃い、操作バーの上端・下端が揃う ──
   2026-09-08、オーナー裁定で #list{align-items:stretch} と
   .rvBtn/.wrBtn.ghost{min-height:57px} の両方を min-width:1024px
   （#inspector の状態を問わず）に広げた。1024px は mqDesktop（app.js）が
   「詳細をカード内展開」→「右カラム #inspector」に切り替える境目
   そのもの ―― この線より上はカードを開いても自分の高さが変わらないので
   stretch させても損が無く、下はアコーディオンなので stretch すると
   開いた1枚に行の相方まで引きずられる。だから 768〜1023px は
   #list{align-items:start} のまま（意図的、直さない）。

   このラウンドの前は「カードの高さ」と「.cardActs の下端」しか検証して
   いなかった。理由：margin-top:auto はカードの下端にしか揃えないので、
   .cardActs 自身の高さ（プレビュー2行なら自然に57px前後、口コミ0件や
   プレビュー無しなら .rvBtn の min-height:44px 止まりで37〜44px）が
   row内で違うと上端はズレる ―― 実測で見つけた例：デフォルト一覧で
   カード高214.06pxが完全一致する行でも、.cardActs自身の高さが
   82.19px/69pxと違えば上端は13.19pxズレた。だがこれこそオーナーが
   写真で指摘した境界線そのものだったので、「下端さえ揃えばよい」を
   やめ、min-height:57px を .rvBtn/.wrBtn.ghost の両方・
   #inspector状態非依存・1024px以上に敷いてバー自身の高さも揃えた
   （app.css の #list ルール内コメント参照）。これで上端も下端も
   揃う（実測・生データ：135349＝プレビュー2行 と 040040＝口コミ0件の
   ghost が同じ行に来た例で actsTop 差 0.18px。owner-round-report.md 参照）。 */
function rowMetrics(){
  const cards = [...document.querySelectorAll("#list > .card")];
  const groups = {};
  for (const c of cards){
    const top = Math.round(c.getBoundingClientRect().top);
    (groups[top] ||= []).push(c);
  }
  return Object.values(groups).filter(g => g.length >= 2).map(g => g.map(c => {
    const r = c.getBoundingClientRect();
    const acts = c.querySelector(".cardActs");
    const ar = acts ? acts.getBoundingClientRect() : null;
    return { cardHeight: r.height, actsTop: ar ? ar.top : null, actsBottom: ar ? ar.bottom : null };
  }));
}
function assertRowsAligned(rows, label){
  check(rows.length > 0, `[${label}] 同じ行に複数枚のカードが無い（検証ができない）`);
  for (const row of rows){
    const heights = row.map(r => r.cardHeight);
    const heightSpread = Math.max(...heights) - Math.min(...heights);
    check(heightSpread <= 1,
          `[${label}] 同じ行のカードの高さが揃っていない（差 ${heightSpread.toFixed(2)}px）`);
    const tops = row.map(r => r.actsTop).filter(t => t !== null);
    const topSpread = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
    check(topSpread <= 1,
          `[${label}] 同じ行の .cardActs の上端が揃っていない（差 ${topSpread.toFixed(2)}px）`);
    const bottoms = row.map(r => r.actsBottom).filter(b => b !== null);
    const bottomSpread = bottoms.length ? Math.max(...bottoms) - Math.min(...bottoms) : 0;
    check(bottomSpread <= 1,
          `[${label}] 同じ行の .cardActs の下端が揃っていない（差 ${bottomSpread.toFixed(2)}px）`);
  }
}

/* 1280px・何も選んでいない状態（以前から保証されていたケース）。 */
{
  const p = await page(1280, 900);
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForSelector(".card");
  assertRowsAligned(await p.evaluate(rowMetrics), "1280px・未選択");
  await p.close();
}

/* 1280px・科目を選んでいる状態（#inspector が空でなくなる）。
   これが今回オーナー裁定で新しく直った側 ―― 以前は
   .workbench:has(#inspector:empty) の中だけに stretch を付けていたので、
   ここでは揃わなくなっていた。
   絞り込みを畳む（railOff）のは、#list の実効幅を稼ぐため ――
   科目選択中は #inspector が固定380px・.wrap の上限が1400pxなので、
   絞り込み(260px)が開いたままだと1280pxでは1列にしかならず、
   「同じ行」の検証ができない（実測ずみ）。 */
{
  const p = await page(1280, 900, true);
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForSelector(".card");
  await p.click(".card .head");
  await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById("inspector").innerHTML.trim().length > 0),
        "[1280px・選択中] #inspector が埋まっていない（前提が崩れている）");
  assertRowsAligned(await p.evaluate(rowMetrics), "1280px・選択中");
  await p.close();
}

/* 900px（1024px未満・2列）。ここは揃わなくて正しい（オーナー裁定）―― かつ、
   カードを開いても同じ行の相方の高さが変わらない（アコーディオンが
   隣を巻き込まない）ことを確認する。揃わない前提を固定するアサーションは
   置かない（データが変われば揃うことも揃わないこともあり得るため）。
   railOff にするのは、絞り込みが開いたままの900pxでは #list が1列
   （実効幅760px未満）にしかならず、「同じ行の相方」を作れないため。 */
{
  const p = await page(900, 900, true);
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForSelector(".card");
  const before = await p.evaluate(() => {
    const cards = [...document.querySelectorAll("#list > .card")];
    const top0 = Math.round(cards[0].getBoundingClientRect().top);
    const row = cards.filter(c => Math.round(c.getBoundingClientRect().top) === top0);
    return row.length >= 2
      ? { neighborId: row[1].dataset.id, neighborHeight: row[1].getBoundingClientRect().height }
      : null;
  });
  check(before, "[900px] 先頭行に相方のカードが無い（検証できない）");
  if (before){
    await p.click(".card .head");
    await p.waitForTimeout(400);
    const after = await p.evaluate(id =>
      document.querySelector(`.card[data-id="${id}"]`)?.getBoundingClientRect().height ?? null,
      before.neighborId);
    check(Math.abs(after - before.neighborHeight) <= 1,
          `[900px] 1枚開くと同じ行の相方まで伸びている（開く前 ${before.neighborHeight.toFixed(1)}px → 開いた後 ${after?.toFixed(1)}px）`);
  }
  await p.close();
}

await browser.close();
console.log(fails.length ? "NG" : `OK ${new Date().toISOString().slice(0,10)}`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
