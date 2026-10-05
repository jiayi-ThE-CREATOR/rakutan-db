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
import { sessionUser } from "./linelogin.js";

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

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const TERMS = ["haru", "aki"];

/* ── PUT /api/profile ─────────────────────────────────────
 * ログインした人の学年・学部・時間割を、毎回まるごと受け取って置き換える。
 * 追加・削除の差分を送る形にしないのは、取りこぼした1回で D1 とブラウザが
 * 永久にずれるから（丸ごとなら次の1回で必ず揃う）。
 *
 * 学年・学部は line_profiles（LINE の問診と同じ表）に書く。空の項目は
 * COALESCE で既存の値を残す ―― サイトで未回答の人が、LINE で答えた値を
 * 空で消さないため。両方空なら line_profiles は触らない。 */
export async function handleProfile(request, env) {
  if (request.method !== "PUT") {
    return new Response("method not allowed", { status: 405, headers: { allow: "PUT" } });
  }
  if (!env.DB) return json(503, { ok: false, error: "not_configured" });
  const userId = await sessionUser(request, env);
  if (!userId) return json(401, { ok: false, error: "not_logged_in" });

  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }

  const grade = cleanGrade(body?.grade);
  const faculty = cleanFaculty(body?.faculty);
  const now = Date.now();

  const stmts = [env.DB.prepare("DELETE FROM timetables WHERE line_user_id = ?").bind(userId)];
  for (const term of TERMS) {
    for (const id of cleanIds(body?.tt?.[term])) {
      stmts.push(env.DB.prepare(
        "INSERT INTO timetables (line_user_id, term_group, course_id, updated_at) VALUES (?, ?, ?, ?)"
      ).bind(userId, term, id, now));
    }
  }
  if (grade || faculty) {
    stmts.push(env.DB.prepare(
      "INSERT INTO line_profiles (line_user_id, grade, faculty, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (line_user_id) DO UPDATE SET " +
        "grade = COALESCE(excluded.grade, line_profiles.grade), " +
        "faculty = COALESCE(excluded.faculty, line_profiles.faculty), " +
        "updated_at = excluded.updated_at"
    ).bind(userId, grade || null, faculty || null, now));
  }

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    console.error("handleProfile error", e);
    return json(500, { ok: false, error: "db_error" });
  }
  return json(200, { ok: true });
}
