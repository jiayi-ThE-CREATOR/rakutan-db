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
{ // 不正な要素だらけの巨大な配列でも、全部は見ない（/api/hit は誰でも叩ける）
  const huge = [...Array(1_000_000).fill("<bad>"), "138531"];
  const t0 = Date.now();
  const r = cleanIds(huge);
  check(r.length === 0, "見る件数に上限が無い（巨大配列の最後の ID まで拾っている）");
  check(Date.now() - t0 < 50, `巨大配列の検証に ${Date.now() - t0}ms かかっている`);
}

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

/* D1 の偽物。batch・run で流れた SQL と引数を順に残す。
   first() は SELECT 用：identities（アカウントの引き直し）は行なし、timetable_docs は docRow を返す。
   ※ 2026-10-20 にアカウント統一（sessionUser → resolveAccount の first()）が入ってから、
     first の無い偽物ではこのテストが落ちていた。2026-10-29 に足した。 */
function fakeDB({ fail = false, docRow = null, docFail = false } = {}) {
  const log = [];
  return {
    log,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async first() {
          if (/FROM timetable_docs/.test(sql)) { if (docFail) throw new Error("no such table"); return docRow; }
          return null;
        },
        async run() {
          if (docFail && /timetable_docs/.test(sql)) throw new Error("no such table");
          log.push([sql, this.args]); return {};
        },
      };
    },
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
  /* 時間割は学期ごとに1文（json_each で ID の配列を展開）。args = [userId, term, now, JSON] */
  const ins = log.filter(([sql]) => sql.startsWith("INSERT INTO timetables"))
    .flatMap(([sql, a]) => (/json_each\(\?\)/.test(sql) ? JSON.parse(a[3]) : []).map((id) => [a[0], a[1], id]));
  check(ins.length === 3, `時間割の INSERT が ${ins.length} 件（3件のはず）`);
  check(ins.every(([u]) => u === USER), "他人の userId で書いている");
  check(ins.some(([, t, id]) => t === "haru" && id === "00Z008"), "英字入りの ID を落としている");
  check(ins.some(([, t, id]) => t === "aki" && id === "200001"), "秋の時間割を書いていない");
  const prof = log.find(([sql]) => sql.startsWith("INSERT INTO line_profiles"));
  check(prof?.[1][0] === USER && prof?.[1][1] === "2" && prof?.[1][2] === "engineering", "学年・学部を書いていない");
}
{ // 1回の書き込みの文の数が、時間割の大きさで増えない（D1 は1呼び出しあたりの問い合わせ数に上限がある）
  const many = (k) => Array.from({ length: 80 }, (_, i) => String(k + i));
  const { res, log } = await putProfile({ grade: "1", faculty: "law", tt: { haru: many(100000), aki: many(200000) } }, { cookie: await sessCookie() });
  check(res.status === 200 && log.length <= 4, `160コマで ${log.length} 文を流している（4文以下のはず）`);
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

// ── 3b. 時間割の写し（timetable_docs・2026-10-29 端末間の同期） ──
const { cleanDoc } = await import(path.join(ROOT, "worker/profile.js"));
{ // 検証：コマは月〜金×1〜6、ID は決まった形だけ。形の違うものは null
  const d = cleanDoc({ v: 1, haru: { slots: { "月1": "138531", "土1": "138531", "火2": "<x>" }, extra: ["00Z008", "bad id"] }, aki: "x" });
  check(JSON.stringify(d) === '{"v":1,"haru":{"slots":{"月1":"138531"},"extra":["00Z008"]},"aki":{"slots":{},"extra":[]}}',
    `cleanDoc の結果が違う: ${JSON.stringify(d)}`);
  check(cleanDoc(null) === null && cleanDoc([]) === null && cleanDoc("x") === null, "形の違う doc を null にしていない");
}
{ // PUT に doc があれば timetable_docs へ本人の1行を書く（batch とは別に）
  const doc = { v: 1, haru: { slots: { "月1": "138531" }, extra: [] }, aki: { slots: {}, extra: ["00Z008"] } };
  const { res, log } = await putProfile({ grade: "1", faculty: "law", tt: { haru: ["138531"], aki: ["00Z008"] }, doc }, { cookie: await sessCookie() });
  const w = log.find(([sql]) => sql.startsWith("INSERT INTO timetable_docs"));
  check(res.status === 200 && w?.[1][0] === USER && JSON.parse(w?.[1][1] ?? "{}").haru?.slots?.["月1"] === "138531",
    "PUT の doc を timetable_docs に書いていない");
}
{ // doc の無い PUT（古い画面）では timetable_docs を触らない
  const { log } = await putProfile({ grade: "1", tt: { haru: [], aki: [] } }, { cookie: await sessCookie() });
  check(!log.some(([sql]) => /timetable_docs/.test(sql)), "doc の無い PUT で timetable_docs を書いている");
}
{ // timetable_docs がまだ無い D1 でも、今までの保存は 200 で通る
  const db = fakeDB({ docFail: true });
  const { res, log } = await putProfile({ grade: "1", tt: { haru: ["138531"], aki: [] }, doc: { v: 1 } }, { cookie: await sessCookie(), db });
  check(res.status === 200 && log.some(([sql]) => sql.startsWith("INSERT INTO timetables")),
    "timetable_docs が無いと今までの保存まで落ちる");
}
{ // GET：本人の写しを返す／無ければ null／未ログインは 401
  const row = { doc: JSON.stringify({ v: 1, haru: { slots: { "水2": "138531" }, extra: [] }, aki: {} }), updated_at: 1761700000000 };
  const got = await (await putProfile(null, { cookie: await sessCookie(), method: "GET", db: fakeDB({ docRow: row }) })).res.json();
  check(got.ok && got.doc?.haru?.slots?.["水2"] === "138531" && got.at === 1761700000000, `GET が写しを返さない: ${JSON.stringify(got)}`);
  const none = await (await putProfile(null, { cookie: await sessCookie(), method: "GET" })).res.json();
  check(none.ok && none.doc === null && none.at === null, `写しが無いときに doc:null を返さない: ${JSON.stringify(none)}`);
  check((await putProfile(null, { method: "GET" })).res.status === 401, "未ログインの GET に 401 を返していない");
  check((await putProfile(null, { cookie: await sessCookie(), method: "GET", db: fakeDB({ docFail: true }) })).res.status === 500,
    "読めないときに 500 を返していない（画面は今まで通り送るだけ）");
}

// スキーマに表がある
check(/CREATE TABLE IF NOT EXISTS timetables/.test(read("db/schema.sql")), "db/schema.sql に timetables が無い");
check(/CREATE TABLE IF NOT EXISTS timetable_docs/.test(read("db/schema.sql")), "db/schema.sql に timetable_docs が無い");

// ── 4. usersync.js（送る時機） ─────────────────
const SYNC_SRC = read("web/assets/usersync.js");

/* 偽ブラウザ。イベントは自前で配る。setTimeout は手で進める。
   GET /api/profile は saved を返す（既定は「写しが無い」）。getFail なら届かない。
   local は端末の rk_timetable（store.getTimetableDoc）。 */
const DOC = (haru = {}, extra = []) => ({ v: 1, haru: { slots: haru, extra }, aki: { slots: {}, extra: [] } });
function runSync({ wait = "", loggedIn = true, gate = true, snap = null,
                   saved = { ok: true, doc: null, at: null }, getFail = false, local = DOC({ "月1": "138531" }), storageOk = true } = {}) {
  const listeners = {};
  const timers = [];
  const puts = [];
  const gets = [];
  const snaps = [];
  const written = [];
  const dialogs = [];
  let reloads = 0;
  const SNAP = snap || { grade: "1", faculty: "law", tt: { haru: ["138531"], aki: [] } };
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    rkStore: {
      snapshot: () => SNAP,
      getTimetableDoc: () => local,
      setTimetableDoc: (d) => written.push(d),
      timetableSaved: () => storageOk,
    },
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
    document: {
      currentScript: { dataset: wait ? { wait } : {} },
      /* 聞くダイアログの偽物。pick("saved" | "local" | "later") で押したことにする */
      createElement: () => ({
        attrs: {}, listeners: {}, shown: false,
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
        showModal() { this.shown = true; }, close() {}, remove() {},
        pick(p) { (this.listeners.click || []).forEach((fn) => fn({ target: { closest: () => ({ dataset: { pick: p } }) } })); },
      }),
      body: { appendChild: (d) => dialogs.push(d) },
    },
    location: { reload: () => { reloads++; } },
    fetch: (url, opts) => {
      if (!opts || !opts.method || opts.method === "GET") {
        gets.push(url);
        return getFail ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true, json: async () => saved });
      }
      puts.push({ url, opts }); return Promise.resolve({ ok: true });
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    JSON, Promise, console,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SYNC_SRC, ctx);
  const fire = (type) => (listeners[type] || []).forEach((fn) => fn({}));
  const flushTimers = () => { for (const t of timers) if (t.fn) { const f = t.fn; t.fn = null; f(); } };
  return { puts, gets, snaps, timers, written, dialogs, reloads: () => reloads, fire, flushTimers,
           openGate: async () => { resolveGate?.(); await new Promise((r) => setImmediate(r)); } };
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
  check(JSON.parse(s.puts[0]?.opts.body ?? "{}").tt?.haru?.[0] === "138531", "PUT の本文が rkStore.snapshot() になっていない");
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
{ // 新しい端末（何も入っていない）で開いただけでは、D1 の時間割を空で上書きしない
  const s = runSync({ snap: { grade: "", faculty: "", tt: { haru: [], aki: [] } } });
  await s.openGate();
  check(s.puts.length === 0, "空の端末を開いただけで PUT している（別の端末で作った時間割が消える）");
  s.fire("rk:store-changed"); s.flushTimers();
  check(s.puts.length === 1, "空の端末でも、本人が変えたときは送るはず（全部外した人の行を消すため）");
}
{ // gate.js が無いページでも落ちない（送らないだけ）
  const s = runSync({ gate: false });
  await new Promise((r) => setImmediate(r));
  check(s.puts.length === 0, "gate.js が無いページで PUT している");
}

// ── 4b. 端末間の同期（2026-10-29・wang 決定「違えば毎回聞く」） ──
const SAVED = (doc, at = 1761700000000) => ({ ok: true, doc, at });
{ // 送る前に保存を聞く。PUT には rk_timetable そのもの（doc）も添える
  const s = runSync();
  await s.openGate();
  check(s.gets.length === 1 && s.gets[0] === "/api/profile", "ログインしたのに保存されている時間割を聞いていない");
  check(s.puts.length === 1 && JSON.parse(s.puts[0].opts.body).doc?.haru?.slots?.["月1"] === "138531", "PUT に doc を添えていない");
}
{ // 未ログインは聞かない
  const s = runSync({ loggedIn: false });
  await s.openGate();
  check(s.gets.length === 0, "未ログインで GET /api/profile を叩いている");
}
{ // 新しい端末（この端末が空）：保存されている方を黙って使い、読み直す。空で上書きしない
  const s = runSync({ local: DOC(), saved: SAVED(DOC({ "水2": "200001" })), snap: { grade: "", faculty: "", tt: { haru: [], aki: [] } } });
  await s.openGate();
  check(s.written.length === 1 && s.written[0].haru.slots["水2"] === "200001", "空の端末に保存されている時間割を書き戻していない");
  check(s.reloads() === 1 && s.dialogs.length === 0, "空の端末で聞いている、または読み直していない");
  check(s.puts.length === 0, "空の端末が保存を上書きしうる");
}
{ // 書き戻せない端末（保存できない）では読み直さない（空に戻って同じことを繰り返すため）
  const s = runSync({ local: DOC(), saved: SAVED(DOC({ "水2": "200001" })), storageOk: false });
  await s.openGate();
  check(s.written.length === 1 && s.reloads() === 0, "保存できない端末で読み直している（無限に繰り返す）");
}
{ // 同じ（サーバーが通さない値の違いは無視）：聞かずに今まで通り
  const s = runSync({ local: DOC({ "月1": "138531", "土1": "138531" }), saved: SAVED(DOC({ "月1": "138531" })) });
  await s.openGate();
  check(s.dialogs.length === 0 && s.written.length === 0 && s.puts.length === 1, "同じ時間割なのに聞いた／書き戻した");
}
{ // 違う：聞く。答えるまでは送らない
  const s = runSync({ local: DOC({ "月1": "138531" }), saved: SAVED(DOC({ "水2": "200001" })) });
  await s.openGate();
  check(s.dialogs.length === 1 && s.dialogs[0].shown, "違うのに聞いていない");
  s.fire("rk:store-changed"); s.flushTimers();
  check(s.puts.length === 0, "答える前に送っている（保存されている方を上書きする）");
  s.dialogs[0].pick("local");
  check(s.puts.length === 1 && JSON.parse(s.puts[0].opts.body).doc?.haru?.slots?.["月1"] === "138531",
    "「この端末」を選んだのにこの端末の時間割を送っていない");
}
{ // 違う → 「保存されている方」：書き戻して読み直す。送らない
  const s = runSync({ local: DOC({ "月1": "138531" }), saved: SAVED(DOC({ "水2": "200001" })) });
  await s.openGate();
  s.dialogs[0].pick("saved");
  check(s.written.length === 1 && s.written[0].haru.slots["水2"] === "200001" && s.reloads() === 1, "「保存されている方」を書き戻していない");
  check(s.puts.length === 0, "「保存されている方」を選んだのに端末の時間割を送った");
}
{ // 違う → ✕（あとで）：何も送らず、書き戻さない
  const s = runSync({ local: DOC({ "月1": "138531" }), saved: SAVED(DOC({ "水2": "200001" })) });
  await s.openGate();
  s.dialogs[0].pick("later");
  s.fire("rk:store-changed"); s.flushTimers();
  check(s.puts.length === 0 && s.written.length === 0, "✕ で閉じたのに送った／書き戻した");
}
{ // 保存が無い（初めて）・聞けない（障害・古い Worker）：今まで通り送る
  const a = runSync({ saved: { ok: true, doc: null, at: null } });
  await a.openGate();
  check(a.puts.length === 1 && a.dialogs.length === 0, "保存が無いときに今まで通り送っていない");
  const b = runSync({ getFail: true });
  await b.openGate();
  check(b.puts.length === 1 && b.dialogs.length === 0, "GET が届かないときに今まで通り送っていない");
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
check(/state:\s*\(\)\s*=>\s*state/.test(read("web/assets/gate.js")), "gate.js が rkGate.state を出していない");

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
  const snap = win.rkStore.snapshot?.();
  check(snap?.grade === "2" && snap?.faculty === "law", "snapshot に学年・学部が無い");
  check(JSON.stringify(snap?.tt?.haru) === '["138531","00Z008"]', "snapshot の時間割が2コマの科目を重ねているか extra を落としている");
  win.rkStore.addExtra("aki", "200001");
  win.rkStore.setProfile({ grade: "3" });
  check(events.filter((t) => t === "rk:store-changed").length === 2, "時間割・学年を書いても rk:store-changed が出ていない");
}

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
  check(t[0][0] === "1年" && t[0][1] === "伏せ" && t[1][1] === "5未満" && t[1][2] === "—",
    "表の並び・伏せ字が違う（2行の表で1つ伏せたら、もう1つも伏せないと 13−10 で戻せる）");
}
{ // 伏せたセルを合計から逆算させない（伏せたのが1つだけなら、次に小さいセルも伏せる）
  const t = R.table(new Map([["a", 10], ["b", 3], ["c", 7], ["d", 20]]), 40, true);
  const hidden = t.filter((r) => r[1] === "5未満" || r[1] === "伏せ").map((r) => r[0]);
  check(hidden.includes("b") && hidden.includes("c") && hidden.length === 2, `伏せたセルが ${hidden}（b と c のはず）`);
  const none = R.table(new Map([["a", 10], ["d", 20]]), 30, true);
  check(none.every((r) => /^\d+$/.test(r[1])), "伏せる必要の無い表まで伏せている");
  const internal = R.table(new Map([["a", 10], ["b", 3]]), 13, false);
  check(internal[1][1] === "3", "内部向けで伏せている");
}
{ // のべ数ではなく人数で伏せる（1人が6科目入れても「6」で出さない）
  const tags = new Map([["A", ["hogaku"]], ["B", ["hogaku"]], ["C", ["hogaku"]], ["D", ["hogaku"]], ["E", ["hogaku"]], ["F", ["hogaku"]]]);
  const a = R.aggregate([{ grade: "4", faculty: "dentistry", ids: ["A", "B", "C", "D", "E", "F"], w: 1 }], tags);
  check(a.tags.get("hogaku") === 6 && a.tagPeople?.get("hogaku") === 1, "タグの人数（tagPeople）を数えていない");
  check(a.coursePeople?.get("A") === 1, "科目の人数（coursePeople）を数えていない");
  const t = R.table(a.tags, a.entries, true, (k) => k, a.tagPeople);
  check(t[0][1] === "5未満", "1人のタグを、のべ数6で外に出している");
  check(R.showGroup?.(4, true) === false && R.showGroup?.(5, true) === true && R.showGroup?.(1, false) === true,
    "外部向けで5未満のグループの内訳表を出している");
}
{ // 外部向けでは A（端末・日）の内訳を出さない（1人が20日来れば20になり、伏せ字の門が効かない）
  const src = read("tools/users_report.mjs");
  check(/isPublic\s*&&\s*prefix\s*===\s*"a"/.test(src), "--public で A の内訳表を出している");
}
{ // --csv の「リポジトリの中か」判定は symlink 経由でも効く
  const { mkdtempSync, symlinkSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "rk-"));
  const link = path.join(tmp, "repo-link");
  symlinkSync(ROOT, link);
  check(R.insideDir?.(path.join(link, "out", "2026-10"), ROOT) === true, "symlink 経由のリポジトリ内パスを外と判定している");
  check(R.insideDir?.(path.join(ROOT, "out"), ROOT) === true, "リポジトリ直下のパスを外と判定している");
  check(R.insideDir?.(path.join(tmp, "stats"), ROOT) === false, "リポジトリ外のパスを中と判定している");
  check(R.insideDir?.(ROOT + "-other/out", ROOT) === false, "名前が前方一致するだけの別フォルダを中と判定している");
  rmSync(tmp, { recursive: true, force: true });
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

// ── 6. 告知 ───────────────────────────────────
{
  const about = read("web/about.html");
  check(about.includes('id="userdata"'), "about に「利用データの扱い」の節が無い");
  check(!about.includes("Cookie は送りません"), "about に「Cookie は送りません」がある（同じドメインへの送信には Cookie が乗るので事実と違う）");
  check(/学年.*学部.*時間割/s.test(about.slice(Math.max(0, about.indexOf('id="userdata"')))) && about.includes('id="userdata"'),
    "about の告知に集める項目（学年・学部・時間割）が無い");
}

// ── 結果 ─────────────────────────────────
if (fails.length) {
  console.error(`NG ${fails.length}/${n}`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK ${n}`);
