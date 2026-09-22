/* 授業内容タグ（何の話をする授業か）でしぼる。
 *
 * 設計：docs/plans/2026-09-03-naiyou-tag-design.md の5章。
 *   ・左の絞り込みには「何の話？」のボタンと、選んだタグだけを置く。本体は中央のダイアログ
 *   ・複数選択は AND。各タグの数字は「いま選んでいるタグに足したら残る件数」で、0件のタグは出さない
 *     ―― 「ことば・語学 ∩ 歴史」のような交差を、人が掘り当てられるようにするのが目的
 *   ・タグは AI がシラバスを読んで付けたもの。ダイアログにそう書く
 *
 * 状態（state.subject）・絞り込み（queryLocal）・件数（subject_facets）は app.js が持つ。
 * ここは描くことと、押されたことを app.js に伝えることだけ ―― 判定を2か所に持たない。
 * カードと詳細に出すタグ（押すとしぼる）は detail.js の subjectTagsHtml。
 *
 * index.html には器を置いていない（松下さん担当のファイルなので、読み込みの1行だけ足した）。
 * 学部のセクション（app.js の buildFaculty）と同じく、ここから差し込む。
 */
(() => {
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* app.js から渡される：{ labels, selected, facets, count, toggle, clear } */
let api = null;

function chip(k, label, { on = false, n = null } = {}){
  const tail = on ? '<span aria-hidden="true"> ✕</span>'
                  : (n === null ? "" : `<span class="n">${n}</span>`);
  const aria = on ? ` aria-label="${esc(label)} を外す"`
                  : (n === null ? "" : ` aria-label="${esc(label)}（${n}件）"`);
  return `<button type="button" class="chip${on ? " on" : ""}" data-subject="${esc(k)}"${aria}>`
       + `${esc(label)}${tail}</button>`;
}

/* ── 左の絞り込み ─────────────────────────
   置き場所は「空きコマからさがす」の直下。空きコマと並ぶ、検索語を持たない人の入口なので。

   中身は `data-gate` で包む ―― **LINE 登録しないと使えない**（2026-09-22 wang 判断。
   条件チップ・配点の ✕・口コミと同じ扱い）。覆うのは gate.js で、見出しは覆いの外に置く
   （index.html の他の節と同じ形：`<h2>` の下に `<div data-gate>`）。
   この節は JS で後から差し込むので、app.js が init のあとに `rkGate.apply()` を呼び直す。
   カードと詳細のタグを押したときの判定は app.js の toggleSubject（配点の ✕ と同じやり方）。 */
function mountRail(){
  if (document.getElementById("subjSec")) return;
  const grid = document.getElementById("grid");
  const anchor = grid && grid.closest("section");
  if (!anchor) return;
  const sec = document.createElement("section");
  sec.id = "subjSec";
  sec.innerHTML = `<h2>授業内容でさがす</h2>
    <div data-gate>
      <button type="button" class="subjOpen" id="subjOpen" aria-haspopup="dialog"></button>
      <div class="chips subjPicked" id="subjPicked" hidden></div>
    </div>`;
  anchor.after(sec);
  sec.querySelector("#subjOpen").addEventListener("click", open);
  sec.querySelector("#subjPicked").addEventListener("click", e => {
    const b = e.target.closest("[data-subject]");
    if (b) api.toggle(b.dataset.subject);
  });
}

function renderRail(){
  const box = document.getElementById("subjPicked");
  if (!box) return;
  const L = api.labels();
  const picked = [...api.selected()].filter(k => L[k]);
  /* 閉じても何を選んだか分かるように、選んだタグはここに残す（✕で外せる）。 */
  box.hidden = !picked.length;
  box.innerHTML = picked.map(k => chip(k, L[k], { on: true })).join("");
  document.getElementById("subjOpen").innerHTML =
    (picked.length ? "タグを足す・変える" : "何の話？") + '<span aria-hidden="true"> ▸</span>';
}

/* ── ダイアログ ───────────────────────────
   <dialog> なのは、Esc で閉じる・背後にフォーカスを漏らさないを自前で書かないため
   （feedback.js / version.js と同じ）。 */
function mountDialog(){
  let dlg = document.getElementById("subjDlg");
  if (dlg) return dlg;
  dlg = document.createElement("dialog");
  dlg.className = "subjDlg";
  dlg.id = "subjDlg";
  dlg.setAttribute("aria-labelledby", "subjTitle");
  dlg.innerHTML = `<div class="subjCard">
    <div class="subjHead">
      <h2 id="subjTitle">何の話がききたい？</h2>
      <button type="button" class="subjClose" aria-label="閉じる">✕</button>
    </div>
    <input type="search" class="subjFind" id="subjFind" placeholder="タグを探す（例：歴史、AI）"
           aria-label="タグを探す" autocomplete="off">
    <div class="subjSelWrap" id="subjSelWrap" hidden>
      <p class="subjLead">選んでいるタグ ―― すべてに当てはまる科目だけが残ります</p>
      <div class="chips" id="subjSel"></div>
    </div>
    <p class="subjLead" id="subjLead">タグを選ぶ</p>
    <div class="chips subjOpts" id="subjOpts"></div>
    <p class="subjEmpty" id="subjEmpty" hidden></p>
    <p class="subjNote">タグは、シラバスの概要と各回の題目を AI が読んで付けたものです。</p>
    <div class="subjFoot">
      <button type="button" class="subjClear" id="subjClear">選択を解除</button>
      <button type="button" class="subjDone" id="subjDone">決定（<b id="subjCount">0</b>件）</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector(".subjClose").addEventListener("click", () => dlg.close());
  dlg.querySelector("#subjDone").addEventListener("click", () => dlg.close());
  dlg.querySelector("#subjClear").addEventListener("click", () => api.clear());
  dlg.querySelector("#subjFind").addEventListener("input", renderDialog);
  dlg.addEventListener("click", e => {
    // 幕（カードの外）を押したら閉じる。.subjDlg は画面いっぱいで、カードの外側が dlg 自身。
    if (e.target === dlg){ dlg.close(); return; }
    const b = e.target.closest("[data-subject]");
    if (b) api.toggle(b.dataset.subject);
  });
  /* 閉じたら、開いたボタンへフォーカスを戻す（<dialog> は戻してくれない）。
     選んだものが変わっていたら、そのあと一覧まで送る（api.done）――
     スマホでは一覧がここから1,300pxほど下にあり、閉じただけでは結果が見えない。
     preventScroll なのは、focus() が先にボタンまで画面を戻してしまうから。
     開いて何も変えずに閉じた人は動かさない。 */
  dlg.addEventListener("close", () => {
    document.getElementById("subjOpen")?.focus({ preventScroll: true });
    if (selKey() !== openedWith) api.done?.();
  });
  return dlg;
}

function renderDialog(){
  const dlg = document.getElementById("subjDlg");
  if (!dlg || !dlg.open) return;
  const L = api.labels(), sel = api.selected(), f = api.facets() || {};
  /* 押したボタンは描き直しで消える。キーボードで辿っている人のフォーカスを戻すために覚えておく。 */
  const had = document.activeElement?.closest?.("#subjDlg [data-subject]")?.dataset.subject;
  const raw = dlg.querySelector("#subjFind").value.trim();
  const q = raw.toLowerCase();

  const picked = [...sel].filter(k => L[k]);
  dlg.querySelector("#subjSelWrap").hidden = !picked.length;
  dlg.querySelector("#subjSel").innerHTML = picked.map(k => chip(k, L[k], { on: true })).join("");

  /* 0件になるタグは出さない ―― 押しても何も残らない選択肢は並べない。 */
  const keys = Object.keys(L);
  const avail = k => !sel.has(k) && (f[k] || 0) > 0
                  && (!q || L[k].toLowerCase().includes(q) || k.includes(q));
  const opts = keys.filter(avail);
  const box = dlg.querySelector("#subjOpts");

  /* 並べ方は状態で変える。
     ・まだ何も選んでいない最初の画面 … 意味の塊（_meta.subject_groups、正本は
       tools/subjects.py の GROUPS）で見出しを付け、中は語彙の定義順。
       件数の多い順にすると「物理 851 → 政治・法 804 → 数学 696 → 医療・健康 693」と
       分野が交互に出て、「理系が見たい」人が目で追えない（2026-09-18 レビュー）
     ・選んだあと（さらにしぼる）と検索中 … 件数の多い順。ここで知りたいのは
       「次にどれを足すと収穫が大きいか」であって、意味の近さではない */
  const groups = api.groups ? api.groups() : [];
  dlg.querySelector("#subjLead").textContent = picked.length ? "さらにしぼる" : "タグを選ぶ";
  if (!picked.length && !q && groups.length){
    box.className = "subjGroups";
    box.innerHTML = groups.map(g => {
      const ks = (g.keys || []).filter(k => L[k] && avail(k));
      return ks.length
        ? `<h3 class="subjGrpH">${esc(g.label)}</h3>`
          + `<div class="chips">${ks.map(k => chip(k, L[k], { n: f[k] })).join("")}</div>`
        : "";
    }).join("");
  } else {
    box.className = "chips subjOpts";
    const byCount = [...opts].sort((a, b) => (f[b] - f[a]) || (keys.indexOf(a) - keys.indexOf(b)));
    box.innerHTML = byCount.map(k => chip(k, L[k], { n: f[k] })).join("");
  }
  const empty = dlg.querySelector("#subjEmpty");
  empty.hidden = opts.length > 0;
  empty.textContent = raw ? `「${raw}」に当てはまるタグはありません`
                          : "これ以上しぼれるタグはありません";
  /* 何も選んでいないときに「決定（7906件）」と出すと、決めるものが無いのに
     決めさせる文になる（全件＝何もしていない状態）。閉じるだけのボタンにする。 */
  dlg.querySelector("#subjDone").innerHTML =
    picked.length ? `決定（<b id="subjCount">${api.count()}</b>件）` : "閉じる";
  dlg.querySelector("#subjClear").disabled = !picked.length;

  if (had){
    const again = dlg.querySelector(`[data-subject="${CSS.escape(had)}"]`);
    (again || dlg.querySelector("#subjFind")).focus();
  }
}

/* 開いた時点の選択。閉じたときに変わっていれば一覧まで送る（mountDialog の close）。
   renderDialog / renderRail の中の picked（配列）とは別物なので名前を分ける。 */
let openedWith = "";
const selKey = () => [...api.selected()].sort().join(",");

function open(){
  const dlg = mountDialog();
  openedWith = selKey();
  dlg.querySelector("#subjFind").value = "";
  dlg.showModal();
  renderDialog();
}

window.rkSubjects = {
  init(a){ api = a; mountRail(); renderRail(); },
  render(){ if (!api) return; renderRail(); renderDialog(); },
  open,
};
})();
