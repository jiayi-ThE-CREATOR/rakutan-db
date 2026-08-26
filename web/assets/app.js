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
                preset:"とにかく軽い", weights:null,
                /* 学部は絞り込みそのものには効かない ―― 効くのは区分だけ。
                   学部は「どの区分が自分に必要か」を並べ替えるためだけに持つ。 */
                faculty:"", track:"", division:new Set() };
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
  state.division.forEach(d => p.append("division", d));
  if (state.weights) for (const [k,v] of Object.entries(state.weights)) p.set("w_"+k, v);
  else if (state.preset) p.set("preset", state.preset);
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
  $("#slotHint").textContent = (state.day)
    ? `${state.day}曜${state.period}限で絞り込み中 ―― もう一度押すと解除`
    : "「火3が空いてる、何取ろう」から始められる。検索語は要らない。";

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
      `<h2>卒業要件の区分でしぼる <span class="sub">全学部に共通の区分です</span></h2>
       <div class="chips" id="divs"></div>

       <h2 class="facH">学部からさがす <span class="sub">選ぶと、その学部だけの区分が下に出ます</span></h2>
       <select id="facSel"></select>
       <select id="trackSel" hidden></select>

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
    // 学部を変えたらトラックは必ず捨てる。学部をまたいで残すと
    // 「ドイツ語専攻のまま工学部」のような、存在しない絞り込みになる。
    $("#facSel").onchange = e => {
      state.faculty = e.target.value; state.track = ""; load();
    };
    $("#trackSel").onchange = e => { state.track = e.target.value; load(); };
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
  } else if (state.track){
    state.track = "";
  }

  // 下段＝その学部だけの区分。
  const own = plan.need.filter(isOwnDivision);
  $("#facOwn").hidden = own.length === 0;
  if (own.length){
    $("#facOwnH").innerHTML = `${esc(fac.label)}だけの区分`
      + ` <span class="sub">学部の履修表の行に合わせています</span>`;
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

/* ── 優先度 ───────────────────────────── */
function buildPresets(){
  $("#presets").innerHTML = Object.keys(META.presets).map(name =>
    `<button class="chip${state.preset===name && !state.weights ? " on":""}" data-p="${esc(name)}">${esc(name)}</button>`).join("");
  $("#presets").querySelectorAll("button").forEach(b => b.onclick = () => {
    state.preset = b.dataset.p; state.weights = null;
    buildPresets(); buildSliders(); load();
  });
}
function buildSliders(){
  const w = state.weights || META.presets[state.preset];
  $("#sliders").innerHTML = Object.entries(META.axis_labels).map(([k,label]) =>
    `<div class="sl"><label for="s_${k}">${esc(label)}</label>
       <input type="range" id="s_${k}" min="0" max="5" value="${w[k]}" data-k="${k}">
       <span class="v" id="v_${k}">${w[k]}</span></div>`).join("");
  $("#sliders").querySelectorAll("input").forEach(i => i.oninput = () => {
    state.weights = state.weights || {...META.presets[state.preset]};
    state.weights[i.dataset.k] = +i.value;
    $("#v_"+i.dataset.k).textContent = i.value;
    buildPresets(); load();
  });
}

/* ── 条件チップ ───────────────────────── */
/* 「条件」は科目の属性（出席なし・持ち込み可…）で、「口コミあり」はデータの
   出所の話。種類が違うので枠を分けて描く。server.py の CONDITIONS には両方
   入っていて cond= の値としては同じ扱いなので、分けるのはこの描画だけ。
   ここに名前を足すと「条件」から「口コミ」の枠へ移る。 */
const TRUST_CONDS = ["口コミあり"];

function chipRow(el, names, facets){
  el.innerHTML = names.map(c =>
    `<button class="chip${state.cond.has(c)?" on":""}" data-c="${esc(c)}">${esc(c)}<span class="n">${facets?.[c] ?? 0}</span></button>`).join("");
  el.querySelectorAll("button").forEach(b => b.onclick = () => {
    const c = b.dataset.c;
    state.cond.has(c) ? state.cond.delete(c) : state.cond.add(c);
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
const CONF = {high:"情報は揃っている", mid:"情報は一部のみ", low:"情報がほとんど無い"};
const FIELD_JA = {eval_ratio:"成績評価の内訳", report_count:"レポート本数",
  out_of_class_hours:"時間外学習", capacity:"定員", class_format:"授業形態", day_period:"曜限"};

function axRow(key, a, label){
  if (a.value === null)
    return `<div class="ax"><div class="l">${esc(label)}</div>
      <div class="miss" style="grid-column:2/4">データなし ― 相性の計算から除外</div></div>`;
  const cls = a.value >= 66 ? "" : a.value >= 45 ? "m" : "w";
  return `<div class="ax"><div class="l">${esc(label)}</div>
      <div class="track"><div class="fill ${cls}" style="width:${a.value}%"></div></div>
      <div class="v">${a.value.toFixed(0)}</div>
      ${a.evidence.length ? `<div class="why">${a.evidence.map(esc).join(" ／ ")}</div>` : ""}</div>`;
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

/* 口コミの件数表示。採点に効いているかで見た目を分ける。
   ・効いていない（scored:false）… 幅いっぱいの注意帯。中身への導線つき
   ・効いている（scored:true）  … 従来どおりのバッジ
   1つの関数にまとめてあるのは、門を越える科目が出てきたときに
   「両方出る」「どちらも出ない」を作らないため（松下さんの仕様書どおり）。

   導線の文言は PC とスマホで出し分ける。PC は詳細が右カラムに出る
   （決定A）ので「タップ」「↓」が指す先が無い。幅が変わったときは
   mqDesktop の change で今のページを描き直して合わせる。 */
function goText(){
  return isDesktop() ? "詳細を開いて1件ずつ読む →" : "タップして中身を見る ↓";
}

function reviewMark(rv){
  if (!rv?.n) return { badge:"", alert:"" };
  if (rv.scored) return { badge:`<span class="rvb">口コミ ${rv.n}件</span>`, alert:"" };
  return { badge:"", alert:`<div class="rvAlert"><i>⚠</i><div>口コミ ${rv.n}件 ―
      まだ数字には入っていません。中身を確認してください<span class="go">${esc(goText())}</span></div></div>` };
}

function card(c){
  const r = c.rakutan, m = c.match;
  const dp = c.day_period || (c.term === "集中" ? "集中" : "—");
  const tags = [...r.tags, ...r.notes];
  const rv = reviewMark(c.reviews);
  const fav = rkStore.isFavorite(c.id);
  return `<article class="card${rv.alert ? " unscored" : ""}" data-id="${esc(c.id)}">
    <div class="head" role="button" tabindex="0">
      <div>
        <h3 class="title">${esc(c.title)}</h3>
        <div class="meta"><span>${esc(dp)}</span>${insMetaSpan(c)}<span>${esc(c.campus||"—")}</span><span>${esc(c.category)}</span></div>
        ${rv.badge}
      </div>
      <div class="fit"><b>${m.fit ?? "—"}</b><small>相性</small></div>
      <div class="reason"><span class="band b${BAND_CLS[r.band] ?? 0}">${esc(r.band)}</span>${esc(m.reason)}
        ${r.needs_review ? `<span class="bandNote">テストの難しさは誰も確認していません</span>` : ""}</div>
      ${rv.alert}
      ${tags.length ? `<div class="tags">${tags.slice(0,4).map(t=>`<span class="tag${r.notes.includes(t)?" g":""}">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
    <button class="favBtn" data-id="${esc(c.id)}" aria-pressed="${fav}"
            aria-label="お気に入り：${esc(c.title)}">${fav ? "★" : "☆"}</button>
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
const koanUrl = id => `https://koan.osaka-u.ac.jp/campusweb/campussquare.do?_flowId=SYW4201600-flow&nendo=2026&j_s_cd=13&j_cd=${encodeURIComponent(id)}&langkbn=j`;

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
  const notes = r.notes || [];
  return `<div class="rv">
      <div class="rvh">口コミ<b>${r.n}件</b>
        <span>定員・レポートの分量・テストの難しさは KOAN に書いていない。ここだけが情報源。</span></div>
      ${notes.length ? `<ul class="rvn">${notes.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      <div class="rvf">${f.map(([k, v]) => `<span><i>${esc(k)}</i>${esc(v)}</span>`).join("")}</div>
      <span class="bandNote">数字は${r.n}件の平均。出席は 0 なし〜2 毎回、課題は 0 軽い〜2 重い${
        r.conflicts?.length ? "。<b>答えが割れている項目があります</b>ので、下の1件ずつを読んでください" : ""}</span>
    </div>`;
}

function detailHtml(c){
  const r = c.rakutan;
  const names = instructors(c);   // showDetail の ins（#inspector）とは別物
  /* 全員をここに出す。見出しは「ほかN名」で畳んであるので、
     複数担当のコマは詳細を開かないと誰が出るのか分からない。
     氏名ごとに nowrap を掛けるのは、姓と名の間が全角空白で、
     そこで折り返されると「モ／ハーチ ゲルゲイ」のように人名が割れるため。

     入れ物が <span> でないのは、app.css の .meta span+span::before が
     「・」を自動で足してしまい、その「・」が nowrap の内側に入るから。
     「・」は行頭に来られない文字（行頭禁則）なので、直前でも改行できず、
     16名の科目で一行が右へ突き抜ける（実測 2026-08-25）。
     区切りを自分で書ける <bdi> にしたうえで、「・」の後ろに <wbr> を置く
     （nowrap の外に改行機会を作らないと、Chromium は要素の境目でも折り返さない）。 */
  const insHtml = names.map(n => `<bdi style="white-space:nowrap">${esc(n)}</bdi>`).join("・<wbr>");
  return `${names.length ? `<div class="meta">担当教員：${insHtml}</div>` : ""}
      ${Object.entries(META.axis_labels).map(([k,l]) => axRow(k, r.axes[k], l)).join("")}
      <div class="conf">${esc(CONF[r.confidence.level])}（6項目中${r.confidence.known}項目）
        ${r.confidence.missing.length ? `／ 未取得：<b>${r.confidence.missing.map(f=>esc(FIELD_JA[f]||f)).join("、")}</b>` : ""}
      </div>
      ${reviewHtml(c)}
      ${c.reviews?.n ? `<button class="panelBtn" data-id="${esc(c.id)}">口コミを見る（${c.reviews.n}件）</button>` : ""}
      <a class="koanLink" href="${esc(koanUrl(c.id))}" target="_blank" rel="noopener noreferrer">この科目のKOAN公式シラバスを見る ↗</a>
      <button class="reviewBtn" data-id="${esc(c.id)}">この科目の口コミを書く</button>
      <button class="favBtn" data-id="${esc(c.id)}" aria-pressed="${rkStore.isFavorite(c.id)}"
              aria-label="お気に入り：${esc(c.title)}">${rkStore.isFavorite(c.id) ? "★" : "☆"}</button>`;
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
  reviewsCache = await (await fetch("data/reviews.built.json")).json();
  return reviewsCache;
}

// 課題の軽重は rvLv（集計側と同じ）を使い回す。同じ対応表を2つ持たない。
const attFull = v => (v === null || v === undefined) ? "―" : RV_ATT[Math.round(v)];

/* null は「―」のまま出す。埋めると「無回答だった」という情報が消える。
   .pReport（通報リンク）は入れていない ―― 通報フォームの URL がまだ無い。 */
function panelEntry(row){
  const curYear = new Date().getFullYear();
  const yearLabel = row.taken_year == null ? "受講時期不明"
    : row.taken_year_before ? `${row.taken_year}年以前に受講` : `${row.taken_year}年受講`;
  const age = row.taken_year == null ? 0 : curYear - row.taken_year;
  const old = row.taken_year != null && age >= 3;

  const examBits = [];
  if (row.exam_hard10 != null) examBits.push(`テスト ${row.exam_hard10}/10`);
  if (row.exam_bring)          examBits.push(`持ち込み ${row.exam_bring}`);

  const lines = [`出席 ${attFull(row.attendance)} ／ 授業中の課題 ${rvLv(row.in_class)} ／ 授業外の課題 ${rvLv(row.out_class)}`];
  if (examBits.length) lines.push(examBits.join(" ・ "));
  if (row.report_words != null) lines.push(`レポート 1本あたり約${row.report_words.toLocaleString()}字`);

  return `<div class="pEntry">
      <div class="pYear">${esc(yearLabel)}${old ? `<span class="pOld">${age}年前の情報</span>` : ""}</div>
      ${lines.map(l => `<div class="pLine">${esc(l)}</div>`).join("")}
      ${row.note ? `<div class="pNote">${esc(row.note)}</div>` : ""}
    </div>`;
}

async function panelListHtml(id){
  const all = await fetchReviewsData();
  const rows = all[id] || [];
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
const CONDITIONS = {
  "出席なし":     c => (c.eval_ratio || {}).attendance === 0,
  "レポートのみ": c => (c.eval_ratio || {}).exam === 0,
  "持ち込み可":   c => c.exam_type === "持込可",
  "1限以外":      c => !/1$/.test(c.day_period || ""),
  "集中講義":     c => c.class_format === "集中講義",
  "小テストなし": c => c.weekly_quiz === false,
  "口コミあり":   c => ((c.reviews || {}).n || 0) > 0,
};

/* score.py の match() と同じ。内積と理由文だけで、判断は入っていない。 */
function matchLocal(r, w){
  // score.py の match() と同じゲート。総合値を出さない科目には相性も出さない。
  if (r.overall === null || r.overall === undefined)
    return { fit:null, reason:`判定に必要な情報が足りていません。口コミが${minForScoring()}件そろうと出ます。`,
             weights:w, labels:META.axis_labels };
  const axes = r.axes;
  let total = 0, wsum = 0;
  for (const [k, weight] of Object.entries(w)){
    const v = (axes[k] || {}).value;
    if (v !== null && v !== undefined && weight > 0){ total += v * weight; wsum += weight; }
  }
  const fit = wsum > 0 ? Math.round(total / wsum) : null;

  const good = [], bad = [];
  for (const [k, weight] of Object.entries(w).sort((a,b) => b[1]-a[1])){
    const v = (axes[k] || {}).value;
    if (v === null || v === undefined || weight < 3) continue;
    if (v >= 66) good.push(META.axis_labels[k]);
    else if (v < 45) bad.push(META.axis_labels[k]);
  }
  const parts = [];
  if (good.length) parts.push(`あなたが重視する${good.slice(0,2).join("・")}を満たしています。`);
  if (bad.length)  parts.push(`一方で${bad.slice(0,2).join("・")}は期待できません。`);
  if (!parts.length) parts.push("重視している条件については、この科目は平均的です。");
  return { fit, reason: parts.join(""), weights: w, labels: META.axis_labels };
}

/* server.py の search() と同じ手順。
   空きコマと条件チップの件数は曜限フィルタ「前」で数える。
   そうしないとコマを押した瞬間に他のコマが全部0件になり、次の一手が打てない。 */
function queryLocal(){
  const w = state.weights || META.presets[state.preset] || META.presets["とにかく軽い"];
  const conds = [...state.cond].filter(k => k in CONDITIONS);
  const trackAxis = state.track ? state.track.split(":")[0] + ":" : "";

  const base = [];
  for (const c of DATA.courses){
    if (state.q && !norm(c.title).includes(norm(state.q))) continue;
    if (state.year !== "all" && !(c.eligible_years || []).includes(+state.year)) continue;
    // full（通年）はどちらの学期でも履修できるので必ず通す。
    if (state.sem !== "all" && c.term_group !== state.sem && c.term_group !== "full") continue;
    if (conds.some(k => !CONDITIONS[k](c))) continue;
    // トラック（専攻語・学科）は同じ軸の中でだけ効かせる。トラックを持たない
    // 科目（共通教育・学部共通など）は通す ―― 落とすと上段の共通区分が
    // まるごと0件になる。
    if (trackAxis && c.track && c.track.startsWith(trackAxis) && c.track !== state.track) continue;
    base.push({ ...c, match: matchLocal(c.rakutan, w) });
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
  /* 相性順。同点や未算出のときの並びをここで1回決め、他の並び替えの
     第2キーとしても使う（同じ件数の科目が毎回違う順に出ないように）。 */
  const byFit = (a,b) => (nul(a.match.fit) - nul(b.match.fit))
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
    results.sort(byFit);

  return { count: results.length, results, slots, facets, weights: w,
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
  const d = await (await fetch("data/courses.built.json")).json();
  DATA.courses = d.courses;
  // 要件表が無くても他は全部動く。学部のセクションが出ないだけ。
  try { REQ = await (await fetch("data/requirements.json")).json(); }
  catch (e) { REQ = null; }
  const m = d._meta;
  META = {
    categories: [...new Set(d.courses.map(c => c.category))].sort(),
    campuses:   [...new Set(d.courses.map(c => c.campus).filter(Boolean))].sort(),
    terms:      [...new Set(d.courses.map(c => c.term))].sort(),
    days: ["月","火","水","木","金"], periods: ["1","2","3","4","5","6"],
    weights: m.weights, conditions: Object.keys(CONDITIONS),
    presets: m.presets, axis_labels: m.axis_label,
    min_for_scoring: m.min_for_scoring,
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
        <h3>${esc(c.title)}</h3>
        <div class="meta"><span>${esc(dp)}</span>${insMetaSpan(c)}<span>${esc(c.campus||"—")}</span><span>${esc(c.category)}</span></div>
      </div><div class="detail">${detailHtml(c)}</div>`;
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

/* 増えた分のカードだけにクリック判定を付ける。以前は呼ばれるたびに
   #list 内の表示済みカード全部を数え直していたため、スクロールで
   読み込みが進むほど1回あたりの作業量が増えていた（雪だるま式）。 */
function bindCardHandler(article, c){
  const h = article.querySelector(".head");
  const t = () => showDetail(c, article);
  h.onclick = t;
  h.onkeydown = e => { if (e.key==="Enter"||e.key===" "){ e.preventDefault(); t(); } };
}

/* 画面幅が変わったとき（PC で窓を縮めた・スマホを回した）に、
   詳細がどちらにも出ていない状態にならないよう描き直す。 */
mqDesktop.addEventListener("change", () => {
  // 注意帯の導線（.go）は PC とスマホで文言が違う。幅が変わったら
  // 今のページを描き直して合わせる ―― カードは load() のときにしか
  // 作らないので、これが無いと「タップして…↓」が PC に残る。
  if (courses.length) renderPage(page);
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
 * 何のためか: **Android の戻るボタン**。全画面のシートが開いた状態で
 * 戻るを押すと、履歴に何も積んでいなければページごと離脱する。
 * 口コミを読みに来た人が一覧を失う。おまけで ?c=<id> の共有もできる。
 *
 * 勘所は「閉じる手段を全部 history.back() 経由にまとめ、実際に閉じる処理は
 * popstate の1箇所だけにする」こと。バラバラに書くと「✕では消えるが
 * 戻るボタンでは消えない」のような手段ごとの食い違いが必ず出る。
 *
 * 置き場所は決定A ―― PC は右カラムの詳細の下に展開、スマホは全画面シート。
 * 組み立てる関数（panelListHtml）は1本のまま、差し込み先だけ変える。
 * PC でも履歴に積む（2026-08-24 決定）。戻るの意味が両方で
 * 「1つ前の状態に戻る」に揃い、共有リンクも両方で効く。
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

/* PC の .panelBtn は右カラム（#inspector）の中。スマホはカードの .detail の中。
   両方に同じ data-id のボタンが居ることは無いが、探す順を決めておく。 */
const panelBtnFor = id =>
  $(`#inspector .panelBtn[data-id="${CSS.escape(id)}"]`)
  || document.querySelector(`.panelBtn[data-id="${CSS.escape(id)}"]`);

/* 閉じるのはここ1箇所だけ。popstate から呼ばれる。
   PC/スマホのどちらで開いていたか覚えずに、両方の跡地を片付ける
   ―― 開いたあとに幅が変わっていることがあるため。 */
function panelSetOpen(open){
  if (open) return;                       // 開くのは openPanel の仕事
  $("#panel").classList.remove("open");
  $("#panelBody").innerHTML = "";
  document.querySelectorAll(".pList").forEach(el => el.remove());
  document.querySelectorAll(".panelBtn").forEach(b => {
    const c = courses.find(x => x.id === b.dataset.id);
    if (c?.reviews?.n) b.textContent = `口コミを見る（${c.reviews.n}件）`;
    b.setAttribute("aria-expanded", "false");
  });
}

async function openPanel(id, push = true){
  const c = await findCourse(id);
  if (!c) return;

  if (push){
    const url = new URL(location.href);
    url.searchParams.set("c", id);
    history.pushState({ panelCourse: id }, "", url);
  }

  const html = await panelListHtml(id);

  if (isDesktop()){
    // 共有リンクで入ってきた人の右カラムは空。リストを挿す前に詳細を出す。
    // article は見つからなくて構わない（showDetail は undefined でも動く。
    // カードの選択ハイライトが付かないだけ）。
    if (selectedCourseId !== id){
      const article = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      showDetail(c, article);
    }
    const btn = panelBtnFor(id);
    if (!btn) return;
    btn.insertAdjacentHTML("afterend", html);
    btn.textContent = "閉じる";
    btn.setAttribute("aria-expanded", "true");
    return;
  }

  $("#panelTitle").textContent = c.title;
  $("#panelBody").innerHTML = html;
  $("#panel").classList.add("open");
}

function closePanel(){
  // 開いたときに積んだ履歴を1つ戻すだけ。閉じる本体は popstate 側。
  if (new URL(location.href).searchParams.get("c")) history.back();
  else panelSetOpen(false);
}

window.addEventListener("popstate", () => {
  const id = new URL(location.href).searchParams.get("c");
  if (id) openPanel(id, false); else panelSetOpen(false);
});

/* 幕は #panel 自身（投稿フォームと同じ .sheet を使い回しているので
   別の .panelOv は無い）。#panel のクリックには2つの役割が乗るため、
   e.target の判定を入れないとリストの中を触るだけで閉じる。 */
$("#panelClose").onclick = closePanel;
$("#panel").onclick = e => { if (e.target === $("#panel")) closePanel(); };
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if ($("#panel").classList.contains("open")
      || document.querySelector(".pList")) closePanel();
});

["#list", "#inspector"].forEach(sel => {
  $(sel).addEventListener("click", e => {
    const btn = e.target.closest(".panelBtn");
    if (!btn) return;
    // 開いているものをもう一度押したら閉じる
    if (btn.getAttribute("aria-expanded") === "true") closePanel();
    else openPanel(btn.dataset.id);
  });
});

/* ── 一覧のページング ───────────────────
 * 無限スクロールをやめた理由：
 * 1,112件が終わりなく流れるだけで、終点も現在位置も分からなかった。
 * それに「1,112件」を平らに並べること自体が
 * 「あなたが1,112件を見比べてください」という意味になっていた。
 * このサービスの価値は、絞ったことのほうにある。
 */
let page = 1;

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
  const total = Math.ceil(courses.length / PAGE_SIZE) || 1;
  page = Math.max(1, Math.min(n, total));
  const list = $("#list");
  list.innerHTML = "";

  if (page === 1){
    const picks = topPicks();
    if (picks.length){
      const box = document.createElement("section");
      box.className = "picks";
      box.innerHTML = `<h2 class="picksH">あなたに合う${picks.length}件` +
        `<span class="sub">人が確認ずみの科目から</span></h2>`;
      appendCards(box, picks);
      list.appendChild(box);
    }
  }

  const start = (page - 1) * PAGE_SIZE;
  appendCards(list, courses.slice(start, start + PAGE_SIZE));
  renderPager();

  /* 左の絞り込みと右の詳細は sticky なので画面に残る。
     動くのは一覧だけ。ページ全体が飛ぶと、
     いま何で絞っていたのか分からなくなる。 */
  if (scroll) list.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderPager(){
  const el = $("#pager");
  if (!el) return;
  const total = Math.ceil(courses.length / PAGE_SIZE) || 1;
  if (!courses.length || total <= 1){ el.innerHTML = ""; return; }

  const shownTo = Math.min(page * PAGE_SIZE, courses.length);

  /* 1,015件だと43ページになるので、番号を全部は出せない。
     先頭・末尾・現在の前後だけ出して、あいだは「…」で畳む。
     狭い画面では前後1つ（＝最大9個）まで。390px でも1行に収まる幅。 */
  const w = window.innerWidth < 480 ? 1 : 2;
  const nums = [];
  for (let i = 1; i <= total; i++){
    if (i === 1 || i === total || Math.abs(i - page) <= w) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  const arrow = (to, label, sign, off) =>
    `<button class="pn nav" data-p="${to}"${off ? " disabled" : ""} ` +
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
  if (d.count){
    renderPage(1);
  } else {
    $("#list").innerHTML =
      `<div class="empty">条件に合う科目がありません。<br>条件チップを外すか、別のコマを押してみてください。</div>`;
    renderPager();
  }
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
/* 口コミボタンは #list だけに委譲していたが、PC では詳細が
   右カラムに出るので、そちらでも拾えるようにする。 */
["#list", "#inspector"].forEach(sel => {
  $(sel).addEventListener("click", e => {
    const btn = e.target.closest(".reviewBtn");
    if (btn) openReviewFor(btn.dataset.id);
  });
});
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
     保存済みのプロフィールより優先される。 */
  {
    const urlParams = new URL(location.href).searchParams;
    const profile = rkStore.getProfile();
    if (urlParams.has("faculty")) state.faculty = urlParams.get("faculty");
    else if (profile.faculty) state.faculty = profile.faculty;
    if (urlParams.has("year")) state.year = urlParams.get("year");
    else if (profile.grade) state.year = profile.grade;
  }

  $("#note").textContent = META.disclaimer;
  buildSems(); buildYears(); buildPresets(); buildSliders();
  buildYearRow(); buildHardSelect();
  $("#tog").onclick = () => {
    const o = $("#sliders").classList.toggle("open");
    $("#tog").textContent = o ? "スライダーを閉じる" : "スライダーで細かく調整する";
  };
  let t; $("#q").oninput = e => { clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value; load(); }, 200); };
  $("#sort").onchange = e => { state.sort = e.target.value; load(); };
  /* 開屏の問診の答え。絞り込みに即あてて描き直す ――
     答えたのに画面が変わらないと、聞かれ損になる。 */
  window.addEventListener("rk:profile-set", e => {
    const { faculty, grade } = e.detail || {};
    if (faculty) state.faculty = faculty;
    if (grade) state.year = grade;
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
   1枚ずつに onclick を付けず、親で受ける（.panelBtn と同じ型）。 */
for (const sel of ["#list", "#inspector"]) {
  $(sel).addEventListener("click", e => {
    const btn = e.target.closest(".favBtn");
    if (!btn) return;
    const now = rkStore.toggleFavorite(btn.dataset.id);
    /* 一覧と詳細に同じ科目の星が同時に出ていることがある。両方直す。 */
    document.querySelectorAll(`.favBtn[data-id="${CSS.escape(btn.dataset.id)}"]`)
      .forEach(b => { b.setAttribute("aria-pressed", String(now));
                      b.textContent = now ? "★" : "☆"; });
  });
}

/* 画面幅で出す番号の数を変えているので、幅が変わったら描き直す。
   スマホを横にしたときに「…」の畳み方が古いままになるのを防ぐ。 */
window.addEventListener("resize", () => { if (courses.length) renderPager(); });
