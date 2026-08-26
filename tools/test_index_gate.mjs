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
 *  3. 旧ドメイン *.workers.dev のページは canonical で正本へ寄る
 *     （LINE の Webhook 用に生かしてあるので止められない。なお Worker 側の
 *      noindex は「Worker が走る経路」にしか届かない ―― 静的アセットは
 *      Worker より先に配られるため。詳しくは worker/index.js の CANONICAL_HOST）
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

// 🚨 旧ドメインの「ページ」はここでは守れない。Workers の静的アセットは
// Worker スクリプトより先に配られるので、index.html が存在する `/` は
// この関数を通らない（2026-08-26 に本番で実測）。守っているのは canonical のほう。
// ここで確かめられるのは「Worker が走る経路」だけ。
const oldTrack = await get(`https://${OLD_HOST}/l/kasai`);
check(/noindex/.test(oldTrack.headers.get("x-robots-tag") || ""), "旧ドメインの計測リンクに noindex が無い");
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

// ── 5. /l/<slug> で開いても中身が出ること ───────────────
// 計測リンクは転送しない（アドレス欄を /l/<slug> のまま残す）ので、
// ページの基準URLは「/l/」になる。ここで相対パスの fetch が1本でも残ると
// /l/data/courses.built.json を叩き、Worker が 404 を返して一覧が
// 「読み込み中…」で止まる ―― 2026-08-26 に利用者から報告があった事故。
// ページ側は絶対パスで持つ。Worker で /l/ 配下を救おうとすると
// 「slug かデータか」を毎回判定することになり、slug を増やすたびに壊れる。
const topScripts = [...read("web/index.html").matchAll(/<script[^>]+src="(\/assets\/[^"]+)"/g)].map(m => m[1]);
check(topScripts.includes("/assets/app.js"), "index.html が app.js を読んでいない（この検査が素通りしている）");
for (const src of topScripts) {
  for (const [, target] of read(`web${src}`).matchAll(/fetch\(\s*["\'`]([^"\'`]+)/g)) {
    if (/^https?:/.test(target)) continue;
    check(target.startsWith("/"), `${src} の fetch("${target}") が相対パス ―― /l/<slug> から開くと 404 になり、一覧が「読み込み中…」で止まる`);
  }
}

console.log(fails.length ? `NG ${fails.length}/${n}\n- ${fails.join("\n- ")}` : `OK ${n}件`);
process.exit(fails.length ? 1 : 0);
