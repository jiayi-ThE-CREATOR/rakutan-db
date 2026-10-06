/* 利用者の属性の集計（純関数）。取ってくる側は users_report.mjs。
 * spec: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 * A（Analytics Engine の snap）と B（D1）を同じ形の rows に直してから、
 * 同じ aggregate() に通す。ただし**結果を足し合わせない**（単位が端末・日と人で違う）。
 *
 * ■ 外部向け（isPublic）の伏せ方
 *   ・5未満のセルは「5未満」。比率も出さない
 *   ・伏せたセルが表に1つだけなら、次に小さいセルも「伏せ」にする（合計から引き算で戻せないように）
 *   ・科目・タグの表は「のべ数」を出すが、伏せるかどうかは**人数**で決める
 *     （1人が同じタグの科目を6つ入れても、その1人の時間割が見えないように）
 */
const MIN_PUBLIC = 5;

export function aggregate(rows, courseTags) {
  const add = (m, k, w) => m.set(k, (m.get(k) || 0) + w);
  const out = { total: 0, grade: new Map(), faculty: new Map(), gradeFaculty: new Map(),
                courses: new Map(), tags: new Map(), entries: 0,
                coursePeople: new Map(), tagPeople: new Map() };
  for (const r of rows) {
    const w = r.w;
    out.total += w;
    add(out.grade, r.grade || "未回答", w);
    add(out.faculty, r.faculty || "未回答", w);
    add(out.gradeFaculty, `${r.grade || "未回答"}|${r.faculty || "未回答"}`, w);
    const seenTags = new Set();
    for (const id of new Set(r.ids)) {
      add(out.courses, id, w);
      add(out.coursePeople, id, w);
      out.entries += w;
      const tags = courseTags.get(id) || [];
      for (const t of (tags.length ? tags : ["タグなし"])) {
        add(out.tags, t, w);
        seenTags.add(t);
      }
    }
    for (const t of seenTags) add(out.tagPeople, t, w);
  }
  return out;
}

export function cell(n, isPublic) {
  if (isPublic && n < MIN_PUBLIC) return `${MIN_PUBLIC}未満`;
  return String(Math.round(n));
}

export function pct(n, d, isPublic) {
  if (!d) return "—";
  if (isPublic && n < MIN_PUBLIC) return "—";
  return `${((100 * n) / d).toFixed(1)}%`;
}

/* guard … 伏せるかどうかを決める数（既定は表の数そのもの。科目・タグの表では人数を渡す）。 */
export function table(map, denom, isPublic, label = (k) => k, guard = map) {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const g = (k) => guard.get(k) ?? 0;
  const hidden = new Set(isPublic ? rows.filter(([k]) => g(k) < MIN_PUBLIC).map(([k]) => k) : []);
  const second = new Set();
  if (hidden.size === 1 && rows.length > 1) {
    const next = rows.filter(([k]) => !hidden.has(k)).sort((a, b) => g(a[0]) - g(b[0]))[0];
    if (next) second.add(next[0]);
  }
  return rows.map(([k, n]) => {
    if (hidden.has(k)) return [label(k), `${MIN_PUBLIC}未満`, "—"];
    if (second.has(k)) return [label(k), "伏せ", "—"];
    return [label(k), cell(n, false), pct(n, denom, false)];
  });
}

/* 学年別・学部別の内訳表を出すか。外部向けでは5未満のグループは表ごと出さない。 */
export function showGroup(total, isPublic) {
  return !isPublic || total >= MIN_PUBLIC;
}

export function toCsv(header, rows) {
  const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

export function rowsFromAE(data) {
  return data.map((r) => ({
    grade: r.grade || "",
    faculty: r.faculty || "",
    ids: r.ids ? String(r.ids).split(",").filter(Boolean) : [],
    w: Number(r.w) || 0,
  }));
}

/* 人ごとに畳む。春秋の両方に入っている科目（通年）は1つに数える。
   問診だけ答えた人（時間割なし）・時間割だけある人（問診なし）も1人として数える。 */
export function rowsFromD1(profiles, timetables) {
  const people = new Map();
  const get = (u) => {
    if (!people.has(u)) people.set(u, { grade: "", faculty: "", ids: new Set(), w: 1 });
    return people.get(u);
  };
  for (const p of profiles) {
    const r = get(p.line_user_id);
    r.grade = p.grade || "";
    r.faculty = p.faculty || "";
  }
  for (const t of timetables) get(t.line_user_id).ids.add(String(t.course_id));
  return [...people.values()].map((r) => ({ ...r, ids: [...r.ids] }));
}
