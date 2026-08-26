/* 「どのURLを検索に載せるか」の門を確かめる。
 *   node tools/test_index_gate.mjs
 *
 * 2026-08-26 の公開で全ページの noindex を外した。外したあとに残る問題は
 * 「同じ本文が複数のURLで配られている」こと ―― 旧ドメイン（*.workers.dev）と
 * 計測リンク /l/<slug> 14本がそれで、どちらもトップと中身が同じ。
 * ここが崩れると、Google が正本を勝手に選び、宣伝で配った方が消えうる。
 *
 * 守りたいのは4つ:
 *  1. 独自ドメインの通常ページに noindex が付いていない（＝公開されている）
 *  2. /l/<slug> は本文を返すが noindex（消すと重複ページが14個できる）
 *  3. 旧ドメイン *.workers.dev は全部 noindex（LINE の Webhook 用に生かしてある）
 *  4. 静的側（robots.txt・_headers・canonical・sitemap）が上と矛盾していない
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const HOST = "rakuhan.nocode-sol.co.jp";
const OLD_HOST = "rakutan-db.wjy20050815.workers.dev";

// ── 1〜3. Worker の応答ヘッダ ──────────────────────
// ASSETS は「本文を返すだけのもの」に差し替える。中身は見ないので十分。
const env = {
  ASSETS: {
    fetch: async () => new Response("<!doctype html><title>ラクハン</title>", {
      headers: { "content-type": "text/html" },
    }),
  },
};
const { default: worker } = await import(path.join(ROOT, "worker/index.js"));
const get = (url) => worker.fetch(new Request(url), env, { waitUntil() {} });
const robots = async (url) => (await get(url)).headers.get("x-robots-tag");

check(await robots(`https://${HOST}/`) === null, "トップに noindex が残っている（公開できていない）");
check(await robots(`https://${HOST}/about`) === null, "/about に noindex が残っている");

const track = await get(`https://${HOST}/l/kasai`);
check(track.status === 200, "/l/kasai が 200 を返さない（計測リンクが死んでいる）");
check((await track.text()).includes("ラクハン"), "/l/kasai がトップの本文を返していない");
check(/noindex/.test(track.headers.get("x-robots-tag") || ""), "/l/kasai に noindex が無い（トップと同じ本文の重複ページが14個できる）");
check(track.headers.get("cache-control") === "no-store", "/l/kasai がキャッシュされる（別URLとして数えられなくなる）");
check((await get(`https://${HOST}/l/dare-mo-shiranai`)).status === 404, "知らない slug が 404 でない");

check(/noindex/.test(await robots(`https://${OLD_HOST}/`) || ""), "旧ドメインのトップに noindex が無い（独自ドメインと重複する）");
check(/noindex/.test(await robots(`https://${OLD_HOST}/about`) || ""), "旧ドメインの /about に noindex が無い");
const health = await get(`https://${OLD_HOST}/line/health`);
check(health.status === 200 && (await health.text()) === "ok", "旧ドメインの /line/health が壊れた（LINE の Webhook もこのドメイン）");

// ── 4. 静的ファイル ────────────────────────────
const robotsTxt = read("web/robots.txt");
check(!/^\s*Disallow:\s*\/\s*$/m.test(robotsTxt), "robots.txt がまだサイト全体を Disallow している");
check(/^\s*Sitemap:\s*https:\/\//m.test(robotsTxt), "robots.txt に Sitemap 行が無い");

const headers = read("web/_headers");
check(!/^\s*X-Robots-Tag/mi.test(headers), "web/_headers に X-Robots-Tag が残っている（全ページが検索に載らない）");

const sitemap = read("web/sitemap.xml");
const pages = { "index": `https://${HOST}/`, "about": `https://${HOST}/about`, "ads": `https://${HOST}/ads`, "kuchikomi": `https://${HOST}/kuchikomi`, "partners": `https://${HOST}/partners` };
for (const [name, url] of Object.entries(pages)) {
  check(sitemap.includes(`<loc>${url}</loc>`), `sitemap.xml に ${url} が無い`);
  const html = read(`web/${name}.html`);
  check(html.includes(`<link rel="canonical" href="${url}">`), `${name}.html の canonical が ${url} になっていない`);
}

console.log(fails.length ? `NG ${fails.length}/${n}\n- ${fails.join("\n- ")}` : `OK ${n}件`);
process.exit(fails.length ? 1 : 0);
