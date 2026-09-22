/* LINE 登録しないと使えない機能の覆い（gate.js）と、その判定。
 *
 *   cd web && python3 -m http.server 8151 &
 *   node tools/test_gate.mjs http://localhost:8151
 *
 * ■ ここが守っているもの
 * 2026-09-13 の指摘「LINE のボタンを押すだけで、登録しなくても連携済みに
 * なる」。原因は判定が localStorage の「押した印」だったこと。だから
 * このテストの本命は最後の2件 ―― **押した印や古い localStorage では
 * 通れない**ことの確認。ここが緩むと元の穴に戻る。
 *
 * 覆いの中身は薄くするだけで隠さない（wang さんの指定「見えるけど押せない」）。
 * 「見えている」を opacity で確かめているのは、display:none や
 * visibility:hidden に変えられたら指定に反するため。
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8151";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const ME = {
  notLoggedIn: { ok: true, configured: true, loggedIn: false, linked: false },
  loggedInNotFriend: { ok: true, configured: true, loggedIn: true, linked: false },
  friend: { ok: true, configured: true, loggedIn: true, linked: true },
  /* LINE Login 未設定。設定漏れでサイト全体を殺さないため開ける。 */
  notConfigured: { ok: true, configured: false, linked: true, reason: "not_configured" },
};

const browser = await chromium.launch();

async function open(path, { me, storage } = {}){
  const page = await browser.newPage();
  await page.addInitScript((st) => {
    try {
      localStorage.setItem("rk_onboarded", "1");
      for (const [k, v] of Object.entries(st || {})) localStorage.setItem(k, v);
    } catch {}
  }, storage || {});
  if (me === null) await page.route("**/api/me", r => r.abort());
  else if (me) await page.route("**/api/me", r => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(me),
  }));
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  return page;
}

/* ── トップ：3つの節が覆われる ─────────────────────
   2026-09-21 に「配点でしぼる」を覆いから外し、2026-09-22 に戻した（wang 判断）。
   目盛りを動かすことも ✕ も登録した人の機能。**覆いは中身を隠さない**ので、
   既定の重さ（テスト50…）は薄いまま読める ―― 何が使えるようになるのか
   見えないと、登録する理由も伝わらない。
   同じ 2026-09-22 に「授業内容でさがす」が加わって 3→4（wang 判断）。この節だけは
   HTML ではなく subjects.js が差し込むので、app.js が init のあとに
   rkGate.apply() を呼び直している ―― そこが抜けると覆いが1つ足りなくなる。 */
{
  const page = await open("/", { me: ME.notLoggedIn });
  const veils = await page.$$(".gateVeil");
  check(veils.length === 4, `トップの覆いが4つでない（${veils.length}）`);

  /* 覆う相手は HTML の data-gate。JS 側にセレクタを持たせない作りなので、
     HTML から data-gate が消えたらここで気づく。 */
  const marked = await page.$$("[data-gate]");
  check(marked.length === 4, `data-gate が4つでない（${marked.length}）`);

  /* 授業内容：見出しは覆いの外、中身（「何の話？」）は覆いの中で inert。 */
  check(await page.$eval("#subjSec h2", e => !e.closest("[data-gate]")),
        "授業内容の見出しまで覆われている");
  check(await page.$eval("#subjOpen", e => !!e.closest("[inert]")),
        "授業内容の「何の話？」が押せる状態のまま（覆いの中に入っていない）");

  const inner = await page.evaluate(() => {
    const el = document.querySelector(".gated > .gateInner");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: +cs.opacity, display: cs.display,
             visibility: cs.visibility, inert: el.hasAttribute("inert") };
  });
  check(inner, "覆いの中身（.gateInner）が無い");
  if (inner){
    check(inner.opacity > 0.15, `中身が薄すぎて見えない（opacity ${inner.opacity}）`);
    check(inner.opacity < 1, "中身が薄くなっていない（ロック中に見えない）");
    check(inner.display !== "none", "中身を display:none で隠している（指定は「見えるけど押せない」）");
    check(inner.visibility !== "hidden", "中身を visibility:hidden で隠している");
    check(inner.inert, "中身が inert でない（押せてしまう）");
  }

  /* 操作できないことの担保は2つ。座標での当たり判定はしない ――
     覆いの位置は描き直しのたびに動くので、測る時点によって結果が変わる
     （実際に false/true のどちらも出た）。属性と計算済みスタイルで見る。 */
  const blocked = await page.evaluate(() => {
    const s = document.querySelector("#sliders input");
    if (!s) return null;
    return {
      /* ① inert … タブ移動もクリックも中身へ届かない（親に付いている） */
      inert: !!s.closest("[inert]"),
      /* ② pointer-events:none … ポインタが中身を素通りして覆いへ抜ける */
      pe: getComputedStyle(s.closest(".gateInner") || s).pointerEvents,
      /* 覆いがポインタを受ける側であること */
      veilPe: getComputedStyle(document.querySelector(".gateVeil")).pointerEvents,
    };
  });
  if (blocked){
    check(blocked.inert, "目盛りが inert の中に無い（キーボードでも動かせてしまう）");
    check(blocked.pe === "none", `中身の pointer-events が none でない（${blocked.pe}）`);
    check(blocked.veilPe !== "none", "覆いの pointer-events が none（押しても促しが出ない）");
  }

  /* 覆いの中の数字は読めること。何が使えるようになるのか見えないと、
     登録する理由も伝わらない（覆いは隠すためのものではない）。 */
  check(await page.$eval("#s_exam", e => e.value) === "50",
        "覆いの中で目盛りの既定（テスト50）が読めない");

  /* 覆いを押したら、**入口へ直行せず**まず説明を出す（2026-09-22 wang 指摘）。
     ボタン以外を押しても出ること。 */
  const before = page.url();
  await page.click(".gateVeil", { position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(600);
  check(await page.$eval("#gateDlg", e => e.open) === true,
        "覆いを押しても説明のダイアログが出ない");
  check(page.url() === before, `説明を出さずに画面を移した（${page.url()}）`);
  const dlgBody = await page.textContent("#gateDlgBody");
  check(/無料/.test(dlgBody), "説明に「登録は無料」が書かれていない");
  const href = await page.$eval("#gateDlgBody .gateBtn", e => e.getAttribute("href"));
  check(/\/line\/login/.test(href || ""), `説明の中に入口のリンクが無い（${href}）`);

  /* 閉じられること（読んだうえで「いまはやめる」が選べる）。 */
  await page.click("#gateDlgClose");
  await page.waitForTimeout(300);
  check(await page.$eval("#gateDlg", e => e.open) === false, "説明を閉じられない");

  /* カードのタグ（授業内容）には覆う器が無いので、押されたら app.js が同じ説明を出す。
     ここが抜けると、登録していない人が一覧をタグで絞れてしまう。 */
  const tag = await page.$("#list .card button.subjTag");
  if (tag){
    const url0 = page.url();
    await tag.dispatchEvent("click");
    await page.waitForTimeout(600);
    check(await page.$eval("#gateDlg", e => e.open) === true,
          "カードのタグを押しても説明のダイアログが出ない");
    check(page.url() === url0, `カードのタグで画面を移した（${page.url()}）`);
    check(!new URL(page.url()).searchParams.getAll("subject").length,
          "未登録なのにカードのタグでしぼり込めた");
    await page.click("#gateDlgClose");
    await page.waitForTimeout(300);
  } else check(false, "カードに押せるタグが無い（前提が崩れている）");

  /* 中のボタンを押したときだけ入口へ進む。 */
  await page.click(".gateVeil", { position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(400);
  await page.click("#gateDlgBody .gateBtn");
  await page.waitForTimeout(1500);
  check(page.url().includes("access.line.me") || page.url().includes("/line/login"),
        `説明のボタンを押しても LINE の入口へ行かない（${page.url()}）`);
  await page.close();
}

/* ── 友だち済みなら覆いが無い ────────────────────── */
{
  const page = await open("/", { me: ME.friend });
  check((await page.$$(".gateVeil")).length === 0, "友だち済みでも覆いが残る");
  const slider = await page.$("#sliders input");
  if (slider) check(!(await slider.isDisabled()), "友だち済みでもスライダーが無効");
  await page.close();
}

/* ── 落ちたとき・未設定のときは開ける（fail-open）───── */
{
  const page = await open("/", { me: null });   // /api/me が届かない
  check((await page.$$(".gateVeil")).length === 0,
        "/api/me が落ちたときに覆ってしまう（障害でサイトが使えなくなる）");
  await page.close();
}
{
  const page = await open("/", { me: ME.notConfigured });
  check((await page.$$(".gateVeil")).length === 0,
        "LINE Login 未設定のときに覆ってしまう（設定前にサイトが使えない）");
  await page.close();
}

/* ── マイページ ─────────────────────────────── */
{
  const page = await open("/mypage.html", { me: ME.notLoggedIn });
  /* マイページは3つのまま ―― 授業内容の節はトップにしか無い（2026-09-22）。 */
  check((await page.$$(".gateVeil")).length === 3,
        "マイページの覆いが3つでない");
  check(!(await page.$("#mpLine .gateVeil")),
        "LINE 連携の節を覆っている（入口を塞ぐと登録できなくなる）");
  const body = await page.textContent("#mpLineBody");
  check(body.includes("LINE で続ける"), "未連携で「LINE で続ける」が出ていない");
  check(!body.includes("連携済み"), "押す前から「連携済み」と出ている");
  await page.close();
}
{
  const page = await open("/mypage.html", { me: ME.loggedInNotFriend });
  const body = await page.textContent("#mpLineBody");
  check(body.includes("まだ友だち追加されていません"),
        "ログイン済み・友だちでない人に友だち追加を促していない");
  await page.close();
}
{
  const page = await open("/mypage.html", { me: ME.friend });
  const body = await page.textContent("#mpLineBody");
  check(body.includes("LINE 連携済み"), "友だち済みで「連携済み」が出ない");
  await page.close();
}

/* ── ここが本命：押した印では通れない ────────────────
   rk_line_linked="1" は「マイページのボタンを押した」だけで立つ印。
   これで覆いが外れたら、2026-09-13 に報告された穴がそのまま残っている。 */
{
  const page = await open("/", {
    me: ME.notLoggedIn, storage: { rk_line_linked: "1" },
  });
  check((await page.$$(".gateVeil")).length === 4,
        "localStorage の rk_line_linked=1 で覆いが外れた（押すだけで通れる穴）");
  await page.close();
}
{
  const page = await open("/mypage.html", {
    me: ME.notLoggedIn, storage: { rk_line_linked: "1" },
  });
  const body = await page.textContent("#mpLineBody");
  check(!body.includes("連携済み"),
        "localStorage の印だけで「連携済み」と表示された（押すだけで連携済みになる穴）");
  await page.close();
}

await browser.close();

if (fails.length){
  console.log("NG");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`  通過 ${n} 件`);
console.log("OK");
