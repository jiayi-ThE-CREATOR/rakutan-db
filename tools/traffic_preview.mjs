/* 毎朝 Discord に出る速報を、いま手元で見る（Discord へは送らない）。
 *
 *   CF_ACCOUNT_ID=<32桁> CF_API_TOKEN=<トークン> node tools/traffic_preview.mjs
 *
 * cron を本番へ出す前に、SQL が通ることと数字の見え方をここで確かめる。
 * トークンの作り方は tools/stats.mjs の先頭（権限は Account Analytics 読み取りだけ）。
 *
 * stats.mjs との違い: あちらは日 × 種類の表、こちらは流入元（/l/<slug>）で
 * 割った Discord 用の本文。数え方の正本は worker/index.js の
 * buildTrafficReport ひとつで、ここはそれを呼ぶだけ ―― 手元と本番で
 * 違う数字が出ないようにするため。
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { STATS_SQL, buildTrafficReport } = await import(path.join(ROOT, "worker/traffic.js"));

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
if (!ACCOUNT || !TOKEN) {
  console.error("CF_ACCOUNT_ID と CF_API_TOKEN が要ります。作り方は tools/stats.mjs の先頭。");
  process.exit(1);
}

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
  { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: STATS_SQL }
);
const text = await res.text();
if (!res.ok) {
  console.error(`SQL API が ${res.status} を返しました:\n${text}`);
  process.exit(1);
}

/* 本番の cron は 23:00 UTC（JST 08:00）に走り、JST で閉じた「きのう」を報せる。
   ここでは**直近に過ぎた 23:00 UTC** を渡す ＝ けさ届いたはずの本文が出る。
   いま時刻をそのまま渡すと、まだ途中の今日を「きのう」と取り違えて、
   毎回少なく見える。 */
const now = new Date();
const lastRun = new Date(Date.UTC(
  now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0, 0
));
if (lastRun > now) lastRun.setUTCDate(lastRun.getUTCDate() - 1);

console.error(`（${lastRun.toISOString()} の cron で出るはずの本文。Discord へは送っていません）\n`);
console.log(buildTrafficReport(JSON.parse(text).data ?? [], lastRun));
