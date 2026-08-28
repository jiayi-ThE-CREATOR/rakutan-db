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
  /* <dialog> の背景（::backdrop）はクリックイベントの標的にならず、代わりに
     dialog 要素自身がクリックを受け取る。中身（h3・input・div・button）を
     クリックしたときは target がその子要素になるので、target===currentTarget
     （＝ dialog 自身をクリックした＝背景）のときだけ閉じる。 */
  $("#mpPicker").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) $("#mpPicker").close();
  });

  $("#mpAllCal").onclick = () => {
    const tt = rkStore.getTimetable(term);
    const ids = [...new Set(Object.values(tt.slots))];
    const courses = ids.map(id => BY_ID.get(id)).filter(Boolean);
    if (!courses.length){ alert("時間割にまだ科目が入っていません。"); return; }
    openCalAdd(courses);
  };
  $("#mpCalAddDlg").querySelectorAll(".mpCalOpt").forEach(btn => {
    btn.onclick = () => onCalAddMethod(btn.dataset.method);
  });
  $("#mpCalAddClose").onclick = () => $("#mpCalAddDlg").close();
  $("#mpCalAddDlg").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) $("#mpCalAddDlg").close();
  });

  $("#mpCalDelDlg").querySelectorAll("[data-open]").forEach(btn => {
    btn.onclick = () => window.open(calViewUrl(btn.dataset.open, calDlgCourses[0]), "_blank", "noopener");
  });
  $("#mpCalDelForget").onclick = () => {
    rkStore.unmarkCalAdded(calDlgCourses[0].id);
    $("#mpCalDelDlg").close();
    renderTimetable();
  };
  $("#mpCalDelDlg").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) $("#mpCalDelDlg").close();
  });
}

function buildProfile(){
  const p = rkStore.getProfile();
  $("#mpFaculty").innerHTML =
    `<option value="">選ばない</option>` +
    /* requirements.json 由来でも app.js の buildFaculty と同じく esc() を通す
       （final-review.md §6：写した元は esc していたのに写し先が落としていた）。 */
    REQ.faculties.map(f => `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join("");
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
   kuchikomi の spring / autumn とは別語彙。混ぜないこと。

   unknown（282件）も両学期に通す。データが「学期が分からない」と
   言っているだけで「他方の学期だ」とは言っていない。unknown を
   どちらの学期からも弾くと、inTerm が両方 false を返し、
   renderFavorites はどちらの学期でも「もう一方に切り替えると入れられます」と
   出す ―― これは実際には確認していない、事実でない断定になる
   （final-review.md §3-①。切り替えても入れられないので、案内としても外れる）。
   時間割に入れる手立てが1つも無くなる方が
   実害も大きいので、full と同じ扱いで両学期へ通す。 */
const TERMS = [["aki","秋・冬学期"],["haru","春・夏学期"]];
const TERM_GROUPS = { haru:["haru","full","unknown"], aki:["aki","full","unknown"] };

function buildTerms(){
  $("#mpTerms").innerHTML = TERMS.map(([v,label]) =>
    `<button class="chip${term===v?" on":""}" data-term="${v}">${label}</button>`).join("");
  $("#mpTerms").querySelectorAll("button").forEach(b => b.onclick = () => {
    term = b.dataset.term; buildTerms(); renderTimetable();
  });
}

function inTerm(c){ return TERM_GROUPS[term].includes(c.term_group); }

/* ── カレンダー連携 ──────────────────────────────────────
 * 1〜6限の時刻・学期の開始日終了日は、本人（松下）が2026-08-27に共有した
 * 全学共通教育の公式資料（授業開始・終了時間の表／令和8年度学年暦）どおり。
 * TERM_RANGE は「令和8年度」の日付なので、年度が変わったら要更新
 * （2027年度の学年暦が出たらここだけ差し替える）。
 *
 * 祝日・大学祭による休講日は、2026-08-27時点では「学年暦の画像1枚だけでは
 * 正確に拾いきれない」という理由で保留にしていたが、2026-08-28にCELAS発行の
 * 全学共通教育学年暦（丸数字＝授業週番号の有無というPDF自身のルール）で
 * 本人が確定させたため、秋・冬学期（aki）分のみ対応した（下記 HOLIDAYS）。
 *
 * 振替授業日（金曜だが月曜の時間割で授業、等）も同じ学年暦から確定させ、
 * 2026-08-29に対応した（下記 TRANSFERS）。休講日と違い、元の曜日の通常回を
 * 止める（EXDATE）のと、振替先の曜日の授業を単発で追加する、の両方が要る。
 *
 * 春・夏学期（haru）は休講日・振替日とも未収集で今回のスコープ外。
 */
const PERIOD_TIMES = {
  "1": [8, 50, 10, 20], "2": [10, 30, 12, 0], "3": [13, 30, 15, 0],
  "4": [15, 10, 16, 40], "5": [16, 50, 18, 20], "6": [18, 30, 20, 0],
};
const DAY_INDEX = { "月": 1, "火": 2, "水": 3, "木": 4, "金": 5 };
const ICS_BYDAY = { "月": "MO", "火": "TU", "水": "WE", "木": "TH", "金": "FR" };
/* 「秋・冬学期」は秋学期(10/1〜12/2)と冬学期(12/3〜3/31)を合わせた期間、
   「春・夏学期」は春学期(4/1〜6/14)と夏学期(6/15〜9/30)を合わせた期間
   ―― マイページの学期タブ（aki/haru）と同じ2分割に合わせてある。 */
const TERM_RANGE = {
  haru: { start: [2026, 4, 1],  end: [2026, 9, 30] },
  aki:  { start: [2026, 10, 1], end: [2027, 3, 31] },
};
// 秋・冬学期の休講日（丸数字なし＝授業日として扱われていない日）。CELAS発行の
// 全学共通教育学年暦（R8_gakunenreki.pdf）を本人が2026-08-28に確認して確定。
// haruは未収集（今回のスコープ外。集めたらここに追加する）。
const HOLIDAYS = {
  aki: ["20261012", "20261102", "20261103", "20261104", "20261123",
        "20261228", "20261229", "20261230", "20261231",
        "20270101", "20270111", "20270115", "20270204"],
  haru: [],
};
// 振替授業日。date=実際の暦日、asDay=その日に実施される時間割の曜日
// （date自体の曜日の授業はその日休みになり、asDayの授業が単発で入る）。
// CELAS学年暦（R8_gakunenreki.pdf）に明記の2件。haruは未収集。
const TRANSFERS = {
  aki: [
    { date: "20261016", asDay: "月" },
    { date: "20261105", asDay: "月" },
  ],
  haru: [],
};
// 冬学期は2/9以降が春休みのため、繰り返し予定はここで打ち切る（本人確認・2026-08-28）。
// TERM_RANGE.aki.end（3/31）は学期の枠自体なので変えない。こちらは「実際に授業がある最後の日」。
const CAL_SYNC_UNTIL = { aki: [2027, 2, 8], haru: null };
const pad2 = (n) => String(n).padStart(2, "0");

function termBounds(termKey){
  const r = TERM_RANGE[termKey] || TERM_RANGE.aki;
  return {
    start: new Date(r.start[0], r.start[1] - 1, r.start[2], 0, 0, 0),
    end:   new Date(r.end[0],   r.end[1] - 1,   r.end[2],   23, 59, 0),
  };
}
// 繰り返し予定を止める日。CAL_SYNC_UNTIL が無い学期（haru等）はこれまで通り学期末を使う。
function calUntil(termKey){
  const until = CAL_SYNC_UNTIL[termKey];
  return until
    ? new Date(until[0], until[1] - 1, until[2], 23, 59, 0)
    : termBounds(termKey).end;
}

const REV_DAY_INDEX = Object.fromEntries(Object.entries(DAY_INDEX).map(([k, v]) => [v, k]));
function isHoliday(d, termKey){
  const key = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  return (HOLIDAYS[termKey] || []).includes(key);
}
/* その曜日の休講日を、blockの開始時刻を持つDateにして返す。EXDATEの値は
   DTSTARTと同じ「日付+時刻」の形でないと、そのタイミングの回が一致除外にならない。 */
function holidayDatesForDay(dayChar, termKey, hh, mm){
  return (HOLIDAYS[termKey] || [])
    .map(k => new Date(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)), hh, mm, 0))
    .filter(d => REV_DAY_INDEX[d.getDay()] === dayChar);
}
function dateFromKey(key, hh, mm){
  return new Date(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)), hh, mm, 0);
}
// 振替日で「元の曜日の通常回」を止めるための日付（block.dayが実施日自身の
// 曜日で、asDayと違う場合＝その日の通常授業は休みになる）。
function transferSuspendDatesForDay(dayChar, termKey, hh, mm){
  return (TRANSFERS[termKey] || [])
    .filter(t => t.asDay !== dayChar)
    .map(t => dateFromKey(t.date, hh, mm))
    .filter(d => REV_DAY_INDEX[d.getDay()] === dayChar);
}
// 「asDayの授業がこの実施日に単発で追加される」対象日（block.day === asDay の科目向け）。
function transferExtraDatesForDay(dayChar, termKey){
  return (TRANSFERS[termKey] || [])
    .filter(t => t.asDay === dayChar)
    .map(t => t.date);
}

/* その曜日がいちばん早く来る日時。学期がまだ始まっていなければ学期の
   開始日を起点にする（そうしないと、学期が始まる前にこの機能を使うと
   「今週の月曜」のような学期外の日が最初の予定になってしまう）。
   学期が始まっていれば今日が起点。今日がその曜日でも、もう開始時刻を
   過ぎていれば1週間先にする。休講日に当たった場合は1週間ずつ先送りする
   （Outlookは繰り返し非対応で、この最初の1回しか予定を作らないため、
   ここで避けておかないと単発予定がそのまま休講日に乗ってしまう）。 */
function nextDateFor(dayChar, hh, mm){
  const want = DAY_INDEX[dayChar];
  const now = new Date();
  const { start } = termBounds(term);
  const floor = now > start ? now : start;
  let diff = (want - floor.getDay() + 7) % 7;
  const d = new Date(floor.getFullYear(), floor.getMonth(), floor.getDate(), hh, mm, 0);
  if (diff === 0 && d.getTime() <= now.getTime()) diff = 7;
  d.setDate(d.getDate() + diff);
  while (isHoliday(d, term)) d.setDate(d.getDate() + 7);
  return d;
}
/* タイムゾーン付き（Z・TZID）にせず、そのまま「その時刻」として書き出す。
   ほぼ全員が日本時間で見る前提なら、これが一番事故りにくい。 */
function fmtICS(d){
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
       + `T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}
function icsEscape(s){
  return String(s).replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
}

/* 同じ科目・同じ曜日で連続するコマ（金4・金5・金6 の実験など）を1つの
   予定にまとめる。バラバラにすると、実際は3時間ぶっ通しの授業が
   3つの短い予定に見えてしまう。 */
function courseEventBlocks(c){
  const byDay = {};
  for (const s of (c.slots || [])){
    const day = s[0], period = s.slice(1);
    if (!PERIOD_TIMES[period]) continue;
    (byDay[day] || (byDay[day] = [])).push(Number(period));
  }
  const blocks = [];
  for (const day of Object.keys(byDay)){
    const periods = byDay[day].sort((a, b) => a - b);
    let start = periods[0], prev = periods[0];
    for (let i = 1; i <= periods.length; i++){
      const p = periods[i];
      if (p === prev + 1){ prev = p; continue; }
      blocks.push({ day, startPeriod: String(start), endPeriod: String(prev) });
      start = prev = p;
    }
  }
  return blocks;
}
function blockRange(block){
  const [sh, sm] = PERIOD_TIMES[block.startPeriod];
  const endT = PERIOD_TIMES[block.endPeriod];
  const start = nextDateFor(block.day, sh, sm);
  const end = new Date(start);
  end.setHours(endT[2], endT[3], 0, 0);
  return { start, end };
}
// 振替日にblockの時刻で単発予定を作るときの開始・終了（blockRangeの「次回」計算を迂回し、
// 振替日の暦日をそのまま使う）。
function transferRange(block, dateKey){
  const [sh, sm] = PERIOD_TIMES[block.startPeriod];
  const endT = PERIOD_TIMES[block.endPeriod];
  const start = dateFromKey(dateKey, sh, sm);
  const end = new Date(start);
  end.setHours(endT[2], endT[3], 0, 0);
  return { start, end };
}

function calIconSVG(added){
  return added
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 13.5v5M9.5 16h5"/></svg>`;
}

function icsEvent(c, block){
  const { start, end } = blockRange(block);
  const untilDate = calUntil(term);
  const exdates = [
    ...holidayDatesForDay(block.day, term, start.getHours(), start.getMinutes()),
    ...transferSuspendDatesForDay(block.day, term, start.getHours(), start.getMinutes()),
  ]
    .filter(d => d > start && d <= untilDate)
    .map(fmtICS);
  const desc = c.instructor ? `担当: ${c.instructor}` : "";
  return [
    "BEGIN:VEVENT",
    `UID:${c.id}-${block.day}${block.startPeriod}@rakuhan.nocode-sol.co.jp`,
    `DTSTAMP:${fmtICS(new Date())}`,
    `DTSTART:${fmtICS(start)}`,
    `DTEND:${fmtICS(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${ICS_BYDAY[block.day]};UNTIL=${fmtICS(untilDate)}`,
    exdates.length ? `EXDATE:${exdates.join(",")}` : null,
    `SUMMARY:${icsEscape(c.title)}`,
    desc ? `DESCRIPTION:${icsEscape(desc)}` : null,
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}
/* 振替日にasDay側の授業として単発で入る回。RRULEを持たない1回だけの予定。 */
function icsTransferEvent(c, block, dateKey){
  const { start, end } = transferRange(block, dateKey);
  const desc = c.instructor ? `担当: ${c.instructor}` : "";
  return [
    "BEGIN:VEVENT",
    `UID:${c.id}-${block.day}${block.startPeriod}-transfer-${dateKey}@rakuhan.nocode-sol.co.jp`,
    `DTSTAMP:${fmtICS(new Date())}`,
    `DTSTART:${fmtICS(start)}`,
    `DTEND:${fmtICS(end)}`,
    `SUMMARY:${icsEscape("（振替）" + c.title)}`,
    desc ? `DESCRIPTION:${icsEscape(desc)}` : null,
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}
function buildICS(courses){
  const events = [];
  for (const c of courses){
    for (const b of courseEventBlocks(c)){
      events.push(icsEvent(c, b));
      for (const dateKey of transferExtraDatesForDay(b.day, term)) events.push(icsTransferEvent(c, b, dateKey));
    }
  }
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//rakuhan//mypage//JA", "CALSCALE:GREGORIAN",
    ...events, "END:VCALENDAR",
  ].join("\r\n");
}
function downloadICS(courses, filename){
  const blob = new Blob([buildICS(courses)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* Googleの「予定を追加」URLは recur パラメータで毎週くり返しに対応できる。
   Outlookの簡易リンクは繰り返しに対応していないため次の1回だけになる
   ―― その差はモーダルの説明文（openCalAdd）側で断っている。
   休講日はEXDATEとしてrecurに試験的に足しているが、このURL方式でGoogleが
   EXDATEを解釈するかは未検証（公式ドキュメントに記載が無い）。効かなくても
   外れて事故るわけではなく、休講日にも予定が残るだけなので試験的に入れている。 */
/* range/transfer を渡すと、振替日の単発予定（くり返し無し・タイトルに「（振替）」）を作る。
   省略時はこれまで通り、次回からの毎週くり返し（休講日・振替停止日をEXDATE除外）。 */
function googleUrl(c, block, range, transfer){
  const { start, end } = range || blockRange(block);
  const title = transfer ? `（振替）${c.title}` : c.title;
  const p = new URLSearchParams({
    action: "TEMPLATE", text: title,
    dates: `${fmtICS(start)}/${fmtICS(end)}`,
    ctz: "Asia/Tokyo",
    details: c.instructor ? `担当: ${c.instructor}` : "",
  });
  if (!transfer){
    const untilDate = calUntil(term);
    const exdates = [
      ...holidayDatesForDay(block.day, term, start.getHours(), start.getMinutes()),
      ...transferSuspendDatesForDay(block.day, term, start.getHours(), start.getMinutes()),
    ]
      .filter(d => d > start && d <= untilDate)
      .map(fmtICS);
    const recurLines = [`RRULE:FREQ=WEEKLY;BYDAY=${ICS_BYDAY[block.day]};UNTIL=${fmtICS(untilDate)}`];
    if (exdates.length) recurLines.push(`EXDATE:${exdates.join(",")}`);
    p.set("recur", recurLines.join("\n"));
  }
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
function outlookUrl(host, c, block, range, transfer){
  const { start, end } = range || blockRange(block);
  const subject = transfer ? `（振替）${c.title}` : c.title;
  const p = new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent",
    startdt: start.toISOString(), enddt: end.toISOString(),
    subject, body: c.instructor ? `担当: ${c.instructor}` : "",
  });
  return `https://${host}/calendar/0/deeplink/compose?${p.toString()}`;
}
/* 複数タブを同時に開くとポップアップブロックに引っかかりやすいので、
   少しずつ間隔をあけて開く。 */
function openTabs(urls){
  urls.forEach((u, i) => setTimeout(() => window.open(u, "_blank", "noopener"), i * 350));
}

/* Googleは「その日」を直接開けるURLがあるのでそこへ。Outlookの簡易リンクに
   同等の「特定の日を開く」ものが見当たらなかったため、週表示止まりにしている
   （不確かなURLを作って外れるより、この方が誠実）。iCalは「開く」操作自体が
   無い（ダウンロードしたファイルを取り込んだアプリ側の話になるため）。 */
function calViewUrl(kind, course){
  const b = courseEventBlocks(course)[0];
  const d = b ? blockRange(b).start : new Date();
  if (kind === "google")
    return `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  if (kind === "outlook-personal") return "https://outlook.live.com/calendar/0/view/week";
  if (kind === "outlook-o365") return "https://outlook.office.com/calendar/0/view/week";
}

let calDlgCourses = []; // 開いているカレンダーのダイアログが対象にしている科目（1件 or 複数）

function openCalAdd(courses){
  calDlgCourses = courses;
  const single = courses.length === 1;
  $("#mpCalAddTitle").textContent = single
    ? `${courses[0].title}をカレンダーに追加`
    : `時間割をすべてカレンダーに追加（${courses.length}件）`;
  const tabCount = courses.reduce((n, c) => n + courseEventBlocks(c).reduce((m, b) =>
    m + 1 + transferExtraDatesForDay(b.day, term).length, 0), 0);
  const holidayNote = term === "aki"
    ? "秋・冬学期の祝日・大学行事による休講日は、iCal・Outlookでは予定が入らないようにしています。"
      + "Googleも同様に除外を試みていますが、動作は確認できていません。"
      + "振替授業日（金曜に月曜の授業など）は、元の曜日の予定を止めたうえで振替先の曜日の予定を単発で追加します。"
    : "祝日や大学祭による休講・振替授業日には対応していません。";
  $("#mpCalAddSub").textContent = (single
    ? "追加するカレンダーを選んでください。Outlook/Googleはログイン済みであることを確認してください。組織アカウントの場合はOffice365を選んでください。"
    : `iCalは全コマを1つのファイルにまとめてダウンロードします。Outlook/Googleは科目ごとに追加画面が開きます（この時間割の場合 ${tabCount} 回）。`)
    + " " + holidayNote;
  const toast = $("#mpCalAddToast");
  toast.textContent = "";
  toast.className = "mpCalToast";
  $("#mpCalAddDlg").showModal();
}

function onCalAddMethod(method){
  if (method === "ics"){
    downloadICS(calDlgCourses, calDlgCourses.length === 1 ? `${calDlgCourses[0].title}.ics` : "私の時間割.ics");
  } else {
    const urls = [];
    for (const c of calDlgCourses){
      for (const b of courseEventBlocks(c)){
        if (method === "google") urls.push(googleUrl(c, b));
        else if (method === "outlook-personal") urls.push(outlookUrl("outlook.live.com", c, b));
        else if (method === "outlook-o365") urls.push(outlookUrl("outlook.office.com", c, b));
        for (const dateKey of transferExtraDatesForDay(b.day, term)){
          const range = transferRange(b, dateKey);
          if (method === "google") urls.push(googleUrl(c, b, range, true));
          else if (method === "outlook-personal") urls.push(outlookUrl("outlook.live.com", c, b, range, true));
          else if (method === "outlook-o365") urls.push(outlookUrl("outlook.office.com", c, b, range, true));
        }
      }
    }
    openTabs(urls);
  }
  const label = { ics: "iCal", google: "Google", "outlook-personal": "Outlook（個人）", "outlook-o365": "Outlook（Office365）" }[method];
  const toast = $("#mpCalAddToast");
  toast.textContent = `${label} を開始しました。`;
  toast.classList.add("show");
  for (const c of calDlgCourses) rkStore.markCalAdded(c.id);
  renderTimetable();
}

function openCalDel(course){
  calDlgCourses = [course];
  $("#mpCalDelTitle").textContent = `${course.title}をカレンダーから削除`;
  $("#mpCalDelBody").textContent =
    "サイト側からは、実際のカレンダーに入っている予定を直接は消せない（どの方法で追加したかまでは記録していないため）。"
    + `追加したカレンダーアプリを開いて、そちら側で「${course.title}」の予定を削除してほしい。`;
  $("#mpCalDelDlg").showModal();
}

function renderTimetable(){
  const tt = rkStore.getTimetable(term);
  let html = '<div class="mpH"></div>' + DAYS.map(d=>`<div class="mpH">${d}</div>`).join("");
  for (const p of PERIODS){
    html += `<div class="mpH">${p}</div>`;
    for (const d of DAYS){
      const slot = d + p;
      const id = tt.slots[slot];
      const c = id ? BY_ID.get(id) : null;
      /* 読み上げ利用者には「ボタン」としか聞こえない（aria-label が無いと
         accessible name が空になる）。何曜何限で、何が入っているかを
         1つの文字列にして持たせる。app.js の buildGrid() と同じ考え方。 */
      if (!c){
        html += `<button class="mpCell" data-slot="${slot}" aria-label="${slot} 空き"></button>`;
        continue;
      }
      /* カレンダー追加ボタンは .mpCell（外すボタン）の中には入れない。
         button の中に button を置くと読み上げが崩れるので、.mpCellWrap を
         挟んで兄弟要素にする（mypage.css 参照）。 */
      const added = rkStore.isCalAdded(id);
      html += `<div class="mpCellWrap">`
            + `<button class="mpCell filled" data-slot="${slot}" aria-label="${slot} ${esc(c.title)}">${esc(c.title)}</button>`
            + `<button type="button" class="mpCalBtn${added ? " added" : ""}" data-cal-id="${esc(id)}"`
            + ` aria-label="${esc(c.title)}をカレンダーに${added ? "連携（削除）" : "追加"}">${calIconSVG(added)}</button>`
            + `</div>`;
    }
  }
  $("#mpGrid").innerHTML = html;
  $("#mpGrid").querySelectorAll(".mpCell").forEach(b => b.onclick = () => onCell(b.dataset.slot));
  $("#mpGrid").querySelectorAll(".mpCalBtn").forEach(btn => {
    btn.onclick = () => {
      const c = BY_ID.get(btn.dataset.calId);
      if (!c) return;
      btn.classList.contains("added") ? openCalDel(c) : openCalAdd([c]);
    };
  });
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
       2026-08-27：以前は「1タップで戻せるから」と確認を出していなかったが、
       誤タップで消えたことが分かりにくいという指摘を受けて確認を挟む方針に変えた。 */
    const c = BY_ID.get(id);
    /* BY_ID に無い＝古いデータのまま残った id。せめてクリックしたマスは外す。 */
    const slots = (c && c.slots && c.slots.length) ? c.slots : [slot];
    const label = c ? c.title : id;
    if (!confirm(`「${label}」を時間割から外しますか？`)) return;
    for (const s of slots) rkStore.clearSlot(term, s);
    renderTimetable();
    return;
  }
  openPicker(slot);
}

let pickerList = [];   // 開いている曜限の全候補。検索は絞り込むだけでこれ自体は変えない。

function openPicker(slot){
  pickerList = COURSES.filter(c => inTerm(c) && (c.slots || []).includes(slot));
  $("#mpPickerTitle").textContent = `${slot} の科目`;
  $("#mpPickerSearch").value = "";
  renderPickerList(pickerList, slot, "");
  /* 1文字打つたびに絞り込む。候補が少ない曜限でも入力欄自体は出しておく
     ―― 「検索できない曜限がある」より、常に同じ場所にある方が分かりやすい。 */
  $("#mpPickerSearch").oninput = () => {
    const q = $("#mpPickerSearch").value.trim();
    renderPickerList(q ? pickerList.filter(c => c.title.includes(q)) : pickerList, slot, q);
  };
  $("#mpPicker").showModal();
}

function renderPickerList(list, slot, query){
  /* 「候補が0件」の理由を2通り出し分ける。曜限自体に科目が無いのか、
     検索語に一致しないだけなのかで、次に何をすればいいかが変わるため。 */
  const empty = query
    ? `<p>「${esc(query)}」に一致する科目がありません。</p>`
    : `<p>この学期の ${slot} に科目がありません。</p>`;
  $("#mpPickerList").innerHTML = list.length
    ? list.map(c => `<button class="mpPick" data-id="${esc(c.id)}">
        <b>${esc(c.title)}</b><small>${esc(c.instructor || "―")}</small></button>`).join("")
    : empty;
  $("#mpPickerList").querySelectorAll(".mpPick").forEach(b => b.onclick = () => {
    putCourse(b.dataset.id, slot);
    $("#mpPicker").close();
  });
}

/* 1科目が複数コマを持つとき（金4・金5・金6 の実験など）は全部のマスを埋める。
   1つだけ埋めると、残りのコマが空いているように見えてしまう。
   置き先のどれかに既に別の科目が入っているときは確認する。
   ピッカー（openPicker → onCell が呼ぶ空きマスへの新規配置）・お気に入り
   （renderFavorites の「時間割に入れる」）・科目一覧の詳細パネル（app.js）の、
   入り口が3つとも最終的に rkStore.putCourse を通る。確認ロジックをそこ1箇所に
   まとめたのは、「お気に入り側は聞くのにピッカー側は黙って上書きする」という
   不整合（前タスクのレビュー指摘）を、複数箇所に同じ確認コードをコピーする
   のではなく、通り道を1本にすることで無くすため（2026-08-29: mypage.jsからは
   呼べなかった科目一覧側とも共有できるよう、中身をstore.jsへ移した）。 */
function putCourse(id, slot){
  const c = BY_ID.get(id);
  const placed = rkStore.putCourse([term], c || { id, slots: [] }, slot, tid => (BY_ID.get(tid) || {}).title);
  if (placed) renderTimetable();
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
    /* 学期が合っているかを、曜限の有無より先に見る。
       fix round 1: 曜限なし（extra 行き）の分岐を先に見ると、今見ている
       学期と関係なく addExtra(term, id) が現在の学期の extra に積んでしまい、
       「秋を見ているのに春だけの集中講義が秋の一覧に載る」という、
       このサイトが防ぐべき取り違えそのものを起こしていた
       （コマの分岐は既に inTerm を先に見ていたので、そちらに合わせる）。
       full（通年）は inTerm がどちらの学期でも true を返すので、
       このチェックだけで両学期とも通る。 */
    if (!inTerm(c)){
      /* 星は学期を問わず付けられるが、コマへも extra へも置けるのは
         今見ている学期の科目だけ。黙って無視すると「押しても反応しない」
         に見えるので理由を出す。曜限の有無で文言を変えない
         ―― 同じ状況に2通りの文があると、それ自体が混乱の種になる。

         2026-08-28: 「◯◯学期の科目です」だけだと、次に何をすればいいかが
         書いていない。学期タブは必ず「秋・冬」から始まる（let term = "aki"）ので、
         春・夏の科目しか星を付けていない人は、開いた瞬間ボタンが1つも無い画面を
         見ることになり、本人（松下）が本番で実際に「追加ボタンが無い」と読んだ。
         状態の説明ではなく、上のタブへ誘導する文にする。 */
      action = `<span class="mpNote">${term==="aki"?"春・夏":"秋・冬"}学期に切り替えると入れられます</span>`;
    } else if (!slots.length){
      /* 曜限がマスに置けない1,069件（集中講義・土曜）。extra へ。 */
      const inExtra = tt.extra.includes(id);
      action = inExtra
        ? `<span class="mpIn">時間割に入っています</span>`
        : `<button data-addextra="${esc(id)}">時間割に入れる</button>`;
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
