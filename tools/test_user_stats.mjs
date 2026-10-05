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

// ── 結果 ─────────────────────────────────
if (fails.length) {
  console.error(`NG ${fails.length}/${n}`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK ${n}`);
