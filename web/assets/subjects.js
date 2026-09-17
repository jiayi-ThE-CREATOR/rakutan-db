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
   置き場所は「空きコマからさがす」の直下。空きコマと並ぶ、検索語を持たない人の入口なので。 */
function mountRail(){
  if (document.getElementById("subjSec")) return;
  const grid = document.getElementById("grid");
  const anchor = grid && grid.closest("section");
  if (!anchor) return;
  const sec = document.createElement("section");
  sec.id = "subjSec";
  sec.innerHTML = `<h2>授業内容でさがす</h2>
    <button type="button" class="subjOpen" id="subjOpen" aria-haspopup="dialog"></button>
    <div class="chips subjPicked" id="subjPicked" hidden></div>`;
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
  /* 閉じたら、開いたボタンへフォーカスを戻す（<dialog> は戻してくれない）。 */
  dlg.addEventListener("close", () => document.getElementById("subjOpen")?.focus());
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

  /* 0件になるタグは出さない ―― 押しても何も残らない選択肢は並べない。
     並びは件数の多い順、同数は語彙の定義順（_meta.subject_labels のキーの順）。 */
  const keys = Object.keys(L);
  const opts = keys
    .filter(k => !sel.has(k) && (f[k] || 0) > 0)
    .filter(k => !q || L[k].toLowerCase().includes(q) || k.includes(q))
    .sort((a, b) => (f[b] - f[a]) || (keys.indexOf(a) - keys.indexOf(b)));
  dlg.querySelector("#subjLead").textContent = picked.length ? "さらにしぼる" : "タグを選ぶ";
  dlg.querySelector("#subjOpts").innerHTML = opts.map(k => chip(k, L[k], { n: f[k] })).join("");
  const empty = dlg.querySelector("#subjEmpty");
  empty.hidden = opts.length > 0;
  empty.textContent = raw ? `「${raw}」に当てはまるタグはありません`
                          : "これ以上しぼれるタグはありません";
  dlg.querySelector("#subjCount").textContent = api.count();
  dlg.querySelector("#subjClear").disabled = !picked.length;

  if (had){
    const again = dlg.querySelector(`[data-subject="${CSS.escape(had)}"]`);
    (again || dlg.querySelector("#subjFind")).focus();
  }
}

function open(){
  const dlg = mountDialog();
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
