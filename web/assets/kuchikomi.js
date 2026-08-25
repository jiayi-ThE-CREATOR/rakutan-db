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
 */

/* ══ 定数 ══════════════════════════════════════════ */

const days = ['月', '火', '水', '木', '金'];
const periods = [1, 2, 3, 4, 5, 6];

/* 口コミの保存先。ここが変わるとスプレッドシートに何も入らなくなる。 */
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwopsnpuXTF6AS7hSxizw4euceYsD1Z_-FVuK4vxCaZHmosmcn2yBqkolUN3UWjENtZ/exec';

/* 学期 → その学期に履修できる term_group。
   full（通年）はどちらでも履修できるので必ず通す（app.js と同じ扱い）。 */
const TERM_GROUPS = { spring: ['haru', 'full'], autumn: ['aki', 'full'] };

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

  loadNote: document.getElementById('load-note'),
  toast: document.getElementById('toast'),
};

let currentEditingCell = null;   // { day: index, period: index }

/* ══ 起動 ══════════════════════════════════════════ */

async function boot() {
  const [rows, req] = await Promise.all([
    fetch('/data/timetable.json').then(r => r.json()),
    fetch('/data/requirements.json').then(r => r.json()),
  ]);
  ROWS = rows;
  FACULTIES = req.faculties || [];

  /* 枠ごとに引けるようにしておく。マスを開くたびに 6,808件を
     なめると、押した瞬間に固まる。 */
  for (const row of ROWS) {
    for (const slot of row.slots) {
      if (!SLOT_INDEX.has(slot)) SLOT_INDEX.set(slot, []);
      SLOT_INDEX.get(slot).push(row);
    }
  }
  for (const list of SLOT_INDEX.values()) {
    list.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  }
}

function init() {
  /* 学部は requirements.json（＝卒業要件表）が正本。ここに一覧を持たない。 */
  FACULTIES.forEach(f => {
    const option = document.createElement('option');
    option.value = f.key;
    option.textContent = f.label;
    els.facultySelect.appendChild(option);
  });

  const savedSettings = JSON.parse(localStorage.getItem('osaka_u_settings') || '{}');
  if (savedSettings.grade) els.gradeSelect.value = savedSettings.grade;
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

  if (state.semester && state.department) {
    generateTimetable();
    els.timetableSection.classList.remove('hidden');
  }

  checkSubmitReady();

  els.gradeSelect.addEventListener('change', () => {
    /* 学年で出る科目が変わる。開いたままの選択は残さない。 */
    state.selectedSubjects = {};
    if (state.semester && state.department) generateTimetable();
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
  if (state.department) {
    generateTimetable();
    els.submitBtn.disabled = true;
  }
  checkSubmitReady();
  saveSettingsToLocal();
}

function handleFacultyChange(e) {
  state.faculty = e.target.value;
  state.department = null;
  fillDepartments(state.faculty);

  state.selectedSubjects = {};
  if (state.semester && state.department) {
    /* 学科が1つしか無い学部は fillDepartments が確定させている。
       ここで時間割まで出しておかないと、選ぶものが無いのに先へ進めない。 */
    generateTimetable();
    els.timetableSection.classList.remove('hidden');
  } else {
    els.timetableSection.classList.add('hidden');
  }
  checkSubmitReady();
  saveSettingsToLocal();
}

function handleDepartmentChange(e) {
  state.department = e.target.value;
  state.selectedSubjects = {};

  if (state.department) {
    generateTimetable();
    els.timetableSection.classList.remove('hidden');
    els.submitBtn.disabled = true;
  }
  checkSubmitReady();
  saveSettingsToLocal();
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

/* 学年。1〜6年は eligible_years で絞る。
   修士・博士は学部科目のデータしか無いので絞らない（0件にはしない）。 */
function gradeNumber() {
  const m = /^([1-6])年$/.exec(els.gradeSelect.value || '');
  return m ? Number(m[1]) : null;
}

function getSubjects(dayIndex, periodIndex) {
  if (!state.faculty || !state.semester) return [];
  const slot = `${days[dayIndex]}${periods[periodIndex]}`;
  const rows = SLOT_INDEX.get(slot) || [];

  const terms = TERM_GROUPS[state.semester] || [];
  const year = gradeNumber();
  /* トラックは同じ軸の中でだけ効かせる。トラックを持たない科目
     （共通教育・学部共通など）は通す ―― 落とすと共通科目が全部消える。
     app.js の trackAxis と同じ規則。 */
  const trackAxis = (state.department || '').includes(':')
    ? state.department.split(':')[0] + ':' : '';

  return rows.filter(r => {
    if (r.faculty !== 'common' && r.faculty !== state.faculty) return false;
    if (!terms.includes(r.term_group)) return false;
    if (year && Array.isArray(r.eligible_years) && !r.eligible_years.includes(year)) return false;
    if (trackAxis && r.track && r.track.startsWith(trackAxis) && r.track !== state.department) return false;
    return true;
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
      cell.addEventListener('click', () => openModal(dIndex, pIndex));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(dIndex, pIndex); }
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

function openModal(dayIndex, periodIndex) {
  currentEditingCell = { day: dayIndex, period: periodIndex };

  els.modalTitle.firstChild.textContent = '口コミを書く ';
  els.modalSlotInfo.textContent = `(${days[dayIndex]}曜日 ${periods[periodIndex]}限)`;

  const subjects = getSubjects(dayIndex, periodIndex);
  const key = `${dayIndex}-${periodIndex}`;
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
  els.modalYearSelect.value = '';

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
  currentEditingCell = null;
}

/* ══ 保存 ══════════════════════════════════════════ */

/* 曜日+時限 → グリッドの key。時間割に無い曜限（土曜・集中）は null。 */
function slotToKey(slot) {
  const d = days.indexOf(slot[0]);
  const p = periods.indexOf(Number(slot.slice(1)));
  return (d < 0 || p < 0) ? null : `${d}-${p}`;
}

function handleSaveReview() {
  const { day, period } = currentEditingCell;
  const key = `${day}-${period}`;

  const subjectId = els.modalSubjectSelect.value;
  const subject = getSubjects(day, period).find(s => s.id === subjectId);
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

  /* 同じ科目が別のコマにも出る（「金3,金4,金5」など）。
     以前は全データを舐めて探していたが、いまは科目が自分の曜限を持っている。
     マスに無い曜限（土曜・集中）は落ちるので、その場合は押したマスだけ。 */
  const keys = subject.slots.map(slotToKey).filter(Boolean);
  const uniqueKeys = [...new Set(keys.length ? keys : [key])];

  uniqueKeys.forEach(k => {
    /* GAS へ送る形は以前のまま（name / teacher）。列を変えない。 */
    state.selectedSubjects[k] = {
      id: subject.id,
      name: subject.title,
      teacher: subject.instructor,
      review: review,
    };
    const [d, p] = k.split('-');
    updateCellUI(Number(d), Number(p));
  });

  checkSubmitReady();
  closeModal();
}

function handleClearCell() {
  if (!currentEditingCell) return;
  const { day, period } = currentEditingCell;
  const key = `${day}-${period}`;

  if (state.selectedSubjects[key]) {
    const subjectId = state.selectedSubjects[key].id;
    Object.keys(state.selectedSubjects).forEach(k => {
      if (state.selectedSubjects[k].id === subjectId) {
        delete state.selectedSubjects[k];
        const [d, p] = k.split('-');
        updateCellUI(Number(d), Number(p));
      }
    });
  }

  checkSubmitReady();
  closeModal();
}

function checkSubmitReady() {
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
      const [d, p] = key.split('-');
      return {
        day: days[d],
        period: periods[p],
        subject: state.selectedSubjects[key],
      };
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
