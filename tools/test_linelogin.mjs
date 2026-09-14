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
 */
import { __test } from "../worker/linelogin.js";

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

if (fails.length){
  console.log("NG");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log(`  通過 ${n} 件`);
console.log("OK");
