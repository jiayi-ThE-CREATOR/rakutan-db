/* 毎日の「どこから来たか」を Discord へ流す一連（POST は cron から）を確かめる。
 *   node tools/test_traffic_report.mjs
 *
 * ここで守りたいのは5つ。
 *  1. 配ったリンクと集計表がずれないこと ―― /l/<slug> は宣伝マニュアルで
 *     すでに人に配ってある。表から漏れた slug は「直接・その他」に化けて
 *     静かに消えるので、slug の正本を1つにしてここで見張る
 *  2. 抽選（_sample_interval）を掛け忘れないこと ―― 件数が増えると
 *     Cloudflare 側が間引いて保存する。掛けずに数えるとその日だけ少なく出る
 *  3. 7日の窓が8日目を拾わないこと
 *  4. 0件のときに黙らないこと ―― 計測の故障と「誰も来なかった」は
 *     Discord 上で見分けが付かない。0でも鳴らし、失敗はもっと鳴らす
 *  5. Discord の 2000 字上限を超えないこと（超えると投稿ごと落ちる）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(path.join(ROOT, "worker/traffic.js"));
const { STATS_CHANNELS, TRACKING_SLUGS, STATS_SQL, buildTrafficReport } = mod;
const worker = (await import(path.join(ROOT, "worker/index.js"))).default;

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

/* ── 1. slug の正本が1つであること ────────────────
   宣伝マニュアルで配ってある14本＋今回足す LINE 公式の2本。 */
const HANDED_OUT = [
  "kasai", "shunya", "kimura", "wang",
  "oc1", "oc2", "oc3", "oc4", "oc5",
  "ig", "story", "dm-a", "dm-b", "x",
];
const inTable = new Set(STATS_CHANNELS.flatMap(([, slugs]) => slugs.map(([s]) => s)));
for (const slug of HANDED_OUT) {
  check(inTable.has(slug), `配布ずみの /l/${slug} が集計表に無い（直接・その他へ化ける）`);
  check(TRACKING_SLUGS.has(slug), `/l/${slug} が TRACKING_SLUGS から消えている（404 になる）`);
}
check(inTable.has("line") && inTable.has("line-rich"), "LINE 公式アカウント用の slug が無い");
check(
  inTable.size === TRACKING_SLUGS.size,
  "集計表と TRACKING_SLUGS がずれている（正本が2つに割れている）"
);

// 実際に /l/line が引けること。表に足しただけで配線を忘れると 404 になる。
const ASSETS = { fetch: async () => new Response("<html>ラクハン</html>", { status: 200 }) };
const lineRes = await worker.fetch(
  new Request("https://rakuhan.nocode-sol.co.jp/l/line"),
  { ASSETS },
  { waitUntil: () => {} }
);
check(lineRes.status === 200, `/l/line が 200 を返さない: ${lineRes.status}`);

/* 入口モジュールに「関数以外の named export」を戻さないこと。
   Workers はこれを受け付けず、Worker ごと起動に失敗する
   （Incorrect type for map entry '…': not of type 'function or ExportedHandler'）。
   単体テストでは通ってしまい、デプロイして初めて全滅するので、ここで止める。 */
const indexSrc = readFileSync(path.join(ROOT, "worker/index.js"), "utf-8");
const badExport = /^export\s+(const|let|var|class)\s/m.exec(indexSrc);
check(!badExport, `worker/index.js に関数以外の export がある（Worker が起動しない）: ${badExport?.[0]}`);

// ── 2. SQL が抽選を掛けていること ────────────────
check(/_sample_interval\s*\*\s*double1/.test(STATS_SQL), "SQL が double1 に _sample_interval を掛けていない");
check(/_sample_interval\s*\*\s*double2/.test(STATS_SQL), "SQL が double2 に _sample_interval を掛けていない");
check(STATS_SQL.includes("Asia/Tokyo"), "SQL が JST で日付を切っていない");
check(STATS_SQL.includes("blob2"), "SQL が path（blob2）を取っていない ―― 流入元を分けられない");

/* ── 3. 集計そのもの ──────────────────────────
   cron は 23:00 UTC ＝ JST 08:00 に走る。だから「きのう」は
   JST で丸一日終わっている 2026-09-03。 */
const NOW = new Date("2026-09-03T23:00:00Z");   // ＝ JST 2026-09-04 08:00
const pv = (day, path_, n_, visits) => ({ day, event: "pv", path: path_, n: String(n_), visits: String(visits) });
const rows = [
  // きのう（2026-09-03）
  pv("2026-09-03", "/l/ig", 30, 12),
  pv("2026-09-03", "/l/story", 10, 5),
  pv("2026-09-03", "/l/x", 8, 4),
  pv("2026-09-03", "/l/line-rich", 6, 3),
  pv("2026-09-03", "/l/oc1", 4, 2),
  pv("2026-09-03", "/l/dm-a", 2, 1),
  pv("2026-09-03", "/l/kasai", 2, 1),
  pv("2026-09-03", "/", 40, 20),
  pv("2026-09-03", "/about", 5, 2),
  { day: "2026-09-03", event: "search", path: "/", n: "25", visits: "0" },
  { day: "2026-09-03", event: "detail", path: "/", n: "15", visits: "0" },
  // 一昨日（前日比の相手）
  pv("2026-09-02", "/", 20, 10),
  // 7日の窓の内側の端（2026-08-28）と、外側（2026-08-27）
  pv("2026-08-28", "/", 6, 3),
  pv("2026-08-27", "/", 999, 777),
];

const rep = buildTrafficReport(rows, NOW);

check(rep.includes("2026-09-03"), "見出しにきのうの日付が無い");
check(/訪問\D*50\b/.test(rep), `きのうの訪問が 50 になっていない:\n${rep}`);
check(rep.includes("107"), "ページ表示 107 が出ていない");
check(rep.includes("25") && rep.includes("15"), "検索・詳細の数が出ていない");
check(/\+40/.test(rep), `前日比 +40 が出ていない（前日は 10）:\n${rep}`);

// 流入元。ig と story はまとめて Instagram、それ以外は素の数で。
check(/Instagram\D*17/.test(rep), "Instagram が ig+story の 17 になっていない");
check(/プロフ\D*12/.test(rep) && /ストーリー\D*5/.test(rep), "Instagram の内訳が出ていない");
check(/X\D*4/.test(rep), "X が 4 になっていない");
check(/LINE 公式\D*3/.test(rep), "LINE 公式が 3 になっていない");
check(/オプチャ\D*2/.test(rep), "LINE オープンチャットが 2 になっていない");
check(/直接・その他\D*22/.test(rep), `slug の無い訪問（/ と /about）が 22 にまとまっていない:\n${rep}`);
// 0 の欄も消さない。消すと「きょうは IG が 0 だった」が読めなくなる。
check(/個人配布/.test(rep) && /学生団体/.test(rep), "訪問のあった欄が落ちている");

// 7日の合計 = 50 + 10 + 3 = 63。8日前の 777 を混ぜないこと。
check(/63/.test(rep), `直近7日の訪問合計 63 が出ていない（8日前を拾った可能性）:\n${rep}`);
check(!rep.includes("777"), "7日の窓の外（8日前）を数えている");
check(rep.includes("08-28"), "7日の走査に窓の端（08-28）が無い");
check(rep.length < 2000, `Discord の上限 2000 字を超えている: ${rep.length} 字`);

// ── 4. 0件でも黙らない ────────────────────────
const empty = buildTrafficReport([], NOW);
check(empty.length > 0, "0件のときに何も返していない");
check(/0/.test(empty), "0件のときに数字を出していない");
check(/計測|故障|届/.test(empty), "0件が『計測の故障かもしれない』と読めない");

// ── 5. cron から Discord まで ────────────────
const WEBHOOK = "https://discord.test/webhook";
const SQL_OK = JSON.stringify({ data: rows });
const realFetch = globalThis.fetch;
let calls = [];
const runScheduled = async (env, sqlStatus = 200, sqlBody = SQL_OK) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("analytics_engine")) return new Response(sqlBody, { status: sqlStatus });
    return new Response(null, { status: 204 });
  };
  const waits = [];
  await worker.scheduled({ scheduledTime: NOW.getTime(), cron: "0 23 * * *" },
    env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
};

const ENV = { CF_ACCOUNT_ID: "acct123", CF_API_TOKEN: "tok456", STATS_DISCORD_WEBHOOK: WEBHOOK };
await runScheduled(ENV);
const sql = calls.find((c) => c.url.includes("analytics_engine"));
const post = calls.find((c) => c.url === WEBHOOK);
check(!!sql, "Analytics Engine に問い合わせていない");
check(sql?.url.includes("/accounts/acct123/"), "アカウントIDが URL に入っていない");
check(sql?.init?.headers?.Authorization === "Bearer tok456", "API トークンを送っていない");
check(!!post, "Discord へ投げていない");
const content = post ? JSON.parse(post.init.body).content : "";
check(content.includes("訪問"), "Discord の本文が速報になっていない");
check(JSON.parse(post?.init?.body ?? "{}").allowed_mentions?.parse?.length === 0,
  "allowed_mentions を閉じていない（本文に @everyone が入ると飛ぶ）");

// webhook 未設定なら、外に一切出ない（口コミ通知と同じ設計）
await runScheduled({ CF_ACCOUNT_ID: "a", CF_API_TOKEN: "t" });
check(calls.length === 0, "webhook 未設定なのに外へ通信している");

// SQL が落ちた日は、黙るのではなく失敗を鳴らす
await runScheduled(ENV, 500, "boom");
const errPost = calls.find((c) => c.url === WEBHOOK);
check(!!errPost, "SQL が落ちた日に何も鳴らしていない（沈黙と 0件 が区別できない）");
check(/取れ|失敗|⚠/.test(JSON.parse(errPost?.init?.body ?? "{}").content ?? ""),
  "失敗した日の本文が失敗だと読めない");

// secret が欠けている日も同じ（黙って止まらない）
await runScheduled({ STATS_DISCORD_WEBHOOK: WEBHOOK });
check(calls.some((c) => c.url === WEBHOOK), "CF の secret が無い日に何も鳴らしていない");

globalThis.fetch = realFetch;

if (fails.length) {
  console.log("NG");
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log(`  通過 ${n} 件`);
console.log("OK");
