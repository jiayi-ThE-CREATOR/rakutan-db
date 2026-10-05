# 利用者の属性を数える Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学年・学部・時間割（と授業内容タグ）を、匿名（A・端末・日）とログイン者（B・人）の2系統で集め、`tools/users_report.mjs` で表と CSV に出す。

**Architecture:** A は既存の `POST /api/hit` に `snap` という種類を足し、Analytics Engine に1日1回のスナップショットを書く。B は新しい `PUT /api/profile` が署名付き Cookie の userId で D1（`line_profiles`＋新しい `timetables`）を丸ごと置き換える。ブラウザ側は新しい `usersync.js` が両方を送り、集計は Cloudflare の SQL API / D1 REST API から取って同じ集計関数に通す。

**Tech Stack:** Cloudflare Workers（素の ES modules）・D1・Analytics Engine・ブラウザの素の JS・Node 製の自前テスト（`check()` 方式、テストフレームワーク無し）

**Spec:** `docs/superpowers/specs/2026-10-05-user-stats-design.md`

## Global Constraints

- 端末IDは発行しない（A で人を数えない）
- 学年は `"1"`〜`"6"` の文字列、学部は requirements.json の faculties の11キー、科目IDは `/^[0-9A-Z]{1,12}$/`・1リストあたり最大80件。外れた値は空に落とす（エラーにしない）
- localStorage を読むのは store.js（`rkStore`）だけ。analytics.js が触る鍵は `rk_nostats`・`rk_d`・`rk_m`・`rk_sd` の4つだけ
- Workers の入口 `worker/index.js` は**関数以外の named export を置かない**（置くと起動で落ちる。2026-09-03 実測）。新モジュールも関数だけを export する
- 計測・同期の失敗で画面を止めない（`/api/hit` は常に 204、`PUT /api/profile` の失敗はブラウザで握りつぶす）
- Analytics Engine の集計は必ず `_sample_interval` を掛ける
- A と B の数字を足さない。見出しに単位（端末・日／人）を書く
- `--public` では5未満のセルを「5未満」にし、そのセルの比率も出さない
- CSV と内部用の数字はリポジトリ（公開）に置かない
- 日本語の文面は `python3 ~/Developer/es-coach-skills/tools/check_ja_kanji.py <file>` で簡体字・中国語句読点が無いことを確かめる

## Review Focus

1. **LINE で答えた学年・学部を、サイトの未回答（空）が消す** —— 空の項目は上書きしない。Task 2 のテストで固定
2. **時間割が空になった人** —— 全部外したら D1 の行も消える（丸ごと置き換え）。Task 2 のテストで固定
3. **`00Z008` のような英字入りの科目ID** —— 数字だけの正規表現だと324件が黙って落ちる。Task 1 のテストで固定
4. **`snap` が毎朝の Discord 速報・`stats.mjs` に紛れ込む** —— `blob1 != 'snap'`。Task 1 のテストで固定
5. **プライベートモード（localStorage が例外）で `rkSnap` が毎回送る** —— 印を残せない端末は送らない（UU と同じ考え方）。Task 3 のテストで固定

---

## ファイル構成

| ファイル | 役割 | 新規/変更 |
|---|---|---|
| `worker/profile.js` | 値の検証（学年・学部・ID）と `PUT /api/profile` | 新規 |
| `worker/linelogin.js` | `sessionUser()` を足す（Cookie → userId） | 変更 |
| `worker/index.js` | `handleHit` に `snap`、`/api/profile` の経路 | 変更 |
| `worker/traffic.js`・`tools/stats.mjs` | `snap` を既存の集計から外す | 変更 |
| `db/schema.sql` | `timetables` 表、冒頭の方針の注記 | 変更 |
| `web/assets/store.js` | `snapshot()` と `rk:store-changed` | 変更 |
| `web/assets/analytics.js` | `window.rkSnap` | 変更 |
| `web/assets/gate.js` | `rkGate.state()` | 変更 |
| `web/assets/usersync.js` | A・B の送信 | 新規 |
| `web/index.html`・`web/mypage.html` | usersync.js を読み込む | 変更 |
| `tools/users_report_lib.mjs` | 集計・伏せ字・CSV（純関数） | 新規 |
| `tools/users_report.mjs` | API から取って表と CSV に出す | 新規 |
| `tools/test_user_stats.mjs` | Worker・usersync・集計のテスト | 新規 |
| `tools/test_analytics.mjs` | `rkSnap` のテスト | 変更 |
| `web/about.html`・`HANDOFF.md` | 告知と引き継ぎ | 変更 |

作業はすべて worktree `~/Developer/rakutan-db-userstats`（ブランチ `feat/user-stats`）で行う。

---

### Task 1: 値の検証と `/api/hit` の `snap`

**Files:**
- Create: `worker/profile.js`
- Modify: `worker/index.js`（import と `HIT_EVENTS`（1100行付近）と `handleHit`（1121行付近））
- Modify: `worker/traffic.js`（`STATS_SQL` の WHERE、63行付近）
- Modify: `tools/stats.mjs`（`sql` の WHERE、46行付近）
- Test: `tools/test_user_stats.mjs`（新規）

**Interfaces:**
- Produces: `worker/profile.js` の `cleanGrade(v) → string`、`cleanFaculty(v) → string`、`cleanIds(v) → string[]`（Task 2 が使う）
- Produces: `/api/hit` が受ける本文 `{ e: "snap", g: string, f: string, ids: string[] }`（Task 3 が送る）
- Produces: Analytics Engine の行 `blobs: ["snap", "", grade, faculty, ids.join(",")]`・`doubles: [1, 0, 0, 0]`（Task 4 が読む）

- [ ] **Step 1: 落ちるテストを書く**

`tools/test_user_stats.mjs` を作る:

```js
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
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_user_stats.mjs`
Expected: `worker/profile.js` が無いので import で落ちる（`ERR_MODULE_NOT_FOUND`）

- [ ] **Step 3: `worker/profile.js` を作る**

```js
/* 利用者の属性（学年・学部・時間割）の検証と保存。
 * 設計: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 * ■ 検証は「外れたら空に落とす」
 *   計測（/api/hit）でもログイン者の保存（PUT /api/profile）でも、変な値で
 *   エラーを返して画面を止める理由は無い。数えられないものは「未回答」として数える。
 *
 * ■ 科目IDは数字だけではない
 *   全7,906件のうち324件が 00Z008 のような英大文字入り。数字だけの正規表現にすると
 *   それらが黙って落ちる。
 *
 * ■ 関数だけを export する（定数を export すると、index.js から import したときに
 *   Workers の起動で落ちる ―― index.js 冒頭の注記と同じ理由）。
 */

/* 正本は web/data/requirements.json の faculties。worker/index.js の FACULTIES と同じ11組。
   ずれは tools/test_user_stats.mjs が見張る。 */
const FACULTY_KEYS = new Set([
  "letters", "human-sci", "law", "economics", "foreign-s", "science",
  "medicine", "dentistry", "pharmacy", "engineering", "engr-sci",
]);
const GRADES = new Set(["1", "2", "3", "4", "5", "6"]);
const COURSE_ID_RE = /^[0-9A-Z]{1,12}$/;
const MAX_IDS = 80;

export function cleanGrade(v) {
  const s = String(v ?? "");
  return GRADES.has(s) ? s : "";
}

export function cleanFaculty(v) {
  const s = String(v ?? "");
  return FACULTY_KEYS.has(s) ? s : "";
}

export function cleanIds(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    const s = String(x);
    if (COURSE_ID_RE.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}
```

- [ ] **Step 4: `handleHit` に `snap` を足す**

`worker/index.js` の import 群（`./linelogin.js` の import の直後）に足す:

```js
import { cleanGrade, cleanFaculty, cleanIds } from "./profile.js";
```

`HIT_EVENTS` を変える:

```js
const HIT_EVENTS = new Set(["pv", "search", "detail", "snap"]);
```

`handleHit` の `const fresh = …` の直前に足す:

```js
  /* 1日1回のスナップショット（利用者の属性。spec 2026-10-05-user-stats）。
     送るかどうか（その日の1回目か）は analytics.js が決める。ここは中身を検証して書くだけ。
     パスは要らないので空。訪問・UU には数えない（doubles は件数の1だけ）。 */
  if (event === "snap") {
    try {
      env.STATS?.writeDataPoint({
        blobs: ["snap", "", cleanGrade(body?.g), cleanFaculty(body?.f), cleanIds(body?.ids).join(",")],
        doubles: [1, 0, 0, 0],
        indexes: ["snap"],
      });
    } catch (e) {}
    return done();
  }
```

- [ ] **Step 5: 既存の集計から `snap` を外す**

`worker/traffic.js` の `STATS_SQL`:

```js
WHERE timestamp >= NOW() - INTERVAL '9' DAY AND blob1 != 'snap'
```

`tools/stats.mjs` の `sql`:

```js
WHERE timestamp >= NOW() - INTERVAL '${days}' DAY AND blob1 != 'snap'
```

- [ ] **Step 6: 通ることを確かめる**

Run: `node tools/test_user_stats.mjs && node tools/test_analytics.mjs && node tools/test_traffic_report.mjs && node tools/test_bot_flow.mjs`
Expected: すべて `OK <件数>`

- [ ] **Step 7: Commit**

```bash
git add worker/profile.js worker/index.js worker/traffic.js tools/stats.mjs tools/test_user_stats.mjs
git commit -m "feat(stats): /api/hit に1日1回の属性スナップショット（snap）を足す"
```

---

### Task 2: `PUT /api/profile`（ログイン者の学年・学部・時間割を D1 へ）

**Files:**
- Modify: `worker/linelogin.js`（`handleLogout` の後ろ、`__test` の前）
- Modify: `worker/profile.js`（末尾に `handleProfile`）
- Modify: `worker/index.js`（`route()` の `/api/favorites` の直前）
- Modify: `db/schema.sql`
- Test: `tools/test_user_stats.mjs`（「── 結果」の直前に追記）

**Interfaces:**
- Consumes: Task 1 の `cleanGrade` / `cleanFaculty` / `cleanIds`
- Produces: `sessionUser(request, env) → Promise<string|null>`（linelogin.js）
- Produces: `PUT /api/profile` 本文 `{ grade: string, faculty: string, tt: { haru: string[], aki: string[] } }` → 200 `{ok:true}` / 401 `{ok:false,error:"not_logged_in"}` / 400 / 405 / 503（Task 3 が送る）
- Produces: D1 表 `timetables(line_user_id, term_group, course_id, updated_at)`（Task 4 が読む）

- [ ] **Step 1: 落ちるテストを書く**

`tools/test_user_stats.mjs` の「── 結果」の直前に追記する:

```js
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
        log[0]?.[0].startsWith("DELETE FROM timetables"), "空の時間割で古い行が残る");
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
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_user_stats.mjs`
Expected: `NG` に「Cookie 無しで 404（401 のはず）」など。`/api/profile` が ASSETS に流れて 200 になるため、401・INSERT 系の行が並ぶ

- [ ] **Step 3: `sessionUser` を足す**

`worker/linelogin.js` の `handleLogout` の後ろに足す:

```js
/* ── PUT /api/profile が「誰の」データかを決める ─────────────
   署名・期限が通った Cookie のときだけ userId を返す。/api/me と違い、
   友だちかどうか（friend）は問わない ―― 書くのは本人の時間割なので、
   ログインしていれば十分。未設定（configured でない）なら誰でもない。 */
export async function sessionUser(request, env) {
  if (!configured(env)) return null;
  const sess = await verify(env.SESSION_SECRET, cookies(request)[SESSION_COOKIE] || "");
  return sess && typeof sess.sub === "string" && sess.sub ? sess.sub : null;
}
```

- [ ] **Step 4: `handleProfile` を足す**

`worker/profile.js` の先頭（注記の直後）に import を足す:

```js
import { sessionUser } from "./linelogin.js";
```

末尾に足す:

```js
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const TERMS = ["haru", "aki"];

/* ── PUT /api/profile ─────────────────────────────────────
 * ログインした人の学年・学部・時間割を、毎回まるごと受け取って置き換える。
 * 追加・削除の差分を送る形にしないのは、取りこぼした1回で D1 とブラウザが
 * 永久にずれるから（丸ごとなら次の1回で必ず揃う）。
 *
 * 学年・学部は line_profiles（LINE の問診と同じ表）に書く。空の項目は
 * COALESCE で既存の値を残す ―― サイトで未回答の人が、LINE で答えた値を
 * 空で消さないため。両方空なら line_profiles は触らない。 */
export async function handleProfile(request, env) {
  if (request.method !== "PUT") {
    return new Response("method not allowed", { status: 405, headers: { allow: "PUT" } });
  }
  if (!env.DB) return json(503, { ok: false, error: "not_configured" });
  const userId = await sessionUser(request, env);
  if (!userId) return json(401, { ok: false, error: "not_logged_in" });

  let body;
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }

  const grade = cleanGrade(body?.grade);
  const faculty = cleanFaculty(body?.faculty);
  const now = Date.now();

  const stmts = [env.DB.prepare("DELETE FROM timetables WHERE line_user_id = ?").bind(userId)];
  for (const term of TERMS) {
    for (const id of cleanIds(body?.tt?.[term])) {
      stmts.push(env.DB.prepare(
        "INSERT INTO timetables (line_user_id, term_group, course_id, updated_at) VALUES (?, ?, ?, ?)"
      ).bind(userId, term, id, now));
    }
  }
  if (grade || faculty) {
    stmts.push(env.DB.prepare(
      "INSERT INTO line_profiles (line_user_id, grade, faculty, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (line_user_id) DO UPDATE SET " +
        "grade = COALESCE(excluded.grade, line_profiles.grade), " +
        "faculty = COALESCE(excluded.faculty, line_profiles.faculty), " +
        "updated_at = excluded.updated_at"
    ).bind(userId, grade || null, faculty || null, now));
  }

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    console.error("handleProfile error", e);
    return json(500, { ok: false, error: "db_error" });
  }
  return json(200, { ok: true });
}
```

- [ ] **Step 5: 経路を足す**

`worker/index.js` の import を変える:

```js
import { cleanGrade, cleanFaculty, cleanIds, handleProfile } from "./profile.js";
```

`route()` の `if (url.pathname === "/api/favorites") {` の直前に足す:

```js
  if (url.pathname === "/api/profile") {
    return handleProfile(request, env);
  }
```

- [ ] **Step 6: スキーマを足す**

`db/schema.sql` の冒頭の2行目「line_user_id はLINEのuserId。学部・学年などの個人情報はここに持たない。」を次に置き換える:

```sql
-- line_user_id はLINEのuserId。名前・メール等は持たない。
-- 学年・学部・時間割は 2026-10-05 から持つ（wang 判断。利用者の属性を数えるため。
-- docs/superpowers/specs/2026-10-05-user-stats-design.md）。about の「利用データの扱い」に告知あり。
```

末尾に足す:

```sql

-- ログインした人の時間割（2026-10-05・利用者の属性を数えるため）。
-- PUT /api/profile が本人の行を消して入れ直す（丸ごと置き換え）。
-- term_group は 'haru' / 'aki'。通年の科目は両方に入る（store.js の termsFor と同じ）。
CREATE TABLE IF NOT EXISTS timetables (
  line_user_id TEXT NOT NULL,
  term_group TEXT NOT NULL,
  course_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (line_user_id, term_group, course_id)
);
```

- [ ] **Step 7: 通ることを確かめる**

Run: `node tools/test_user_stats.mjs && node tools/test_linelogin.mjs && node tools/test_analytics.mjs`
Expected: すべて `OK <件数>`

- [ ] **Step 8: Commit**

```bash
git add worker/linelogin.js worker/profile.js worker/index.js db/schema.sql tools/test_user_stats.mjs
git commit -m "feat(stats): PUT /api/profile ―― ログイン者の学年・学部・時間割を D1 へ丸ごと置き換え"
```

---

### Task 3: ブラウザ側の送信（`rkSnap`・`usersync.js`）

**Files:**
- Modify: `web/assets/store.js`（`writeTT`・`setProfile`・`rkStore` に `snapshot`）
- Modify: `web/assets/analytics.js`（送信を `send()` に切り出し、`window.rkSnap`、冒頭の注記）
- Modify: `web/assets/gate.js`（`window.rkGate` に `state`）
- Create: `web/assets/usersync.js`
- Modify: `web/index.html`（411行 `onboard.js` の直後）、`web/mypage.html`（284行 `mypage.js` の直後）
- Test: `tools/test_analytics.mjs`（`rkSnap`）、`tools/test_user_stats.mjs`（usersync）

**Interfaces:**
- Consumes: Task 1 の `/api/hit` の `snap` 本文、Task 2 の `PUT /api/profile`
- Produces: `rkStore.snapshot() → { grade: string, faculty: string, tt: { haru: string[], aki: string[] } }`
- Produces: `window.rkSnap(snapshot)`（その日1回だけ送る）、`window.rkGate.state() → { loggedIn, linked, configured }`
- Produces: イベント `rk:store-changed`（学年・学部・時間割が書かれたとき）

- [ ] **Step 1: `rkSnap` の落ちるテストを書く**

`tools/test_analytics.mjs` の `run()` の return を変える（`snap` を足す）:

```js
  return { loaded, shown, hits, ls: ctx.localStorage, ss: ctx.sessionStorage, track: ctx.window.rkTrack, snap: ctx.window.rkSnap };
```

「── 4. Worker の POST /api/hit」の直前に足す:

```js
// ── 3c. 属性のスナップショット（rkSnap・1日1回） ──
const SNAP = { grade: "1", faculty: "law", tt: { haru: ["138531", "00Z008"], aki: ["138531"] } };
{ // その日の1回目だけ送る
  const { hits, ls, snap } = run("https://rakuhan.nocode-sol.co.jp/");
  check(typeof snap === "function", "window.rkSnap が無い");
  snap(SNAP);
  const s = hits.find((h) => h.body.e === "snap");
  check(s?.body.g === "1" && s?.body.f === "law", "snap に学年・学部が載っていない");
  check(JSON.stringify(s?.body.ids) === '["138531","00Z008"]', "春秋の時間割を重複なしで1本にしていない");
  check(ls._dump().rk_sd === TODAY, "snap の日付印 rk_sd が残っていない");
  snap(SNAP);
  check(hits.filter((h) => h.body.e === "snap").length === 1, "同じ日に snap を2回送っている");
}
{ // 前の日に送った端末は今日また送る
  const { hits, snap } = run("https://rakuhan.nocode-sol.co.jp/", { rk_sd: "2000-01-01" });
  snap(SNAP);
  check(hits.some((h) => h.body.e === "snap"), "日が変わったのに snap を送っていない");
}
{ // 除外された端末・localStorage が全滅の端末は送らない
  const ex = run("https://rakuhan.nocode-sol.co.jp/", { rk_nostats: "1" });
  ex.snap(SNAP);
  check(!ex.hits.some((h) => h.body.e === "snap"), "除外された端末で snap を送っている");
  const priv = run("https://rakuhan.nocode-sol.co.jp/", {}, true);
  priv.snap(SNAP);
  check(!priv.hits.some((h) => h.body.e === "snap"), "印を残せない端末で snap を送っている（毎回数えてしまう）");
}
{ // 中身が空・壊れていても落ちずに送る（未回答も数の一部）
  const { hits, snap } = run("https://rakuhan.nocode-sol.co.jp/");
  snap(undefined);
  const s = hits.find((h) => h.body.e === "snap");
  check(s && s.body.g === "" && s.body.ids.length === 0, "空のスナップショットを送っていない");
}
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_analytics.mjs`
Expected: `NG` に「window.rkSnap が無い」

- [ ] **Step 3: analytics.js に `rkSnap` を足す**

`web/assets/analytics.js`:

(a) 冒頭の注記の「localStorage を直に触る。鍵は rk_nostats と UU の日付印 rk_d・rk_m の3つだけに留めること。」を次に置き換える:

```js
 *   localStorage を直に触る。鍵は rk_nostats と UU の日付印 rk_d・rk_m、
 *   スナップショットの日付印 rk_sd の4つだけに留めること。
```

(b) 「■ UU（日・月）の数え方」の節の後ろに足す:

```js
 * ■ 属性のスナップショット（2026-10-05 追加・spec 2026-10-05-user-stats）
 *
 *   window.rkSnap({ grade, faculty, tt }) を usersync.js が呼ぶ。その日（JST）の
 *   1回目だけ、学年・学部・時間割の科目IDを e:"snap" で送る。日付印は rk_sd。
 *   ここでも端末IDは送らない。学年・学部・時間割を読むのは store.js で、
 *   このファイルは渡された値を送るだけ。
```

(c) `UU` の鍵の定数（`DKEY`・`MKEY`）の隣に足す:

```js
  const SDKEY = "rk_sd";
```

(d) `hit()` の中の「sendBeacon はページを離れる途中でも届く」から `} catch (e) {}` までを、関数 `send(body)` に切り出して `hit()` の前に置く:

```js
  /* sendBeacon はページを離れる途中でも届く。ここで待たない
     ―― 計測のために操作を1msでも遅らせない。 */
  function send(body) {
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon(HIT_URL, new Blob([body], { type: "application/json" }))) return;
      fetch(HIT_URL, {
        method: "POST", body, keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    } catch (e) {}
  }
```

`hit()` の末尾は `send(body);` の1行にする。

(e) `hit()` の後ろ・`window.rkTrack = hit;` の直前に足す:

```js
  /* 1日1回の属性スナップショット。印（rk_sd）を残せない端末は送らない
     ―― 毎回「その日の1回目」に見えて上に膨らむより、数え損ねる方を選ぶ（UU と同じ）。 */
  function snap(s) {
    if (excluded) return;
    if (!firstIn(SDKEY, jstDay())) return;
    const ids = [...new Set([...(s?.tt?.haru || []), ...(s?.tt?.aki || [])].map(String))];
    send(JSON.stringify({ e: "snap", g: String(s?.grade || ""), f: String(s?.faculty || ""), ids }));
  }
```

(f) `window.rkTrack = hit;` の直後に足す:

```js
  window.rkSnap = snap;
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node tools/test_analytics.mjs`
Expected: `OK <件数>`

- [ ] **Step 5: usersync の落ちるテストを書く**

`tools/test_user_stats.mjs` の「── 結果」の直前に追記する:

```js
// ── 4. usersync.js（送る時機） ─────────────────
import vm from "node:vm";
const SYNC_SRC = read("web/assets/usersync.js");

/* 偽ブラウザ。イベントは自前で配る。setTimeout は手で進める。 */
function runSync({ wait = "", loggedIn = true, gate = true } = {}) {
  const listeners = {};
  const timers = [];
  const puts = [];
  const snaps = [];
  const SNAP = { grade: "1", faculty: "law", tt: { haru: ["138531"], aki: [] } };
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    rkStore: { snapshot: () => SNAP },
    rkSnap: (s) => snaps.push(s),
  };
  let resolveGate;
  if (gate) {
    window.rkGate = {
      ready: new Promise((r) => { resolveGate = r; }),
      state: () => ({ loggedIn, linked: true, configured: true }),
    };
  }
  const ctx = {
    window,
    document: { currentScript: { dataset: wait ? { wait } : {} } },
    fetch: (url, opts) => { puts.push({ url, opts }); return Promise.resolve({ ok: true }); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    JSON, Promise, console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SYNC_SRC, ctx);
  const fire = (type) => (listeners[type] || []).forEach((fn) => fn({}));
  const flushTimers = () => { for (const t of timers.splice(0)) t.fn && t.fn(); };
  return { puts, snaps, timers, fire, flushTimers, openGate: async () => { resolveGate?.(); await new Promise((r) => setImmediate(r)); } };
}

{ // マイページ（待たない）: 読み込んだ時点でスナップショット
  const s = runSync();
  check(s.snaps.length === 1, "マイページで読み込み時に rkSnap を呼んでいない");
}
{ // トップ（data-wait="app"）: rk:app-ready まで待つ
  const s = runSync({ wait: "app" });
  check(s.snaps.length === 0, "トップで app.js の準備より先に rkSnap を呼んでいる（URL の学年が反映されない）");
  s.fire("rk:app-ready");
  check(s.snaps.length === 1, "rk:app-ready のあとに rkSnap を呼んでいない");
}
{ // ログイン者: ゲートの判定のあとに1回 PUT、変更は2秒まとめて1回
  const s = runSync();
  check(s.puts.length === 0, "/api/me の判定より先に PUT している");
  await s.openGate();
  check(s.puts.length === 1 && s.puts[0].url === "/api/profile" && s.puts[0].opts.method === "PUT",
    "ログイン者に最初の PUT /api/profile を送っていない");
  check(JSON.parse(s.puts[0].opts.body).tt.haru[0] === "138531", "PUT の本文が rkStore.snapshot() になっていない");
  s.fire("rk:store-changed"); s.fire("rk:store-changed"); s.fire("rk:store-changed");
  check(s.puts.length === 1, "変更のたびにその場で送っている（debounce が無い）");
  check(s.timers.some((t) => t.fn && t.ms === 2000), "debounce が2秒になっていない");
  s.flushTimers();
  check(s.puts.length === 2, "続けて3回変えたのに1回にまとまっていない");
}
{ // 未ログインは PUT しない（変更があっても）
  const s = runSync({ loggedIn: false });
  await s.openGate();
  s.fire("rk:store-changed"); s.flushTimers();
  check(s.puts.length === 0, "未ログインで PUT /api/profile を送っている");
  check(s.snaps.length === 1, "未ログインでも匿名のスナップショットは送るはず");
}
{ // gate.js が無いページでも落ちない（送らないだけ）
  const s = runSync({ gate: false });
  await new Promise((r) => setImmediate(r));
  check(s.puts.length === 0, "gate.js が無いページで PUT している");
}
// 読み込み順（rkStore・rkGate・rkSnap が先にあること）
for (const page of ["web/index.html", "web/mypage.html"]) {
  const html = read(page);
  const at = (src) => html.indexOf(`src="/assets/${src}"`);
  check(at("usersync.js") > 0, `${page} が usersync.js を読み込んでいない`);
  check(at("usersync.js") > at("store.js") && at("usersync.js") > at("gate.js") && at("usersync.js") > at("analytics.js"),
    `${page} で usersync.js が store.js / gate.js / analytics.js より前にある`);
}
check(/src="\/assets\/usersync\.js" data-wait="app"/.test(read("web/index.html")), "トップの usersync.js に data-wait=\"app\" が無い");

// store.js: snapshot と変更の合図
{
  const STORE_SRC = read("web/assets/store.js");
  const m = new Map(Object.entries({
    osaka_u_settings: JSON.stringify({ faculty: "law", grade: "2", semester: "x" }),
    rk_timetable: JSON.stringify({ v: 1, haru: { slots: { "月1": "138531", "月2": "138531" }, extra: ["00Z008"] }, aki: { slots: {}, extra: [] } }),
  }));
  const events = [];
  const win = { dispatchEvent: (e) => events.push(e.type) };
  const ctx = {
    window: win,
    localStorage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    JSON, console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(STORE_SRC, ctx);
  const snap = win.rkStore.snapshot();
  check(snap.grade === "2" && snap.faculty === "law", "snapshot に学年・学部が無い");
  check(JSON.stringify(snap.tt.haru) === '["138531","00Z008"]', "snapshot の時間割が2コマの科目を重ねているか extra を落としている");
  win.rkStore.addExtra("aki", "200001");
  win.rkStore.setProfile({ grade: "3" });
  check(events.filter((t) => t === "rk:store-changed").length === 2, "時間割・学年を書いても rk:store-changed が出ていない");
}
```

- [ ] **Step 6: 落ちることを確かめる**

Run: `node tools/test_user_stats.mjs`
Expected: `web/assets/usersync.js` が無いので `ENOENT` で落ちる

- [ ] **Step 7: store.js に `snapshot` と変更の合図を足す**

`web/assets/store.js` の `const writeTT = …` を置き換える:

```js
  /* 学年・学部・時間割が書かれたら知らせる。usersync.js がログイン者の分を
     サーバーへ送り直す合図（spec 2026-10-05-user-stats）。 */
  const changed = () => {
    try { window.dispatchEvent(new CustomEvent("rk:store-changed")); } catch (e) {}
  };
  const writeTT = (tt) => { write(K_TT, JSON.stringify(tt)); changed(); };
```

`setProfile` の `write(K_SET, JSON.stringify(o));` の直後に `changed();` を足す。

`rkStore` の `getTimetable(t) { … },` の直前に足す:

```js
    /* 学年・学部・時間割の写し。usersync.js が匿名の計測（rkSnap）と
       ログイン者の保存（PUT /api/profile）の両方にこれを渡す。
       2コマ以上の科目は slots に同じ ID が並ぶので、重複を消す。 */
    snapshot() {
      const p = this.getProfile();
      const tt = readTT();
      const ids = (t) => [...new Set([...Object.values(tt[t].slots), ...tt[t].extra].map(String))];
      return { grade: p.grade, faculty: p.faculty, tt: { haru: ids("haru"), aki: ids("aki") } };
    },
```

冒頭の注記の鍵の一覧の下に1行足す:

```js
 * 学年・学部・時間割を書いたら rk:store-changed を出す（usersync.js が聞いている）。
```

- [ ] **Step 8: gate.js に `state` を足す**

`web/assets/gate.js` の最後の行を置き換える:

```js
  /* 描き直しの後にも掛け直せるよう、外から呼べる口を残す。
     state は usersync.js がログイン済みかを読む口（/api/me を二重に聞かない）。 */
  window.rkGate = { apply, linked: () => linked, prompt, ready, state: () => state };
```

- [ ] **Step 9: `web/assets/usersync.js` を作る**

```js
/* 利用者の属性を数えるための送信。
 * 設計: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 *  A（匿名・全員）… 学年・学部・時間割を window.rkSnap に渡す。その日の1回目かどうかは
 *                   analytics.js が決める（除外された端末も向こうで止まる）。
 *  B（ログイン者）… PUT /api/profile に丸ごと送る。ログイン済みかは gate.js が
 *                   /api/me に聞いた結果（rkGate.state()）を読む。変わったら2秒まとめて送り直す。
 *
 * トップ（data-wait="app"）は rk:app-ready まで待ってから A を送る。app.js が
 * LINE から来た ?faculty=&year= を書き込むのはその前なので、待たないと
 * LINE 経由の1回目が「未回答」として数えられる。
 *
 * どれが失敗しても画面は止めない（送れなかった分は数えないだけ）。
 */
(() => {
  const store = window.rkStore;
  if (!store) return;

  const DEBOUNCE_MS = 2000;
  const waitApp = (document.currentScript && document.currentScript.dataset.wait) === "app";
  let loggedIn = false;
  let timer = 0;

  function snapNow() {
    try { if (window.rkSnap) window.rkSnap(store.snapshot()); } catch (e) {}
  }

  function push() {
    if (!loggedIn) return;
    try {
      fetch("/api/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(store.snapshot()),
      }).catch(() => {});
    } catch (e) {}
  }

  if (waitApp) window.addEventListener("rk:app-ready", snapNow);
  else snapNow();

  window.addEventListener("rk:store-changed", () => {
    clearTimeout(timer);
    timer = setTimeout(push, DEBOUNCE_MS);
  });

  const gate = window.rkGate;
  if (gate && gate.ready) {
    gate.ready.then(() => {
      loggedIn = !!(gate.state && gate.state().loggedIn);
      push();
    });
  }
})();
```

注: `rk:app-ready` は1回しか発火しない（app.js:2260）ので `{ once: true }` は付けない（偽ブラウザの addEventListener を単純に保つため）。

- [ ] **Step 10: ページに読み込ませる**

`web/index.html` の `<script src="/assets/onboard.js" defer></script>` の直後に足す:

```html
<!-- 利用者の属性を数える（匿名の1日1回＋ログイン者の保存）。app.js の後・data-wait="app" で
     rk:app-ready を待つ。spec: docs/superpowers/specs/2026-10-05-user-stats-design.md -->
<script src="/assets/usersync.js" data-wait="app" defer></script>
```

`web/mypage.html` の `<script src="/assets/mypage.js" defer></script>` の直後に足す:

```html
<!-- 利用者の属性を数える（匿名の1日1回＋ログイン者の保存）。spec: 2026-10-05-user-stats -->
<script src="/assets/usersync.js" defer></script>
```

- [ ] **Step 11: 通ることを確かめる**

Run: `node tools/test_user_stats.mjs && node tools/test_analytics.mjs && node tools/test_gate.mjs`
Expected: すべて `OK <件数>`。`test_gate.mjs` が実ブラウザ（playwright）を要するなら、`python3 tools/serve.py 8140 &` を立ててから引数に `http://localhost:8140` を渡す（ファイル冒頭の使い方に従う）

- [ ] **Step 12: Commit**

```bash
git add web/assets/store.js web/assets/analytics.js web/assets/gate.js web/assets/usersync.js web/index.html web/mypage.html tools/test_analytics.mjs tools/test_user_stats.mjs
git commit -m "feat(stats): ブラウザから属性を送る ―― 匿名の1日1回（rkSnap）とログイン者の PUT /api/profile"
```

---

### Task 4: 集計スクリプト（`tools/users_report.mjs`）

**Files:**
- Create: `tools/users_report_lib.mjs`（純関数）
- Create: `tools/users_report.mjs`（API から取って出す）
- Test: `tools/test_user_stats.mjs`（「── 結果」の直前に追記）

**Interfaces:**
- Consumes: Analytics Engine の `snap` 行（Task 1）、D1 の `line_profiles`・`timetables`（Task 2）
- Produces（lib）:
  - `aggregate(rows, courseTags) → { total, grade: Map, faculty: Map, gradeFaculty: Map, courses: Map, tags: Map, entries }`
    - `rows`: `{ grade: string, faculty: string, ids: string[], w: number }[]`（A は w＝標本の重み、B は w＝1）
    - `courseTags`: `Map<courseId, string[]>`
  - `cell(n, isPublic) → string`、`pct(n, d, isPublic) → string`
  - `table(map, denom, isPublic, label) → string[][]`（`[ラベル, 数, 比率]`、数の多い順）
  - `toCsv(header, rows) → string`
  - `rowsFromAE(data) → rows`、`rowsFromD1(profiles, timetables) → rows`

- [ ] **Step 1: 落ちるテストを書く**

`tools/test_user_stats.mjs` の「── 結果」の直前に追記する:

```js
// ── 5. 集計 ───────────────────────────────────
const R = await import(path.join(ROOT, "tools/users_report_lib.mjs"));
{
  const tags = new Map([["A", ["joho", "ai"]], ["B", ["kotoba"]], ["C", []]]);
  const rows = [
    { grade: "1", faculty: "engineering", ids: ["A", "B"], w: 2 },
    { grade: "1", faculty: "law", ids: ["A"], w: 1 },
    { grade: "", faculty: "", ids: [], w: 3 },
    { grade: "2", faculty: "law", ids: ["C", "ZZZ"], w: 1 },
  ];
  const a = R.aggregate(rows, tags);
  check(a.total === 7, `総数が ${a.total}（重みの和 7 のはず）`);
  check(a.grade.get("1") === 3 && a.grade.get("未回答") === 3, "学年の分布（未回答を含む）が違う");
  check(a.gradeFaculty.get("1|engineering") === 2, "学年×学部が違う");
  check(a.courses.get("A") === 3, "科目の登録数（重み付き）が違う");
  check(a.entries === 7, `時間割の科目（のべ）が ${a.entries}（2×2+1+2=7 のはず）`);
  check(a.tags.get("joho") === 3 && a.tags.get("ai") === 3, "1科目に複数タグを、それぞれに数えていない");
  check(a.tags.get("タグなし") === 2, "タグの無い科目・知らない科目を「タグなし」にしていない");
  const sum = [...a.tags.values()].reduce((x, y) => x + y, 0);
  check(sum > a.entries, "タグの合計がのべ数を超えていない（多重計上していない）");
}
{ // 伏せ字
  check(R.cell(4, true) === "5未満" && R.cell(5, true) === "5", "外部向けで5未満を伏せていない／5を伏せている");
  check(R.cell(2, false) === "2", "内部向けで伏せている");
  check(R.pct(4, 100, true) === "—", "伏せたセルの比率を出している（分母から逆算できる）");
  check(R.pct(25, 100, true) === "25.0%" && R.pct(1, 0, false) === "—", "比率の計算が違う");
  const t = R.table(new Map([["1", 10], ["2", 3]]), 13, true, (k) => `${k}年`);
  check(t[0][0] === "1年" && t[0][1] === "10" && t[1][1] === "5未満" && t[1][2] === "—", "表の並び・伏せ字が違う");
}
{ // CSV（カンマ・引用符を含むラベル）
  const csv = R.toCsv(["名前", "数"], [['芸術, "音楽"', "5"]]);
  check(csv === '名前,数\n"芸術, ""音楽""",5\n', `CSV の引用が違う: ${JSON.stringify(csv)}`);
}
{ // API の行を rows に直す
  const ae = R.rowsFromAE([{ grade: "1", faculty: "law", ids: "138531,00Z008", w: "2" }, { grade: "", faculty: "", ids: "", w: 1 }]);
  check(ae[0].w === 2 && ae[0].ids.length === 2 && ae[1].ids.length === 0, "AE の行の読み替えが違う（空の ids を [\"\"] にしていないか）");
  const d1 = R.rowsFromD1(
    [{ line_user_id: "U1", grade: "1", faculty: "law" }, { line_user_id: "U2", grade: null, faculty: "science" }],
    [{ line_user_id: "U1", course_id: "A" }, { line_user_id: "U1", course_id: "A" }, { line_user_id: "U3", course_id: "B" }]);
  const byIds = Object.fromEntries(d1.map((r) => [r.ids.join(",") || "-", r]));
  check(d1.length === 3, `D1 の人数が ${d1.length}（U1・U2・U3 の3人のはず）`);
  check(byIds["A"]?.grade === "1" && byIds["A"]?.ids.length === 1, "春秋に同じ科目がある人を2つに数えている");
  check(byIds["B"]?.grade === "" && byIds["-"]?.grade === "", "問診の無い人・null の学年を空にしていない");
  check(d1.every((r) => r.w === 1), "B の重みが1でない");
}
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_user_stats.mjs`
Expected: `tools/users_report_lib.mjs` が無いので `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: `tools/users_report_lib.mjs` を作る**

```js
/* 利用者の属性の集計（純関数）。取ってくる側は users_report.mjs。
 * spec: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 * A（Analytics Engine の snap）と B（D1）を同じ形の rows に直してから、
 * 同じ aggregate() に通す。ただし**結果を足し合わせない**（単位が端末・日と人で違う）。
 */
const MIN_PUBLIC = 5;

export function aggregate(rows, courseTags) {
  const add = (m, k, w) => m.set(k, (m.get(k) || 0) + w);
  const out = { total: 0, grade: new Map(), faculty: new Map(), gradeFaculty: new Map(),
                courses: new Map(), tags: new Map(), entries: 0 };
  for (const r of rows) {
    const w = r.w;
    out.total += w;
    add(out.grade, r.grade || "未回答", w);
    add(out.faculty, r.faculty || "未回答", w);
    add(out.gradeFaculty, `${r.grade || "未回答"}|${r.faculty || "未回答"}`, w);
    for (const id of r.ids) {
      add(out.courses, id, w);
      out.entries += w;
      const tags = courseTags.get(id) || [];
      if (!tags.length) add(out.tags, "タグなし", w);
      for (const t of tags) add(out.tags, t, w);
    }
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

export function table(map, denom, isPublic, label = (k) => k) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => [label(k), cell(n, isPublic), pct(n, denom, isPublic)]);
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
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node tools/test_user_stats.mjs`
Expected: `OK <件数>`

- [ ] **Step 5: `tools/users_report.mjs` を作る**

```js
/* 利用者の属性（学年・学部・時間割・授業内容タグ）を数える。
 *
 *   CF_ACCOUNT_ID=<32桁> CF_API_TOKEN=<トークン> node tools/users_report.mjs [--days 30] [--public] [--csv <dir>]
 *
 * spec: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 * ■ 2つの節は足さない
 *   A … 全訪問者の1日1回のスナップショット（Analytics Engine）。単位は「端末・日」。
 *       よく来る人ほど日数ぶん重く数える。--days で期間を決める（最大90日＝保存期間）。
 *   B … LINE ログインした人（D1）。単位は「人」。いまの状態で、期間では絞らない。
 *
 * ■ --public（外部に出すとき）
 *   5未満のセルを「5未満」にし、そのセルの比率も出さない（分母から逆算できるため）。
 *
 * ■ --csv <dir>
 *   表ごとに CSV を書く。**リポジトリの外を指定すること**（公開リポジトリ）。
 *   Analytics Engine は90日で消えるので、外部に出す月の数字は月が明けたら書き出して保管する。
 *
 * ■ トークン
 *   tools/stats.mjs と同じトークンに **アカウント / D1 / 読み取り** を足す
 *   （Account Analytics / 読み取り だけでは B が 403 になる）。
 */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { aggregate, table, toCsv, rowsFromAE, rowsFromD1 } from "./users_report_lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const DATASET = "rakutan_use";   // wrangler.toml の [[analytics_engine_datasets]] と揃える

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const isPublic = args.includes("--public");
const csvDir = opt("--csv");
const days = Number(opt("--days") ?? 30);

if (!ACCOUNT || !TOKEN) {
  console.error("CF_ACCOUNT_ID と CF_API_TOKEN が要ります。作り方はこのファイルの先頭と tools/stats.mjs の先頭。");
  process.exit(1);
}
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error(`--days は 1〜90 の整数で（渡された値: ${opt("--days")}）。保存期間が90日のため。`);
  process.exit(1);
}
/* 作る前に判定する（作ってから弾くと、リポジトリの中に空のフォルダが残る）。 */
if (csvDir && (path.resolve(csvDir) + path.sep).startsWith(realpathSync(ROOT) + path.sep)) {
  console.error("--csv にリポジトリの中は指定できません（公開リポジトリ。内部の数字が出てしまう）。");
  process.exit(1);
}
if (csvDir) mkdirSync(csvDir, { recursive: true });

// 科目 → 授業内容タグ、表示名
const built = JSON.parse(readFileSync(path.join(ROOT, "web/data/courses.built.json"), "utf-8"));
const courseTags = new Map(built.courses.map((c) => [String(c.id), c.subjects || []]));
const courseTitle = new Map(built.courses.map((c) => [String(c.id), c.title]));
const TAG_LABEL = built._meta.subject_labels || {};
const REQ = JSON.parse(readFileSync(path.join(ROOT, "web/data/requirements.json"), "utf-8"));
const FAC_LABEL = Object.fromEntries(REQ.faculties.map((f) => [f.key, f.label]));
const DB_ID = readFileSync(path.join(ROOT, "wrangler.toml"), "utf-8").match(/database_id\s*=\s*"([^"]+)"/)?.[1];

const gradeLabel = (k) => (k === "未回答" ? k : `${k}年`);
const facLabel = (k) => FAC_LABEL[k] || k;
const tagLabel = (k) => TAG_LABEL[k] || k;

async function cf(url, init) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${url}`,
    { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} が ${res.status} を返しました:\n${text}`);
  return JSON.parse(text);
}

/* _sample_interval を掛けるのを省かないこと（traffic.js の注記と同じ理由）。 */
async function fetchA() {
  const sql = `
SELECT blob3 AS grade, blob4 AS faculty, blob5 AS ids, SUM(_sample_interval * double1) AS w
FROM ${DATASET}
WHERE timestamp >= NOW() - INTERVAL '${days}' DAY AND blob1 = 'snap'
GROUP BY grade, faculty, ids
FORMAT JSON`;
  const json = await cf("/analytics_engine/sql", { method: "POST", body: sql });
  return rowsFromAE(json.data ?? []);
}

async function fetchB() {
  const q = async (sql) => {
    const json = await cf(`/d1/database/${DB_ID}/query`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql }),
    });
    return json.result?.[0]?.results ?? [];
  };
  const [profiles, timetables] = await Promise.all([
    q("SELECT line_user_id, grade, faculty FROM line_profiles"),
    q("SELECT line_user_id, course_id FROM timetables"),
  ]);
  return rowsFromD1(profiles, timetables);
}

const out = [];   // [ファイル名, 見出し, 表]
function section(prefix, unit, rows) {
  const a = aggregate(rows, courseTags);
  console.log(`\n■ ${prefix === "a" ? `A 全訪問者（直近 ${days} 日・単位：端末・日）` : "B LINE ログイン者（いまの状態・単位：人）"}`);
  console.log(`  合計 ${Math.round(a.total)} ${unit}・時間割の科目（のべ）${Math.round(a.entries)}`);
  const show = (name, title, header, rowsT) => {
    console.log(`\n  ${title}`);
    for (const r of rowsT) console.log(`    ${r.join("\t")}`);
    out.push([`${prefix}_${name}.csv`, header, rowsT]);
  };
  show("grade", "学年", ["学年", unit, "比率"], table(a.grade, a.total, isPublic, gradeLabel));
  show("faculty", "学部", ["学部", unit, "比率"], table(a.faculty, a.total, isPublic, facLabel));
  show("grade_faculty", "学年 × 学部", ["学年×学部", unit, "比率"],
    table(a.gradeFaculty, a.total, isPublic, (k) => { const [g, f] = k.split("|"); return `${gradeLabel(g)}・${facLabel(f)}`; }));
  show("courses_top20", "時間割に入っている科目 TOP 20", ["科目", `${unit}（のべ）`, "比率"],
    table(a.courses, a.entries, isPublic, (id) => `${courseTitle.get(id) || "（不明な科目）"}（${id}）`).slice(0, 20));
  show("tags", "授業内容タグ（1科目に複数タグ。合計は100%を超える）", ["タグ", `${unit}（のべ）`, "比率"],
    table(a.tags, a.entries, isPublic, tagLabel));
  for (const g of [...a.grade.keys()].filter((k) => k !== "未回答").sort()) {
    const sub = aggregate(rows.filter((r) => r.grade === g), courseTags);
    show(`tags_grade${g}`, `授業内容タグ（${g}年）`, ["タグ", `${unit}（のべ）`, "比率"], table(sub.tags, sub.entries, isPublic, tagLabel));
  }
  for (const f of [...a.faculty.keys()].filter((k) => k !== "未回答").sort()) {
    const sub = aggregate(rows.filter((r) => r.faculty === f), courseTags);
    show(`tags_${f}`, `授業内容タグ（${facLabel(f)}）`, ["タグ", `${unit}（のべ）`, "比率"], table(sub.tags, sub.entries, isPublic, tagLabel));
  }
}

console.log(`ラクハン 利用者の属性${isPublic ? "（外部向け：5未満は伏せ字）" : "（内部向け）"}`);
console.log("A と B は単位が違うので足さないこと。");
try { section("a", "端末・日", await fetchA()); }
catch (e) { console.error(`\nA を取れませんでした: ${e.message}`); }
try { section("b", "人", await fetchB()); }
catch (e) { console.error(`\nB を取れませんでした: ${e.message}\n（403 ならトークンに D1 の読み取り権限が無い）`); }

if (csvDir) {
  for (const [file, header, rowsT] of out) writeFileSync(path.join(csvDir, file), toCsv(header, rowsT));
  console.log(`\nCSV を ${out.length} 本書きました: ${csvDir}`);
}
```

- [ ] **Step 6: 動くことを確かめる（トークンがあれば）**

Run: `node tools/users_report.mjs`（環境変数なし）
Expected: 「CF_ACCOUNT_ID と CF_API_TOKEN が要ります」で終了コード1

Run: `CF_ACCOUNT_ID=x CF_API_TOKEN=y node tools/users_report.mjs --csv ./out`
Expected: 「--csv にリポジトリの中は指定できません」で終了コード1

トークンがある場合: `CF_ACCOUNT_ID=… CF_API_TOKEN=… node tools/users_report.mjs --days 7`
Expected: A・B の見出しが出る（デプロイ前なので A は合計0、B は D1 にスキーマを当てる前なら「B を取れませんでした」）

- [ ] **Step 7: Commit**

```bash
git add tools/users_report_lib.mjs tools/users_report.mjs tools/test_user_stats.mjs
git commit -m "feat(stats): tools/users_report.mjs ―― 学年・学部・時間割・授業内容タグを A/B 別に集計・CSV"
```

---

### Task 5: 告知・引き継ぎ・D1 への反映

**Files:**
- Modify: `web/about.html`（183行 `<h2 id="disclaimer">免責</h2>` の直前）
- Modify: `HANDOFF.md`（ルールの直下に新しい節）
- Test: `tools/test_user_stats.mjs`（about の告知があること）

**Interfaces:**
- Consumes: Task 1〜4 の全体
- Produces: なし（文書と本番の D1）

- [ ] **Step 1: 落ちるテストを書く**

`tools/test_user_stats.mjs` の「── 結果」の直前に追記する:

```js
// ── 6. 告知 ───────────────────────────────────
{
  const about = read("web/about.html");
  check(about.includes('id="userdata"'), "about に「利用データの扱い」の節が無い");
  check(/学年.*学部.*時間割/s.test(about.slice(about.indexOf('id="userdata"'))), "about の告知に集める項目（学年・学部・時間割）が無い");
}
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_user_stats.mjs`
Expected: `NG` に「about に「利用データの扱い」の節が無い」

- [ ] **Step 3: about に告知を足す**

`web/about.html` の `<h2 id="disclaimer">免責</h2>` の直前に足す:

```html
  <h2 id="userdata">利用データの扱い</h2>
  <p>ラクハンは、どんな学生に使われているかを知るために、次のものを集計しています。</p>
  <ul>
    <li><b>だれでも</b>：1日1回、そのブラウザに保存されている<b>学年・学部・時間割に入れた科目</b>を送ります。名前・端末を見分ける番号・Cookie は送りません。</li>
    <li><b>LINE でログインした人</b>：学年・学部・時間割に入れた科目を、LINE のユーザーID と結びつけて保存します。名前やメールアドレスは受け取りません。</li>
  </ul>
  <p>集計した結果（例：「利用者の X% が1年生」）は、チームの改善と、協賛企業などへの説明に使います。外に出すのは集計した数字だけで、人数が少なく個人が分かるおそれのある項目は伏せます。</p>
  <p>保存したデータを消してほしいときは、下の「サイトへのご意見」から連絡してください。</p>
```

- [ ] **Step 4: 字形と通るかを確かめる**

Run: `python3 ~/Developer/es-coach-skills/tools/check_ja_kanji.py web/about.html && node tools/test_user_stats.mjs`
Expected: `中国語の字形・句読点：なし` と `OK <件数>`

- [ ] **Step 5: HANDOFF に引き継ぎを書く**

`HANDOFF.md` のルールの直下の `---` の後ろに、既存の節と同じ形で足す:

```markdown
## 2026-10-05 ｜ 利用者の属性（学年・学部・時間割・授業内容タグ）を数え始めた ｜ Claude（wang） → 全員

spec: `docs/superpowers/specs/2026-10-05-user-stats-design.md`。2系統あり、**数字は足さない**。
A＝全訪問者の1日1回のスナップショット（`/api/hit` の `snap`・Analytics Engine・単位は端末・日）。
B＝LINE ログイン者（`PUT /api/profile`・D1 の `line_profiles`＋`timetables`・単位は人）。

### 1. 何が動く状態か

    CF_ACCOUNT_ID=… CF_API_TOKEN=… node tools/users_report.mjs --days 30            # 内部向け
    CF_ACCOUNT_ID=… CF_API_TOKEN=… node tools/users_report.mjs --public --csv ~/rakuhan-stats/2026-10   # 外部向け

- `node tools/test_user_stats.mjs` / `node tools/test_analytics.mjs`

### 2. 何をしていないか

- **A は人数ではない。** よく来る人ほど日数ぶん重い。その日の最初の表示より後の変更は翌日まで出ない
- **Analytics Engine は90日で消える。** 外部に出す月の数字は、月が明けたら `--csv` でリポジトリの外に保管する
- B の送信はテスト版（LINE ログイン不可）では確かめられない。本番で `wrangler d1 execute rakutan-favorites --remote --command "SELECT COUNT(*) FROM timetables"` で見る
- 消してほしいという連絡への手順（D1 から1人分を消す）は手作業: `DELETE FROM timetables WHERE line_user_id = ?` と `DELETE FROM line_profiles WHERE line_user_id = ?`

### 3. 次の人が最初に打つコマンド

    npx wrangler d1 execute rakutan-favorites --remote --command "SELECT COUNT(*) FROM timetables"

### 4. 踏んだ罠

- 科目IDは数字だけではない（`00Z008` など324件）。検証は `/^[0-9A-Z]{1,12}$/`
- `line_profiles` は LINE bot も読む。サイトで空のまま送られた項目は COALESCE で上書きしない（LINE で答えた値を消さない）
- 既存の集計（毎朝の速報・stats.mjs）は event で絞っていない SQL があったので `blob1 != 'snap'` を足した
```

- [ ] **Step 6: 字形を確かめる**

Run: `python3 ~/Developer/es-coach-skills/tools/check_ja_kanji.py HANDOFF.md`
Expected: `中国語の字形・句読点：なし`

- [ ] **Step 7: 全テストを流す**

Run: `node tools/test_user_stats.mjs && node tools/test_analytics.mjs && node tools/test_traffic_report.mjs && node tools/test_linelogin.mjs && node tools/test_bot_flow.mjs && node tools/test_index_gate.mjs`
Expected: すべて `OK <件数>`

- [ ] **Step 8: Commit**

```bash
git add web/about.html HANDOFF.md tools/test_user_stats.mjs
git commit -m "docs: about に「利用データの扱い」、HANDOFF に利用者の属性の集計"
```

- [ ] **Step 9: D1 にスキーマを当てる（人の承認を取ってから）**

本番の D1 を変える操作なので、**実行前にユーザーへ確認する**。`CREATE TABLE IF NOT EXISTS` だけなので既存の表は変わらない。

Run: `npx wrangler d1 execute rakutan-favorites --remote --file=db/schema.sql`
Expected: エラーなし。続けて `npx wrangler d1 execute rakutan-favorites --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` に `timetables` が出る

**順番の注意:** このスキーマ適用は **PR のマージ（本番デプロイ）より前**に行う。表が無いまま `PUT /api/profile` が動くと、batch が落ちて 500 を返し続ける（画面は止まらないが、B の数が取れない）。

- [ ] **Step 10: PR を出す**

```bash
git push -u origin feat/user-stats
gh pr create --title "feat(stats): 利用者の属性（学年・学部・時間割・授業内容タグ）を数える" --body "<spec へのリンク・A/B の説明・テスト版では LINE ログインの部分を確かめられないことを書く>"
```

リポジトリの CLAUDE.md に従い、Cloudflare のテスト版ができるのを待ち（約1分）、Branch Preview URL（`feat-user-stats-rakutan-db.wjy20050815.workers.dev`）を開いて確かめてから、その URL を返答に書く。
```
