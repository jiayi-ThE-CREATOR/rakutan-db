/* 「実際に何回使われたか」を読む。
 *
 *   CF_ACCOUNT_ID=<32桁> CF_API_TOKEN=<トークン> node tools/stats.mjs [日数]
 *
 * 日数の既定は14。Analytics Engine の保存期間は90日なので、それ以上は取れない
 * （Cloudflare Web Analytics のダッシュボードは6か月ぶん残る。用途が違う）。
 *
 * ■ トークンの作り方（1回だけ・作れるのは本番アカウントの持ち主）
 *   dash.cloudflare.com → 右上のプロフィール → API トークン → トークンを作成
 *   → カスタムトークン → アクセス許可に **アカウント / Account Analytics / 読み取り**
 *   ひとつだけ。ゾーンの権限は要らない。
 *   アカウントIDはダッシュボードの URL（/ の次の32桁）。
 *
 * ■ この数字が Cloudflare Web Analytics と合わない理由（合わなくて正しい）
 *   あちらの beacon は cloudflareinsights.com にあるので、広告ブロッカー
 *   （Brave / uBlock / DuckDuckGo）に塞がれる＝**下限**。こちらは同じ
 *   ドメインの /api/hit なので塞がれない＝**上限に近い**。
 *   2つの差が、そのまま「どれくらい塞がれているか」の目安になる。
 *   どちらも ?nostats=1 を踏んだ端末（自分たち）は数えていない。
 */
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const DATASET = "rakutan_use";          // wrangler.toml の [[analytics_engine_datasets]] と揃える
const EVENTS = ["pv", "search", "detail"];

if (!ACCOUNT || !TOKEN) {
  console.error("CF_ACCOUNT_ID と CF_API_TOKEN が要ります。作り方はこのファイルの先頭。");
  process.exit(1);
}

const days = Number(process.argv[2] ?? 14);
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error(`日数は 1〜90 の整数で（渡された値: ${process.argv[2]}）。保存期間が90日のため。`);
  process.exit(1);
}

/* _sample_interval を掛けるのを省かないこと。件数が増えると Cloudflare 側が
   間引いて保存し、掛けずに数えるとその日だけ静かに少なく出る。 */
const sql = `
SELECT formatDateTime(timestamp, '%Y-%m-%d', 'Asia/Tokyo') AS day,
       blob1 AS event,
       SUM(_sample_interval * double1) AS n,
       SUM(_sample_interval * double2) AS visits
FROM ${DATASET}
WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
GROUP BY day, event
ORDER BY day DESC, event ASC
FORMAT JSON`;

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
  { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: sql }
);
const text = await res.text();
if (!res.ok) {
  console.error(`API が ${res.status} を返しました:\n${text}`);
  if (res.status === 404) {
    console.error(`\nテーブルがまだ無いのかもしれません（一度も書き込まれていない）。`);
    console.error(`確かめ方: curl の本文に "SHOW TABLES" を渡す。`);
  }
  process.exit(1);
}

let rows;
try { rows = JSON.parse(text).data ?? []; }
catch (e) { console.error("JSON として読めませんでした:\n" + text); process.exit(1); }

if (!rows.length) {
  console.log("まだ1件も届いていません。");
  console.log("疑う順番: ① まだデプロイしていない ② nginx が Origin と Referer の");
  console.log("両方を落としている ③ 自分の端末が ?nostats=1 で除外されている");
  process.exit(0);
}

// 日 × イベントに畳む
const byDay = new Map();
for (const r of rows) {
  const d = byDay.get(r.day) ?? { visits: 0 };
  d[r.event] = Number(r.n) || 0;
  if (r.event === "pv") d.visits = Number(r.visits) || 0;
  byDay.set(r.day, d);
}

const pad = (s, w) => String(s).padStart(w);
console.log(`ラクハン 実測（直近 ${days} 日・JST・自分たちを除いた数）\n`);
console.log(`${"日付".padEnd(12)}${pad("訪問", 7)}${pad("ページ表示", 12)}${pad("検索", 7)}${pad("詳細", 7)}`);
const total = { visits: 0, pv: 0, search: 0, detail: 0 };
for (const [day, d] of byDay) {
  console.log(`${day.padEnd(12)}${pad(d.visits, 7)}${pad(d.pv ?? 0, 12)}${pad(d.search ?? 0, 7)}${pad(d.detail ?? 0, 7)}`);
  total.visits += d.visits;
  for (const e of EVENTS) total[e] += d[e] ?? 0;
}
console.log(`${"─".repeat(33)}`);
console.log(`${"合計".padEnd(12)}${pad(total.visits, 7)}${pad(total.pv, 12)}${pad(total.search, 7)}${pad(total.detail, 7)}`);
console.log(`\n訪問＝タブを開いてからの1回目のページ表示。同じ人が翌日また来れば2回数える。`);
console.log(`検索・詳細＝実際の操作。クローラは JS を動かさないのでここには出ない。`);
