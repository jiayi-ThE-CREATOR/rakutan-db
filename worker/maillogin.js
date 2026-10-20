/* メールでログイン（2026-10-19 wang 決定）。
 * 設計: docs/superpowers/specs/2026-10-19-mail-login-design.md
 *
 *   POST /mail/start  {email, next}  … ログイン用のリンクをメールで送る
 *   GET  /mail/login?t=…             … 「ログインする」ボタンだけのページを返す
 *   POST /mail/login  t=…            … 使い捨ての文字列を確かめ、セッション Cookie を置く
 *   GET  /mail/poll                  … 送った側の端末が「押されたか」を聞く（別の端末で押しても入れる）
 *
 * ■ 別の端末で押しても、送った端末がログインする（2026-10-20 wang 依頼）
 * パソコンで送ってスマホのメールで押す、がいちばん多い。送るときに「待ち番号」（rid）を作り、
 * 送った端末の Cookie（HttpOnly）とリンクの中に入れる。リンクが押されたら rid に「誰か」を書き、
 * 送った端末は /mail/poll で3秒ごとに聞いて、書かれていたらセッションを受け取る（1回だけ）。
 * 確認の番号（パソコンとスマホで同じ数字を見比べる）は付けない（wang 判断）。そのため、他人が
 * 自分のパソコンからあなたのアドレスで送り、あなたがそのリンクを押すと、他人のパソコンが
 * あなたとして入れる。守る中身が時間割・お気に入りだけなので受け入れている。
 *
 * ■ アドレスは保存しない
 * 識別子は HMAC-SHA256(MAIL_ID_SECRET, 小文字にしたアドレス)。secret が無いと戻せない。
 * アカウントの ID は "m:" ＋ 識別子。お気に入り・時間割の line_user_id 列にそのまま入る。
 * アドレスは送信の間だけ使い、D1 にもログにも書かない。
 *
 * ■ GET で即ログインしない
 * 大学や会社のメールは、届いたリンクを安全確認のために先に開くことがある（リンクの事前取得）。
 * GET でログインまで済ませると、その確認で使い捨ての文字列が使われてしまい、本人が押したときには
 * 「もう使われています」になる。だから GET はボタンだけ出し、押したとき（POST）に使う。
 *
 * ■ 送信回数の制限
 * 同じアドレス 1時間3通、サイト全体 1時間40通。IP では数えない ―― 独自ドメインは吉村さんの
 * サーバー経由で届くので、Worker から見た IP は全員同じになりうる。
 * Resend の無料枠（1日100通）に当たったら、LINE で入ってもらう。
 */
import {
  sign, verify, safeNext, setCookie, clearCookie, cookies, json, redirect, hmac, b64urlEncode,
  SESSION_COOKIE, SESSION_TTL_SEC,
} from "./linelogin.js";

const WAIT_COOKIE = "rk_mailwait";

export const SITE_URL = "https://rakuhan.nocode-sol.co.jp";
const FROM = "ラクハン <login@rakuhan-mail.nocode-sol.co.jp>";
const RESEND_URL = "https://api.resend.com/emails";

const LINK_TTL_SEC = 15 * 60;          // リンクの期限
const PER_ADDRESS_PER_HOUR = 3;
const SITE_PER_HOUR = 40;

/* 形だけ見る（届くかどうかは送ってみないと分からない）。長すぎるものと空白入りは弾く。 */
export function cleanEmail(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s.length > 254 || /\s/.test(s)) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(s) ? s : null;
}

export async function mailId(env, email) {
  return b64urlEncode(await hmac(env.MAIL_ID_SECRET, email)).slice(0, 32);
}

function configured(env) {
  return !!(env.RESEND_API_KEY && env.MAIL_ID_SECRET && env.SESSION_SECRET && env.DB);
}

/* その時間帯の回数を1つ増やし、増やした後の値を返す。行は1時間ごと（古い行は消す）。 */
async function bump(env, key, hour) {
  await env.DB.prepare("DELETE FROM mail_rate WHERE hour < ?").bind(hour - 24).run();
  const row = await env.DB.prepare(
    `INSERT INTO mail_rate (key, hour, n) VALUES (?, ?, 1)
     ON CONFLICT(key, hour) DO UPDATE SET n = n + 1 RETURNING n`).bind(key, hour).first();
  return row ? row.n : 1;
}

export function mailText(link) {
  return [
    "ラクハンにログインするためのリンクです。下のリンクを押すと、ログインが完了します。",
    "",
    link,
    "",
    "このリンクは 15 分間だけ、1 回だけ使えます。",
    "スマホで押しても大丈夫です。メールを送ったパソコンも、自動でログインします。",
    "",
    "このメールに心当たりがない場合は、何もしなくて大丈夫です（誰かがアドレスを打ち間違えた可能性があります）。リンクを押さなければ、何も起きません。",
    "",
    "――",
    "ラクハン（学生団体 GUILD・非公式）",
    "このメールは送信専用です。返信はできません。",
  ].join("\n");
}

function mailHtml(link) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div style="font-family:sans-serif;line-height:1.8;color:#222">
<p>ラクハンにログインするためのリンクです。下のボタンを押すと、ログインが完了します。</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#DB6209;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">ラクハンにログインする</a></p>
<p style="font-size:13px;color:#555">ボタンが押せないときは、このリンクを開いてください：<br>${esc(link)}</p>
<p>このリンクは 15 分間だけ、1 回だけ使えます。<br>スマホで押しても大丈夫です。メールを送ったパソコンも、自動でログインします。</p>
<p>このメールに心当たりがない場合は、何もしなくて大丈夫です（誰かがアドレスを打ち間違えた可能性があります）。リンクを押さなければ、何も起きません。</p>
<p style="font-size:13px;color:#777">――<br>ラクハン（学生団体 GUILD・非公式）<br>このメールは送信専用です。返信はできません。</p>
</div>`;
}

/* ── POST /mail/start ─────────────────────────────────── */
export async function handleMailStart(request, env, fetchImpl = fetch) {
  if (!configured(env)) return json(503, { ok: false, error: "not_configured" });
  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const email = cleanEmail(body && body.email);
  if (!email) return json(400, { ok: false, error: "bad_email" });
  const next = safeNext(body && body.next);

  const id = await mailId(env, email);
  const hour = Math.floor(Date.now() / 3600000);
  /* 回数を超えたときも、送れたときと同じ返事をする（そのアドレスに何通送ったかを外から測らせない）。
     サイト全体の上限だけは「混み合っています」と言う ―― 誰のアドレスとも結びつかないので漏れない。 */
  if (await bump(env, "site", hour) > SITE_PER_HOUR) {
    return json(429, { ok: false, error: "busy" });
  }
  if (await bump(env, `id:${id}`, hour) > PER_ADDRESS_PER_HOUR) {
    return json(200, { ok: true });
  }

  const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(12)));
  /* 待ち番号。送った端末だけが Cookie で持つ（推測できない長さ）。 */
  const rid = b64urlEncode(crypto.getRandomValues(new Uint8Array(18)));
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SEC;
  const token = await sign(env.SESSION_SECRET, { typ: "mail", h: id, n: nonce, w: rid, next, exp });
  const link = `${SITE_URL}/mail/login?t=${encodeURIComponent(token)}`;

  let res;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: [email],
        subject: "【ラクハン】ログイン用のリンク",
        text: mailText(link), html: mailHtml(link),
      }),
    });
  } catch (e) {
    console.error("resend unreachable");     // アドレスはログに出さない
    return json(502, { ok: false, error: "send_failed" });
  }
  if (res.status === 429) return json(429, { ok: false, error: "busy" });   // 無料枠（1日100通）
  if (!res.ok) {
    console.error("resend failed", res.status);
    return json(502, { ok: false, error: "send_failed" });
  }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM mail_wait WHERE exp < ?").bind(now - 3600).run();
  await env.DB.prepare("INSERT INTO mail_wait (rid, exp) VALUES (?, ?)").bind(rid, exp).run();
  return json(200, { ok: true }, { "set-cookie": setCookie(WAIT_COOKIE, rid, LINK_TTL_SEC) });
}

function page(title, bodyHtml) {
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}｜ラクハン</title>
<style>body{font-family:sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;text-align:center;color:#222;background:#faf8f5}
button,a.b{display:inline-block;background:#DB6209;color:#fff;border:0;padding:12px 22px;border-radius:10px;font-size:16px;font-weight:bold;text-decoration:none;cursor:pointer}
p{line-height:1.8}</style></head><body>${bodyHtml}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
               "x-robots-tag": "noindex", "referrer-policy": "no-referrer" },
  });
}

const EXPIRED = () => page("リンクが使えません",
  `<h1>リンクが使えません</h1><p>期限（15分）が切れたか、もう使われたリンクです。<br>もう一度ログインからやり直してください。</p>
   <p><a class="b" href="/">ラクハンへ</a></p>`);

/* ── GET /mail/login ─────────────────────────────────── */
export async function handleMailLoginPage(request, env) {
  if (!configured(env)) return json(503, { ok: false, error: "not_configured" });
  const t = new URL(request.url).searchParams.get("t") || "";
  const obj = await verify(env.SESSION_SECRET, t);
  if (!obj || obj.typ !== "mail") return EXPIRED();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return page("ログイン", `<h1>ラクハンにログイン</h1>
<form method="post" action="/mail/login"><input type="hidden" name="t" value="${esc(t)}">
<button type="submit">ログインする</button></form>`);
}

/* ── POST /mail/login ────────────────────────────────── */
export async function handleMailLogin(request, env) {
  if (!configured(env)) return json(503, { ok: false, error: "not_configured" });
  let t = "";
  try { t = String((await request.formData()).get("t") || ""); } catch { t = ""; }
  const obj = await verify(env.SESSION_SECRET, t);
  if (!obj || obj.typ !== "mail" || typeof obj.h !== "string" || typeof obj.n !== "string") return EXPIRED();

  /* 1回だけ。使った文字列を記録し、2回目は通さない（期限を過ぎた記録は消す）。 */
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM mail_nonce WHERE exp < ?").bind(now).run();
  const ins = await env.DB.prepare(
    "INSERT INTO mail_nonce (n, exp) VALUES (?, ?) ON CONFLICT(n) DO NOTHING").bind(obj.n, obj.exp).run();
  if (!ins.meta || ins.meta.changes !== 1) return EXPIRED();

  /* 送った端末へ知らせる（その端末は /mail/poll で受け取る）。押した端末にもこのままセッションを出す。 */
  if (typeof obj.w === "string" && obj.w) {
    await env.DB.prepare("UPDATE mail_wait SET sub = ? WHERE rid = ? AND sub IS NULL AND exp >= ?")
      .bind(`m:${obj.h}`, obj.w, now).run();
  }
  const session = await mailSession(env, `m:${obj.h}`, now);
  /* 303：POST の後は GET で戻り先へ。 */
  const res = redirect(`${SITE_URL}${safeNext(obj.next)}`, [setCookie(SESSION_COOKIE, session, SESSION_TTL_SEC)]);
  return new Response(null, { status: 303, headers: res.headers });
}

async function mailSession(env, sub, now) {
  return sign(env.SESSION_SECRET, { sub, friend: true, via: "mail", exp: now + SESSION_TTL_SEC });
}

/* ── GET /mail/poll ─────────────────────────────────── */
/* 返すのは state だけ：none（待っていない）／waiting／expired／ok（この返事でセッションを置いた）。 */
export async function handleMailPoll(request, env) {
  if (!configured(env)) return json(503, { ok: false, error: "not_configured" });
  const rid = cookies(request)[WAIT_COOKIE];
  if (!rid) return json(200, { ok: true, state: "none" });
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT sub, exp, taken FROM mail_wait WHERE rid = ?").bind(rid).first();
  if (!row || row.exp < now || row.taken) {
    return json(200, { ok: true, state: row && row.taken ? "none" : "expired" },
                { "set-cookie": clearCookie(WAIT_COOKIE) });
  }
  if (!row.sub) return json(200, { ok: true, state: "waiting" });
  /* 受け取りは1回だけ（同時に2回聞かれても、片方だけが taken を 0→1 にできる）。 */
  const up = await env.DB.prepare("UPDATE mail_wait SET taken = 1 WHERE rid = ? AND taken = 0").bind(rid).run();
  if (!up.meta || up.meta.changes !== 1) return json(200, { ok: true, state: "none" }, { "set-cookie": clearCookie(WAIT_COOKIE) });
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  headers.append("set-cookie", setCookie(SESSION_COOKIE, await mailSession(env, row.sub, now), SESSION_TTL_SEC));
  headers.append("set-cookie", clearCookie(WAIT_COOKIE));
  return new Response(JSON.stringify({ ok: true, state: "ok" }), { status: 200, headers });
}
