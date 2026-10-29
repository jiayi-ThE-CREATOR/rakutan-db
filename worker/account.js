/* ログイン方法（LINE・メール）と、アカウントの対応（2026-10-20 wang 決定）。
 * 設計: docs/superpowers/specs/2026-10-19-mail-login-design.md「1つのアカウントに統一」
 *
 * ■ 形
 * ログイン方法の ID（ident）：LINE は userId（U…）、メールは "m:<識別子>"。
 * アカウントの ID（account）：お気に入り・時間割・プロフィールの line_user_id 列に入る値。
 * identities に行が無い ident は、それ自体がアカウント（今までの LINE の人は1行も要らない）。
 *
 * ■ つなぐ
 * ログイン中（アカウント A）に、もう一方の方法でも入ると、その ident を A につなぐ。
 * 同じブラウザで両方を通したこと＝両方とも本人のもの、の証明になる。
 * 両方にすでにデータがあるとき：お気に入りは和集合、時間割と学年・学部は新しい方（wang 決定）。
 * 主アカウントは LINE の側 ―― LINE の bot が line_profiles を LINE の userId で読むため。
 * LINE どうし（別々の LINE アカウント）はつながない（bot がどちらかのプロフィールを失う）。
 */

const isLine = (a) => /^U[0-9a-f]{32}$/.test(a || "");

export async function resolveAccount(env, ident) {
  if (!ident || !env.DB) return ident;
  const row = await env.DB.prepare("SELECT account FROM identities WHERE ident = ?").bind(ident).first();
  return row ? row.account : ident;
}

/* アカウント A に ident B をつなぐ。返り値はつないだ後のアカウント ID（主アカウント）。 */
export async function linkIdentity(env, accA, identB) {
  const accB = await resolveAccount(env, identB);
  if (!accA || accB === accA) return accB;
  if (isLine(accA) && isLine(accB)) return accB;            // LINE どうしはつながない

  let primary = accA, secondary = accB;
  if (!isLine(accA) && isLine(accB)) { primary = accB; secondary = accA; }

  const newest = async (table) => (await env.DB.prepare(
    `SELECT MAX(updated_at) AS m FROM ${table} WHERE line_user_id = ?`).bind(secondary).first())?.m || 0;
  const newestP = async (table) => (await env.DB.prepare(
    `SELECT MAX(updated_at) AS m FROM ${table} WHERE line_user_id = ?`).bind(primary).first())?.m || 0;
  const ttSecondaryNewer = (await newest("timetables")) > (await newestP("timetables"));
  const pfSecondaryNewer = (await newest("line_profiles")) > (await newestP("line_profiles"));

  const P = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const now = Date.now();
  const stmts = [
    /* お気に入り：和集合 */
    P(`INSERT INTO favorites (line_user_id, course_id, created_at)
       SELECT ?, course_id, created_at FROM favorites WHERE line_user_id = ?
       ON CONFLICT (line_user_id, course_id) DO NOTHING`, primary, secondary),
    P("DELETE FROM favorites WHERE line_user_id = ?", secondary),
    /* 時間割・学年学部：新しい方 */
    ...(ttSecondaryNewer
      ? [P("DELETE FROM timetables WHERE line_user_id = ?", primary),
         P("UPDATE timetables SET line_user_id = ? WHERE line_user_id = ?", primary, secondary)]
      : [P("DELETE FROM timetables WHERE line_user_id = ?", secondary)]),
    ...(pfSecondaryNewer
      ? [P("DELETE FROM line_profiles WHERE line_user_id = ?", primary),
         P("UPDATE line_profiles SET line_user_id = ? WHERE line_user_id = ?", primary, secondary)]
      : [P("DELETE FROM line_profiles WHERE line_user_id = ?", secondary)]),
    /* 対応表：secondary にぶら下がっていたものも、secondary 自身も、B も、すべて primary へ */
    P("UPDATE identities SET account = ? WHERE account = ?", primary, secondary),
  ];
  for (const x of new Set([secondary, identB])) {
    if (x !== primary) {
      stmts.push(P(`INSERT INTO identities (ident, account, created_at) VALUES (?, ?, ?)
                    ON CONFLICT (ident) DO UPDATE SET account = excluded.account`, x, primary, now));
    }
  }
  await env.DB.batch(stmts);

  /* 時間割の写し（timetable_docs・2026-10-29）も時間割と同じく新しい方。
     上の batch とは分けて流す ―― 表をまだ作っていない D1 でも、つなぐこと自体は落とさないため。 */
  try {
    const docSecondaryNewer = (await newest("timetable_docs")) > (await newestP("timetable_docs"));
    await env.DB.batch(docSecondaryNewer
      ? [P("DELETE FROM timetable_docs WHERE line_user_id = ?", primary),
         P("UPDATE timetable_docs SET line_user_id = ? WHERE line_user_id = ?", primary, secondary)]
      : [P("DELETE FROM timetable_docs WHERE line_user_id = ?", secondary)]);
  } catch (e) {
    console.error("linkIdentity timetable_docs error", e);
  }
  return primary;
}

/* アカウントにつながっているログイン方法（マイページの表示用）。 */
export async function methodsOf(env, account) {
  const out = { line: isLine(account), mail: (account || "").startsWith("m:") };
  if (!env.DB || !account) return out;
  const { results } = await env.DB.prepare("SELECT ident FROM identities WHERE account = ?").bind(account).all();
  for (const r of results || []) {
    if (isLine(r.ident)) out.line = true;
    if (r.ident.startsWith("m:")) out.mail = true;
  }
  return out;
}

export const __test = { isLine };
