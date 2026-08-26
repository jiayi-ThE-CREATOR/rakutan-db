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
  if (tt.slots[slot]){
    /* 埋まっているマスは外す。確認は出さない ―― 1タップで戻せるので。 */
    rkStore.clearSlot(term, slot);
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
   1つだけ埋めると、残りのコマが空いているように見えてしまう。 */
function putCourse(id, slot){
  const c = BY_ID.get(id);
  const slots = (c && c.slots && c.slots.length) ? c.slots : [slot];
  for (const s of slots) rkStore.setSlot(term, s, id);
  renderTimetable();
}
window.mpPutCourse = putCourse;

boot();
