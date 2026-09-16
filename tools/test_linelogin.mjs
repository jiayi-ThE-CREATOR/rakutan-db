/* LINE ログインのセッションと、戻り先の扱い（worker/linelogin.js）。
 *
 *   node tools/test_linelogin.mjs
 *
 * ■ ここが守っているもの
 * ゲートの判定は最終的にこの署名つき Cookie 1枚に載る。だから
 *   ・friend:false を true に書き換えて通せないこと
 *   ・別の鍵で作ったものを通さないこと
 *   ・期限切れを通さないこと
 * が崩れると、画面側の覆いは意味を失う（2026-09-13 の穴に戻る）。
 *
 * 戻り先（next）は外部URLを弾く。ここが緩むと、ログインの入口が
 * 別サイトへの踏み台になる。
 *
 * ■ 2026-09-16 に足したもの ―― ドメイン
 * 新ドメインは吉村さんのサーバー経由で Worker に届くので、Worker からは
 * 旧ドメイン（*.workers.dev）で来たように見える。request.url の origin で
 * redirect_uri を組んでいたため LINE の登録と一致せず、**本番で誰も
 * ログインできなかった**。下の「ドメイン」の節は、Worker が旧ドメインの
 * URL でリクエストを受けた前提（本番と同じ）で、LINE へ渡す値と戻り先が
 * 新ドメインになっていることを確かめる。
 */
import { __test, handleLineLogin, handleLineCallback, SITE_URL } from "../worker/linelogin.js";

const { sign, verify, safeNext } = __test;
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const S = "test-secret-key";
const future = () => Math.floor(Date.now() / 1000) + 600;

/* ── 戻り先 ─────────────────────────────────── */
check(safeNext("/mypage") === "/mypage", "自サイト内のパスを通していない");
check(safeNext("/?year=2&sem=haru") === "/?year=2&sem=haru", "クエリ付きのパスを通していない");
check(safeNext("//evil.example/x") === "/", "// で始まる値を外部URLとして弾いていない");
check(safeNext("https://evil.example") === "/", "絶対URLを弾いていない");
check(safeNext("javascript:alert(1)") === "/", "javascript: を弾いていない");
check(safeNext(undefined) === "/", "未指定を / にしていない");
check(safeNext("") === "/", "空文字を / にしていない");

/* ── 署名 ───────────────────────────────────── */
{
  const t = await sign(S, { sub: "U1", friend: true, exp: future() });
  const got = await verify(S, t);
  check(got?.friend === true, "正しい署名のセッションを読めていない");
  check(got?.sub === "U1", "userId が復元できていない");
}
{
  const t = await sign(S, { sub: "U1", friend: true, exp: future() });
  check(await verify("another-secret", t) === null, "別の鍵で作ったものを通している");
}
{
  /* 本命：friend:false を true に書き換える。payload だけ差し替えても
     署名が合わないので通らない、が期待。 */
  const exp = future();
  const real = await sign(S, { sub: "U1", friend: false, exp });
  const [payload, sig] = real.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "U1", friend: true, exp }))
    .toString("base64url");
  check(forged !== payload, "テストの前提が崩れている（改ざん payload が元と同じ）");
  check(await verify(S, `${forged}.${sig}`) === null,
        "friend:false → true の書き換えが通ってしまう（ゲートを素通りできる穴）");
}
{
  const t = await sign(S, { sub: "U1", friend: false, exp: future() });
  const [payload, sig] = t.split(".");
  check(await verify(S, `${payload}.${"A".repeat(sig.length)}`) === null,
        "署名を差し替えたものを通している");
}
{
  const old = await sign(S, { sub: "U1", friend: true, exp: Math.floor(Date.now() / 1000) - 1 });
  check(await verify(S, old) === null, "期限切れを通している");
}
for (const bad of ["", "abc", "a.b.c", ".", "x.", ".y", null, undefined, 123, {}]){
  check(await verify(S, bad) === null, `壊れた値を通している: ${JSON.stringify(bad)}`);
}
{
  /* exp が無い・数値でないものを弾く（期限なしのセッションを作らせない）。 */
  const noExp = await sign(S, { sub: "U1", friend: true });
  check(await verify(S, noExp) === null, "exp の無いセッションを通している");
  const strExp = await sign(S, { sub: "U1", friend: true, exp: "9999999999" });
  check(await verify(S, strExp) === null, "exp が文字列のセッションを通している");
}

/* ── ドメイン（2026-09-16 の本番事故の再発防止）──────────── */
const ENV = {
  LINE_LOGIN_CHANNEL_ID: "2011609321",
  LINE_LOGIN_CHANNEL_SECRET: "x".repeat(32),
  SESSION_SECRET: S,
};
/* 本番と同じく、Worker には旧ドメインの URL で届く前提で呼ぶ。 */
const OLD = "https://rakutan-db.wjy20050815.workers.dev";

check(SITE_URL === "https://rakuhan.nocode-sol.co.jp",
      `SITE_URL が LINE に登録したドメインと違う（${SITE_URL}）`);
{
  /* ① go 無し：Cookie を置かず、新ドメインの go=1 へ移るだけ */
  const r1 = await handleLineLogin(new Request(`${OLD}/line/login?next=/mypage`), ENV);
  const loc1 = r1.headers.get("location") || "";
  check(r1.status === 302, "1段目が 302 でない");
  check(loc1 === `${SITE_URL}/line/login?go=1&next=%2Fmypage`,
        `1段目で新ドメインへ移していない（${loc1}）`);
  check(!r1.headers.get("set-cookie"),
        "1段目で Cookie を置いている（旧ドメインに state が残り、戻ったときに照合が落ちる）");

  /* ② go=1：LINE へ渡す redirect_uri が新ドメインのコールバック */
  const r2 = await handleLineLogin(new Request(`${OLD}/line/login?go=1&next=/mypage`), ENV);
  const loc2 = new URL(r2.headers.get("location") || "https://invalid/");
  check(loc2.origin === "https://access.line.me", `2段目が LINE の認可画面へ行っていない（${loc2.origin}）`);
  check(loc2.searchParams.get("redirect_uri") === `${SITE_URL}/line/callback`,
        `LINE へ渡す redirect_uri が新ドメインでない（${loc2.searchParams.get("redirect_uri")}）── 本番で誰もログインできなくなる`);
  check(loc2.searchParams.get("client_id") === ENV.LINE_LOGIN_CHANNEL_ID, "client_id が違う");
  check((r2.headers.get("set-cookie") || "").startsWith("rk_oauth_state="), "2段目で state の Cookie を置いていない");
  check(!/;\s*Domain=/i.test(r2.headers.get("set-cookie") || ""),
        "Cookie に Domain を付けている（ブラウザが開いているホストに紐づけるため付けない）");

  /* 戻り先を外部へ差し替えようとしても、1段目で自サイト内に丸める */
  const r3 = await handleLineLogin(new Request(`${OLD}/line/login?next=//evil.example/x`), ENV);
  check(r3.headers.get("location") === `${SITE_URL}/line/login?go=1&next=%2F`,
        `外部の戻り先が丸められていない（${r3.headers.get("location")}）`);
}
{
  /* キャンセルで戻ってきたとき（code 無し）も、新ドメインへ帰す */
  const state = await sign(S, { n: "x", next: "/mypage", exp: future() });
  const r = await handleLineCallback(
    new Request(`${OLD}/line/callback?error=access_denied&state=${encodeURIComponent(state)}`), ENV);
  check(r.headers.get("location") === `${SITE_URL}/mypage`,
        `キャンセル時の戻り先が新ドメインでない（${r.headers.get("location")}）`);
}

if (fails.length){
  console.log("NG");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`  通過 ${n} 件`);
console.log("OK");
