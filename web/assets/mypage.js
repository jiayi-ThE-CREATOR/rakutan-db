/* マイページ。
 *
 * app.js は読まない。あちらは一覧・絞り込み・詳細のためのもので、
 * #list の無いページで読むと途中で落ちる（shell.js の冒頭に同じ注意がある）。
 * 科目のデータは web/data/timetable.json（6,808件・gzip 135KB）だけ使う。
 * courses.built.json は12MBあり、ここに要るのは名前・担当・曜限だけ。
 */
const $ = (s) => document.querySelector(s);
/* app.js と同じ書き方。科目名は KOAN 由来の外部文字列なので必ず通す。 */
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));
const DAYS = ["月","火","水","木","金"];
const PERIODS = ["1","2","3","4","5","6"];   // Task 1 で6限に揃えたのと同じ

let COURSES = [];          // timetable.json
let BY_ID = new Map();
let REQ = null;            // requirements.json（学部の一覧の正本）
let term = "aki";

async function boot(){
  let tt, req;
  try {
    [tt, req] = await Promise.all([
      fetch("/data/timetable.json").then(r => r.json()),
      fetch("/data/requirements.json").then(r => r.json()),
    ]);
  } catch (e) {
    /* 失敗すると何も描画されず画面が空のまま固まる。
       正直に「読み込めなかった」と出す ―― 白紙より状況が分かる。 */
    $(".mypage").insertAdjacentHTML("afterbegin",
      `<p class="mpError">データを読み込めませんでした。時間をおいて再読み込みしてください。</p>`);
    return;
  }
  COURSES = tt;
  BY_ID = new Map(tt.map(c => [c.id, c]));
  REQ = req;
  buildProfile();
  buildTerms();
  renderTimetable();
  renderFavorites();
  $("#mpPickerClose").onclick = () => $("#mpPicker").close();
}

function buildProfile(){
  const p = rkStore.getProfile();
  $("#mpFaculty").innerHTML =
    `<option value="">選ばない</option>` +
    REQ.faculties.map(f => `<option value="${f.key}">${f.label}</option>`).join("");
  $("#mpGrade").innerHTML =
    `<option value="">選ばない</option>` +
    [1,2,3,4,5,6].map(g => `<option value="${g}">${g}年</option>`).join("");

  /* 選択肢に無い値をそのまま入れると select は無言で未選択になる
     （kuchikomi が 2026-08-26 に踏んだ罠）。在ることを確かめてから入れる。 */
  if ([...$("#mpFaculty").options].some(o => o.value === p.faculty))
    $("#mpFaculty").value = p.faculty;
  if ([...$("#mpGrade").options].some(o => o.value === p.grade))
    $("#mpGrade").value = p.grade;

  $("#mpFaculty").onchange = e => rkStore.setProfile({ faculty: e.target.value });
  $("#mpGrade").onchange   = e => rkStore.setProfile({ grade: e.target.value });
}

/* 学期は haru / aki の2つだけ。timetable.json の term_group と同じ語彙で、
   full（通年）はどちらの学期でも履修できるので必ず通す（app.js と同じ扱い）。
   kuchikomi の spring / autumn とは別語彙。混ぜないこと。 */
const TERMS = [["aki","秋・冬学期"],["haru","春・夏学期"]];
const TERM_GROUPS = { haru:["haru","full"], aki:["aki","full"] };

function buildTerms(){
  $("#mpTerms").innerHTML = TERMS.map(([v,label]) =>
    `<button class="chip${term===v?" on":""}" data-term="${v}">${label}</button>`).join("");
  $("#mpTerms").querySelectorAll("button").forEach(b => b.onclick = () => {
    term = b.dataset.term; buildTerms(); renderTimetable();
  });
}

function inTerm(c){ return TERM_GROUPS[term].includes(c.term_group); }

function renderTimetable(){
  const tt = rkStore.getTimetable(term);
  let html = '<div class="mpH"></div>' + DAYS.map(d=>`<div class="mpH">${d}</div>`).join("");
  for (const p of PERIODS){
    html += `<div class="mpH">${p}</div>`;
    for (const d of DAYS){
      const slot = d + p;
      const id = tt.slots[slot];
      const c = id ? BY_ID.get(id) : null;
      html += `<button class="mpCell${c?" filled":""}" data-slot="${slot}">`
            + (c ? esc(c.title) : "") + `</button>`;
    }
  }
  $("#mpGrid").innerHTML = html;
  $("#mpGrid").querySelectorAll(".mpCell").forEach(b => b.onclick = () => onCell(b.dataset.slot));
  renderExtra();
  /* コマが埋まると「時間割に入れる」ボタンの出方（もう入っている／
     上書きになる、など）が変わるので、お気に入り側も引き直す。
     ループしないのは、renderFavorites 側からは renderTimetable を
     直接呼ばないため（呼ぶのは mpPutCourse 経由の1回だけ）。
     ここに renderFavorites → renderTimetable の直接呼び出しを足すと
     無限ループになるので足さないこと。 */
  renderFavorites();
}
window.mpRenderTimetable = renderTimetable;

function renderExtra(){
  const tt = rkStore.getTimetable(term);
  if (!tt.extra.length){ $("#mpExtra").innerHTML = ""; return; }
  $("#mpExtra").innerHTML = `<h4>時間割に入らない科目</h4>` + tt.extra.map(id => {
    const c = BY_ID.get(id);
    return `<div class="mpExtraRow"><span>${c ? esc(c.title) : id}</span>
      <button data-rm="${esc(id)}">外す</button></div>`;
  }).join("");
  $("#mpExtra").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    rkStore.removeExtra(term, b.dataset.rm); renderTimetable();
  });
}

function onCell(slot){
  const tt = rkStore.getTimetable(term);
  const id = tt.slots[slot];
  if (id){
    /* 置くときは科目の全コマを埋める（putCourse）ので、外すときも対称に
       全コマ外す。クリックしたマスだけ外すと、複数コマの科目
       （金4・金5・金6 の実験など。timetable.json に528件ある）が
       半分残ったまま「埋まっている」ように見えてしまう。
       確認は出さない ―― 1タップで科目ごと戻せるので。 */
    const c = BY_ID.get(id);
    /* BY_ID に無い＝古いデータのまま残った id。せめてクリックしたマスは外す。 */
    const slots = (c && c.slots && c.slots.length) ? c.slots : [slot];
    for (const s of slots) rkStore.clearSlot(term, s);
    renderTimetable();
    return;
  }
  openPicker(slot);
}

function openPicker(slot){
  const list = COURSES.filter(c => inTerm(c) && (c.slots || []).includes(slot));
  $("#mpPickerTitle").textContent = `${slot} の科目`;
  $("#mpPickerList").innerHTML = list.length
    ? list.map(c => `<button class="mpPick" data-id="${esc(c.id)}">
        <b>${esc(c.title)}</b><small>${esc(c.instructor || "―")}</small></button>`).join("")
    : `<p>この学期の ${slot} に科目がありません。</p>`;
  $("#mpPickerList").querySelectorAll(".mpPick").forEach(b => b.onclick = () => {
    putCourse(b.dataset.id, slot);
    $("#mpPicker").close();
  });
  $("#mpPicker").showModal();
}

/* 1科目が複数コマを持つとき（金4・金5・金6 の実験など）は全部のマスを埋める。
   1つだけ埋めると、残りのコマが空いているように見えてしまう。
   置き先のどれかに既に別の科目が入っているときは確認する。
   ピッカー（openPicker → onCell が呼ぶ空きマスへの新規配置）と
   お気に入り（renderFavorites の「時間割に入れる」）の、入り口が2つとも
   最終的にここを通る。確認をここ1箇所にまとめたのは、
   「お気に入り側は聞くのにピッカー側は黙って上書きする」という
   不整合（前タスクのレビュー指摘）を、2箇所に同じ確認コードを
   コピーするのではなく、通り道を1本にすることで無くすため。 */
function putCourse(id, slot){
  const c = BY_ID.get(id);
  const slots = (c && c.slots && c.slots.length) ? c.slots : [slot];
  const tt = rkStore.getTimetable(term);
  const busy = slots.filter(s => tt.slots[s] && tt.slots[s] !== id);
  if (busy.length){
    const names = busy.map(s => `${s}：${(BY_ID.get(tt.slots[s]) || {}).title || tt.slots[s]}`);
    if (!confirm(`次のコマを上書きします。\n\n${names.join("\n")}\n\nよろしいですか？`)) return;
  }
  for (const s of slots) rkStore.setSlot(term, s, id);
  renderTimetable();
}
window.mpPutCourse = putCourse;

function renderFavorites(){
  const ids = rkStore.getFavorites();
  if (!ids.length){
    $("#mpFavList").innerHTML =
      `<p class="mpEmpty">まだありません。科目の一覧で ☆ を押すと、ここに溜まります。</p>`;
    return;
  }
  const tt = rkStore.getTimetable(term);
  $("#mpFavList").innerHTML = ids.map(id => {
    const c = BY_ID.get(id);
    if (!c) return `<div class="mpFav"><span>${esc(id)}（この学期のデータにありません）</span>
      <button data-fav="${esc(id)}">☆ 外す</button></div>`;

    const slots = c.slots || [];
    let action;
    if (!slots.length){
      /* 曜限がマスに置けない1,069件（集中講義・土曜）。extra へ。 */
      const inExtra = tt.extra.includes(id);
      action = inExtra
        ? `<span class="mpIn">時間割に入っています</span>`
        : `<button data-addextra="${esc(id)}">時間割に入れる</button>`;
    } else if (!inTerm(c)){
      /* 星は学期を問わず付けられるが、コマへ置けるのは今見ている学期の科目だけ。
         黙って無視すると「押しても反応しない」に見えるので理由を出す。 */
      action = `<span class="mpNote">${term==="aki"?"春・夏":"秋・冬"}学期の科目です</span>`;
    } else {
      /* 上書き確認は putCourse（mpPutCourse）側でまとめて行う。
         ここでは「既に入っている」か「まだ」かの表示だけ分ける。 */
      const already = slots.every(s => tt.slots[s] === id);
      action = already
        ? `<span class="mpIn">時間割に入っています</span>`
        : `<button data-add="${esc(id)}">時間割に入れる</button>`;
    }
    return `<div class="mpFav">
      <span><b>${esc(c.title)}</b><small>${esc(c.day_period || "曜限なし")}
        ・${esc(c.instructor || "―")}</small></span>
      <span class="mpFavActions">${action}
        <button data-fav="${esc(id)}">☆ 外す</button></span>
    </div>`;
  }).join("");

  $("#mpFavList").querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const id = b.dataset.add;
    const c = BY_ID.get(id);
    mpPutCourse(id, (c.slots || [])[0]);
  });
  $("#mpFavList").querySelectorAll("[data-addextra]").forEach(b => b.onclick = () => {
    rkStore.addExtra(term, b.dataset.addextra);
    renderTimetable();
  });
  $("#mpFavList").querySelectorAll("[data-fav]").forEach(b => b.onclick = () => {
    rkStore.toggleFavorite(b.dataset.fav);
    renderFavorites();
  });
}

boot();
