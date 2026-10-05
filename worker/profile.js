/* 利用者の属性（学年・学部・時間割）の検証と保存。
 * 設計: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 * ■ 検証は「外れたら空に落とす」
 *   計測（/api/hit）でもログイン者の保存（PUT /api/profile）でも、変な値で
 *   エラーを返して画面を止める理由は無い。数えられないものは「未回答」として数える。
 *
 * ■ 科目IDは数字だけではない
 *   全7,906件のうち324件が 00Z008 のような英大文字入り。数字だけの正規表現にすると
 *   それらが黙って落ちる。
 *
 * ■ 関数だけを export する（定数を export すると、index.js から import したときに
 *   Workers の起動で落ちる ―― index.js 冒頭の注記と同じ理由）。
 */

/* 正本は web/data/requirements.json の faculties。worker/index.js の FACULTIES と同じ11組。
   ずれは tools/test_user_stats.mjs が見張る。 */
const FACULTY_KEYS = new Set([
  "letters", "human-sci", "law", "economics", "foreign-s", "science",
  "medicine", "dentistry", "pharmacy", "engineering", "engr-sci",
]);
const GRADES = new Set(["1", "2", "3", "4", "5", "6"]);
const COURSE_ID_RE = /^[0-9A-Z]{1,12}$/;
const MAX_IDS = 80;

export function cleanGrade(v) {
  const s = String(v ?? "");
  return GRADES.has(s) ? s : "";
}

export function cleanFaculty(v) {
  const s = String(v ?? "");
  return FACULTY_KEYS.has(s) ? s : "";
}

export function cleanIds(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    const s = String(x);
    if (COURSE_ID_RE.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}
