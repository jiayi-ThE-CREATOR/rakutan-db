/* LINE とメールを1つのアカウントに（worker/account.js）。D1 は SQLite で代わりにする。
 *
 *   node tools/test_account.mjs
 *
 * 守りたいこと（2026-10-20 wang 決定）:
 *   ・ログイン中にもう一方でも入ると、同じアカウントになる（両方向）
 *   ・両方にデータがあるとき：お気に入りは和集合、時間割と学年・学部は新しい方
 *   ・主アカウントは LINE の側（bot が LINE の userId でプロフィールを読む）
 *   ・つないだ後は、どちらで入っても・古いセッションでも、同じアカウントに書く
 *   ・別々の LINE アカウントどうしはつながない
 */
import { d1 } from "./d1_sqlite.mjs";
import { resolveAccount, linkIdentity, methodsOf } from "../worker/account.js";
import { handleMailStart, handleMailLogin, mailId } from "../worker/maillogin.js";
import { handleMe, sessionUser, __test } from "../worker/linelogin.js";

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const U1 = "U" + "1".repeat(32), U2 = "U" + "2".repeat(32);
const base = { RESEND_API_KEY: "re", MAIL_ID_SECRET: "ms", SESSION_SECRET: "ss",
               LINE_LOGIN_CHANNEL_ID: "1", LINE_LOGIN_CHANNEL_SECRET: "2" };
const q = (DB, sql, ...a) => DB.raw.prepare(sql).all(...a).map(r => ({ ...r }));

/* ── メールのアカウントに LINE をつなぐ：データの合わせ方 ─────── */
{
  const DB = d1(); const env = { ...base, DB };
  const M = "m:aaaa";
  const ins = (sql, ...a) => DB.raw.prepare(sql).run(...a);
  ins("INSERT INTO favorites VALUES (?, 'C1', 1)", M);
  ins("INSERT INTO favorites VALUES (?, 'C2', 1)", U1);
  ins("INSERT INTO favorites VALUES (?, 'C2', 2)", M);                         // 重複
  ins("INSERT INTO timetables VALUES (?, 'aki', 'T-mail', 200)", M);           // メールの方が新しい
  ins("INSERT INTO timetables VALUES (?, 'aki', 'T-line', 100)", U1);
  ins("INSERT INTO line_profiles VALUES (?, '1', 'law', 50)", M);              // LINE の方が新しい
  ins("INSERT INTO line_profiles VALUES (?, '2', 'eng', 90)", U1);

  const acc = await linkIdentity(env, M, U1);
  check(acc === U1, `主アカウントが LINE の側でない: ${acc}`);
  const favs = q(DB, "SELECT course_id FROM favorites WHERE line_user_id = ? ORDER BY course_id", U1).map(r => r.course_id);
  check(JSON.stringify(favs) === '["C1","C2"]', `お気に入りが和集合でない: ${favs}`);
  check(q(DB, "SELECT * FROM favorites WHERE line_user_id = ?", M).length === 0, "メール側のお気に入りが残っている");
  const tt = q(DB, "SELECT course_id FROM timetables WHERE line_user_id = ?", U1).map(r => r.course_id);
  check(JSON.stringify(tt) === '["T-mail"]', `時間割が新しい方（メール）でない: ${tt}`);
  const pf = q(DB, "SELECT grade, faculty FROM line_profiles WHERE line_user_id = ?", U1);
  check(pf.length === 1 && pf[0].faculty === "eng", `学年・学部が新しい方（LINE）でない: ${JSON.stringify(pf)}`);
  check(await resolveAccount(env, M) === U1 && await resolveAccount(env, U1) === U1, "つないだ後の引き直しが違う");
  const m = await methodsOf(env, U1);
  check(m.line && m.mail, `つながっている方法が両方出ない: ${JSON.stringify(m)}`);

  /* 古いセッション（中身はメールの ident）でも、主アカウントに書く */
  const old = await __test.sign("ss", { sub: M, friend: true, via: "mail", exp: Math.floor(Date.now() / 1000) + 600 });
  const req = new Request("https://x/api/profile", { headers: { cookie: `rk_sess=${old}` } });
  check(await sessionUser(req, env) === U1, "古いセッションが主アカウントに引き直されない");
  const me = await (await handleMe(req, env)).json();
  check(me.methods && me.methods.line && me.methods.mail, `/api/me が methods を返さない: ${JSON.stringify(me)}`);

  /* 2回目は何もしない */
  check(await linkIdentity(env, U1, M) === U1, "つなぎ済みをもう一度つなぐと壊れる");
}

/* ── LINE のアカウントにメールをつなぐ（メールの流れ・別の端末で押す） ── */
{
  const DB = d1(); const env = { ...base, DB };
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); };
  const lineSess = await __test.sign("ss", { sub: U1, friend: true, via: "line", exp: Math.floor(Date.now() / 1000) + 600 });
  const start = await handleMailStart(new Request("https://rakuhan.nocode-sol.co.jp/mail/start", {
    method: "POST", headers: { "content-type": "application/json", cookie: `rk_sess=${lineSess}` },
    body: JSON.stringify({ email: "line@example.jp", next: "/mypage", link: true }) }), env, fakeFetch);
  check(start.status === 200, "LINE のアカウントからメールの送信ができない");
  const t = new URL(sent[0].text.match(/https:\/\/\S+/)[0]).searchParams.get("t");
  const done = await handleMailLogin(new Request("https://rakuhan.nocode-sol.co.jp/mail/login", {
    method: "POST", body: new URLSearchParams({ t }) }), env);                // 別の端末（セッション無し）
  const sess = await __test.verify("ss", ((done.headers.get("set-cookie") || "").match(/rk_sess=([^;]+)/) || [])[1] || "");
  check(sess && sess.sub === U1, `メールで入ったのに LINE のアカウントにならない: ${sess && sess.sub}`);
  const id = await mailId(env, "line@example.jp");
  check(await resolveAccount(env, `m:${id}`) === U1, "メールの ident が LINE のアカウントにつながっていない");
  check(!DB.written.some(v => v.includes("example.jp")), "アドレスが D1 に書かれている");

  /* つなぐ指定が無ければ、つながない（別のアカウントのまま） */
  sent.length = 0;
  await handleMailStart(new Request("https://rakuhan.nocode-sol.co.jp/mail/start", {
    method: "POST", headers: { "content-type": "application/json", cookie: `rk_sess=${lineSess}` },
    body: JSON.stringify({ email: "other@example.jp" }) }), env, fakeFetch);
  const t2 = new URL(sent[0].text.match(/https:\/\/\S+/)[0]).searchParams.get("t");
  const d2 = await handleMailLogin(new Request("https://rakuhan.nocode-sol.co.jp/mail/login", {
    method: "POST", body: new URLSearchParams({ t: t2 }) }), env);
  const s2 = await __test.verify("ss", ((d2.headers.get("set-cookie") || "").match(/rk_sess=([^;]+)/) || [])[1] || "");
  check(s2 && s2.sub.startsWith("m:"), "つなぐ指定が無いのにつないでしまった");
}

/* ── LINE どうしはつながない／メールどうしはつなぐ ── */
{
  const DB = d1(); const env = { ...base, DB };
  check(await linkIdentity(env, U1, U2) === U2 && await resolveAccount(env, U2) === U2, "別々の LINE をつないでしまった");
  check(await linkIdentity(env, "m:a", "m:b") === "m:a" && await resolveAccount(env, "m:b") === "m:a", "メールどうしがつながらない");
  /* m:a に LINE をつなぐと、先につないだ m:b も LINE へ */
  check(await linkIdentity(env, "m:a", U1) === U1 && await resolveAccount(env, "m:b") === U1,
        "先につないでいたメールが、LINE の主アカウントへ移らない");
}

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
for (const f of fails) console.log("  NG ", f);
process.exit(fails.length ? 1 : 0);
