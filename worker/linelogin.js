/* LINE ログイン（OAuth 2.0）と、友だち追加済みかの確認。
 *
 * ■ なぜ要るのか
 * マイページの「LINE 連携」は 2026-09-02 まで、**ボタンを押した印を
 * localStorage に書くだけ**だった（store.js の rk_line_linked の注記どおり）。
 * 押した先で本人が友だち追加をやめても分からないので、押して戻るだけで
 * 「連携済み」になる。wang さんの 2026-09-13 の指摘はこれ。
 *
 * 「LINE 登録しないと使えない」を本当に成立させるには、サイト側が
 * 友だちかどうかを**自分で確かめる**しかない。それができるのは
 * LINE ログインの friendship status API だけなので、ここを作る。
 *
 * ■ 使うチャネルが2つあることに注意
 * Messaging API チャネル（bot 側・LINE_CHANNEL_*）とは別に、
 * **LINE ログインチャネル**（LINE_LOGIN_CHANNEL_*）が必要。
 * そして LINE Developers 側で「リンクされた LINE 公式アカウント」に
 * bot を指定しておくこと。これを忘れると friendship status API が
 * 常に friendFlag:false を返し、誰もゲートを通れなくなる。
 *
 * ■ ドメインは SITE_URL に固定する（request.url を使わない）
 * 公開ドメイン rakuhan.nocode-sol.co.jp は吉村さんのサーバーを経由して
 * この Worker に届く。そのため Worker からは、新ドメインで来た人も
 * **旧ドメイン（*.workers.dev）で来たように見える**。
 * 2026-09-16 に request.url の origin で redirect_uri を組んでいて、
 * LINE に登録したコールバックURL（新ドメイン）と一致せず、誰も
 * ログインできなかった（ロックだけが効いた状態で本番に出た）。
 * index.js の SITE_URL と同じ理由・同じ値。
 *
 * さらに、Cookie はドメインごとに別物。旧ドメインで state の Cookie を
 * 置いて新ドメインのコールバックへ戻ると、照合が必ず落ちる。だから
 * /line/login の最初の一歩で必ず SITE_URL へ移ってから Cookie を置く（go=1）。
 *
 * ■ セッションは Cookie に閉じる（D1 を使わない）
 * 持つのは userId と friendFlag と期限だけで、消えても友だち追加を
 * やり直す必要はない（もう一度ログインすれば復帰する）。
 * D1 に置くと、Cookie が消えた人のゴミ行が残り続けるだけで得がない。
 * 改ざんは HMAC-SHA256 の署名で弾く。
 */

const AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const FRIENDSHIP_URL = "https://api.line.me/friendship/v1/status";

/* LINE Developers に登録したコールバックURLのドメイン。変えるなら両方直す。 */
export const SITE_URL = "https://rakuhan.nocode-sol.co.jp";
const CALLBACK_URL = `${SITE_URL}/line/callback`;

const SESSION_COOKIE = "rk_sess";
const STATE_COOKIE = "rk_oauth_state";
/* 30日。履修登録は年2回なので、学期をまたぐたびに入り直してもらう。
   これ以上長くすると、卒業した人のセッションが残り続ける。 */
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;
/* 認可画面を開いてから戻ってくるまでの猶予。LINE アプリへの往復に
   時間がかかることがあるので10分取る。 */
const STATE_TTL_SEC = 600;

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/* 一致比較は長さで早期に返さない（署名の長さは固定なので実害は無いが、
   ここを緩めると後から可変長のものを渡したときに漏れる）。 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(secret, payloadObj) {
  const payload = b64urlEncode(enc.encode(JSON.stringify(payloadObj)));
  const sig = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

async function verify(secret, token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".", 2);
  if (!payload || !sig) return null;
  const expect = b64urlEncode(await hmac(secret, payload));
  if (!safeEqual(expect, sig)) return null;
  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
  if (!obj || typeof obj.exp !== "number" || obj.exp * 1000 < Date.now()) return null;
  return obj;
}

function cookies(request) {
  const raw = request.headers.get("Cookie") || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/* SameSite=Lax でなければならない。Strict にすると、LINE の認可画面から
   戻ってきた最初のリクエストに Cookie が乗らず、state の検証が必ず落ちる。
   Domain は付けない ―― ブラウザが開いているホスト（SITE_URL）に紐づく。 */
function setCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/* 戻り先は「このサイトの中のパス」だけを許す。
   //evil.example や http://evil.example を渡されるとそこへ飛ばす踏み台に
   なるので、先頭が / で、かつ // で始まらないものに限る。 */
function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      /* ログイン状態は人ごとに違う。CDN に載せさせない。 */
      "cache-control": "no-store",
      ...(extraHeaders || {}),
    },
  });
}

function redirect(location, cookieHeaders) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookieHeaders || []) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

function configured(env) {
  return !!(env.LINE_LOGIN_CHANNEL_ID && env.LINE_LOGIN_CHANNEL_SECRET && env.SESSION_SECRET);
}

/* ── GET /line/login ───────────────────────────────────────
   2段階で動く。
   ① go が無い … SITE_URL の /line/login?go=1 へ移るだけ。どのドメインから
      来ても、Cookie を置く時点では必ず新ドメインにいる状態を作る。
   ② go=1     … state を Cookie と URL の両方に置いて認可画面へ送る（CSRF 対策）。
      next も state の中に入れる ―― URL に別で持たせると、戻り先だけ
      差し替えられる余地が残る。 */
export async function handleLineLogin(request, env) {
  if (!configured(env)) return json(503, { ok: false, error: "not_configured" });

  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next") || "/");

  if (url.searchParams.get("go") !== "1") {
    return redirect(`${SITE_URL}/line/login?go=1&next=${encodeURIComponent(next)}`);
  }

  const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const state = await sign(env.SESSION_SECRET, {
    n: nonce,
    next,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC,
  });

  const auth = new URL(AUTH_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.LINE_LOGIN_CHANNEL_ID);
  auth.searchParams.set("redirect_uri", CALLBACK_URL);
  auth.searchParams.set("state", state);
  auth.searchParams.set("scope", "profile openid");
  /* 友だちでない人には、認可と同時に友だち追加も勧める。
     これが無いと「ログインしたのに friendFlag:false」で行き止まりになる。 */
  auth.searchParams.set("bot_prompt", "aggressive");

  return redirect(auth.toString(), [setCookie(STATE_COOKIE, state, STATE_TTL_SEC)]);
}

/* ── GET /line/callback ────────────────────────────────────
   code をアクセストークンに替え、friendship status を確かめてから
   セッションを発行する。friendFlag が false でもセッションは出す
   （本人であることは確かめられているので、画面側で「まだ友だちでない」と
   出し分けられるようにする。ここで弾くと、何が足りないのか伝えられない）。
   戻り先は必ず SITE_URL の中 ―― Cookie を置いたドメインへ帰す。 */
export async function handleLineCallback(request, env) {
  if (!configured(env)) return json(503, { ok: false, error: "not_configured" });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const stateCookie = cookies(request)[STATE_COOKIE];

  /* 認可画面で「キャンセル」を押すと code は来ず error だけ来る。
     エラーページを出すより、元のページへ黙って戻す方が親切。 */
  if (!code) {
    const back = stateParam ? (await verify(env.SESSION_SECRET, stateParam))?.next : null;
    return redirect(`${SITE_URL}${safeNext(back || "/")}`, [clearCookie(STATE_COOKIE)]);
  }

  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return json(400, { ok: false, error: "state_mismatch" }, { "set-cookie": clearCookie(STATE_COOKIE) });
  }
  const stateObj = await verify(env.SESSION_SECRET, stateParam);
  if (!stateObj) {
    return json(400, { ok: false, error: "state_invalid" }, { "set-cookie": clearCookie(STATE_COOKIE) });
  }

  let tokenRes;
  try {
    tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        /* 認可リクエストで渡したものと一字一句同じでないと LINE が弾く。 */
        redirect_uri: CALLBACK_URL,
        client_id: env.LINE_LOGIN_CHANNEL_ID,
        client_secret: env.LINE_LOGIN_CHANNEL_SECRET,
      }),
    });
  } catch (e) {
    console.error("line token fetch failed", e);
    return json(502, { ok: false, error: "token_unreachable" });
  }
  if (!tokenRes.ok) {
    console.error("line token exchange failed", tokenRes.status, (await tokenRes.text()).slice(0, 300));
    return json(502, { ok: false, error: "token_failed" });
  }
  const token = await tokenRes.json();

  /* userId は id_token（JWT）の sub にある。ここでは署名の再検証はしない
     ―― token エンドポイントとの直接の HTTPS 通信で受け取った値なので、
     途中で差し替えられる経路が無い。payload だけ読む。 */
  let userId = "";
  try {
    const parts = String(token.id_token || "").split(".");
    if (parts.length === 3) {
      const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
      userId = typeof claims.sub === "string" ? claims.sub : "";
    }
  } catch (e) {
    console.error("id_token parse failed", e);
  }

  /* ここが今回の核心。bot と友だちかどうかを LINE に聞く。 */
  let friend = false;
  try {
    const fr = await fetch(FRIENDSHIP_URL, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (fr.ok) {
      friend = !!(await fr.json()).friendFlag;
    } else {
      /* 404/403 が返るのは「リンクされた LINE 公式アカウント」の設定漏れが
         ほとんど。ここを黙って false にすると「設定漏れ」と「友だちでない」
         が区別できず、原因を探せなくなるのでログに出す。 */
      console.error("friendship status failed", fr.status, (await fr.text()).slice(0, 300));
    }
  } catch (e) {
    console.error("friendship fetch failed", e);
  }

  const session = await sign(env.SESSION_SECRET, {
    sub: userId,
    friend,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  });

  return redirect(`${SITE_URL}${safeNext(stateObj.next)}`, [
    setCookie(SESSION_COOKIE, session, SESSION_TTL_SEC),
    clearCookie(STATE_COOKIE),
  ]);
}

/* ── GET /api/me ───────────────────────────────────────────
   画面側がゲートの開閉を決めるのに使う。返すのは友だちかどうかだけで、
   userId は返さない（画面に出す用途が無く、出せば漏れる面が増えるだけ）。 */
export async function handleMe(request, env) {
  if (!configured(env)) {
    /* 未設定のあいだゲートを閉じると、サイトが誰にも使えなくなる。
       設定漏れで機能を落とすより、開けておいて設定を直す方を選ぶ。 */
    return json(200, { ok: true, configured: false, linked: true, reason: "not_configured" });
  }
  const sess = await verify(env.SESSION_SECRET, cookies(request)[SESSION_COOKIE] || "");
  if (!sess) return json(200, { ok: true, configured: true, linked: false, loggedIn: false });
  return json(200, { ok: true, configured: true, linked: !!sess.friend, loggedIn: true });
}

/* ── POST /api/logout ─────────────────────────────────────── */
export async function handleLogout(request, env) {
  return json(200, { ok: true }, { "set-cookie": clearCookie(SESSION_COOKIE) });
}

export const __test = { sign, verify, safeNext, b64urlEncode, b64urlDecode };
