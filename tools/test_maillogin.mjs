/* メールでログイン（worker/maillogin.js）。D1 と Resend は偽物で置き換える。
 *
 *   node tools/test_maillogin.mjs
 *
 * 守りたいこと（設計: docs/superpowers/specs/2026-10-19-mail-login-design.md）:
 *   ・アドレスそのものを D1 に書かない（識別子だけ）
 *   ・リンクは 1回だけ使える。GET では使わない（メールの安全確認で消費されないように）
 *   ・発行するセッションは friend:true / via:"mail" / sub:"m:…" で、/api/me が門を開ける
 *   ・同じアドレスは1時間3通まで（超えても返事は同じ）。サイト全体の上限は busy
 *   ・戻り先は自サイトだけ
 */
import { handleMailStart, handleMailLoginPage, handleMailLogin, handleMailPoll, cleanEmail, mailId, mailText }
  from "../worker/maillogin.js";
import { handleMe, __test } from "../worker/linelogin.js";

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

/* D1 は SQLite で代わりにする（tools/d1_sqlite.mjs）。bind した値は DB.written に残る。 */
import { d1 } from "./d1_sqlite.mjs";
const fakeDB = d1;

const ADDR = "Taro.Handai@Example.com";
const env = { RESEND_API_KEY: "re_test", MAIL_ID_SECRET: "mail-secret", SESSION_SECRET: "sess-secret", DB: fakeDB() };
const sent = [];
const fakeFetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };
const post = (body) => new Request("https://rakuhan.nocode-sol.co.jp/mail/start", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/* ── 形 ─────────────────────────────────────── */
check(cleanEmail(" A@B.jp ") === "a@b.jp", "前後の空白・大文字を揃えていない");
check(cleanEmail("a b@c.jp") === null && cleanEmail("abc") === null && cleanEmail("a@b") === null, "形の悪いアドレスを通している");
const r0 = await handleMailStart(post({ email: "nope" }), env, fakeFetch);
check(r0.status === 400, "形の悪いアドレスで 400 にならない");

/* ── 送る ───────────────────────────────────── */
const r1 = await handleMailStart(post({ email: ADDR, next: "/mypage" }), env, fakeFetch);
check(r1.status === 200 && (await r1.json()).ok, "正しいアドレスで送れない");
check(sent.length === 1 && sent[0].body.to[0] === ADDR.toLowerCase(), "宛先が違う");
check(sent[0].body.from.includes("rakuhan-mail.nocode-sol.co.jp"), "送信元が子ドメインでない");
check(sent[0].body.text.includes("15 分間だけ、1 回だけ"), "本文に期限の説明が無い");
const id = await mailId(env, ADDR.toLowerCase());
check(!env.DB.written.some(v => v.toLowerCase().includes("example.com")), "アドレスが D1 に書かれている");
check(env.DB.written.includes(`id:${id}`), "識別子で数えていない");

const link = sent[0].body.text.match(/https:\/\/\S+/)[0];
const t = new URL(link).searchParams.get("t");

/* ── GET はボタンだけ ───────────────────────── */
const g = await handleMailLoginPage(new Request(link), env);
const gh = await g.text();
check(g.status === 200 && gh.includes('method="post"') && !g.headers.get("set-cookie"),
  "GET でセッションを出している、またはボタンが無い");
const g2 = await handleMailLoginPage(new Request(link), env);
check((await g2.text()).includes("ログインする"), "GET を2回開いたらリンクが使えなくなった（事前取得で消費される）");

/* ── POST でログイン ─────────────────────────── */
const form = (tok) => new Request("https://rakuhan.nocode-sol.co.jp/mail/login", {
  method: "POST", body: new URLSearchParams({ t: tok }) });
const p1 = await handleMailLogin(form(t), env);
check(p1.status === 303 && p1.headers.get("location") === "https://rakuhan.nocode-sol.co.jp/mypage", "戻り先へ 303 で戻らない");
const cookie = (p1.headers.get("set-cookie") || "").split(";")[0];
const sess = await __test.verify(env.SESSION_SECRET, cookie.split("=")[1] || "");
check(sess && sess.sub === `m:${id}` && sess.friend === true && sess.via === "mail", `セッションの中身が違う: ${JSON.stringify(sess)}`);

const me = await (await handleMe(new Request("https://x/api/me", { headers: { cookie } }),
  { ...env, LINE_LOGIN_CHANNEL_ID: "1", LINE_LOGIN_CHANNEL_SECRET: "2" })).json();
check(me.linked === true && me.loggedIn === true && me.via === "mail", `/api/me が門を開けない: ${JSON.stringify(me)}`);

const p2 = await handleMailLogin(form(t), env);
check(p2.status === 200 && !p2.headers.get("set-cookie"), "同じリンクで2回ログインできる");

/* ── 改ざん・期限 ───────────────────────────── */
const forged = await __test.sign("other-secret", { typ: "mail", h: id, n: "x", next: "/", exp: Math.floor(Date.now() / 1000) + 600 });
check(!(await handleMailLogin(form(forged), env)).headers.get("set-cookie"), "別の鍵で作ったリンクが通る");
const old = await __test.sign(env.SESSION_SECRET, { typ: "mail", h: id, n: "y", next: "/", exp: Math.floor(Date.now() / 1000) - 1 });
check(!(await handleMailLogin(form(old), env)).headers.get("set-cookie"), "期限切れのリンクが通る");
const sessTok = await __test.sign(env.SESSION_SECRET, { sub: "U1", friend: true, exp: Math.floor(Date.now() / 1000) + 600 });
check(!(await handleMailLogin(form(sessTok), env)).headers.get("set-cookie"), "メール用でない署名（セッション等）をリンクとして通す");

/* ── 戻り先 ─────────────────────────────────── */
sent.length = 0;
await handleMailStart(post({ email: "b@example.jp", next: "https://evil.example" }), env, fakeFetch);
const t2 = new URL(sent[0].body.text.match(/https:\/\/\S+/)[0]).searchParams.get("t");
const p3 = await handleMailLogin(form(t2), env);
check(p3.headers.get("location") === "https://rakuhan.nocode-sol.co.jp/", "外部の戻り先を弾いていない");

/* ── 回数の制限 ─────────────────────────────── */
sent.length = 0;
for (let i = 0; i < 4; i++) await handleMailStart(post({ email: "c@example.jp" }), env, fakeFetch);
check(sent.length === 3, `同じアドレスに1時間で ${sent.length} 通送った（3通まで）`);
const env2 = { ...env, DB: fakeDB() };
let busy = 0;
for (let i = 0; i < 42; i++) {
  const r = await handleMailStart(post({ email: `u${i}@example.jp` }), env2, fakeFetch);
  if (r.status === 429) busy++;
}
check(busy === 2, `サイト全体で1時間40通を超えた分が busy にならない（${busy}）`);
const quota = async () => new Response("{}", { status: 429 });
check((await handleMailStart(post({ email: "d@example.jp" }), { ...env, DB: fakeDB() }, quota)).status === 429,
  "Resend の無料枠を超えたとき busy を返さない");

check(mailText("L").includes("心当たりがない場合"), "本文に心当たりの説明が無い");

/* ── 別の端末で押しても、送った端末がログインする（2026-10-20） ── */
{
  const envX = { ...env, DB: fakeDB() };
  sent.length = 0;
  const pc = await handleMailStart(post({ email: "x@example.jp", next: "/mypage" }), envX, fakeFetch);
  const waitCookie = (pc.headers.get("set-cookie") || "").split(";")[0];
  check(waitCookie.startsWith("rk_mailwait=") && /HttpOnly/.test(pc.headers.get("set-cookie")),
        "送った端末に待ち番号の Cookie（HttpOnly）を置いていない");
  const poll = (cookie) => handleMailPoll(new Request("https://rakuhan.nocode-sol.co.jp/mail/poll",
    { headers: cookie ? { cookie } : {} }), envX);
  check((await (await poll(waitCookie)).json()).state === "waiting", "押される前に waiting にならない");
  check((await (await poll("")).json()).state === "none", "Cookie の無い端末が none にならない");

  const tx = new URL(sent[0].body.text.match(/https:\/\/\S+/)[0]).searchParams.get("t");
  const phone = await handleMailLogin(form(tx), envX);           // スマホ（待ち番号の Cookie は無い）
  check(phone.status === 303 && (phone.headers.get("set-cookie") || "").startsWith("rk_sess="), "スマホでログインできない");

  const pr = await poll(waitCookie);
  const prCookies = pr.headers.get("set-cookie") || "";
  check((await pr.json()).state === "ok" && prCookies.includes("rk_sess="), "スマホで押したのに、送った端末にセッションが出ない");
  const sessX = await __test.verify(envX.SESSION_SECRET, (prCookies.match(/rk_sess=([^;,]+)/) || [])[1] || "");
  check(sessX && sessX.via === "mail" && sessX.sub.startsWith("m:"), "送った端末のセッションの中身が違う");
  const again = await poll(waitCookie);
  check((await again.json()).state !== "ok" && !(again.headers.get("set-cookie") || "").includes("rk_sess="),
        "同じ待ち番号で2回セッションを受け取れる");

  /* 期限切れ */
  sent.length = 0;
  const pc2 = await handleMailStart(post({ email: "y@example.jp" }), envX, fakeFetch);
  const wc2 = (pc2.headers.get("set-cookie") || "").split(";")[0];
  envX.DB.raw.exec("UPDATE mail_wait SET exp = 1 WHERE sub IS NULL");
  check((await (await poll(wc2)).json()).state === "expired", "期限切れの待ちが expired にならない");
  check(!envX.DB.written.some(v => v.includes("example.jp") && !v.startsWith("id:")), "待ちの表にアドレスが書かれている");
}

console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
for (const f of fails) console.log("  NG ", f);
process.exit(fails.length ? 1 : 0);
