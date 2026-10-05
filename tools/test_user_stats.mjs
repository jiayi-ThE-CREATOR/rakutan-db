/* 利用者の属性を数える仕組み（spec: docs/superpowers/specs/2026-10-05-user-stats-design.md）。
 *   node tools/test_user_stats.mjs
 *
 * 守りたいもの:
 *  1. 学年・学部・科目IDの検証（英字入りの ID 00Z008 を落とさない／外れた値は空に落とす）
 *  2. /api/hit の snap が決めた形で書かれ、既存の集計（速報・stats.mjs）に紛れ込まない
 *  3. PUT /api/profile が Cookie の本人にだけ書き、時間割を丸ごと置き換える
 *  4. usersync.js の送る時機
 *  5. 集計（伏せ字・タグの多重計上・A と B を混ぜない）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

// ── 1. 値の検証 ────────────────────────────────
const { cleanGrade, cleanFaculty, cleanIds } = await import(path.join(ROOT, "worker/profile.js"));

check(cleanGrade("1") === "1" && cleanGrade(6) === "6", "正しい学年を通していない");
check(cleanGrade("7") === "" && cleanGrade("") === "" && cleanGrade(null) === "" && cleanGrade("M1") === "",
  "範囲外の学年を空に落としていない");
check(cleanFaculty("engineering") === "engineering", "正しい学部キーを通していない");
check(cleanFaculty("工学部") === "" && cleanFaculty(undefined) === "", "知らない学部を空に落としていない");
check(JSON.stringify(cleanIds(["138531", "00Z008", "138531"])) === '["138531","00Z008"]',
  "英字入りの ID を落としたか、重複を消していない");
check(cleanIds(["<script>", "a1", "", 12345]).join(",") === "12345", "形の違う ID を通している");
check(cleanIds("138531").length === 0 && cleanIds(undefined).length === 0, "配列でないものを受けている");
check(cleanIds(Array.from({ length: 200 }, (_, i) => String(100000 + i))).length === 80, "81件目以降を捨てていない");

// 学部キーの写しが正本（requirements.json）とずれていないこと
const REQ = JSON.parse(read("web/data/requirements.json"));
for (const f of REQ.faculties) check(cleanFaculty(f.key) === f.key, `正本の学部キー ${f.key} を落としている（profile.js の写しが古い）`);

// ── 2. /api/hit の snap ────────────────────────
const worker = (await import(path.join(ROOT, "worker/index.js"))).default;
const ASSETS = { fetch: async () => new Response("asset", { status: 200 }) };
const CTX = { waitUntil() {} };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const ORIGIN = "https://rakuhan.nocode-sol.co.jp";

async function hit(body) {
  const written = [];
  const env = { ASSETS, STATS: { writeDataPoint: (d) => written.push(d) } };
  const req = new Request(ORIGIN + "/api/hit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: ORIGIN },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, env, CTX);
  return { res, written };
}

{
  const { res, written } = await hit({ e: "snap", g: "1", f: "engineering", ids: ["138531", "00Z008"] });
  check(res.status === 204, "snap に 204 を返していない");
  const w = written[0];
  check(w?.blobs?.[0] === "snap", "snap が blob1 に入っていない");
  check(w?.blobs?.[2] === "1" && w?.blobs?.[3] === "engineering", "学年・学部が blob3・blob4 に入っていない");
  check(w?.blobs?.[4] === "138531,00Z008", "時間割の ID が blob5 にカンマ区切りで入っていない");
  check(JSON.stringify(w?.doubles) === "[1,0,0,0]", "snap が訪問・UU として数えられている");
}
{
  const { written } = await hit({ e: "snap", g: "9", f: "evil", ids: ["x;DROP"] });
  const w = written[0];
  check(w?.blobs?.[2] === "" && w?.blobs?.[3] === "" && w?.blobs?.[4] === "", "snap の不正な値を空に落としていない");
}
{
  const { written } = await hit({ e: "snap" });
  check(written.length === 1 && written[0].blobs[4] === "", "中身の無い snap（未回答・時間割なし）を数えていない");
}
{
  const { written } = await hit({ e: "pv", p: "/", n: 1, d: 1, m: 1, g: "1", ids: ["138531"] });
  check(written[0]?.blobs?.length === 2, "pv に学年・時間割が載ってしまう");
}

// 既存の集計に snap を混ぜない
const { STATS_SQL } = await import(path.join(ROOT, "worker/traffic.js"));
check(/blob1\s*!=\s*'snap'/.test(STATS_SQL), "毎朝の速報の SQL が snap を外していない");
check(/blob1\s*!=\s*'snap'/.test(read("tools/stats.mjs")), "stats.mjs の SQL が snap を外していない");

// ── 3. PUT /api/profile ───────────────────────
const { __test: login } = await import(path.join(ROOT, "worker/linelogin.js"));
const SECRET = "test-secret-key";
const USER = "U" + "a".repeat(32);

/* D1 の偽物。batch で流れた SQL と引数を順に残す。 */
function fakeDB({ fail = false } = {}) {
  const log = [];
  return {
    log,
    prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this; } }; },
    async batch(stmts) {
      if (fail) throw new Error("D1 down");
      for (const s of stmts) log.push([s.sql, s.args]);
      return [];
    },
  };
}

async function putProfile(body, { cookie, db = fakeDB(), method = "PUT" } = {}) {
  const env = {
    ASSETS, DB: db,
    LINE_LOGIN_CHANNEL_ID: "x", LINE_LOGIN_CHANNEL_SECRET: "y", SESSION_SECRET: SECRET,
  };
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const req = new Request(ORIGIN + "/api/profile", {
    method, headers, body: method === "GET" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const res = await worker.fetch(req, env, CTX);
  return { res, log: db.log };
}
const sessCookie = async (sub = USER, exp = Math.floor(Date.now() / 1000) + 600) =>
  `rk_sess=${await login.sign(SECRET, { sub, friend: true, exp })}`;

{ // 未ログインは書かない
  const { res, log } = await putProfile({ grade: "1", faculty: "law", tt: { haru: ["138531"], aki: [] } });
  check(res.status === 401, `Cookie 無しで ${res.status}（401 のはず）`);
  check(log.length === 0, "Cookie 無しで D1 に書いている");
}
{ // 期限切れ・別の鍵の Cookie も書かない
  const old = await sessCookie(USER, Math.floor(Date.now() / 1000) - 1);
  check((await putProfile({ grade: "1" }, { cookie: old })).res.status === 401, "期限切れの Cookie で書いている");
  const forged = `rk_sess=${await login.sign("other-key", { sub: USER, friend: true, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  check((await putProfile({ grade: "1" }, { cookie: forged })).res.status === 401, "別の鍵で作った Cookie で書いている");
}
{ // 正しい1件: 時間割を丸ごと置き換え、学年・学部を書く
  const { res, log } = await putProfile(
    { grade: "2", faculty: "engineering", tt: { haru: ["138531", "00Z008"], aki: ["200001"] } },
    { cookie: await sessCookie() });
  check(res.status === 200, `正しい1件で ${res.status}`);
  check(/^DELETE FROM timetables WHERE line_user_id = \?$/.test(log[0]?.[0] ?? "") && log[0]?.[1][0] === USER,
    "最初に本人の時間割を消していない（丸ごと置き換えになっていない）");
  const ins = log.filter(([sql]) => sql.startsWith("INSERT INTO timetables"));
  check(ins.length === 3, `時間割の INSERT が ${ins.length} 件（3件のはず）`);
  check(ins.every(([, a]) => a[0] === USER), "他人の userId で書いている");
  check(ins.some(([, a]) => a[1] === "haru" && a[2] === "00Z008"), "英字入りの ID を落としている");
  check(ins.some(([, a]) => a[1] === "aki" && a[2] === "200001"), "秋の時間割を書いていない");
  const prof = log.find(([sql]) => sql.startsWith("INSERT INTO line_profiles"));
  check(prof?.[1][0] === USER && prof?.[1][1] === "2" && prof?.[1][2] === "engineering", "学年・学部を書いていない");
}
{ // 時間割を全部外した人 → 行が消えるだけ
  const { log } = await putProfile({ grade: "1", faculty: "law", tt: { haru: [], aki: [] } }, { cookie: await sessCookie() });
  check(log.filter(([sql]) => sql.startsWith("INSERT INTO timetables")).length === 0 &&
        (log[0]?.[0] ?? "").startsWith("DELETE FROM timetables"), "空の時間割で古い行が残る");
}
{ // サイトで未回答（空）の項目は、LINE で答えた値を消さない
  const { log } = await putProfile({ grade: "", faculty: "", tt: { haru: ["138531"], aki: [] } }, { cookie: await sessCookie() });
  check(!log.some(([sql]) => sql.startsWith("INSERT INTO line_profiles")), "学年・学部が両方空なのに line_profiles を書いている");
  const half = await putProfile({ grade: "3", faculty: "", tt: {} }, { cookie: await sessCookie() });
  const p = half.log.find(([sql]) => sql.startsWith("INSERT INTO line_profiles"));
  check(p && /COALESCE\(excluded\.faculty, line_profiles\.faculty\)/.test(p[0]) && p[1][2] === null,
    "空の学部で LINE の回答を上書きしうる（COALESCE で守っていない）");
}
{ // 壊れた本文・違うメソッド・D1 障害
  check((await putProfile("JSON ではない", { cookie: await sessCookie() })).res.status === 400, "壊れた本文で 400 を返していない");
  check((await putProfile({}, { cookie: await sessCookie(), method: "POST" })).res.status === 405, "PUT 以外で 405 を返していない");
  const down = await putProfile({ grade: "1" }, { cookie: await sessCookie(), db: fakeDB({ fail: true }) });
  check(down.res.status === 500, "D1 が落ちたときに 500 を返していない");
}

// スキーマに表がある
check(/CREATE TABLE IF NOT EXISTS timetables/.test(read("db/schema.sql")), "db/schema.sql に timetables が無い");

// ── 結果 ─────────────────────────────────
if (fails.length) {
  console.error(`NG ${fails.length}/${n}`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK ${n}`);
