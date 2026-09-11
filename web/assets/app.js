const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const DAYS = ["月","火","水","木","金"], PERIODS = ["1","2","3","4","5","6"];

/* 判定の区分を必ず画面に出す。ここを出さないと「情報不足」も「拘束は軽い」も
   学生には見えず、相性の数字だけが独り歩きする。
   0=灰（情報不足） 1=緑（軽い） 2=黄（保留つき） 3=赤（重い） */
const BAND_CLS = { "情報不足":0, "判定不可":0, "参考値":0,
                   "軽め":1, "拘束は軽い":2, "標準":2, "やや重め":3, "重め":3 };

/* year の既定を "1" にしてあるのは、1年生が履修できない科目が97件あり、
   しかもそれが上位に食い込むため（統計学B-II、熱学・統計力学要論 など）。
   選べない科目を薦めないことを既定にする。2〜4年生はチップで切り替える。 */
/* sem（学期）の既定は "aki"。9/2 に始まるのが秋冬学期の履修登録で、
   春夏の757件（全体の68%）はいま登録できない。既定を「すべて」にすると、
   選べない科目が7割混ざった一覧を最初に見せることになる。
   ⚠️ 春夏の履修登録期（3〜4月）には "haru" へ変えること。
   値が日本語でないのは、クエリ文字列で文字化けするため。 */
/* 既定は学年も学期も「すべて」。最初に見た人へ、まず**扱っている量**を見せる
   （7,877件／空きコマの数字も全部入りになる）。絞り込みはそこから始める。
   2026-08-26 まで 1年・秋冬 が既定で、初回表示は 319件だった。
   server.py の search() の既定も同じ値にしてある。片方だけ変えないこと。 */
const state = { q:"", year:"all", sem:"all", day:"", period:"", cond:new Set(), sort:"fit",
                /* 配点の上限（%）。100＝制限なし。2026-09-03 に「重み 0〜5」から
                   置き換えた。**チップ「出席なし」等はここと同じ状態を指す** ――
                   別々に持つと片方を押したときにもう片方と食い違う。 */
                caps:{ attendance:100, exam:100, quiz:100, report:100 },
                /* 学部は絞り込みそのものには効かない ―― 効くのは区分だけ。
                   学部は「どの区分が自分に必要か」を並べ替えるためだけに持つ。 */
                /* track2＝専攻語が「日本語」の学生が実際に履修する言語。
                   外国語学部の日本語専攻は、自分の専攻語（日本語）とは別に
                   もう一つの言語を履修し、その言語の専攻語科目をそのまま取る
                   （中国語を選べば中国語専攻の学生と同じ科目）。だから track2 は
                   「専攻」ではなく「言語」で、絞り込みでは track の代わりに使う。 */
                faculty:"", track:"", track2:"", division:new Set() };
const SEMS = [["aki","秋・冬学期"],["haru","春・夏学期"],["all","すべて"]];
const YEARS = [["1","1年"],["2","2年"],["3","3年"],["4","4年"],
               ["5","5年"],["6","6年"],["all","すべて"]];
let META = null;
let REQ = null;   // 卒業要件表（学部→区分→単位数）。data/requirements.json

/* 口コミが採点に効き始める人数。reviews.py の MIN_FOR_SCORING が正本で、
   build.py が courses.built.json の _meta に焼き、API は /api/meta で返す。
   ここで数字を書くと、門を変えたときに文言だけ古くなる
   （2026-08-24 まで「1件入ると出ます」と出していたが、実際は3件だった）。 */
function minForScoring(){
  // API モードは /api/meta、静的モードは courses.built.json の _meta 由来。
  // どちらも届かないときだけ 3（reviews.py の既定）に落とす。
  return (META && META.min_for_scoring) || 3;
}

/* ── クエリ組み立て ───────────────────── */
function qs(){
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  p.set("year", state.year);
  p.set("sem", state.sem);
  if (state.day) p.set("day", state.day);
  if (state.period) p.set("period", state.period);
  p.set("sort", state.sort);
  state.cond.forEach(c => p.append("cond", c));
  if (state.faculty) p.set("faculty", state.faculty);
  if (state.track) p.set("track", state.track);
  if (state.track2) p.set("track2", state.track2);
  state.division.forEach(d => p.append("division", d));
  for (const k of CAP_AXES) if (state.caps[k] < NO_CAP) p.set("cap_" + k, state.caps[k]);
  return p;
}

/* ── 空きコマグリッド ─────────────────── */
function buildGrid(slots){
  const g = $("#grid");
  g.innerHTML = '<div class="h"></div>' + DAYS.map(d=>`<div class="h">${d}</div>`).join("");
  PERIODS.forEach(p => {
    g.insertAdjacentHTML("beforeend", `<div class="h">${p}</div>`);
    DAYS.forEach(d => {
      const n = (slots?.[d]?.[p]) ?? 0;
      const on = state.day===d && state.period===p;
      const b = document.createElement("button");
      b.className = (n===0 ? "zero" : "") + (on ? " on" : "");
      b.textContent = n === 0 ? "－" : n;
      b.setAttribute("aria-label", `${d}曜${p}限 ${n}件`);
      b.onclick = () => {
        if (n===0 && !on) return;
        state.day = on ? "" : d; state.period = on ? "" : p;
        load();
      };
      g.appendChild(b);
    });
  });
  $("#slotBar").hidden = !state.day;
  if (state.day) $("#slotBarText").textContent = `${state.day}曜${state.period}限で絞り込み中`;
}

/* ── 学年 ─────────────────────────────── */
function buildSems(){
  $("#sems").innerHTML = SEMS.map(([v,label]) =>
    `<button class="chip${state.sem===v?" on":""}" data-s="${v}">${label}</button>`).join("");
  $("#sems").querySelectorAll("button").forEach(b => b.onclick = () => {
    state.sem = b.dataset.s;
    buildSems(); load();
  });
}

function buildYears(){
  $("#years").innerHTML = YEARS.map(([v,label]) =>
    `<button class="chip${state.year===v?" on":""}" data-y="${v}">${label}</button>`).join("");
  $("#years").querySelectorAll("button").forEach(b => b.onclick = () => {
    state.year = b.dataset.y;
    buildYears(); load();
  });
}


/* ── 学部から区分でしぼる ─────────────────
   セクションごと app.js が作って rail に差し込む。index.html には1行も足さない
   ―― あちらは松下さん担当で、同時に触ると必ず衝突する。
   CSS も既存の .chips / .chip / .toggle / .railNote を使い回す。

   学部は絞り込みに効かない。効くのは区分だけ。
   学部が決めるのは「どの区分が自分の卒業要件にあるか」の並べ替えと単位数の表示。
   区分の顔ぶれは全11学部で同じ14個なので、学部で出し分けるものは無い
   （設計 1章① を読むこと）。 */

const DIV_OTHER = "other";   // 「まだ判定していない」科目の置き場。データには書かない
// 外国語学部の専攻語のうち「日本語」だけは、もう一つ言語を選ばせる特別枠。
// requirements.json の外国語学部 tracks に出てくる固定のキー。
const FS_JAPANESE_TRACK = "fs_lang:R";

// 絞り込みに実際に使うトラック。日本語専攻で言語を選んでいれば、その言語の
// 専攻語科目をそのまま取る＝その言語のキーで絞る（自分の専攻語＝日本語では絞らない）。
function effectiveTrack(){
  return (state.track === FS_JAPANESE_TRACK && state.track2) ? state.track2 : state.track;
}

/* チップにする区分だけを返す。chip:false の区分（第1外国語）は、内訳の
   総合英語・実践英語が実在する区分なので、親はチップにしない
   ―― 親に直接ぶら下がる科目が無く、必ず0件になって壊れて見えるため。
   要件表の行としてはデータに残っている（内訳の検算に使う）。 */
/* 画面は3段。
     上 …… 全学部に共通の卒業要件区分（only の無い区分）
     中 …… 学部セレクタ ＋ その学部のトラック（外国語学部＝専攻語、工学部＝学科）
     下 …… その学部だけの区分（only 付き）
   学部の専門科目の区分は他学部の学生には意味が無いので、選んでいるときだけ出す
   （工学部の学生に「専攻語 1年実習」を見せない）。 */
function isOwnDivision(d){ return !!(d.only && d.only.includes(state.faculty)); }

function divisionsOf(){
  return ((REQ && REQ.divisions) || [])
    .filter(d => d.chip !== false)
    .filter(d => !d.only || isOwnDivision(d));
}
function facultyOf(key){ return ((REQ && REQ.faculties) || []).find(f => f.key === key); }

/* 要件表の生文字列（"2" / "－" / "＊" / "＊6"）を画面の言葉にする。
   学科で数字がばらつく学部（理学部の専門基礎 25/25/25/24）は幅で出す。
   要件外（－ と空）は null を返し、呼び出し側が折りたたみへ送る。 */
function unitBadge(values, groupSize){
  const uniq = [...new Set(values)];
  if (uniq.every(v => v === "－" || v === "-" || v === "")) return null;
  // ○ ＝「チェックシートに行はあるが、その紙に単位数が書かれていない」。
  // 要件の側には置き、バッジは出さない（数字を猜うと要件の捏造になる）。
  if (uniq.every(v => v === "○")) return "";
  const nums = uniq.map(v => (v.match(/\d+/) || [])[0]).filter(Boolean).map(Number);
  if (!nums.length) return "便覧で確認";
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const n = lo === hi ? `${lo}単位` : `${lo}〜${hi}単位`;
  return (groupSize > 1 ? "計" : "") + n;
}

/* 学部を選んでいないときは全区分を「必要」の側に並べる（要件の情報が無いので
   優劣を付けられない）。選んでいれば、要件表のグループから
   区分ごとのバッジと、要件外かどうかを引く。 */
function divisionPlan(){
  const all = divisionsOf();
  const fac = facultyOf(state.faculty);
  if (!fac) return { need: all.map(d => ({ ...d, badge:null, title:"" })), off: [], notes: [] };

  const badge = {}, title = {}, off = new Set(all.map(d => d.key));
  for (const r of fac.requirements){
    const b = unitBadge(r.values, r.divisions.length);
    if (b === null) continue;                // 要件外のまま
    const labels = r.divisions.map(k => (all.find(d => d.key === k) || {}).label || k);
    for (const k of r.divisions){
      off.delete(k);
      badge[k] = b;
      title[k] = r.divisions.length > 1
        ? `${labels.join("・")} の合計で ${b.replace(/^計/, "")}`
        : "";
    }
  }
  return {
    need: all.filter(d => !off.has(d.key))
             .map(d => ({ ...d, badge:badge[d.key], title:title[d.key] })),
    off:  all.filter(d =>  off.has(d.key)).map(d => ({ ...d, badge:null, title:"" })),
    notes: fac.notes || [],
  };
}

/* いま選んでいる学部の画面に出ていない区分の選択を捨てる。

   学部だけの区分（only 付き）は、学部を変えると chip が画面から消える。
   選択だけ state に残ると、**押していない条件が見えないまま効き続ける**
   ―― 経済学部で「必修科目」を選び、理学部へ移ると、理学部の画面なのに
   経済学部の必修45件だけが出る。押した覚えのない絞り込みは、原因が
   画面から読めないぶん「壊れている」と読まれる。

   共通の区分（only の無いもの）は捨てない。あれはどの学部でも同じ意味で、
   学部は「どの区分が自分に必要か」を並べ替えるためだけの軸だから
   （学部を外しても情報教育科目の選択は残るのが正しい）。

   load() の0件で捨てる処理では間に合わない ―― division_facets は
   区分で絞る**前**に数えているので、他学部の区分も件数を持っている。 */
function dropForeignDivisions(){
  for (const k of [...state.division]){
    const d = ((REQ && REQ.divisions) || []).find(x => x.key === k);
    if (d && d.only && !isOwnDivision(d)) state.division.delete(k);
  }
}

function divisionChip(d, facets){
  const n = facets?.[d.key] ?? 0;
  const on = state.division.has(d.key);
  // <small> はブラウザ既定で一段小さく出る。新しい CSS クラスを増やさないため
  // （app.css は松下さん担当）、素のタグで済ませている。
  const badge = d.badge ? ` <small>${esc(d.badge)}</small>` : "";
  // 0件は押せない。押せると「壊れている」と読まれる。理由を title で添える。
  const dis = n === 0 ? ' disabled title="この区分の科目はまだ取れていません"'
                      : (d.title ? ` title="${esc(d.title)}"` : "");
  return `<button class="chip${on ? " on" : ""}"${dis} data-d="${esc(d.key)}">`
       + `${esc(d.label)}${badge}<span class="n">${n}</span></button>`;
}

function buildFaculty(facets){
  if (!REQ || !divisionsOf().length) return;   // 要件表が無い環境では出さない

  let sec = $("#facSec");
  if (!sec){
    sec = document.createElement("section");
    sec.id = "facSec";
    // 3段に分ける。上は全学部に共通の区分で、学部を選んでいなくても意味がある。
    // 下は選んだ学部にしか無い区分なので、選ぶまで丸ごと隠す。
    sec.innerHTML =
      `<h2>全学部共通の区分でしぼる</h2>
       <button class="toggle" id="divsTog"></button>
       <div class="chips" id="divs"></div>

       <h2 class="facH">学部からさがす</h2>
       <select id="facSel"></select>
       <div class="trackRow" id="trackRow">
         <select id="trackSel" hidden></select>
         <select id="trackSel2" hidden></select>
       </div>

       <div id="facOwn" hidden>
         <h2 class="facH" id="facOwnH"></h2>
         <div class="chips" id="divsOwn"></div>
       </div>
       <button class="toggle" id="divTog" hidden></button>
       <div class="chips" id="divsOff" hidden></div>
       <p class="railNote" id="facNotes"></p>`;
    const years = $("#years").closest("section");
    years.parentNode.insertBefore(sec, years.nextSibling);

    $("#facSel").innerHTML = `<option value="">学部を選ぶ</option>`
      + ((REQ.faculties || []).map(f =>
          `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join(""));
    // 学部を変えたらトラックと「その学部だけの区分」は必ず捨てる。
    // 学部をまたいで残すと「ドイツ語専攻のまま工学部」のような、
    // 存在しない絞り込みになる。
    $("#facSel").onchange = e => {
      state.faculty = e.target.value; state.track = ""; state.track2 = "";
      dropForeignDivisions();
      load();
    };
    $("#trackSel").onchange = e => {
      state.track = e.target.value; state.track2 = "";
      load();
    };
    $("#trackSel2").onchange = e => { state.track2 = e.target.value; load(); };
    // 既定は閉じる。すでに区分を選んでいる状態（URL復元など）なら、
    // 選択が見えなくならないよう開いたままにする。
    const startOpen = state.division.size > 0;
    $("#divs").hidden = !startOpen;
    $("#divsTog").textContent = startOpen ? "卒業要件を閉じる" : "卒業要件で絞り込む";
    $("#divsTog").onclick = () => {
      const box = $("#divs");
      box.hidden = !box.hidden;
      $("#divsTog").textContent = box.hidden ? "卒業要件で絞り込む" : "卒業要件を閉じる";
    };
    $("#divTog").onclick = () => {
      const box = $("#divsOff");
      box.hidden = !box.hidden;
      $("#divTog").textContent = box.hidden
        ? `卒業要件外の区分も表示する (${box.dataset.n})`
        : "卒業要件外の区分を隠す";
    };
  }
  $("#facSel").value = state.faculty;

  const plan = divisionPlan();
  const other = { key:DIV_OTHER, label:"その他", badge:null,
                  title:"区分がまだ分かっていない科目" };

  // 上段＝共通の区分。「その他」は共通側に置く（学部に紐づかない置き場なので）。
  const shared = plan.need.filter(d => !isOwnDivision(d));
  $("#divs").innerHTML = shared.concat([other])
    .map(d => divisionChip(d, facets)).join("");

  // 中段＝トラック（外国語学部＝専攻語、工学部＝学科）。持たない学部では出さない。
  const fac = facultyOf(state.faculty);
  const tracks = (fac && fac.tracks) || [];
  const tsel = $("#trackSel");
  tsel.hidden = !tracks.length;
  if (tracks.length){
    tsel.innerHTML = `<option value="">${esc(fac.tracks_label || "すべて")}</option>`
      + tracks.map(t => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join("");
    tsel.value = state.track;
  } else {
    // 中身も捨てる。hidden にするだけだと、学科・専攻を持たない学部に
    // 切り替えたときに前の学部の選択肢が残る（CSS 側の取りこぼしで
    // 実際に「文学部なのに専攻語を選ぶ」が見えていた）。
    tsel.innerHTML = "";
    if (state.track) state.track = "";
  }

  /* 日本語専攻だけの追加枠。専攻語＝日本語の学生は、卒業要件上もう一つ言語を
     履修し、その言語の専攻語科目をそのまま取る（例：中国語を選べば中国語専攻の
     学生と同じ科目）。だから見出しは「専攻」ではなく「言語」。
     選ばせるのは専攻語の一覧から日本語自身を除いたもの。 */
  const t2sel = $("#trackSel2");
  const showLang2 = tracks.length > 0 && state.track === FS_JAPANESE_TRACK;
  t2sel.hidden = !showLang2;
  $("#trackRow").classList.toggle("split", showLang2);
  if (showLang2){
    t2sel.innerHTML = `<option value="">言語を選ぶ</option>`
      + tracks.filter(t => t.key !== FS_JAPANESE_TRACK)
              .map(t => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join("");
    t2sel.value = state.track2;
  } else {
    t2sel.innerHTML = "";
    if (state.track2) state.track2 = "";
  }

  // 下段＝その学部だけの区分。
  const own = plan.need.filter(isOwnDivision);
  $("#facOwn").hidden = own.length === 0;
  if (own.length){
    $("#facOwnH").textContent = `${fac.label}だけの区分`;
    $("#divsOwn").innerHTML = own.map(d => divisionChip(d, facets)).join("");
  } else {
    $("#divsOwn").innerHTML = "";
  }

  const tog = $("#divTog"), box = $("#divsOff");
  tog.hidden = plan.off.length === 0;
  box.dataset.n = plan.off.length;
  if (plan.off.length){
    box.innerHTML = plan.off.map(d => divisionChip(d, facets)).join("");
    if (box.hidden) tog.textContent = `卒業要件外の区分も表示する (${plan.off.length})`;
  } else {
    box.innerHTML = ""; box.hidden = true;
  }

  $("#facNotes").innerHTML = plan.notes.map(t => esc(t)).join("<br>");

  sec.querySelectorAll(".chips button").forEach(b => b.onclick = () => {
    const k = b.dataset.d;
    state.division.has(k) ? state.division.delete(k) : state.division.add(k);
    load();
  });
}

/* ── 配点でしぼる（上限スライダー） ───────────────
   数字はシラバスの「成績評価の内訳」そのもの。
   「出席率 30%」＝ 出席・平常点が成績の30%以下の科目だけ出す、の意味。

   0% にすると、対応する条件チップ（出席なし・小テストなし）と**同じ状態**に
   なる。チップはこのスライダーのショートカットであって別の判定ではない。 */
function buildSliders(){
  $("#sliders").innerHTML = CAP_AXES.map(k =>
    `<div class="sl"><label for="s_${k}">${esc(CAP_LABEL[k])}</label>
       <input type="range" id="s_${k}" min="0" max="100" step="${CAP_STEP}"
              value="${state.caps[k]}" data-k="${k}"
              aria-label="${esc(CAP_LABEL[k])}が成績に占める割合の上限">
       <span class="v" id="v_${k}">${state.caps[k]}%</span></div>`).join("");
  $("#sliders").querySelectorAll("input").forEach(i => i.oninput = () => {
    state.caps[i.dataset.k] = +i.value;
    $("#v_"+i.dataset.k).textContent = i.value + "%";
    /* チップの点灯はここから導く（別に持たない）。件数も動くので描き直す。 */
    syncCaps();
    load();
  });
  updateCapWarn();
}

/* 上限の合計が100%を下回ると、成績評価の内訳の合計が100%である以上、
   条件を満たす科目は**原理的に存在しない**。0件になってから気付かせるのでは
   なく、そうなる前に理由を出す。score.py の caps_impossible と同じ判定。 */
function updateCapWarn(){
  const el = $("#capWarn");
  if (el) el.hidden = !capsImpossible(state.caps);
}

/* スライダー・チップ・URL を1つの状態から描き直す。 */
function syncCaps(){
  updateCapWarn();
  for (const k of CAP_AXES){
    const i = $("#s_"+k);
    if (i && +i.value !== state.caps[k]){
      i.value = state.caps[k];
      $("#v_"+k).textContent = state.caps[k] + "%";
    }
  }
  const u = new URL(location.href);
  for (const k of CAP_AXES){
    if (state.caps[k] < NO_CAP) u.searchParams.set("cap_"+k, state.caps[k]);
    else u.searchParams.delete("cap_"+k);
  }
  history.replaceState(history.state, "", u.pathname + u.search + u.hash);
}

/* ── 条件チップ ───────────────────────── */
/* 「条件」は科目の属性（出席なし・持ち込み可…）で、「口コミあり」はデータの
   出所の話。種類が違うので枠を分けて描く。server.py の CONDITIONS には両方
   入っていて cond= の値としては同じ扱いなので、分けるのはこの描画だけ。
   ここに名前を足すと「条件」から「口コミ」の枠へ移る。 */
const TRUST_CONDS = ["口コミあり"];

/* 配点系チップが点いているか＝そのチップの軸がすべて 0% か。
   state.cond には入れない（入れると同じことを2か所で持つことになる）。 */
const capsZero = c => Object.keys(CHIP_CAPS[c]).every(k => state.caps[k] === 0);
const chipOn = c => c in CHIP_CAPS ? capsZero(c) : state.cond.has(c);

/* 2026-09-11: 「レポートのみ」は試験・出席・小テストの3軸を 0% にするので、
   1軸だけ見る「出席なし」「小テストなし」も同時に条件を満たし、3つとも光る。
   同じ濃さで光ると、自分が押した1つがどれか画面から読めない（本人指摘）。

   **絞り込みの中身は変えない。** 実際に出席0%で絞れている以上、「出席なし」を
   消灯させるのは画面が嘘をつくことになる。見分けたいだけなので、
   広いチップに含まれて点いている側を淡い地（--brand-soft）で出す。
   広い＝自分の軸を全部含み、かつ軸の数が多いチップ。
   返すのは「どれに含まれているか」の名前（title に出して理由を言う）。 */
const chipImpliedBy = c => {
  if (!(c in CHIP_CAPS) || !capsZero(c)) return "";
  const mine = Object.keys(CHIP_CAPS[c]);
  return Object.keys(CHIP_CAPS).find(d => d !== c && capsZero(d)
    && mine.every(k => k in CHIP_CAPS[d])
    && Object.keys(CHIP_CAPS[d]).length > mine.length) || "";
};

function chipRow(el, names, facets){
  el.innerHTML = names.map(c => {
    const by = chipImpliedBy(c);
    return `<button class="chip${chipOn(c)?" on":""}${by?" imp":""}" data-c="${esc(c)}"` +
      (by ? ` title="「${esc(by)}」に含まれています"` : "") +
      `>${esc(c)}<span class="n">${facets?.[c] ?? 0}</span></button>`;
  }).join("");
  el.querySelectorAll("button").forEach(b => b.onclick = () => {
    const c = b.dataset.c;
    if (c in CHIP_CAPS){
      /* チップはスライダーのショートカット。押したらスライダーが動く。 */
      const on = chipOn(c);
      for (const k of Object.keys(CHIP_CAPS[c])) state.caps[k] = on ? NO_CAP : 0;
      syncCaps();
    } else {
      state.cond.has(c) ? state.cond.delete(c) : state.cond.add(c);
    }
    /* load() より先に呼ぶ。後だと、外した直後の1回だけ
       意味を失った並び順のまま描いてしまう。 */
    syncReviewSortOptions();
    load();
  });
}

function buildConds(facets){
  chipRow($("#conds"), META.conditions.filter(c => !TRUST_CONDS.includes(c)), facets);
  chipRow($("#trust"), META.conditions.filter(c =>  TRUST_CONDS.includes(c)), facets);
  syncReviewSortOptions();
}

/* 口コミの件数で並べる2つは「口コミあり」を押しているときだけ出す。
   押していないと6,000件以上が0件で並び、「少ない順」はほぼ全科目が
   同点になって並び替えとして意味を持たない。

   **チップを外したときに並び替えも戻す。** 戻さないと、意味を失った
   並び順のまま一覧が残り、しかも選択中の値がドロップダウンから消えて
   「何順で並んでいるのか画面から読めない」状態になる。 */
function syncReviewSortOptions(){
  const on = state.cond.has("口コミあり");
  let reset = false;
  for (const v of ["reviews_many", "reviews_few"]){
    const o = $(`#sort option[value="${v}"]`);
    if (!o) continue;
    o.hidden = !on;
    o.disabled = !on;
    if (!on && state.sort === v) reset = true;
  }
  if (reset){
    state.sort = "fit";
    $("#sort").value = "fit";
  }
  return reset;
}

/* ── カード ───────────────────────────── */

/* 成績評価の内訳（KOANシラバスの生の%）を積み上げバーで見せる（2026-09-05）。
 *
 * 出すのは **KOAN のシラバスの成績評価テーブルの行そのもの**（`eval_raw`）。
 * 文言も数字も並び順もシラバスのまま。こちらで種類にまとめ直したり、
 * 名前を付け替えたりしない（本人判断・2026-09-07）。
 *
 * なぜ eval_ratio（4区分に振り分けた値）を出さないか
 * ──────────────────────────────────────────────
 * 振り分けは採点のための都合であって、学生が見るべき事実ではない。
 * 実害が出ていた：
 *   ・`発表` は scrape/parse.py で report に入るので、
 *     「学習への参加度20% ＋ 発表80%」の科目が「レポート 80%」と出ていた。
 *     レポートは1本も無い。同じ形の科目が 1,363件（全7,906件で実測）
 *   ・`期末レポート` `期末課題` は試験ルールの裸の「期末」に当たるので
 *     「期末テスト」として出ていた（延べ172箇所）
 *   ・振り分けられなかった項目（723箇所・507科目）は灰色の「不明」に消えていた。
 *     中央値で35%の配点が名前ごと消えていたことになる
 * シラバスの行をそのまま出せば、この3つは同時に起きなくなる。
 *
 * **採点・つまみ・条件チップは今までどおり eval_ratio（4区分）を見る。**
 * 画面のこの部分だけがシラバス直写しになった。片方を直すときにもう片方が
 * 一緒に動くことは無いので、食い違って見えたらまずここを疑うこと。
 *
 * 色は種類ではなく**並び順**（--comp-1〜5）。KOAN の表は最大5列なので5色で足りる。
 * 同じ「レポート」でも科目によって色が違うが、凡例が隣にあるので困らない。 */

/* シラバスの表に「ここには書いていない」とだけ書かれている行（実測15種類・60箇所）。
 * 例：`補足情報を参照 100%`、`下記評価基準 100%`、`英文シラバスをご参照ください。100%`。
 *
 * **文言と数字はシラバスのまま出す**（この欄の原則）が、色だけ灰色にする。
 * 評価の成分と同じ色で塗ると「補足情報を参照という科目が成績の100%」に見えるため。
 * 灰色は「記載なし」と同じ役割の色 ―― 中身が分かっていない、の意味。
 *
 * 🚨 「その他（レポート、課題提出、…）」のような**中身を並べている行は成分**なので
 *    ここに入れない。実データで似た21種類（`その他の課題`『出席カードへのふり返り記入』
 *    など）を目視で分けた。増やすときは全1,134種類に当てて誤爆を見ること。
 *
 * 本当の配点はシラバス本文の「成績評価に関する補足情報」に書かれていることが多い。
 * KOAN の生HTMLを取り込めば埋められる（HANDOFF 参照）。それまでは灰色で出す。 */
const EVAL_POINTER =
  /^(下記|以下)|補足情報|ご参照ください|^各担当教員が判定$|^総合的に判断$|^講義と合わせて成績評価を行う$|^（その他の場合ここに記入）$/;

/* シラバス本文の「成績評価に関する補足情報」。表が使いものにならないときだけ出す。
 *
 * KOAN の成績評価テーブルは教員が埋めないことがある。実測（全7,906件）で
 * 表が空59件・「補足情報を参照」等だけ50件・合計が100%に届かない18件。
 * この137件の生HTMLを取り直したところ、**107件はこの欄に配点が書かれていた**
 * （うち63件は数字入り）。例：人文地理学演習は表が空で、補足情報に
 * 「授業で指示する課題類（80％）と授業での議論への貢献度（20％）で評価します。」
 *
 * **文章のまま出す。** ％を機械で拾って帯に足すことはしない ――
 * 「小課題3回（各20点）」のような書き方が混ざっていて、拾い方を決めた時点で
 * シラバスに無い解釈を足すことになる。帯はあくまで表の写し。 */
const evalNoteHtml = c => c.eval_note
  ? `<div class="compNote">シラバスの補足情報：${esc(c.eval_note)}</div>` : "";

function evalCompHtml(c){
  const raw = c.eval_raw;
  const rows = raw ? Object.entries(raw) : [];
  if (!rows.length)
    return evalNoteHtml(c) ||
      `<div class="compNote">評価方法の内訳はKOANから取得できていません。下の「KOAN公式シラバスを見る」で確認してください。</div>`;

  /* シラバスの表が100%に届いていない科目が18件ある（例：有機化学3は
     中間試験30% ＋ 期末試験40% で70%）。残りを他の行へ按分すると
     シラバスに無い数字を出すことになるので、「記載なし」として灰色で置く。 */
  const known = rows.reduce((sum, [, v]) => sum + (v || 0), 0);
  const gap = Math.max(0, Math.round((100 - known) * 10) / 10);
  const hasGap = gap >= 1;

  /* 本文に「毎回小テスト」とあるのに、成績評価の表には小テストの行が無い科目。
     表に無いものを表へ足すことはしないので、注記として別に出す。 */
  const quizNoRow = c.weekly_quiz &&
    !rows.some(([k]) => /小テスト|クイズ|quiz/i.test(k));

  /* 案内文の行は灰色。色の順番（--comp-1〜5）は成分の行だけで数えるので、
     案内文が混ざっても成分どうしの色がずれない。 */
  const pointers = rows.filter(([k]) => EVAL_POINTER.test(k));
  let seq = 0;
  const colorOf = k => EVAL_POINTER.test(k) ? "var(--comp-gap)"
                                            : `var(--comp-${(seq++ % 5) + 1})`;
  const colors = new Map(rows.map(([k]) => [k, colorOf(k)]));

  const dot = v => `<i class="compDot" style="background:${v}"></i>`;
  return `<div class="compBar">
      ${rows.filter(([, v]) => v > 0).map(([k, v]) =>
        `<div class="compSeg" style="width:${v}%;background:${colors.get(k)}"></div>`).join("")}
      ${hasGap ? `<div class="compSeg" style="width:${gap}%;background:var(--comp-gap)"></div>` : ""}
    </div>
    <div class="compLegend">
      ${rows.map(([k, v]) => `<span>${dot(colors.get(k))}${esc(k)}<b>${v}%</b></span>`).join("")}
      ${hasGap ? `<span>${dot("var(--comp-gap)")}記載なし<b>${gap}%</b></span>` : ""}
    </div>
    ${pointers.length ? (evalNoteHtml(c) ||
        `<div class="compNote">シラバスの成績評価の表には「${esc(pointers[0][0])}」とだけ書かれていて、内訳が分かりません。下の「KOAN公式シラバスを見る」で確認してください</div>`) : ""}
    ${quizNoRow ? `<div class="compNote">シラバス本文に「毎回小テスト」の記載がありますが、成績評価の表には配点がありません</div>` : ""}
    ${hasGap ? `<div class="compNote">シラバスの成績評価の表が${known}%ぶんしか埋まっていません。下の「KOAN公式シラバスを見る」で確認してください</div>` : ""}
    ${hasGap && !pointers.length ? evalNoteHtml(c) : ""}`;
}

/* ── 担当教員 ─────────────────────────────
 * 「基礎解析学I」は10コマ以上あり、曜限も担当教員も違う。履修登録で選ぶのは
 * 科目ではなくコマなので、教員名が無いと学生は自分が登録すべき行を特定できない。
 * だから一覧のカードにも出す（README「教員名の扱い」の載せる理由そのもの）。
 *
 * ただし同じ章が3つ禁じている。ここで守っているのは次の2つ：
 *   ・教員を軸にした集計・並び替え・検索を作らない
 *     → queryLocal() の検索は今まで通り title だけ。instructor は足さないこと
 *   ・スコアの見出しの隣に置かない
 *     → 曜限・キャンパス・区分と同じ .meta（12px・灰）の中の1項目として出す。
 *       相性の数字（.fit）とは別ブロック
 *
 * KOAN は複数担当をカンマ区切りで持つ（最大16名・94文字）。全部そのまま出すと
 * カードの見出しが名前で埋まるので、一覧では「先頭＋ほかN名」、
 * 全員は詳細（detailHtml）に出す。 */
const instructors = c =>
  String(c.instructor || "").split(",").map(s => s.trim()).filter(Boolean);

/* 一覧・見出し用の短い形。1〜2名はそのまま、3名以上は先頭＋ほかN名。
   名前が無いときは空文字を返し、呼び出し側で項目ごと出さない
   （「担当教員なし」と書くと、取れていないだけなのに事実に見える）。 */
function insLabel(c){
  const n = instructors(c);
  if (!n.length) return "";
  if (n.length <= 2) return n.join("・");
  return `${n[0]} ほか${n.length - 1}名`;
}

/* .meta の1項目。区切りの「・」は app.css の span+span::before が入れるので、
   名前が無い科目では span ごと出さないと「・・」が残る。 */
const insMetaSpan = c => insLabel(c) ? `<span>${esc(insLabel(c))}</span>` : "";

/* 口コミの件数表示。件数そのものは操作バーの「口コミ N件を読む」が持つので、
   ここが返すのは「まだ採点に入っていない」の注意帯だけ（2026-09-06）。
   導線の文言（「タップして中身を見る ↓」）も外した ―― 読む先は
   すぐ下の操作バーに在る。 */
function reviewMark(rv){
  if (!rv?.n || rv.scored) return { alert:"" };
  return { alert:`<div class="rvAlert"><i>⚠</i><div>口コミ ${rv.n}件 ―
      まだ数字には入っていません。下の「口コミを読む」で中身を確認してください</div></div>` };
}

/* band の下の ※ の行。「口コミが集まれば数字が出る」科目にだけ出す。
   出す条件は2つ ―― テストの難しさ待ち（needs_review）と、総合値がまだ出せず
   その穴が口コミで埋まる科目（内訳は読めている）。後者は 2026-09-06 まで
   .reason 側が「口コミが3件そろうと出ます」と言っていたぶんで、同じことを
   2か所で言うのをやめ、投稿への誘い1本に寄せた（score.py の _unjudged_reason）。

   口コミが1件も無いなら「最初の1人」に誘う ―― ここが投稿への入口になる。
   口コミはあるが門を越えていない科目で「誰も書いていない」と言うと、すぐ下の
   注意帯（口コミ N件 ― まだ数字には入っていません）と矛盾するので、
   足りない話（テストの難しさ）だけを書く。それも無いなら注意帯に任せて黙る。 */
function bandNoteText(c){
  const r = c.rakutan;
  const cap = r.eval_captured;
  const min = (META && META.eval_total_min) || 80;
  const unjudged = (r.overall === null || r.overall === undefined)
    && cap !== null && cap !== undefined && cap >= min;
  if (!r.needs_review && !unjudged) return "";
  if (!c.reviews?.n) return "口コミはまだ誰も書いてないけど、最初の1人になりませんか？";
  return r.needs_review ? "テストの難しさは、まだ誰も書いてない" : "";
}

/* 一覧カードの下端の操作バー（2026-09-06）。
 * 「読む・書く・時間割」をここに集める。詳細を開かないと押せなかった
 * 「時間割に追加」と、2回押さないと届かなかった口コミが1回で届く。
 *
 * .head の**外**に置くこと。.head は role="button" なので、中に入れると
 * 入れ子の押せる要素になる（.favBtn を .card > .favBtn にしてあるのと同じ理由）。
 *
 * 2026-09-08：口コミ＝本人が書いた一言、という定義に揃えた（wangの依頼）。
 * 選択式だけ答えて一言を書かなかった回答は「一覧に並ぶ1件」には数えない
 * （集計・スコアには変わらず入る）。だから3通りに分かれる：
 *   readable > 0        … 今までどおり「口コミ N件を読む」＋一言のプレビュー。
 *                          N は readable（= reviews.notes.length）で、
 *                          n（回答の総数）ではない。
 *   readable===0, n>0    … 読める一言が無いが回答はある。「読む」ではなく
 *                          「見る」に言い換え、プレビューは出さない
 *                          （notes が空なので出す一言そのものが無い）。
 *   n===0                … 従来どおり最初の1人を誘う破線ボタン。 */
function cardActsHtml(c){
  const n = c.reviews?.n || 0;
  const readable = c.reviews?.notes?.length || 0;
  const first = (c.reviews?.notes || [])[0] || "";
  const write = `/kuchikomi?c=${encodeURIComponent(c.id)}`;
  let read;
  if (readable){
    read = `<button class="rvBtn" data-id="${esc(c.id)}" aria-haspopup="dialog">
         <span>💬 口コミ ${readable}件を読む ›</span>${
           first ? `<small>「${esc(first)}」ほか</small>` : ""}
       </button>
       <a class="wrBtn" href="${esc(write)}" aria-label="この科目の口コミを書く"
          title="この科目の口コミを書く">✎</a>`;
  } else if (n){
    read = `<button class="rvBtn" data-id="${esc(c.id)}" aria-haspopup="dialog">
         <span>📊 みんなの回答を見る</span>
       </button>
       <a class="wrBtn" href="${esc(write)}" aria-label="この科目の口コミを書く"
          title="この科目の口コミを書く">✎</a>`;
  } else {
    read = `<a class="wrBtn ghost" href="${esc(write)}">✎ 最初の口コミを書く ›</a>`;
  }
  /* inTimetable は termsFor→getTimetable→readTT→localStorage.getItem+JSON.parse
     を学期ごとに歩く。1回に抑える ―― 1ページ24枚で毎回2回呼ぶと、
     絞り込みを変えるたびに同期ストレージ読み取りが最大96回走っていた。 */
  const inTT = rkStore.inTimetable(c);
  return `<div class="cardActs">${read}
      <button class="ttAddBtn" data-id="${esc(c.id)}" aria-pressed="${inTT}">
        ${inTT ? "✓ 時間割に入れた" : "＋ 時間割"}</button>
    </div>`;
}

function card(c){
  const r = c.rakutan, m = c.match;
  const dp = c.day_period || (c.term === "集中" ? "集中" : "—");
  /* r.notes（score.py の _schedule_note()）は「1限（体感コスト大）」と
     「<キャンパス>キャンパス（移動あり）」の2つだけを出す。wangの依頼で
     チップとしては消す（2026-09-08）。rakutan.notes 自体は score.py が
     引き続き計算していて courses.built.json にも入っているが、
     web/line/worker/tools のどこからも他に参照されていない（確認済み）
     ―― 表示だけをやめる。条件チップ（r.tags）はそのまま残す。 */
  const tags = [...r.tags];
  const rv = reviewMark(c.reviews);
  const note = bandNoteText(c);
  const fav = rkStore.isFavorite(c.id);
  return `<article class="card${rv.alert ? " unscored" : ""}" data-id="${esc(c.id)}">
    <div class="head" role="button" tabindex="0">
      <div>
        <h3 class="title"><span class="titleT">${esc(c.title)}</span></h3>
        <div class="meta"><span>${esc(dp)}</span>${insMetaSpan(c)}<span>${esc(c.campus||"—")}</span><span>${esc(c.category)}</span></div>
      </div>
      <div class="fit"><b>${r.overall ?? "—"}</b><small>楽単スコア</small></div>
      <div class="reason"><span class="band b${BAND_CLS[r.band] ?? 0}">${esc(r.band)}</span>${esc(m.reason)}</div>
      ${note ? `<div class="bandNote">${esc(note)}</div>` : ""}
      ${rv.alert}
      ${tags.length ? `<div class="tags">${tags.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
    <button class="favBtn" data-id="${esc(c.id)}" aria-pressed="${fav}"
            aria-label="お気に入り：${esc(c.title)}">${fav ? "★" : "☆"}</button>
    ${cardActsHtml(c)}
    <div class="detail"></div>
  </article>`;
}

/* 詳細（4軸バーと信頼度）は開くまで作らない。
   閉じたまま全カード分を作ると、DOMの56%が「誰も見ていない中身」になり、
   絞り込みのたびの描画とレイアウトがその分だけ重くなる。
   実測（50件・390px）: ノード 1,672→670、innerHTML 3.33ms→1.16ms。 */
/* 全学教育科目のシラバス公式ページ。時間割コード（c.id）だけ差し替える。
   セッション不要で開ける形式（政岡さんが 2026-08-20 に3件で確認）。
   j_s_cd=13 固定＝共通教育科目。
   実装は松下さん（PR #23）。作り直しで構造が変わったので、
   同じものを app.js へ移した（2026-08-24）。 */
// j_s_cd（所属コード）は科目ごとに違う（全学教育推進機構は13だが他学部は別値）。
// courses.built.json の shozoku_cd を使う。無ければ13にフォールバック
// （2026-08-26以前にビルドされた古いデータ・shozoku_cd未収集の科目向け。
// その場合、全学教育推進機構以外の科目はリンクが無効になりうる）。
const koanUrl = c => `https://koan.osaka-u.ac.jp/campusweb/campussquare.do?_flowId=SYW4201600-flow&nendo=2026&j_s_cd=${encodeURIComponent(c.shozoku_cd || "13")}&j_cd=${encodeURIComponent(c.id)}&langkbn=j`;

/* ── 口コミの中身 ─────────────────────
   数字だけ出しても「なぜ楽なのか」は伝わらない。件数・内訳・一言をまとめて出す。
   値は build.py が焼いた集計（複数件なら平均）。一言は publish:false のものを
   除いたぶんだけ入っている ―― 本文を止めても件数と数値は残るので、
   ここの n と一言の数は一致しないことがある。 */
const RV_ATT = ["なし", "たまに", "毎回"];
const RV_LV  = ["軽い", "ふつう", "重い"];
const rvLv = v => (v === null || v === undefined) ? "―" : RV_LV[Math.round(v)];

/* 集計はラベルではなく数字で出す（2026-08-24）。
 *
 * ラベルにすると、**誰も答えていない選択肢を「みんなの答え」として出す**。
 * 実データ 135093 は「なし」と「毎回」の2件で、平均 1.0 を RV_ATT に
 * 通すと「たまに」になる ―― そう答えた人は1人もいない。
 * 数字なら「0 と 2 を平均した 1.0」と読めるので、嘘にならない。
 *
 * 目盛りは元の 0〜2 のまま。1〜5 のような別の幅に引き伸ばすと、
 * 3択で集めたものに無い精度を足すことになる。凡例を横に添えて補う。
 *
 * 1件ずつ（panelEntry）は逆にラベルのまま ―― あちらは平均ではなく
 * 「その人がそう答えた」なので、ラベルが正確。
 */
const rvAvg = v => (v === null || v === undefined) ? "―" : `${v.toFixed(1)} / 2`;

/* 口コミの集計。モーダルの先頭に出す。
   一言3件（.rvn）は廃止した ―― モーダルに全件が1件ずつ出るので重複になる。
   値を <b> で包むのは、ラベルより数字を大きくするため（CSS 側で効かせる）。 */
function reviewHtml(c){
  const r = c.reviews;
  if (!r || !r.n) return "";
  const f = [["出席", rvAvg(r.attendance)],
             ["授業中の課題", rvAvg(r.in_class)],
             ["授業外の課題", rvAvg(r.out_class)]];
  if (r.exam_hard10 != null) f.push(["テストの難易度", `${r.exam_hard10} / 10`]);
  /* 「その他（持ち帰り形式）」等は 可／不可 に畳むと情報が落ちるので、
     畳んだ値に原文を添えて出す ―― 「可（持ち帰り形式）」。 */
  if (r.exam_bring){
    const m = (r.exam_bring_raw || "").match(/^その他[（(](.+)[）)]$/);
    f.push(["持ち込み", m ? `${r.exam_bring}（${m[1]}）` : r.exam_bring]);
  }
  if (r.report_words)        f.push(["レポート", `1本あたり約${r.report_words.toLocaleString()}字`]);
  /* 全幅にする条件は2つ。どちらも実データ・実測から引いた（2026-09-07）。
     ・値が長い ―― 数値側の最長「2.0 / 2」＝7文字と、持ち込みの括弧つき最短
       「可（オンライン）」＝8文字のあいだに境界を置く。
     ・ラベルが長い ―― 390px では半幅セルが 159px しかなく、ラベルは6文字までしか
       1行に収まらない（「授業中の課題」＝6文字は 21px の1行、
       「テストの難易度」＝7文字は 42px の2行になる。実測）。
       ラベルは固定文字列なので、値の長さでは拾えない。 */
  const cell = ([k, v]) =>
    `<span${(String(v).length > 7 || k.length > 6) ? ` class="w"` : ""}><i>${esc(k)}</i><b>${esc(v)}</b></span>`;
  return `<div class="rv">
      <div class="rvf">${f.map(cell).join("")}</div>
      <span class="bandNote">数字は${r.n}件の平均。出席は 0 なし〜2 毎回、課題は 0 軽い〜2 重い${
        r.conflicts?.length ? "。<b>答えが割れている項目があります</b>ので、下の1件ずつを読んでください" : ""}</span>
    </div>`;
}

function detailHtml(c){
  /* ── 詳細の並び（2026-09-10・口コミの集計を詳細にも出す）──────────
   *
   *   ── 成績評価の内訳  KOANの%を積み上げバーで
   *   ── 口コミ         集計（reviewHtml）＋本人の一言を1件だけ
   *   ── KOAN リンク
   *
   * 「読む・書く」ボタンと「時間割に追加」は一覧カードの操作バー（.cardActs）に
   * 残したまま ―― 2026-09-07 の判断（同じ操作を画面に2つ並べない）は変えない。
   * ただし wang から、モーダルを開かなくても集計数字（出席・課題・テストの
   * 難易度など）がここで見えてほしいと依頼があった（Discord 2026-09-10）。
   * reviewHtml() はモーダル（#panelBody）用に作った関数をそのまま再利用 ――
   * 集計の中身を二重に持たないため。一言は「一部だけでいい」との依頼どおり
   * 1件のみ、cardActsHtml と同じ notes[0] を出す（全件は N件を読む→で）。
   * 一言は .pNote ではなく専用の .dQuote で出す ―― .pNote はモーダルの
   * 1件ずつ表示（panelEntry）と共有のクラスなので、ここだけ吹き出し風に
   * 変えると影響範囲がモーダル側にも及んでしまう（2026-09-10、Claude Design
   * で4案作り松下さんが「そっと囲む」案を選定）。
   *
   * 元は score.py が計算した5軸の「重さ」スコアをバーで見せていたが、
   * 松下さんの依頼で「KOANシラバスに書かれている成績評価の生の%」に置き換えた
   * （2026-09-05）。担当教員の行と信頼度の注記は wang の依頼で削除（2026-09-06）。
   *
   * .dSec 自体は app.css に固有のスタイルを持たない（レイアウトは中の
   * .secH/.compBar 側が持つ）が、クラス名として消さないこと ――
   * tools/test_favorite.mjs が `.detail .dSec` を「詳細が描画された」の
   * 目印として待っている（2026-09-07）。 */
  const rn = c.reviews?.n || 0;
  const first = (c.reviews?.notes || [])[0] || "";
  return `<div class="dSec">
        <div class="secH">成績評価の内訳</div>
        ${evalCompHtml(c)}
      </div>
      ${rn ? `<div class="dSec">
        <div class="secH">口コミ <b>${rn}件</b></div>
        ${reviewHtml(c)}
        ${first ? `<p class="dQuote">${esc(first)}</p>` : ""}
      </div>` : ""}
      <div class="dActs">
        <a class="koanLink" href="${esc(koanUrl(c))}" target="_blank" rel="noopener noreferrer">この科目のKOAN公式シラバスを見る ↗</a>
      </div>`;
}

/* ── 口コミを1件ずつ ───────────────────
   集計（複数件なら平均）だけでは足りない。実データにそのまま出ている:
   135093 は集計が「たまに」だが、答えた2人は「なし」と「毎回」で、
   「たまに」と答えた人は1人もいない。平均が消したものを読ませる場所。

   件数に比例して伸びるので courses.built.json とは別ファイル。
   最初に開いた時だけ取りに行く。server.py も同じ URL で返すので、
   API モードと静的モードで分岐しない。 */
let reviewsCache = null;
async function fetchReviewsData(){
  if (reviewsCache) return reviewsCache;
  reviewsCache = await (await fetch("/data/reviews.built.json")).json();
  return reviewsCache;
}

// 課題の軽重は rvLv（集計側と同じ）を使い回す。同じ対応表を2つ持たない。
const attFull = v => (v === null || v === undefined) ? "―" : RV_ATT[Math.round(v)];

/* null は「―」のまま出す。埋めると「無回答だった」という情報が消える。
   並びは 受講年 → 本人が書いた一言 → 選択式の答え（2026-09-06）。
   以前は選択式が先だったので、読みたい一言に届く前に
   「出席 毎回 ／ 授業中の課題 ― ／ 授業外の課題 ―」を読まされていた。
   .pReport（通報リンク）は入れていない ―― 通報フォームの URL がまだ無い。 */
function panelEntry(row){
  const curYear = new Date().getFullYear();
  const yearLabel = row.taken_year == null ? "受講時期不明"
    : row.taken_year_before ? `${row.taken_year}年以前に受講` : `${row.taken_year}年受講`;
  const age = row.taken_year == null ? 0 : curYear - row.taken_year;
  const old = row.taken_year != null && age >= 3;

  const facts = [`出席 ${attFull(row.attendance)}`,
                 `授業中の課題 ${rvLv(row.in_class)}`,
                 `授業外の課題 ${rvLv(row.out_class)}`];
  if (row.exam_hard10 != null) facts.push(`テスト ${row.exam_hard10}/10`);
  if (row.exam_bring)          facts.push(`持ち込み ${row.exam_bring}`);
  if (row.report_words != null) facts.push(`レポート 約${row.report_words.toLocaleString()}字`);

  return `<div class="pEntry">
      <div class="pYear">${esc(yearLabel)}${old ? `<span class="pOld">${age}年前の情報</span>` : ""}</div>
      ${row.note ? `<div class="pNote">${esc(row.note)}</div>` : ""}
      <div class="pFacts">${facts.map(t => `<span>${esc(t)}</span>`).join("")}</div>
    </div>`;
}

/* 口コミ＝本人が書いた一言、という定義（2026-09-08）。選択式だけ答えて
   一言を書かなかった回答は一覧に並べない ―― 見せるものが無いのに枠だけ
   出すと「本文が消えた」ように見える。呼び出し元（openPanel）が
   readable===0 のときはそもそもこれを呼ばないので、ここで rows が
   空になるのは実データ上は起きない想定（reviews.notes.length と
   ここで数える件数は全141件で一致すると確認ずみ）。呼ばないほうを
   選んだ理由も同じ ―― 空リストを描いて「まだ誰も書いていない」を
   出すと、回答自体はあるのに嘘になる。 */
async function panelListHtml(id){
  const all = await fetchReviewsData();
  const rows = (all[id] || []).filter(row => (row.note || "").trim());
  if (!rows.length) return `<p class="pEmpty">まだ誰も書いていない</p>`;
  return `<div class="pList">${rows.map(panelEntry).join("")}</div>`;
}

/* ══════════════════════════════════════════════════════════
   データ層 ― server.py がいれば API、いなければ静的JSON

   Cloudflare Pages は静的ホスティングなので server.py は動かない。
   かといって score.py を丸ごと JS に移植すると点数の正本が2つになり、
   片方だけ直した瞬間にサイトとLINEで違う点数が出る。
   なので 4軸・信頼度・動的重み（＝判断が入る部分）は build.py が
   Python で確定させて静的JSONに焼き、ここでやるのは
   「絞り込み」と「重み×軸スコアの内積」だけにしてある。
   ここには判断を書かないこと。書いた時点で正本が2つになる。
   ══════════════════════════════════════════════════════════ */
const DATA = { mode: null, courses: [] };

const norm = s => String(s || "").replace(/[\s　]+/g, "").toLowerCase();

/* 口コミの件数。reviews を持たない科目は0件として扱う（server.py と同じ）。 */
const reviewCount = c => ((c.reviews || {}).n) || 0;

/* server.py の CONDITIONS と同じ内容。片方だけ足さないこと。 */
/* 成績評価の内訳が「最後まで分かっている」科目か。
   eval_unclassified が残っている＝ scrape/parse.py が振り分けられなかった項目が
   あるということ。**その残りに出席や試験が隠れている可能性がある**ので、
   「出席なし」「レポートのみ」を名乗らせない（411件が該当）。
   内訳そのものが取れていない152件も同じ理由で外す。 */
const evalKnown = c => !!c.eval_ratio && !c.eval_unclassified;

/* ── 配点の上限（score.py の passes_caps / caps_impossible と同じ） ──
   規模・形態（scale）は成績評価の内訳ではないので上限をかけられない。 */
const CAP_AXES = ["attendance", "exam", "quiz", "report"];
const NO_CAP = 100;
/* 目盛りの刻み。**10 で確定（2026-09-04 wangさんの判断）。**

   5 刻みも検討して実データを数えた。結論は「取りこぼしは出るが、10 でよい」:
     ・配点の値の 7.1%（のべ1,100個）は「5の倍数だが10の倍数でない」
     ・10の倍数でない配点を持つ科目は 708件＝9.0%（出席35%の科目は90件ある）
     ・5刻みで増える件数は低いほうに偏る（出席の上限15%で+134件、25%で+108件）。
       35%以上は +42/+16/+7 とほとんど効かない
   つまみが11段か21段かの差より、11段で迷わず動かせるほうを採った。
   **上限は「以下」なので、35%の科目が消えるわけではない**（上限40%で入る）。
   拾えないのは「35%ちょうどで切りたい」という指定のほうだけ。

   刻みを変えるときはここだけ直すこと。URL復元の丸めもこの値を見ている
   （以前 10 を直書きしていて、5刻みにしたとき 35% が往復で 40% に化けた）。 */
const CAP_STEP = 10;
const NO_CAPS = { attendance:NO_CAP, exam:NO_CAP, quiz:NO_CAP, report:NO_CAP };
const CAP_LABEL = { attendance:"出席・平常点", exam:"期末テスト",
                    quiz:"小テスト", report:"レポート" };

function passesCaps(c, caps){
  /* 上限が全部100%（＝既定）なら何も落とさない。触っていないのに件数が
     減る画面は、何が起きたのか説明できない。 */
  if (CAP_AXES.every(k => (caps[k] ?? NO_CAP) >= NO_CAP)) return true;
  /* 上限を1本でも動かしたら、配点が最後まで読めない科目は通さない。
     eval_unclassified が残る科目は「残りの%」にどの軸が隠れているか分からず、
     黙って通すとズレは必ず「実際より楽に見える」方向にだけ出る。 */
  if (!evalKnown(c)) return false;
  /* 🚨 振り分けられているだけでは足りない。**合計が100%に届いているか**も見る。
     デンマーク語V〜VIIの6件は eval_unclassified が空なのに内訳が「試験20%」
     しか無く（シラバスの表がそもそも埋まっていない）、4本の上限を20%にしても
     通り抜けていた。残り80%に何が入るか分からない以上、通してはいけない。
     score.py の passes_caps と同じ判定。片方だけ直さないこと。 */
  const min = (META && META.eval_total_min) || 80;
  let total = 0;
  for (const v of Object.values(c.eval_ratio)) total += v || 0;
  if (total < min) return false;
  // キーが無い＝0%（不明ではない）。0% はどの上限も通る。
  return CAP_AXES.every(k => (c.eval_ratio[k] || 0) <= (caps[k] ?? NO_CAP));
}

const capsImpossible = caps =>
  CAP_AXES.reduce((sum, k) => sum + (caps[k] ?? NO_CAP), 0) < 100;

/* 2026-08-26: 「出席なし」「レポートのみ」「集中講義」の3つは、全7,877件に対して
   **常に0件**だった。原因は判定のほうにあり、データは正しかった。

     出席なし・レポートのみ … scrape/parse.py:152 が
         `{k: v for k, v in buckets.items() if v > 0}`
       で **0% の項目をキーごと落としている**。つまり `attendance === 0` や
       `exam === 0` は構造上ありえない。0% は「キーが無い」として表れる。
     集中講義 … class_format の実値は 演習科目/講義科目/実習科目/実験科目 の4種で、
       "集中講義" という値は存在しない。集中講義は KOAN の開講区分（term）が
       「集中」になっている（191件）。day_period が「他」の1,060件は
       "曜限が決まっていない" であって集中講義とは別物（通年305・秋冬210 を含む）。

   server.py の CONDITIONS と同じ内容。片方だけ足さない・直さないこと。 */
/* 2026-09-03: 配点にかかわる3つのチップは、配点スライダーの 0% と**同義**。
   判定を2つ持つと必ず食い違うので、実装は passesCaps の1つだけにする。
   server.py の CHIP_CAPS と同じ内容。片方だけ直さないこと。

   「小テストなし」を weekly_quiz（本文の正規表現）で判定するのはやめた ――
   本文に「毎回小テスト」と書いてあっても配点が0%なら成績には効かない。
   逆に本文に無くても内訳に小テストがあれば毎週ある。学生が知りたいのは後者。 */
const CHIP_CAPS = {
  "出席なし":     { attendance:0 },
  "小テストなし": { quiz:0 },
  "レポートのみ": { exam:0, attendance:0, quiz:0 },
};
const capChip = caps => c => passesCaps(c, { ...NO_CAPS, ...caps });

const CONDITIONS = {
  "出席なし":     capChip(CHIP_CAPS["出席なし"]),
  "レポートのみ": capChip(CHIP_CAPS["レポートのみ"]),
  "持ち込み可":   c => c.exam_type === "持込可",
  "1限以外":      c => !/1$/.test(c.day_period || ""),
  "集中講義":     c => c.term === "集中",
  "小テストなし": capChip(CHIP_CAPS["小テストなし"]),
  "口コミあり":   c => ((c.reviews || {}).n || 0) > 0,
};

/* score.py の match() と同じ。数字は総合の楽単スコアで、理由は軸の値だけから書く。

   2026-09-03: スライダーが「重み」から「上限」に変わったので、内積で出す
   「相性」という数字は入力を失った。ユーザーの重み無しで出した数字に
   「あなたとの相性」という名前を付けると嘘になるので、表に出すのは
   総合の楽単スコアにした。上限は絞り込み、順位は楽単スコア。 */
function matchLocal(r){
  if (r.overall === null || r.overall === undefined){
    /* 「口コミが集まれば出ます」と言えるのは、口コミで埋まる穴のときだけ。
       内訳そのものが載っていない科目は待っても出ない（score.py と同文）。

       2026-09-07: 「シラバスに載っていない」と「こちらが読み分けられない」を
       言い分ける。内訳をシラバス直写しにしたので、詳細に内訳が100%出ているのに
       一覧のカードで「載っていない」と言う状態になっていた（507科目）。
       score.py の _unjudged_reason と同文。片方だけ直さないこと。 */
    const cap = r.eval_captured;
    const unc = r.eval_unclassified;
    const min = (META && META.eval_total_min) || 80;
    let reason;
    /* 2026-09-11: 読み分けられない項目がある科目（363件）の文言を、こちらの
       都合の説明から読む人への案内に変えた。「種類に読み分けられなかった」は
       こちらの分類器の話で、読む人には何の情報でもない。この363件は成績の
       つけ方がそもそも特殊なので点数は出さず、シラバスの表をそのまま写して
       いる下の「成績評価の内訳」を読んでもらう。score.py の _unjudged_reason
       と同文。片方だけ直さないこと。 */
    const TOKUSHU = "この授業は成績のつけ方が特殊なため、点数での判定は出していません。"
                  + "下の「成績評価の内訳」に、シラバスに書かれているとおりの項目と配点を出しています。";
    if (cap === null || cap === undefined)
      reason = unc
        ? TOKUSHU
        : "シラバスに成績評価の内訳が載っていないため、判定を出していません。";
    else if (cap >= min)
      reason = "";          // 口コミ待ちは band の下の ※ の行が言う（bandNoteText）
    else if (unc)
      reason = TOKUSHU;
    else
      reason = `シラバスの成績評価の内訳が${Math.round(cap)}%分しか読み取れないため、判定を出していません。`;
    return { fit:null, reason, labels:META.axis_labels };
  }
  const axes = r.axes;
  const good = [], bad = [];
  for (const k of CAP_AXES){
    const v = (axes[k] || {}).value;
    if (v === null || v === undefined) continue;
    if (v >= 66) good.push(META.axis_labels[k]);
    else if (v < 45) bad.push(META.axis_labels[k]);
  }
  const parts = [];
  if (good.length) parts.push(`${good.slice(0,2).join("・")}が期待できます。`);
  if (bad.length)  parts.push(`${bad.slice(0,2).join("・")}は期待できません。`);
  if (!parts.length) parts.push("どの軸も平均的な科目です。");
  return { fit: r.overall, reason: parts.join(""), labels: META.axis_labels };
}

/* server.py の search() と同じ手順。
   空きコマと条件チップの件数は曜限フィルタ「前」で数える。
   そうしないとコマを押した瞬間に他のコマが全部0件になり、次の一手が打てない。 */
function queryLocal(){
  const conds = [...state.cond].filter(k => k in CONDITIONS);
  const track = effectiveTrack();
  const trackAxis = track ? track.split(":")[0] + ":" : "";

  const base = [];
  for (const c of DATA.courses){
    if (state.q && !norm(c.title).includes(norm(state.q))) continue;
    if (state.year !== "all" && !(c.eligible_years || []).includes(+state.year)) continue;
    // full（通年）はどちらの学期でも履修できるので必ず通す。
    if (state.sem !== "all" && c.term_group !== state.sem && c.term_group !== "full") continue;
    if (conds.some(k => !CONDITIONS[k](c))) continue;
    /* 配点の上限。チップ（出席なし等）もここで一緒に効く ―― チップは
       state.caps を動かすだけで、別の判定は持たない。 */
    if (!passesCaps(c, state.caps)) continue;
    // トラック（専攻語・学科）は同じ軸の中でだけ効かせる。トラックを持たない
    // 科目（共通教育・学部共通など）は通す ―― 落とすと上段の共通区分が
    // まるごと0件になる。
    if (trackAxis && c.track && c.track.startsWith(trackAxis) && c.track !== track) continue;
    base.push({ ...c, match: matchLocal(c.rakutan) });
  }

  // 区分チップの件数は区分フィルタを掛ける「前」で数える（server.py と同じ理由）。
  const divisionFacets = {};
  for (const e of base){
    const k = e.division || "other";
    divisionFacets[k] = (divisionFacets[k] || 0) + 1;
  }
  if (state.division.size){
    for (let i = base.length - 1; i >= 0; i--){
      if (!state.division.has(base[i].division || "other")) base.splice(i, 1);
    }
  }

  const slots = {};
  for (const d of META.days){ slots[d] = {}; for (const p of META.periods) slots[d][p] = 0; }
  for (const e of base){
    const dp = e.day_period || "";
    if (dp.length >= 2 && slots[dp[0]] && dp.slice(1) in slots[dp[0]]) slots[dp[0]][dp.slice(1)]++;
  }
  const facets = {};
  for (const [k, fn] of Object.entries(CONDITIONS)) facets[k] = base.filter(fn).length;

  let results = base;
  if (state.day)    results = results.filter(e => (e.day_period || "").startsWith(state.day));
  if (state.period) results = results.filter(e => (e.day_period || "").endsWith(state.period));

  const nul = v => v === null || v === undefined;
  /* おすすめ順。同点や未算出のときの並びをここで1回決め、他の並び替えの
     第2キーとしても使う（同じ件数の科目が毎回違う順に出ないように）。
     2026-09-03: match.fit の中身は「重みとの内積」ではなく総合の楽単スコアに
     なった（matchLocal 参照）。上限は絞り込み、順位は楽単スコア。 */
  /* 🚨 第1キーは「テストの難しさが確認できているか」（needs_review）。
     相性だけで並べると、一番目立つ場所に「誰も難しさを確かめていない
     一発試験の科目」が来る ―― 検証していないから薦めている状態になる
     （2026-08-26 実測：おすすめ上位371件が全部それだった）。
     build.py の preset_top と server.py の search() も同じ順序。 */
  const unverified = c => (c.rakutan && c.rakutan.needs_review) ? 1 : 0;
  const byFit = (a,b) => (unverified(a) - unverified(b))
                      || (nul(a.match.fit) - nul(b.match.fit))
                      || ((b.match.fit||0) - (a.match.fit||0));

  if (state.sort === "rakutan")
    results.sort((a,b) => (nul(a.rakutan.overall) - nul(b.rakutan.overall))
                       || ((b.rakutan.overall||0) - (a.rakutan.overall||0)));
  else if (state.sort === "confidence"){
    const o = { high:0, mid:1, low:2 };
    results.sort((a,b) => o[a.rakutan.confidence.level] - o[b.rakutan.confidence.level]);
  }
  /* 口コミの件数。server.py の search() と同じ順序にすること。
     同じ件数のときは相性順に落とす ―― 件数だけだと同点が大量に出る
     （「口コミあり」でも1件の科目が一番多い）。 */
  else if (state.sort === "reviews_many")
    results.sort((a,b) => (reviewCount(b) - reviewCount(a)) || byFit(a,b));
  else if (state.sort === "reviews_few")
    results.sort((a,b) => (reviewCount(a) - reviewCount(b)) || byFit(a,b));
  /* 科目名順。2026-08-26 まで、この分岐が無く相性順に落ちていた
     （本番は静的配信なので server.py の title は使われず、
     ドロップダウンで選んでも並びが変わらなかった）。

     localeCompare("ja") にしているのは、ラテン文字→かな→漢字 の順になり、
     先頭の【人文】【総合】等が重みの低い記号として扱われるため
     ―― 学生が期待する「名前順」になる。
     **server.py はコードポイント順で、ここだけ並びが揃っていない**
     （標準ライブラリに日本語の照合順序が無いため。理由は server.py 側に
     書いてある）。本番＝静的配信なので、利用者に見えるのはこちら。 */
  else if (state.sort === "title")
    results.sort((a,b) => a.title.localeCompare(b.title, "ja"));
  else
    results.sort(byFit);   /* おすすめ順（既定）＝検証ずみ → 相性 */

  return { count: results.length, results, slots, facets, caps: { ...state.caps },
           division_facets: divisionFacets };
}

async function boot(){
  // server.py で動いていれば API を使う（投稿も受けられる）。
  try {
    if ((await fetch("/api/health")).ok){
      DATA.mode = "api";
      META = await (await fetch("/api/meta")).json();
      REQ = await (await fetch("/api/requirements")).json();
      CAN_POST = true;
      return;
    }
  } catch (e) { /* 静的配信では届かない。想定内。 */ }

  DATA.mode = "static";
  // データは必ず絶対パスで取る。計測リンク /l/<slug> は転送せずトップの本文を
  // そのまま返すので、相対パスだと基準URLが「/l/」になり /l/data/… を叩いて
  // 404 になる（Worker は /l/ 配下を slug としてしか見ない）。宣伝で配った
  // 14本のリンクから開いた人だけ一覧が「読み込み中…」で止まった原因がこれ。
  const d = await (await fetch("/data/courses.built.json")).json();
  DATA.courses = d.courses;
  // 要件表が無くても他は全部動く。学部のセクションが出ないだけ。
  try { REQ = await (await fetch("/data/requirements.json")).json(); }
  catch (e) { REQ = null; }
  const m = d._meta;
  META = {
    categories: [...new Set(d.courses.map(c => c.category))].sort(),
    campuses:   [...new Set(d.courses.map(c => c.campus).filter(Boolean))].sort(),
    terms:      [...new Set(d.courses.map(c => c.term))].sort(),
    days: ["月","火","水","木","金"], periods: ["1","2","3","4","5","6"],
    weights: m.weights, conditions: Object.keys(CONDITIONS),
    axis_labels: m.axis_label,
    min_for_scoring: m.min_for_scoring,
    eval_total_min: m.eval_total_min,
    disclaimer: m.note || "",
  };
  CAN_POST = false;
}

/* ── 読み込み ─────────────────────────── */
/* 1,112件を毎回まるごと描画すると実機で重くなるため、最初は PAGE_SIZE 件だけ
   描画し、リスト末尾のセンチネルが画面に入るたび追加描画する（無限スクロール）。 */
const PAGE_SIZE = 24;
const TOP_PICKS = 5;
let courses = [];

// 直前に詳細欄を開いた科目。下の「口コミを書く」を押したときの初期選択に使う。
let lastOpenedCourseId = null;

/* ── 選択状態 ─────────────────────────
 * PC（1024px 以上）では詳細を右カラムに出す。
 * スマホではいままで通りカードの中に開く。
 *
 * 詳細を組み立てる関数（detailHtml）は1本のまま。差し込む場所だけ変える。
 * ここを2本に分けると、片方だけ直して片方が古いまま、が必ず起きる。
 * tools/test_layout.py が detailHtml の本数を数えている。
 */
let selectedCourseId = null;
const mqDesktop = window.matchMedia("(min-width:1024px)");
const isDesktop = () => mqDesktop.matches;

function showDetail(c, article){
  selectedCourseId = c.id;

  if (isDesktop()){
    document.querySelectorAll(".card.sel").forEach(el => el.classList.remove("sel"));
    if (article) article.classList.add("sel");
    const dp = c.day_period || (c.term === "集中" ? "集中" : "—");
    const ins = $("#inspector");
    ins.innerHTML = `<div class="inspectorHead">
        <button type="button" class="insClose" aria-label="この科目を閉じる">✕</button>
        <h3>${esc(c.title)}</h3>
        <div class="meta"><span>${esc(dp)}</span>${insMetaSpan(c)}<span>${esc(c.campus||"—")}</span><span>${esc(c.category)}</span></div>
      </div><div class="detail">${detailHtml(c)}</div>`;
    ins.querySelector(".insClose").onclick = closeDetail;
    ins.scrollTop = 0;
    lastOpenedCourseId = c.id;
    return;
  }

  if (!article) return;
  // 初めて開くときに詳細を組み立てる。2回目以降は作り直さない。
  if (!article.dataset.filled){
    article.querySelector(".detail").innerHTML = detailHtml(c);
    article.dataset.filled = "1";
  }
  const opening = !article.classList.contains("open");
  article.classList.toggle("open");
  if (opening) lastOpenedCourseId = c.id;
}

/* 右カラムを閉じて「何も選んでいない」状態へ戻す（2026-09-06 追加）。
   これが無いと、いちど科目を押した人は再読込するまで開いた直後の
   画面（2カラムを中央に寄せた状態）に戻れなかった。閉じる手段は
   ✕ と Esc の2つで、どちらもここを呼ぶ。
   lastOpenedCourseId は消さない ―― 下の「口コミを書く」の初期選択に
   使うもので、閉じたあとも直前に見ていた科目のままでよい。 */
function closeDetail(){
  selectedCourseId = null;
  document.querySelectorAll(".card.sel").forEach(el => el.classList.remove("sel"));
  $("#inspector").innerHTML = "";
}

/* 増えた分のカードだけにクリック判定を付ける。以前は呼ばれるたびに
   #list 内の表示済みカード全部を数え直していたため、スクロールで
   読み込みが進むほど1回あたりの作業量が増えていた（雪だるま式）。 */
function bindCardHandler(article, c){
  const h = article.querySelector(".head");
  /* 「詳細を開いた回数」を数えるのはここ。showDetail の中ではない
     ―― showDetail は画面幅が変わったときにも呼ばれるので、そこで数えると
     PC で窓を縮めただけで1件になる。スマホの .head は開閉の両方なので、
     開くときだけ数える（rkTrack は analytics.js、除外された端末では何もしない）。 */
  const t = () => {
    const opening = isDesktop() || !article.classList.contains("open");
    showDetail(c, article);
    if (opening) window.rkTrack?.("detail");
  };
  h.onclick = t;
  h.onkeydown = e => { if (e.key==="Enter"||e.key===" "){ e.preventDefault(); t(); } };
}

/* 画面幅が変わったとき（PC で窓を縮めた・スマホを回した）に、
   詳細がどちらにも出ていない状態にならないよう描き直す。 */
mqDesktop.addEventListener("change", () => {
  if (!selectedCourseId) return;
  const c = courses.find(x => x.id === selectedCourseId);
  if (!c) return;
  const article = document.querySelector(`.card[data-id="${CSS.escape(c.id)}"]`);
  if (isDesktop()){
    showDetail(c, article);
  } else {
    // PC からスマホ幅へ縮めたとき。右カラムは CSS で隠れるので、
    // 選んでいた科目をカードの中に開き直す。
    $("#inspector").innerHTML = "";
    if (article && !article.classList.contains("open")) showDetail(c, article);
  }
});

/* ── 口コミパネル（1件ずつ）─────────────
 * 何のためか: **Android の戻るボタン**。中央モーダルが開いた状態で
 * 戻るを押すと、履歴に何も積んでいなければページごと離脱する。
 * 口コミを読みに来た人が一覧を失う。おまけで ?c=<id> の共有もできる。
 * この履歴エントリを積む理由は今も変わらずこれ1つ（2026-09-07）。
 *
 * 今は幅によらず同じ中央モーダル1つ（#panel）。入口は ?c=<id> か
 * 一覧カードの .rvBtn のどちらか、閉じ方は2通り：
 *   - 自分で開いた（history.pushState 済み）→ ✕/Esc/幕クリックは
 *     history.back() を呼ぶだけ。実際に閉じるのは popstate 側。
 *   - 共有リンクで直接開いた（積んでいない）→ history.back() だと
 *     サイトの外へ出てしまうので、その場で ?c= を剥がして直接閉じる
 *     （closePanel、2026-09-07）。
 */

/* 絞り込みで一覧から外れている科目や、まだ読んでいないページの科目も
   共有リンクからは開けるようにする。static モードは DATA.courses に
   全件あるが、API モードは表示中の分しか手元に無いので1件だけ取りに行く。 */
async function findCourse(id){
  const local = courses.find(c => c.id === id) || DATA.courses.find(c => c.id === id);
  if (local || DATA.mode !== "api") return local || null;
  try {
    const res = await fetch(`/api/courses/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const c = await res.json();
    return c && c.id ? c : null;
  } catch { return null; }
}

/* index.html は #panel の .kBox に role="dialog" aria-modal="true" を持たせている。
   aria-modal は支援技術に「これ以外は無視しろ」と告げるので、フォーカスが
   背景に残ったままだと宣言だけが独り歩きする。ここで最低限のモーダル性を持たせる：
   開くときに元のフォーカス位置を覚えて✕へ移し、閉じるときに戻す。
   本格的なタブトラップ（Tab でモーダルの外に出さない）はやっていない ――
   Esc がどこからでも閉じる（document 側のハンドラ）ので無くても迷子にはならない、
   という判断（意図的な範囲外。見落としではない）。 */
let panelReturnFocus = null;

/* 実際に閉じる処理（クラス外し・中身の空っぽ化）はここ1箇所だけ。
   popstate から呼ばれるのが基本だが、共有リンクを直接閉じる経路
   （closePanel）は history.back() を経由せずここを直接呼ぶ（2026-09-07）。 */
function panelSetOpen(open){
  if (open) return;                       // 開くのは openPanel の仕事
  $("#panel").classList.remove("open");
  $("#panelBody").innerHTML = "";
  if (panelReturnFocus && document.contains(panelReturnFocus)) panelReturnFocus.focus();
  panelReturnFocus = null;
}

async function openPanel(id, push = true){
  const c = await findCourse(id);
  if (!c) return;

  /* PC では、モーダルの後ろに科目の詳細も出しておく。
     共有リンク（?c=）で入ってきた人はここでしか科目を選んでいないので、
     出しておかないとモーダルを閉じた瞬間に既定の一覧へ放り出される。
     tools/test_eval_raw.mjs（2026-09-08・main 側）も ?c= で開いた先に
     詳細（.compNote）が在ることを前提にしている。
     スマホは詳細がカードの中に開く＝モーダルの裏で勝手にカードが伸びるので、
     ここでは出さない。 */
  if (isDesktop() && selectedCourseId !== id){
    const article = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    showDetail(c, article);
  }

  if (push){
    const url = new URL(location.href);
    url.searchParams.set("c", id);
    history.pushState({ panelCourse: id }, "", url);
  }

  const n = c.reviews?.n || 0;
  const readable = c.reviews?.notes?.length || 0;
  $("#panelTitle").textContent = c.title;
  /* readable===0 のとき「口コミ」を名乗らない ―― 一言を書いた人が
     1人もいないので、「実際に取った人が書いたもの」は嘘になる。
     選択式の回答はあるので、その集計であることだけを伝える。 */
  $("#panelSub").textContent = readable
    ? `口コミ ${readable}件 ― 実際に取った人が書いたもの`
    : `回答 ${n}件の集計 ― 書かれた口コミはまだありません`;
  $("#panelWrite").href = `/kuchikomi?c=${encodeURIComponent(id)}`;
  /* readable===0 のときは panelListHtml を呼ばない。呼ぶと
     「1件ずつ」の区切りの下に「まだ誰も書いていない」が出るが、
     回答自体はある（数字には入っている）ので、これは嘘になる。 */
  $("#panelBody").innerHTML = reviewHtml(c) + (readable ? await panelListHtml(id) : "");
  $("#panel").classList.add("open");
  $("#panelBody").scrollTop = 0;
  panelReturnFocus = document.activeElement;
  $("#panelClose").focus();
}

function closePanel(){
  /* 開くときに積んだぶんだけ戻す。閉じる本体は popstate 側。
     ?c= が URL に在ることは「自分で積んだ」の証拠にならない ―― 共有リンクで
     直接入ってきた人は openPanel(id, false) で積んでいないので、history.back()
     はこの画面ではなく直前のページ（新規タブなら about:blank）へ飛び、
     サイトから出てしまう（2026-09-07 実測）。積んだかどうかは history.state で見る。 */
  if (history.state?.panelCourse){ history.back(); return; }
  const url = new URL(location.href);
  if (url.searchParams.has("c")){
    url.searchParams.delete("c");
    history.replaceState(null, "", url);
  }
  panelSetOpen(false);
}

window.addEventListener("popstate", () => {
  const id = new URL(location.href).searchParams.get("c");
  if (id) openPanel(id, false); else panelSetOpen(false);
});

/* 幕は #panel 自身（.kModal が幕を描くので、別の .panelOv は無い）。
   #panel のクリックには2つの役割が乗るため、e.target の判定を
   入れないと箱（.kBox）の中を触るだけで閉じる（クリックが #panel まで
   バブリングするため）。 */
$("#panelClose").onclick = closePanel;
$("#panel").onclick = e => { if (e.target === $("#panel")) closePanel(); };
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if ($("#panel").classList.contains("open")){ closePanel(); return; }
  // パネルが無いときの Esc は、右カラムの詳細を閉じる（✕ と同じ動き）。
  if (isDesktop() && $("#inspector").innerHTML) closeDetail();
});

/* 口コミの入口は一覧カードの操作バーだけ（詳細からは外した）。
   カードは絞り込みのたびに作り直されるので、親で受ける。 */
$("#list").addEventListener("click", e => {
  const btn = e.target.closest(".rvBtn");
  if (!btn) return;
  openPanel(btn.dataset.id);
});

/* ── 一覧のページング ───────────────────
 * 無限スクロールをやめた理由：
 * 1,112件が終わりなく流れるだけで、終点も現在位置も分からなかった。
 * それに「1,112件」を平らに並べること自体が
 * 「あなたが1,112件を見比べてください」という意味になっていた。
 * このサービスの価値は、絞ったことのほうにある。
 */
let page = 1;
/* 下の一覧に実際に並べる分（「あなたに合う」枠に出したぶんを抜いたもの）と、
   抜いた件数。renderPager は resize からも引数なしで呼ばれるので、
   ページ送りの計算に要るこの2つはここに置いて共有する。 */
let listed = [];
let picked = 0;

/* 1ページ目の先頭に出す推薦枠。人が確認ずみの科目からだけ選ぶ。
   ⚠️ 本一覧の並び順そのものは変えない。
   ROADMAP 1章の「おすすめ順を検証ずみ優先に」は未決定のまま。
   ここで足すのは視覚的に独立した枠だけで、その決定を先取りしない。

   2026-08-24：口コミ108件を取り込んだ結果、門（3件）を越えた科目が
   0 → 2件（135327・135349）になった。**この枠がここで初めて画面に出る。**
   5件に満たないので見出しは「あなたに合う2件」になる（picks.length を出す）。 */
function topPicks(){
  /* 「あなたに合う」と名乗る以上、下の一覧がどの順に並んでいても、
     ここは必ず相性順で選ぶ。

     2026-08-24 修正：以前は courses の先頭から5件取っていた。
     courses は利用者が選んだ並び順で来るので、
     「科目名順」を選ぶと “名前が前の5件” を「あなたに合う5件」と
     呼んでいた（4つの並び順のうち3つで名前と中身が食い違う）。
     門を越えた科目が0件で枠自体が出ていなかったため、
     画面上は誰にも見えていなかった。

     filter が新しい配列を返すので、ここで sort しても
     courses そのものの並びは動かない。 */
  const nul = v => v === null || v === undefined;
  return courses
    .filter(c => c.reviews && c.reviews.scored)
    .sort((a, b) => (nul(a.match.fit) - nul(b.match.fit))
                 || ((b.match.fit || 0) - (a.match.fit || 0)))
    .slice(0, TOP_PICKS);
}

function appendCards(parent, list){
  const frag = document.createElement("div");
  frag.innerHTML = list.map(card).join("");
  Array.from(frag.children).forEach((n, i) => {
    parent.appendChild(n);
    bindCardHandler(n, list[i]);
  });
}

/* scroll=true はユーザーがページ送りを押したときだけ。
   初回描画で動かすと、まだ何もしていないのに
   ヘッダが画面外へ流れていってしまう。 */
function renderPage(n, scroll = false){
  /* 2026-09-11：「あなたに合う」枠に出した科目が、すぐ下の一覧にも
     そのまま並んでいた（本人指摘・実測3件）。枠に出したものは一覧から外す。

     外すのは1ページ目だけでは足りない。**全ページから外す** ―― 1ページ目の
     一覧だけから抜くと、抜いたぶんが後ろへ押し出されて2ページ目に現れ、
     同じ重複が戻るだけになる。 */
  const picks = topPicks();
  const pickIds = new Set(picks.map(c => c.id));
  listed = picks.length ? courses.filter(c => !pickIds.has(c.id)) : courses;
  picked = picks.length;

  const total = Math.ceil(listed.length / PAGE_SIZE) || 1;
  page = Math.max(1, Math.min(n, total));
  const list = $("#list");
  list.innerHTML = "";

  if (page === 1 && picks.length){
    const box = document.createElement("section");
    box.className = "picks";
    box.innerHTML = `<h2 class="picksH">あなたに合う${picks.length}件` +
      `<span class="sub">人が確認ずみの科目から</span></h2>`;
    appendCards(box, picks);
    list.appendChild(box);
  }

  const start = (page - 1) * PAGE_SIZE;
  appendCards(list, listed.slice(start, start + PAGE_SIZE));
  renderPager();

  /* 左の絞り込みと右の詳細は sticky なので画面に残る。
     動くのは一覧だけ。ページ全体が飛ぶと、
     いま何で絞っていたのか分からなくなる。 */
  if (scroll) list.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderPager(){
  const el = $("#pager");
  if (!el) return;
  const total = Math.ceil(listed.length / PAGE_SIZE) || 1;
  if (!courses.length || total <= 1){ el.innerHTML = ""; return; }

  /* 分母は courses.length（＝上の帯に出ている件数）のままにする。
     「あなたに合う」枠に出したぶんも利用者はもう見ているので、分子に足す。
     ここを listed.length にすると、帯の件数とページ送りの件数が食い違う。 */
  const shownTo = Math.min(page * PAGE_SIZE, listed.length) + picked;

  /* 1,015件だと43ページになるので、番号を全部は出せない。
     先頭・末尾・現在の前後だけ出して、あいだは「…」で畳む。
     狭い画面では前後1つ（＝最大9個）まで。390px でも1行に収まる幅。 */
  const w = window.innerWidth < 480 ? 1 : 2;
  const nums = [];
  for (let i = 1; i <= total; i++){
    if (i === 1 || i === total || Math.abs(i - page) <= w) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  /* クラス名は pnArrow（"nav" にしない）。ヘッダーの .nav と名前が衝突すると、
     スマホ幅（639px以下）専用の帯用マージン（app.css の @media (max-width:639px)
     内の .nav ルール）がこのボタンにも効いてしまい、矢印だけ位置がずれる
     （2026-08-29 の panelBtn/ttAddBtn の衝突と同じ種類の罠）。 */
  const arrow = (to, label, sign, off) =>
    `<button class="pn pnArrow" data-p="${to}"${off ? " disabled" : ""} ` +
    `aria-label="${label}">${sign}</button>`;

  el.innerHTML =
    `<div class="pagerPos">${shownTo} / ${courses.length}件</div>` +
    `<div class="pagerNums">` +
      arrow(page - 1, "前のページ", "‹", page <= 1) +
      nums.map(x => x === "…"
        ? `<span class="gap">…</span>`
        : `<button class="pn${x === page ? " on" : ""}" data-p="${x}"` +
          `${x === page ? ' aria-current="page"' : ""}>${x}</button>`).join("") +
      arrow(page + 1, "次のページ", "›", page >= total) +
    `</div>`;

  el.querySelectorAll(".pn").forEach(b => {
    if (!b.disabled) b.onclick = () => renderPage(+b.dataset.p, true);
  });
}

async function load(retry){
  const d = DATA.mode === "api"
    ? await (await fetch("/api/courses?" + qs())).json()
    : queryLocal();

  // 学年や学期を変えると、選んでいた区分が0件になることがある
  // （「専攻語 1年実習」を選んだまま2年へ切り替える等）。選択を残すと
  // chip が disabled になったまま条件だけ効き続け、「何も押していないのに
  // 1件も出ない」状態になって、原因が画面から読めない。だから外す。
  if (!retry && state.division.size){
    const f = d.division_facets || {};
    let dropped = false;
    for (const k of [...state.division]) if (!(f[k] > 0)){ state.division.delete(k); dropped = true; }
    if (dropped) return load(true);
  }
  courses = d.results;
  buildGrid(d.slots); buildConds(d.facets); buildFaculty(d.division_facets);
  $("#count").textContent = d.count;
  syncRailTog();   // 条件が変われば畳んでいるときのバッジも変わる
  if (d.count){
    renderPage(1);
  } else {
    $("#list").innerHTML =
      `<div class="empty">条件に合う科目がありません。<br>条件チップを外すか、別のコマを押してみてください。</div>`;
    listed = []; picked = 0;   // 前回の結果を残したままページ送りを描かせない
    renderPager();
  }
}

/* ── 左の絞り込みの開閉 ─────────────────
 * 畳むと中カラムが 284〜304px 広がり、#list が自動で2列になる
 * （列数を決めているのは app.css の auto-fill。ここでは幅を変えるだけ）。
 * 768px 未満ではボタンを出していない（.rail が横に並んでいないので意味が無い）。
 */
const mqWide = window.matchMedia("(min-width:768px)");

/* 畳んでいるあいだ、効いている条件が画面から消える。数だけでもバッジに
   出さないと「なぜ12件しか出ないのか」がどこにも書かれていない状態になる。
   数え方は「左カラムで押せるもの」に揃える ―― 検索語と並び順は .bar 側に
   見えたままなので数えない。学部（state.faculty / track）も、絞り込みには
   効かず区分の並べ替えにしか使っていないので数えない（state の宣言参照）。
   配点は軸ごとに1つと数える。チップ「出席なし」等は state.cond ではなく
   state.caps を 0 にするので（chipOn 参照）、二重には数えていない。 */
function activeFilterCount(){
  let n = 0;
  if (state.day) n++;                                   // 空きコマ（曜日と限は対）
  n += state.cond.size;                                 // 条件チップ＋口コミあり
  n += CAP_AXES.filter(k => state.caps[k] < NO_CAP).length;
  if (state.year !== "all") n++;
  if (state.sem  !== "all") n++;
  n += state.division.size;                             // 卒業要件の区分
  return n;
}

/* 開閉の操作子は継ぎ目の取っ手（#grip）1つだけ。矢印の向きは CSS が
   .railOff から出し分けるので、ここでは名前と条件数だけを面倒みる。 */
function syncRailTog(){
  const btn = $("#grip");
  if (!btn) return;
  const off = $("#workbench").classList.contains("railOff");
  const label = off ? "絞り込みを表示" : "絞り込みを隠す";
  btn.setAttribute("aria-expanded", String(!off));
  btn.setAttribute("aria-label", label);
  btn.dataset.label = label;   // 乗せたときに出る名札（app.css の .grip::after）
  /* 条件の数は畳んでいるときだけ出す。開いていれば条件そのものが左に見えている。 */
  const n = activeFilterCount();
  const b = $("#gripCount");
  b.textContent = n;
  b.hidden = !(off && n > 0);
}

function setRail(open){
  $("#workbench").classList.toggle("railOff", !open);
  rkStore.setRailOpen(open);
  syncRailTog();
}

/* ── 長い科目名をホバーで流し読みさせる ─────────
 * 科目名は2行で切ってある（app.css）。実データで2行に収まらないのは
 * 1% 未満だが、そこは「学問への扉（…）」のように前半が共通で、
 * 括弧の中だけが違う。切ったままだと見分けが付かないので、乗せたときだけ
 * はみ出したぶんを上へ流す。
 *
 * 距離は測るしかない（幅もフォントも実行時にしか決まらない）。
 * mqOn でクランプを外して全高を測り、次のフレームで mqRun を足して動かす。
 */
const MQ_SPEED = 45;      // px/秒。100px はみ出して約2.2秒
function mqStart(t){
  if (!t || !mqWide.matches || t.classList.contains("mqOn")) return;
  clearTimeout(t._mqT);
  t.classList.add("mqOn");
  const inner = t.firstElementChild;
  const shift = inner ? inner.offsetHeight - t.clientHeight : 0;
  if (shift <= 1){ t.classList.remove("mqOn"); return; }   // 2行に収まっている
  t.style.setProperty("--mqShift", shift + "px");
  t.style.setProperty("--mqDur", Math.max(0.6, shift / MQ_SPEED).toFixed(2) + "s");
  /* 動きを止めている人には流れないので、標準のツールチップで全文を読ませる。 */
  if (window.matchMedia("(prefers-reduced-motion:reduce)").matches && !t.title){
    t.title = inner.textContent;
  }
  requestAnimationFrame(() => { if (t.classList.contains("mqOn")) t.classList.add("mqRun"); });
}
function mqStop(t){
  if (!t || !t.classList.contains("mqOn")) return;
  t.classList.remove("mqRun");        // 戻りは .titleT の .2s で速く戻る
  clearTimeout(t._mqT);
  t._mqT = setTimeout(() => t.classList.remove("mqOn"), 250);
}

/* 口コミ選択肢は「口コミを書く」を押した時だけ作る。
   絞り込むたびに（検索窓1文字ごとも）1,112件分作り直していたのが無駄だった。 */
function buildReviewSelect(){
  $("#rvCourse").innerHTML = courses.map(c =>
    `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("");
}

// id を渡すとその科目を選んだ状態でシートを開く。省略時は一覧の先頭のまま。
function openReviewFor(id){
  buildReviewSelect();
  if (id) $("#rvCourse").value = id;
  resetReviewForm();
  $("#sheet").classList.add("open");
}

/* ── 口コミシート ───────────────────────
 * 設問は正典（しゅんやさんのフォーム → tools/ingest_reviews.py →
 * data/reviews.json）。data-k は server.py の do_POST が読むキーと1対1。
 * **キー名を変えるときは do_POST と一緒に変えること。** 片方だけ変えると、
 * 2026-08-21 と同じ「入った口コミが黙って落ちる」事故になる。
 */
const review = {};

/* 年はべた書きしない（来年もそのまま使える）。4つめは「それ以前」で、
   年は境界を意味する ―― taken_year_before が立つ。 */
function buildYearRow(){
  const y = new Date().getFullYear();
  const opts = [[y, `${y}年`], [y-1, `${y-1}年`], [y-2, `${y-2}年`],
                [y-3, `${y-3}年以前`, true]];
  $("#rvYearRow").innerHTML = opts.map(([v, label, before]) =>
    `<button data-v="${v}"${before ? ' data-before="1"' : ""}>${label}</button>`).join("");
  $("#rvYearRow").querySelectorAll("button").forEach(b => b.onclick = () => {
    $("#rvYearRow").querySelectorAll("button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    review.taken_year = +b.dataset.v;
    review.taken_year_before = b.dataset.before === "1";
    checkSend();
  });
}

function buildHardSelect(){
  $("#rvHard").innerHTML = `<option value="">選んでください</option>` +
    Array.from({length:10}, (_, i) =>
      `<option value="${i+1}">${i+1}${i === 0 ? "（簡単）" : i === 9 ? "（難しい）" : ""}</option>`).join("");
}

/* 分岐の開閉。**隠すときは値も消す** ―― 隠しただけで値が残ると、
   「テストは無かった」と答えた人の口コミに難易度が付いて送られる。 */
function toggleExamFields(on){
  $("#qExamBring").hidden = !on;
  $("#qExamHard").hidden  = !on;
  if (!on){
    delete review.exam_bring; delete review.exam_hard10;
    $("#rvHard").value = "";
    $("#qExamBring").querySelectorAll("button").forEach(x => x.classList.remove("on"));
  }
}
function toggleReportFields(on){
  $("#qReportWords").hidden = !on;
  if (!on){ delete review.report_words; $("#rvWords").value = ""; }
}

function checkSend(){
  const base = review.attendance != null && review.in_class != null && review.out_class != null
    && review.taken_year != null && review.exam != null && review.report != null;
  const examOk   = !review.exam   || (review.exam_bring != null && review.exam_hard10 != null);
  const reportOk = !review.report || review.report_words != null;
  $("#send").disabled = !(base && examOk && reportOk);
}

/* シートを開くたびに前回の答えを消す。別の科目を続けて投稿するときに
   「テストはあった？」だけ前の科目のまま送られるのを防ぐ。 */
function resetReviewForm(){
  for (const k of Object.keys(review)) delete review[k];
  document.querySelectorAll(".row2 button, .row4 button")
          .forEach(b => b.classList.remove("on"));
  $("#rvNote").value = ""; $("#rvWords").value = ""; $("#rvHard").value = "";
  toggleExamFields(false); toggleReportFields(false);
  checkSend();
}

/* data-v は設問によって型が違う。数値に寄せると exam_bring の
   「可」「不可」が NaN になる。ここで1箇所に寄せておく。 */
const BOOL_KEYS = ["exam", "report"];
const STR_KEYS  = ["exam_bring"];
function coerce(key, raw){
  if (BOOL_KEYS.includes(key)) return raw === "1";
  if (STR_KEYS.includes(key))  return raw;
  return +raw;
}

document.querySelectorAll(".row2").forEach(row => {
  row.querySelectorAll("button").forEach(b => b.onclick = () => {
    row.querySelectorAll("button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    const k = row.dataset.k;
    review[k] = coerce(k, b.dataset.v);
    if (k === "exam")   toggleExamFields(review.exam);
    if (k === "report") toggleReportFields(review.report);
    checkSend();
  });
});
$("#rvHard").onchange = e => {
  if (e.target.value) review.exam_hard10 = +e.target.value;
  else delete review.exam_hard10;
  checkSend();
};
$("#rvWords").oninput = e => {
  const v = parseInt(e.target.value, 10);
  if (Number.isFinite(v) && v > 0) review.report_words = v;
  else delete review.report_words;
  checkSend();
};
$("#slotBarClear").onclick = () => { state.day = ""; state.period = ""; load(); };
$("#fab").onclick = () => openReviewFor(lastOpenedCourseId);
$("#close").onclick = () => $("#sheet").classList.remove("open");
$("#sheet").onclick = e => { if (e.target === $("#sheet")) $("#sheet").classList.remove("open"); };
/* 静的ホスティングには投稿を受ける先が無い。
   受け皿が無いのに送信ボタンだけ出すと、書いてくれた口コミが消える。
   「準備中」と書いたボタンを置くのも、押せるように見えて何も起きないので採らない。
   保存先ができるまでは入口ごと出さない。
   D1 が立ったら CAN_POST を true にするだけで戻る（この行以外は触らなくていい）。 */
let CAN_POST = false;

$("#send").onclick = async () => {
  if (!CAN_POST) return;
  /* 正典のキーを1つずつ並べる。`...review` で丸ごと送ると、分岐を開いて
     閉じたときの値が紛れ込む（delete し損ねた1件が「テスト無し」の
     口コミに難易度を付ける）。ここに無いキーは送らない、が守れる形にする。 */
  const body = {
    course_id: $("#rvCourse").value,
    taken_year: review.taken_year,
    taken_year_before: !!review.taken_year_before,
    attendance: review.attendance,
    in_class: review.in_class,
    out_class: review.out_class,
    exam: !!review.exam,
    exam_bring: review.exam ? (review.exam_bring ?? null) : null,
    exam_hard10: review.exam ? (review.exam_hard10 ?? null) : null,
    report: !!review.report,
    report_words: review.report ? (review.report_words ?? null) : null,
    note: $("#rvNote").value,
  };
  const res = await fetch("/api/reviews", {method:"POST", headers:{"Content-Type":"application/json"},
                                           body: JSON.stringify(body)});
  const j = await res.json();
  $("#send").textContent = j.ok ? `ありがとう（累計 ${j.total} 件）` : "送信できませんでした";
  setTimeout(() => { $("#sheet").classList.remove("open"); $("#send").textContent = "送信する"; }, 1200);
};

function applyPostMode() {
  if (CAN_POST) return;
  $("#fab").style.display = "none";
  $("#sheet").classList.remove("open");
}

/* ── 起動 ─────────────────────────────── */
(async () => {
  await boot();
  window.REQ = REQ;   // onboard.js が学部の一覧を借りる（べた書きを作らないため）
  applyPostMode();

  /* 問診で答えた学部・学年を、最初の load() より前に既定の絞り込みとして
     あてる。rk:profile-set（下）はその場の1画面にしか効かず、翌日また
     開くと state は毎回 "" / "all" に戻っていた ―― 「あなたが履修できる
     科目だけを出せます」という約束が、答えた瞬間の1画面でしか成立しない
     嘘になっていた（final-review.md §3-④）。
     ただし共有リンクが明示した値には勝たせない。URL に ?year= や
     ?faculty= が既に付いているなら、それを送った側の意図のほうが
     保存済みのプロフィールより優先される。

     「キーが在るだけ」を明示扱いにしてはいけない。?year= のように
     キーはあっても値が空だと urlYear は "" になり、queryLocal() の
     +state.year は 0 になる。timetable.json に eligible_years が 0 の
     科目は無いので一覧が黙って0件に落ち、しかも "" は YEARS のどの値
     とも一致しないので年チップもどれも選択状態にならない ――
     「絞り込んでいるように見えないまま0件」という一番タチの悪い形になる
     （final-review.md 再レビュー指摘）。だから値が空でないことまで見る。 */
  {
    const urlObj = new URL(location.href);
    const urlParams = urlObj.searchParams;
    const urlFaculty = urlParams.get("faculty");
    const urlYear = urlParams.get("year");
    /* 配点の上限。共有されたURLから開いた人が同じ結果を見られるようにする。
       目盛りに合わせて丸める ―― スライダーの位置と違う値が入ると、つまみの
       位置と件数が食い違って「なぜこの件数なのか」が画面から読めなくなる。
       **CAP_STEP を直書きしないこと**（10 のまま置いていて、35% がURLの
       往復で 40% に化けた。tools/test_haiten_ui.mjs が見張っている）。 */
    for (const k of CAP_AXES){
      const v = parseInt(urlParams.get("cap_" + k), 10);
      if (Number.isFinite(v))
        state.caps[k] = Math.max(0, Math.min(100, Math.round(v / CAP_STEP) * CAP_STEP));
    }

    /* LINE 公式アカウントの問診から届いた場合だけ、その回答を「本人の回答」
       として確定する。共有リンクの ?faculty=&year= と URL の形はまったく
       同じなので、bot 側（worker/index.js の siteUri）が付ける from=line の
       有無だけで見分ける。マーカーが無い訪問は「誰かが送ってきた絞り込み
       リンク」として今までどおりフィルタにしか使わず、本人の学部・学年
       （osaka_u_settings）は上書きしない ―― A が B に自分用の絞り込み
       リンクを送っても、B 自身のプロフィールが黙って書き換わらないための線。
       検証もここで行う：requirements.json（boot() 済みの REQ）に実在する
       学部キーでなく、または学年が1〜6でなければ何も書かない
       （壊れたクエリを osaka_u_settings に混入させない）。 */
    if (urlParams.get("from") === "line") {
      /* 学部・学年が壊れていても、この人が bot のボタンから来たことは確か。
         だから下の検証より先に、連携の印だけは立てる
         （マイページの「LINE 連携済み」がこれを見る）。 */
      rkStore.markLineLinked();
      const facValid = !!(REQ && Array.isArray(REQ.faculties) &&
        REQ.faculties.some(f => f.key === urlFaculty));
      const yrValid = /^[1-6]$/.test(urlYear || "");
      if (facValid && yrValid) {
        rkStore.setProfile({ faculty: urlFaculty, grade: urlYear });
        rkStore.markOnboarded();
      }
      /* from=line は「本人の回答」を示す印であって、共有していい情報では
         ない。アドレスバーに残したままだと、この画面のURLをそのままコピー
         して友だちに送ったとき、送られた側もこの印を引き継いでしまい、
         その人自身のプロフィールを黙って上書きしてしまう ――
         design doc §4.3 が署名トークンを使い切りにして302で剥がす理由と
         同じ線（あちらは署名トークンの漏洩対策、こちらはこの印の
         "うっかり転送" 対策で、守りたい形が同じ）。消費したらすぐ剥がす。
         faculty/year はそのまま残してよい ―― 印が無ければ今日どおり
         「フィルタだけ」に落ちるので、残っても安全側になる。 */
      urlParams.delete("from");
      const stripped = urlObj.pathname +
        (urlParams.toString() ? "?" + urlParams.toString() : "") + urlObj.hash;
      history.replaceState(null, "", stripped);
    }

    const profile = rkStore.getProfile();
    if (urlFaculty) state.faculty = urlFaculty;
    else if (profile.faculty) state.faculty = profile.faculty;
    /* osaka_u_settings は kuchikomi.js と共用（store.js のコメント参照）。
       口コミページの「いまの学年」は "1年"〜"6年"・"修士"・"博士" も持つが、
       ここが受け付けるのは YEARS と同じ "1"〜"6" だけ。検証せず代入すると、
       口コミ側で選んだ値がそのまま学年チップに来て、どれとも一致せず
       チップが全部非選択になり、+state.year も NaN になって学年フィルタが
       全科目を弾く＝0件になる（2026-08-31 松下からの報告で発覚）。 */
    if (urlYear) state.year = urlYear;
    else if (/^[1-6]$/.test(profile.grade)) state.year = profile.grade;
  }

  $("#note").textContent = META.disclaimer;
  buildSems(); buildYears(); buildSliders();
  buildYearRow(); buildHardSelect();
  $("#tog").onclick = () => {
    const o = $("#sliders").classList.toggle("open");
    $("#tog").textContent = o ? "配点スライダーを閉じる" : "配点で細かくしぼる";
  };

  /* 左の絞り込みの開閉。前回の選択を復元してから配線する ―― 先に配線すると
     復元のための classList 操作が「押した」ことになってしまう。 */
  setRail(rkStore.getRailOpen());
  $("#grip").onclick = () => {
    const open = $("#workbench").classList.contains("railOff");   // 畳んでいた＝これから開く
    setRail(open);
    window.rkTrack?.("rail_toggle", open ? "open" : "close");
  };

  /* 長い科目名の流し読み。#list は描き直すたびに中身が入れ替わるので、
     カードごとではなく #list に1つだけ張る。カード内での移動（見出し→タグ等）で
     止まらないよう、relatedTarget が同じカードの中なら何もしない。 */
  const listEl = $("#list");
  const titleOf = e => {
    const card = e.target.closest?.(".card");
    if (!card || card.contains(e.relatedTarget)) return null;
    return card.querySelector(".title");
  };
  listEl.addEventListener("mouseover", e => mqStart(titleOf(e)));
  listEl.addEventListener("mouseout",  e => mqStop(titleOf(e)));
  /* キーボードで辿る人にも同じものを見せる（.head は role="button" tabindex="0"）。 */
  listEl.addEventListener("focusin",  e => mqStart(titleOf(e)));
  listEl.addEventListener("focusout", e => mqStop(titleOf(e)));
  let t; $("#q").oninput = e => { clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value; load();
      /* 打鍵が止まるたびに確定するので、第2引数で同じ語の重複を落とす。
         語そのものは送らない（analytics.js の中で比較して捨てるだけ）。 */
      if (state.q.trim()) window.rkTrack?.("search", state.q.trim());
    }, 200); };
  $("#sort").onchange = e => { state.sort = e.target.value; load(); };
  /* 開屏の問診の答え。絞り込みに即あてて描き直す ――
     答えたのに画面が変わらないと、聞かれ損になる。 */
  window.addEventListener("rk:profile-set", e => {
    const { faculty, grade } = e.detail || {};
    if (faculty) state.faculty = faculty;
    if (/^[1-6]$/.test(grade)) state.year = grade;
    buildYears();
    load();
  });
  await load();
  window.dispatchEvent(new CustomEvent("rk:app-ready"));
  /* ?c=<科目id> で入ってきた人。push はしない（履歴を二重に積まない）。
     共有リンクは既定の絞り込みで開くので、その科目が一覧に無いことは
     普通に起きる ―― findCourse が1件だけ取りに行く。 */
  const initId = new URL(location.href).searchParams.get("c");
  if (initId) openPanel(initId, false);
})();

/* お気に入りの星。カードは絞り込みのたびに作り直されるので、
   1枚ずつに onclick を付けず、親で受ける（.ttAddBtn と同じ型）。
   委譲先は #list だけ ―― .favBtn は詳細（#inspector）には出ない
   （カード右上に☆があるので詳細から外した。detailHtml 前のコメント参照）。 */
$("#list").addEventListener("click", e => {
  const btn = e.target.closest(".favBtn");
  if (!btn) return;
  const now = rkStore.toggleFavorite(btn.dataset.id);
  /* 「あなたに合う」枠と通常の一覧に同じ科目が重複して出ることがあるので、
     同じ id の .favBtn が複数あり得る。両方直す。 */
  document.querySelectorAll(`.favBtn[data-id="${CSS.escape(btn.dataset.id)}"]`)
    .forEach(b => { b.setAttribute("aria-pressed", String(now));
                    b.textContent = now ? "★" : "☆"; });
});

/* 「時間割に追加」（2026-09-06、カードの操作バー新設で .ttAddBtn が詳細から
   カードの .cardActs へ移った。委譲先は #list だけ ―― detailHtml はもう
   .ttAddBtn を出さない）。配置ロジック（コンフリクト確認＋一括配置）は
   rkStore.putCourse に1本化されている（mypage.jsのputCourseと共有。理由は
   web/assets/mypage.js の putCourse 直前コメントを参照）。曜限が無い科目は
   putCourse が何もしない（false を返す）ので、ここで addExtra に振り分ける。
   2026-09-08：押すだけで外せなかった（追加のみ）のをトグルにした。
   外す側は rkStore.removeCourse に1本化（store.js のコメント参照・
   putCourse と対称の置き場所）。同じ id のボタンは「あなたに合う」枠と
   通常の一覧に重複しうるので、押した後は data-id が一致する全ボタンを
   まとめて直す（.favBtn の委譲コメントと同じ理由）。 */
$("#list").addEventListener("click", e => {
  const btn = e.target.closest(".ttAddBtn");
  if (!btn) return;
  const id = btn.dataset.id;
  const c = courses.find(x => x.id === id) || DATA.courses.find(x => x.id === id);
  if (!c) return;
  const terms = rkStore.termsFor(c);
  const pressed = btn.getAttribute("aria-pressed") === "true";
  let nowPressed;
  if (pressed){
    rkStore.removeCourse(terms, c);
    nowPressed = false;
  } else if (rkStore.slotsOf(c).length){
    nowPressed = rkStore.putCourse(terms, c, null, tid =>
      (courses.find(x => x.id === tid) || DATA.courses.find(x => x.id === tid) || {}).title);
  } else {
    for (const t of terms) rkStore.addExtra(t, c.id);
    nowPressed = true;
  }
  if (nowPressed !== pressed){
    document.querySelectorAll(`.ttAddBtn[data-id="${CSS.escape(id)}"]`).forEach(b => {
      b.setAttribute("aria-pressed", String(nowPressed));
      b.textContent = nowPressed ? "✓ 時間割に入れた" : "＋ 時間割";
    });
  }
});

/* 画面幅で出す番号の数を変えているので、幅が変わったら描き直す。
   スマホを横にしたときに「…」の畳み方が古いままになるのを防ぐ。 */
window.addEventListener("resize", () => { if (courses.length) renderPager(); });
