/* 口コミ投稿（時間割から選ぶ）。
 *
 * 元は別サイト（Netlify）で動いていたものを、そのまま ラクハン の中へ入れた。
 * 設問・保存先（GAS）・localStorage の鍵は当時のまま ―― しゅんやさんが
 * 運用しているスプレッドシートと tools/ingest_reviews.py の列がそこで繋がっている。
 *
 * ■ 変えたのは「科目データの出所」だけ
 * 以前は科目 2,157件がこのファイルに直接書かれていた（1年生用のテンプレート）。
 * そのため 2年生以上と学部の専門科目には投稿しようが無かった。
 * いまは build.py が焼く web/data/timetable.json（全学部・全学年 6,808件）を読む。
 * **この画面には判断を書かない。** どの科目がどの学部のものかは
 * tools/faculty.py が決め、build.py が焼く。ここは絞り込むだけ。
 * （app.js の CONDITIONS と同じ約束。ブラウザ側に規則を持つと必ず漂う）
 *
 * ■ 入口が2つある理由
 * 全7,877件のうち1,069件は曜限がマスに置けない（「他」＝集中講義など1,060件と
 * 土曜9件）。時間割だけを入口にすると、この1,069件には永久に口コミが付かない
 * ―― 理学部は667件中443件がこちらで、学部ごと投稿できなくなる。
 * だから「時間割から選ぶ」と「時間割に無い科目から選ぶ」の2つを置く。
 * 選んだあとの設問・保存・送信は完全に同じ道を通る。
 */

/* ══ 定数 ══════════════════════════════════════════ */

const days = ['月', '火', '水', '木', '金'];
const periods = [1, 2, 3, 4, 5, 6];

/* 口コミの保存先。ここが変わるとスプレッドシートに何も入らなくなる。 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwopsnpuXTF6AS7hSxizw4euceYsD1Z_-FVuK4vxCaZHmosmcn2yBqkolUN3UWjENtZ/exec';

/* 学期 → その学期に履修できる term_group。
   full（通年）はどちらでも履修できるので必ず通す（app.js と同じ扱い）。 */
const TERM_GROUPS = { spring: ['haru', 'full'], autumn: ['aki', 'full'] };

/* 受講した年の選択肢。今年から5年ぶんと「それ以前」。
   **べた書きしない。** 年を書き足す作業を毎年発生させないためと、
   「受講した学年」とモーダルの「2 受講年度」で一覧がずれないため
   （ずれると、上で選んだ年がモーダルの選択肢に無い、という状態になる）。
   値の形（"2026年度" / "2021年度以前"）は、しゅんやさんのシートに
   すでに入っている表記に合わせてある。変えると過去の行と混ざる。 */
function takenYears() {
  const now = new Date().getFullYear();
  const years = [];
  for (let i = 0; i < 5; i++) years.push(`${now - i}年度`);
  years.push(`${now - 5}年度以前`);
  return years;
}

function fillYearSelect(sel, placeholder) {
  sel.innerHTML = '';
  sel.appendChild(new Option(placeholder, ''));
  sel.options[0].disabled = true;
  takenYears().forEach(y => sel.appendChild(new Option(y, y)));
}

/* ══ 状態 ══════════════════════════════════════════ */

const state = {
  semester: null,
  faculty: null,          // requirements.json の faculties[].key
  department: null,       // tracks があれば track キー、無ければ学科名、単一なら 'all'
  selectedSubjects: {},   // key: "dayIndex-periodIndex", value: 科目 + review
};

/* 時間割の元データ。boot() が入れる。 */
let ROWS = [];            // web/data/timetable.json
let FACULTIES = [];       // web/data/requirements.json の faculties
let SLOT_INDEX = new Map(); // "月1" → その枠の科目の配列
let EXTRA = [];           // 曜限がマスに置けない科目（集中講義・土曜）

/* ══ DOM ═══════════════════════════════════════════ */

const els = {
  gradeSelect: document.getElementById('grade-select'),
  semesterSelect: document.getElementById('semester-select'),

  facultySelect: document.getElementById('faculty-select'),
  departmentSelect: document.getElementById('department-select'),
  departmentLabel: document.getElementById('department-label'),
  timetableSection: document.getElementById('timetable-section'),
  timetableGrid: document.getElementById('timetable-grid'),
  submitBtn: document.getElementById('submit-survey'),

  modal: document.getElementById('class-modal'),
  modalTitle: document.getElementById('modal-title'),
  modalSlotInfo: document.getElementById('modal-slot-info'),
  modalSubjectSelect: document.getElementById('modal-subject-select'),
  modalYearSelect: document.getElementById('modal-year-select'),
  reviewQuestions: document.getElementById('review-questions'),
  noSubjectsMsg: document.getElementById('no-subjects-msg'),
  closeModalBtn: document.getElementById('close-modal'),
  clearCellBtn: document.getElementById('clear-cell-btn'),
  saveReviewBtn: document.getElementById('save-review-btn'),

  formButtons: document.querySelectorAll('.form-btn'),
  reportDetailsSection: document.getElementById('report-details-section'),
  reportWordCount: document.getElementById('report-word-count'),
  reportWordDisplay: document.getElementById('report-word-display'),
  commentInput: document.getElementById('comment'),

  attendanceOtherText: document.getElementById('attendance-other-text'),
  examOtherText: document.getElementById('exam-other-text'),
  examDetailsSection: document.getElementById('exam-details-section'),
  examDifficulty: document.getElementById('exam-difficulty'),
  examDifficultyDisplay: document.getElementById('exam-difficulty-display'),

  extraSection: document.getElementById('extra-section'),
  extraSearch: document.getElementById('extra-search'),
  extraSelect: document.getElementById('extra-select'),
  extraCount: document.getElementById('extra-count'),
  extraOpen: document.getElementById('extra-open'),
  extraList: document.getElementById('extra-list'),
  submitArea: document.getElementById('submit-area'),

  loadNote: document.getElementById('load-note'),
  toast: document.getElementById('toast'),
};

/* いま編集しているもの。時間割のマスと「時間割に無い科目」で形が違うので、
   どちらなのかを kind で持つ。key は selectedSubjects の鍵。 */
let currentTarget = null;   // { kind:'slot'|'extra', key, day?, period?, id? }

/* ══ 起動 ══════════════════════════════════════════ */

async function boot() {
  const [rows, req] = await Promise.all([
    fetch('/data/timetable.json').then(r => r.json()),
    fetch('/data/requirements.json').then(r => r.json()),
  ]);
  ROWS = rows;
  FACULTIES = req.faculties || [];

  /* 曜限を持たない科目は時間割に置けない。別の入口へ回す。 */
  EXTRA = ROWS.filter(r => !r.slots.length)
              .sort((a, b) => a.title.localeCompare(b.title, 'ja'));

  /* 枠ごとに引けるようにしておく。マスを開くたびに 6,808件を
     なめると、押した瞬間に固まる。 */
  for (const row of ROWS) {
    for (const slot of row.slots) {   // 曜限が無い科目はここを1周もしない
      if (!SLOT_INDEX.has(slot)) SLOT_INDEX.set(slot, []);
      SLOT_INDEX.get(slot).push(row);
    }
  }
  for (const list of SLOT_INDEX.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  }
}

function init() {
  fillYearSelect(els.gradeSelect, '受講した学年を選択してください');
  fillYearSelect(els.modalYearSelect, '選択してください');

  /* 学部は requirements.json（＝卒業要件表）が正本。ここに一覧を持たない。 */
  FACULTIES.forEach(f => {
    const option = document.createElement('option');
    option.value = f.key;
    option.textContent = f.label;
    els.facultySelect.appendChild(option);
  });

  const savedSettings = JSON.parse(localStorage.getItem('osaka_u_settings') || '{}');
  /* 以前は学年（"2年"）を入れていた。選択肢に無い値をそのまま代入すると
     select は無言で未選択のままになり、「選んだのに送れない」になる。 */
  if (takenYears().includes(savedSettings.grade)) els.gradeSelect.value = savedSettings.grade;
  if (savedSettings.semester) {
    els.semesterSelect.value = savedSettings.semester;
    state.semester = savedSettings.semester;
  }
  if (savedSettings.faculty && FACULTIES.some(f => f.key === savedSettings.faculty)) {
    els.facultySelect.value = savedSettings.faculty;
    state.faculty = savedSettings.faculty;
    fillDepartments(state.faculty);
    if (savedSettings.department
        && [...els.departmentSelect.options].some(o => o.value === savedSettings.department)) {
      els.departmentSelect.value = savedSettings.department;
      state.department = savedSettings.department;
    }
  }

  showPickers();
  checkSubmitReady();

  els.gradeSelect.addEventListener('change', () => {
    /* 受けた年で出る科目は変わらない（シラバスは2026年度ぶんしか無い）ので、
       選びかけの科目は捨てない。捨てると年を選び直しただけで全部消える。 */
    checkSubmitReady();
    saveSettingsToLocal();
  });
  els.semesterSelect.addEventListener('change', handleSemesterChange);
  els.facultySelect.addEventListener('change', handleFacultyChange);
  els.departmentSelect.addEventListener('change', handleDepartmentChange);

  els.closeModalBtn.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();   // 背景クリックで閉じる
  });
  els.clearCellBtn.addEventListener('click', handleClearCell);
  els.saveReviewBtn.addEventListener('click', handleSaveReview);
  els.submitBtn.addEventListener('click', handleSubmit);

  els.formButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const group = e.target.closest('.button-group');
      group.querySelectorAll('.form-btn').forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');

      if (group.id === 'group-report') {
        els.reportDetailsSection.classList.toggle('hidden', e.target.dataset.value !== 'あり');
      }
      if (group.id === 'group-exam-presence') {
        els.examDetailsSection.classList.toggle('hidden', e.target.dataset.value !== 'あり');
      }
      if (group.id === 'group-attendance') {
        const other = e.target.dataset.value === 'その他';
        els.attendanceOtherText.classList.toggle('hidden', !other);
        if (!other) els.attendanceOtherText.value = '';
      }
      if (group.id === 'group-exam') {
        const other = e.target.dataset.value === 'その他';
        els.examOtherText.classList.toggle('hidden', !other);
        if (!other) els.examOtherText.value = '';
      }
      checkModalFormReady();
    });
  });

  els.modalSubjectSelect.addEventListener('change', checkModalFormReady);
  els.modalYearSelect.addEventListener('change', checkModalFormReady);

  /* 時間割に無い科目。理学部4年は1画面に343件出るので、絞り込みが要る。 */
  els.extraSearch.addEventListener('input', renderExtraSelect);
  els.extraSelect.addEventListener('change', () => {
    els.extraOpen.disabled = !els.extraSelect.value;
  });
  els.extraOpen.addEventListener('click', () => {
    if (els.extraSelect.value) openEditor({ kind: 'extra', id: els.extraSelect.value });
  });

  els.reportWordCount.addEventListener('input', (e) => {
    els.reportWordDisplay.textContent = e.target.value;
  });
  els.examDifficulty.addEventListener('input', (e) => {
    els.examDifficultyDisplay.textContent = e.target.value;
  });
}

/* ══ 学部・学科 ═════════════════════════════════════ */

function facultyOf(key) { return FACULTIES.find(f => f.key === key) || null; }

/* 学科の選択肢。3通りある ―― どれを出すかは要件表が持っている情報で決まる。
     ① tracks がある（工学部・外国語学部）… 科目を絞れる。値は track キー
     ② departments がある（理学部・医学部…）… 名前だけで、科目は絞れない
     ③ どちらも無い（文学部・法学部…）      … 「全学科」1つ
   ②で科目を絞らないのは、科目の側に学科の情報が無いから。
   無い情報で絞ると「その学科の科目が0件」という嘘になる。 */
function fillDepartments(facultyKey) {
  const fac = facultyOf(facultyKey);
  const tracks = (fac && fac.tracks) || [];
  const departments = (fac && fac.departments) || [];
  const sel = els.departmentSelect;

  if (tracks.length) {
    els.departmentLabel.textContent = fac.tracks_label || '学科';
    sel.innerHTML = '<option value="" disabled selected>選択してください</option>';
    tracks.forEach(t => sel.appendChild(new Option(t.label, t.key)));
  } else if (departments.length) {
    els.departmentLabel.textContent = '学科';
    sel.innerHTML = '<option value="" disabled selected>学科を選択してください</option>';
    departments.forEach(d => sel.appendChild(new Option(d, d)));
  } else {
    els.departmentLabel.textContent = '学科';
    sel.innerHTML = '';
    sel.appendChild(new Option('全学科', 'all'));
    sel.value = 'all';
    state.department = 'all';
  }
  sel.disabled = false;
}

/* GAS へ送るのは人が読める名前。スプレッドシートを開くのは人なので、
   letters / eng_dept:riko のような内部キーを送らない。 */
function facultyLabel() {
  const fac = facultyOf(state.faculty);
  return fac ? fac.label : '';
}

function departmentLabel() {
  if (!state.department || state.department === 'all') return '全学科';
  const fac = facultyOf(state.faculty);
  const t = ((fac && fac.tracks) || []).find(x => x.key === state.department);
  return t ? t.label : state.department;
}

/* ══ イベントハンドラ ═══════════════════════════════ */

function handleSemesterChange(e) {
  state.semester = e.target.value;
  state.selectedSubjects = {};
  showPickers();
  checkSubmitReady();
  saveSettingsToLocal();
}

function handleFacultyChange(e) {
  state.faculty = e.target.value;
  state.department = null;
  fillDepartments(state.faculty);

  /* 学科が1つしか無い学部は fillDepartments が state.department を確定させている。
     そこまで出しておかないと、選ぶものが無いのに先へ進めない。 */
  state.selectedSubjects = {};
  showPickers();
  checkSubmitReady();
  saveSettingsToLocal();
}

function handleDepartmentChange(e) {
  state.department = e.target.value;
  state.selectedSubjects = {};
  showPickers();
  checkSubmitReady();
  saveSettingsToLocal();
}

/* 学期と学部（＋学科）が揃うまで、選ぶ画面は出さない。
   3か所で同じ条件を書いていたのをここへ寄せた。 */
function showPickers() {
  const ready = !!(state.semester && state.department);
  els.timetableSection.classList.toggle('hidden', !ready);
  els.extraSection.classList.toggle('hidden', !ready);
  els.submitArea.classList.toggle('hidden', !ready);
  if (!ready) return;
  generateTimetable();
  renderExtraSelect();
  renderExtraList();
}

function saveSettingsToLocal() {
  const settings = {
    grade: els.gradeSelect.value,
    semester: els.semesterSelect.value,
    faculty: state.faculty,
    department: state.department,
  };
  localStorage.setItem('osaka_u_settings', JSON.stringify(settings));
}

/* ══ 科目の絞り込み ═════════════════════════════════ */

/* 2026-08-26: 学年（eligible_years）での絞り込みをやめた。
   ここに来る人は**もう受け終わった科目**を探している。「4年」を選んだ人から
   1年配当の科目を隠すと、1年のときに受けた科目に口コミを書けなくなる。
   探しに来た科目が出ないほうが、一覧が長いことより悪い。
   （科目をさがす側＝app.js の学年フィルタは「これから履修できるか」なので、
     こちらとは目的が違う。あちらはそのまま。） */
function getSubjects(dayIndex, periodIndex) {
  if (!state.faculty || !state.semester) return [];
  const slot = `${days[dayIndex]}${periods[periodIndex]}`;
  const rows = SLOT_INDEX.get(slot) || [];

  const terms = TERM_GROUPS[state.semester] || [];
  /* トラックは同じ軸の中でだけ効かせる。トラックを持たない科目
     （共通教育・学部共通など）は通す ―― 落とすと共通科目が全部消える。
     app.js の trackAxis と同じ規則。 */
  const trackAxis = (state.department || '').includes(':')
    ? state.department.split(':')[0] + ':' : '';

  return rows.filter(r => {
    if (r.faculty !== 'common' && r.faculty !== state.faculty) return false;
    if (!terms.includes(r.term_group)) return false;
    if (trackAxis && r.track && r.track.startsWith(trackAxis) && r.track !== state.department) return false;
    return true;
  });
}

/* ══ 時間割に無い科目 ═══════════════════════════════ */

/* 学期が分からない科目が276件ある（KOAN に学期の記載が無いもの）。
   時間割のマスと違って、ここで落とすと**その科目は永久に投稿できない**。
   「分からない」を「該当しない」と読み替えないために、どちらの学期でも出し、
   選択肢の側で分けて見せる（欠損を勝手に埋めない、の同じ考え方）。 */
function extraCandidates() {
  if (!state.faculty || !state.semester) return { same: [], unknown: [] };
  const terms = TERM_GROUPS[state.semester] || [];
  const q = (els.extraSearch.value || '').trim();

  const same = [], unknown = [];
  for (const r of EXTRA) {
    if (r.faculty !== 'common' && r.faculty !== state.faculty) continue;
    if (q && !r.title.includes(q)) continue;
    if (terms.includes(r.term_group)) same.push(r);
    else if (r.term_group === 'unknown') unknown.push(r);
  }
  return { same, unknown };
}

function submittedKeys() {
  return JSON.parse(localStorage.getItem('osaka_u_submitted') || '{}');
}

function renderExtraSelect() {
  const { same, unknown } = extraCandidates();
  const done = submittedKeys();
  const sel = els.extraSelect;
  const keep = sel.value;

  const option = r => {
    const o = document.createElement('option');
    o.value = r.id;
    const mark = done[`${state.semester}-x-${r.id}`] ? '✅ ' : '';
    const who = r.instructor ? `（${r.instructor}）` : '';
    o.textContent = `${mark}${r.title}${who}　[${r.day_period || '曜限なし'}]`;
    return o;
  };

  sel.innerHTML = '';
  const total = same.length + unknown.length;
  if (!total) {
    sel.appendChild(new Option('該当する科目はありません', ''));
    sel.disabled = true;
  } else {
    sel.disabled = false;
    sel.appendChild(new Option('科目を選択してください', ''));
    if (same.length) {
      const g = document.createElement('optgroup');
      g.label = state.semester === 'spring' ? '春・夏学期の科目' : '秋・冬学期の科目';
      same.forEach(r => g.appendChild(option(r)));
      sel.appendChild(g);
    }
    if (unknown.length) {
      const g = document.createElement('optgroup');
      g.label = '学期が分からない科目';
      unknown.forEach(r => g.appendChild(option(r)));
      sel.appendChild(g);
    }
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  }

  els.extraCount.textContent = total
    ? `${total}件${unknown.length ? `（うち学期が分からないもの ${unknown.length}件）` : ''}`
    : '集中講義・土曜開講の科目は、この条件では見つかりませんでした。';
  els.extraOpen.disabled = !sel.value;
}

/* 選んだ（まだ送っていない）時間割外の科目。時間割のマスと同じ役割。 */
function renderExtraList() {
  const picked = Object.keys(state.selectedSubjects).filter(k => k.startsWith('x-'));
  els.extraList.innerHTML = '';
  picked.forEach(k => {
    const s = state.selectedSubjects[k];
    const li = document.createElement('li');
    li.className = 'extraItem';
    const name = document.createElement('span');
    name.className = 'extraName';
    name.textContent = s.teacher ? `${s.name}（${s.teacher}）` : s.name;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'extraEdit';
    edit.textContent = '書き直す';
    edit.addEventListener('click', () => openEditor({ kind: 'extra', id: s.id }));
    li.append(name, edit);
    els.extraList.appendChild(li);
  });
}

/* ══ 時間割グリッド ═════════════════════════════════ */

function generateTimetable() {
  els.timetableGrid.innerHTML = '';

  const emptyCorner = document.createElement('div');
  els.timetableGrid.appendChild(emptyCorner);

  days.forEach(day => {
    const th = document.createElement('div');
    th.className = 'th-cell';
    th.textContent = day;
    els.timetableGrid.appendChild(th);
  });

  periods.forEach((period, pIndex) => {
    const thPeriod = document.createElement('div');
    thPeriod.className = 'th-cell th-period';
    thPeriod.textContent = period;
    els.timetableGrid.appendChild(thPeriod);

    days.forEach((day, dIndex) => {
      const cell = document.createElement('div');
      cell.className = 'td-cell';
      cell.dataset.day = dIndex;
      cell.dataset.period = pIndex;
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${day}曜${period}限の科目を選ぶ`);
      cell.addEventListener('click', () => openEditor({ kind: 'slot', day: dIndex, period: pIndex }));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor({ kind: 'slot', day: dIndex, period: pIndex }); }
      });
      els.timetableGrid.appendChild(cell);
      updateCellUI(dIndex, pIndex);
    });
  });
}

function updateCellUI(dayIndex, periodIndex) {
  const cell = document.querySelector(`.td-cell[data-day="${dayIndex}"][data-period="${periodIndex}"]`);
  if (!cell) return;

  const key = `${dayIndex}-${periodIndex}`;
  const subject = state.selectedSubjects[key];

  if (subject) {
    cell.classList.add('selected');
    cell.classList.remove('cell-submitted');
    cell.innerHTML = `<div class="cell-subject"></div>`;
    cell.firstChild.textContent = subject.name;
    return;
  }

  cell.classList.remove('selected');

  const storageKey = `${state.semester}-${key}`;
  const submitted = JSON.parse(localStorage.getItem('osaka_u_submitted') || '{}');
  const done = submitted[storageKey];

  if (done && done.faculty === state.faculty && done.department === state.department) {
    cell.classList.add('cell-submitted');
    cell.innerHTML = `<div class="submitted-badge">✅ 送信済み</div><div class="cell-subject"></div>`;
    cell.lastChild.textContent = done.name;
  } else {
    cell.classList.remove('cell-submitted');
    /* その枠に出せる科目が何件あるかを出す。0件のマスを押させないため。 */
    const n = getSubjects(dayIndex, periodIndex).length;
    cell.innerHTML = n
      ? `<span class="cell-empty-text">＋</span><span class="cell-count"></span>`
      : `<span class="cell-empty-text cell-none">―</span>`;
    if (n) cell.lastChild.textContent = `${n}件`;
  }
}

/* ══ モーダル ══════════════════════════════════════ */

/* 設問から先はマスも時間割外も完全に同じ道を通る。
   違うのは「候補が何件か」と「どの鍵に入れるか」だけ。 */
function openEditor(target) {
  const slot = target.kind === 'slot';
  currentTarget = slot
    ? { ...target, key: `${target.day}-${target.period}` }
    : { ...target, key: `x-${target.id}` };

  els.modalTitle.firstChild.textContent = '口コミを書く ';
  els.modalSlotInfo.textContent = slot
    ? `(${days[target.day]}曜日 ${periods[target.period]}限)`
    : '(時間割に無い科目)';

  const subjects = slot
    ? getSubjects(target.day, target.period)
    : EXTRA.filter(r => r.id === target.id);
  const key = currentTarget.key;
  const selectedData = state.selectedSubjects[key];

  resetModalForm();

  if (subjects.length === 0) {
    els.modalSubjectSelect.classList.add('hidden');
    els.reviewQuestions.classList.add('hidden');
    els.noSubjectsMsg.classList.remove('hidden');
    els.clearCellBtn.classList.add('hidden');
  } else {
    els.modalSubjectSelect.classList.remove('hidden');
    els.reviewQuestions.classList.remove('hidden');
    els.noSubjectsMsg.classList.add('hidden');

    els.modalSubjectSelect.innerHTML = '<option value="" disabled selected>科目を選択してください</option>';
    subjects.forEach(subj => {
      const option = document.createElement('option');
      option.value = subj.id;
      /* 同じ科目名が曜限違いで何コマもある（基礎解析学Iは10コマ以上）。
         担当教員はコマの特定に要るので必ず出す。 */
      option.textContent = subj.instructor ? `${subj.title}（${subj.instructor}）` : subj.title;
      els.modalSubjectSelect.appendChild(option);
    });

    /* 時間割外は「どの科目か」がもう決まっている。選び直させない。 */
    if (!slot) els.modalSubjectSelect.value = target.id;

    if (selectedData) {
      els.modalSubjectSelect.value = selectedData.id;
      els.clearCellBtn.classList.remove('hidden');
      if (selectedData.review) restoreReview(selectedData.review);
    } else {
      els.clearCellBtn.classList.add('hidden');
    }
  }

  checkModalFormReady();
  els.modal.classList.remove('hidden');
}

function restoreReview(review) {
  els.modalYearSelect.value = review.yearTaken || '';

  const att = review.attendance;
  if (att && att.startsWith('その他')) {
    restoreButtonGroup('group-attendance', 'その他');
    els.attendanceOtherText.classList.remove('hidden');
    const m = att.match(/その他（(.*)）/);
    if (m) els.attendanceOtherText.value = m[1];
  } else {
    restoreButtonGroup('group-attendance', att);
  }

  restoreButtonGroup('group-assignment-inclass', review.assignmentInClass);
  restoreButtonGroup('group-assignment-outclass', review.assignmentOutClass);
  restoreButtonGroup('group-exam-presence', review.examPresence);

  if (review.examPresence === 'あり') {
    els.examDetailsSection.classList.remove('hidden');
    const ex = review.exam;
    if (ex && ex.startsWith('その他')) {
      restoreButtonGroup('group-exam', 'その他');
      els.examOtherText.classList.remove('hidden');
      const m = ex.match(/その他（(.*)）/);
      if (m) els.examOtherText.value = m[1];
    } else {
      restoreButtonGroup('group-exam', ex);
    }
    if (review.examDifficulty) {
      els.examDifficulty.value = review.examDifficulty;
      els.examDifficultyDisplay.textContent = review.examDifficulty;
    }
  }

  restoreButtonGroup('group-report', review.reportPresence);
  if (review.reportPresence === 'あり') {
    els.reportDetailsSection.classList.remove('hidden');
    if (review.reportWordCount) {
      els.reportWordCount.value = review.reportWordCount;
      els.reportWordDisplay.textContent = review.reportWordCount;
    }
  }
  els.commentInput.value = review.comment || '';
}

function resetModalForm() {
  els.formButtons.forEach(btn => btn.classList.remove('selected'));
  /* 上で選んだ年を初期値に入れる。ほとんどの人は同じ年の科目をまとめて書くので、
     毎回選ばせない。科目ごとに違うなら、その場で変えられる。 */
  els.modalYearSelect.value = els.gradeSelect.value || '';

  els.reportDetailsSection.classList.add('hidden');
  els.reportWordCount.value = 2000;
  els.reportWordDisplay.textContent = 2000;

  els.examDetailsSection.classList.add('hidden');
  els.examDifficulty.value = 5;
  els.examDifficultyDisplay.textContent = 5;

  els.commentInput.value = '';
  els.attendanceOtherText.value = '';
  els.attendanceOtherText.classList.add('hidden');
  els.examOtherText.value = '';
  els.examOtherText.classList.add('hidden');
}

function restoreButtonGroup(groupId, value) {
  if (!value) return;
  const btn = document.querySelector(`#${groupId} .form-btn[data-value="${CSS.escape(value)}"]`);
  if (btn) btn.classList.add('selected');
}

function checkModalFormReady() {
  const sel = id => document.querySelector(`#${id} .selected`);

  const examBtn = sel('group-exam-presence');
  let hasExam = false;
  if (examBtn) hasExam = examBtn.dataset.value === 'あり' ? sel('group-exam') !== null : true;

  els.saveReviewBtn.disabled = !(
    els.modalSubjectSelect.value !== ''
    && els.modalYearSelect.value !== ''
    && sel('group-attendance')
    && sel('group-assignment-inclass')
    && sel('group-assignment-outclass')
    && hasExam
    && sel('group-report')
  );
}

function closeModal() {
  els.modal.classList.add('hidden');
  currentTarget = null;
}

/* ══ 保存 ══════════════════════════════════════════ */

/* 曜日+時限 → グリッドの key。時間割に無い曜限（土曜・集中）は null。 */
function slotToKey(slot) {
  const d = days.indexOf(slot[0]);
  const p = periods.indexOf(Number(slot.slice(1)));
  return (d < 0 || p < 0) ? null : `${d}-${p}`;
}

function handleSaveReview() {
  if (!currentTarget) return;
  const slot = currentTarget.kind === 'slot';
  const subjectId = els.modalSubjectSelect.value;
  const subject = slot
    ? getSubjects(currentTarget.day, currentTarget.period).find(s => s.id === subjectId)
    : EXTRA.find(r => r.id === subjectId);
  if (!subject) return;

  const attendanceBtnVal = document.querySelector('#group-attendance .selected').dataset.value;
  const attendanceValue = attendanceBtnVal === 'その他'
    ? `その他（${els.attendanceOtherText.value.trim()}）` : attendanceBtnVal;

  const examPresenceBtnVal = document.querySelector('#group-exam-presence .selected').dataset.value;
  let examValue = null;
  if (examPresenceBtnVal === 'あり') {
    const examBtnVal = document.querySelector('#group-exam .selected').dataset.value;
    examValue = examBtnVal === 'その他'
      ? `その他（${els.examOtherText.value.trim()}）` : examBtnVal;
  }

  const reportPresence = document.querySelector('#group-report .selected').dataset.value;
  const review = {
    yearTaken: els.modalYearSelect.value,
    attendance: attendanceValue,
    assignmentInClass: document.querySelector('#group-assignment-inclass .selected').dataset.value,
    assignmentOutClass: document.querySelector('#group-assignment-outclass .selected').dataset.value,
    examPresence: examPresenceBtnVal,
    exam: examValue,
    examDifficulty: examPresenceBtnVal === 'あり' ? els.examDifficulty.value : null,
    reportPresence: reportPresence,
    reportWordCount: reportPresence === 'あり' ? els.reportWordCount.value : null,
    comment: els.commentInput.value.trim(),
  };

  /* 同じ科目が別のコマにも出る（「金3,金4,金5」など）。科目が自分の曜限を
     持っているので、該当するマスをまとめて埋める。時間割外は鍵ひとつ。 */
  const keys = slot
    ? [...new Set(subject.slots.map(slotToKey).filter(Boolean))]
    : [`x-${subject.id}`];

  keys.forEach(k => {
    /* GAS へ送る形は以前のまま（name / teacher）。列を変えない。 */
    state.selectedSubjects[k] = {
      id: subject.id,
      name: subject.title,
      teacher: subject.instructor,
      /* 時間割外の科目は曜限がマスに無い。原文（「他」「土3」）をそのまま持つ。 */
      day_period: slot ? null : (subject.day_period || '他'),
      review: review,
    };
  });
  refresh(keys);

  checkSubmitReady();
  closeModal();
}

/* 鍵の形で描き直し先を振り分ける。"0-1" はマス、"x-138531" は時間割外。 */
function refresh(keys) {
  let extra = false;
  keys.forEach(k => {
    if (k.startsWith('x-')) { extra = true; return; }
    const [d, p] = k.split('-');
    updateCellUI(Number(d), Number(p));
  });
  if (extra) { renderExtraList(); renderExtraSelect(); }
}

function handleClearCell() {
  if (!currentTarget) return;
  const entry = state.selectedSubjects[currentTarget.key];
  if (entry) {
    /* 同じ科目IDが付いた鍵をまとめて外す（複数コマの科目のため）。 */
    const gone = Object.keys(state.selectedSubjects)
      .filter(k => state.selectedSubjects[k].id === entry.id);
    gone.forEach(k => delete state.selectedSubjects[k]);
    refresh(gone);
  }

  checkSubmitReady();
  closeModal();
}

function checkSubmitReady() {
  /* 時間割のマスと時間割外を同じ入れ物で数えているので、分岐は要らない。 */
  const hasSelection = Object.keys(state.selectedSubjects).length > 0;
  const hasStudentInfo = els.gradeSelect.value !== '' && els.semesterSelect.value !== '';
  els.submitBtn.disabled = !(hasSelection && hasStudentInfo);
}

/* ══ 送信 ══════════════════════════════════════════ */

async function handleSubmit() {
  const originalText = els.submitBtn.textContent;
  els.submitBtn.disabled = true;
  els.submitBtn.textContent = '送信中...';

  /* 鍵の名前は以前のまま。スプレッドシートの列がこれに繋がっている。
     faculty / department だけ、内部キーではなく表示名を入れている
     （学部の一覧が要件表ベースに変わったので、以前の 'let' 等はもう無い）。 */
  const payload = {
    grade: els.gradeSelect.value,
    semester: els.semesterSelect.value,
    faculty: facultyLabel(),
    department: departmentLabel(),
    selections: Object.keys(state.selectedSubjects).map(key => {
      const item = state.selectedSubjects[key];
      /* 時間割に無い科目には曜日も時限も無い。数字をでっち上げず、
         KOAN の原文（「他」「土3」）を day に入れ、period は null で送る。
         ingest_reviews.py が読むのは科目コードなので、取り込みには影響しない。 */
      if (key.startsWith('x-')) {
        return { day: item.day_period || '他', period: null, subject: item };
      }
      const [d, p] = key.split('-');
      return { day: days[d], period: periods[p], subject: item };
    }),
  };

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (result.status === 'success') {
      showToast();

      const submitted = JSON.parse(localStorage.getItem('osaka_u_submitted') || '{}');
      Object.keys(state.selectedSubjects).forEach(key => {
        submitted[`${state.semester}-${key}`] = {
          ...state.selectedSubjects[key],
          faculty: state.faculty,
          department: state.department,
        };
      });
      localStorage.setItem('osaka_u_submitted', JSON.stringify(submitted));

      state.selectedSubjects = {};
      generateTimetable();
      renderExtraSelect();
      renderExtraList();
    } else {
      alert('送信に失敗しました: ' + (result.message || '不明なエラー'));
    }
  } catch (error) {
    console.error('Error submitting survey:', error);
    alert('通信エラーが発生しました。ネットワーク接続を確認してください。');
  }

  els.submitBtn.textContent = originalText;
  checkSubmitReady();
}

function showToast() {
  els.toast.classList.remove('hidden');
  setTimeout(() => els.toast.classList.add('hidden'), 3000);
}

/* ══ アプリの起動 ═══════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await boot();
  } catch (e) {
    console.error(e);
    els.loadNote.textContent = '科目データを読み込めませんでした。時間をおいて開き直してください。';
    return;
  }
  els.loadNote.hidden = true;
  init();
});
