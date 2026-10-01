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
import { readFileSync, readdirSync } from "node:fs";
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

// ── 旧ドメイン（2026-10-01〜）──────────────────────────
// 本番の経路は「nginx → 旧ドメイン」で、Host は常に OLD_HOST。独自ドメインから来たかは
// X-Forwarded-Host の値で見る（worker/index.js「正本のホスト」）。ここが崩れると
// 独自ドメインが転送ループで全停止するので、nginx 経由の形をそのまま再現して確かめる。
const viaNginx = (p, init = {}) => worker.fetch(new Request(`https://${OLD_HOST}${p}`, {
  ...init, headers: { "X-Forwarded-Host": HOST, ...(init.headers || {}) },
}), env, { waitUntil() {} });
for (const p of ["/", "/about", "/c/138531", "/sitemap-courses.xml", "/api/me"]) {
  const r = await viaNginx(p);
  check(r.status !== 301 && !r.headers.get("location"), `nginx 経由の ${p} が転送される（独自ドメインが転送ループになる）`);
}
check((await viaNginx("/")).headers.get("x-robots-tag") === null, "nginx 経由の / に noindex が付く（run_worker_first で全ページが検索から消える）");
check((await viaNginx("/c/138531")).headers.get("x-robots-tag") === null, "nginx 経由の /c/<id> に noindex が付く");
check(/noindex/.test((await viaNginx("/l/kasai")).headers.get("x-robots-tag") || ""), "nginx 経由の /l/kasai に noindex が無い");
check((await get(`https://${OLD_HOST}/`, )).headers.get("location") === `https://${HOST}/`, "旧ドメイン直の / が独自ドメインへ 301 しない");
const oldC = await get(`https://${OLD_HOST}/c/138531?x=1`);
check(oldC.status === 301 && oldC.headers.get("location") === `https://${HOST}/c/138531?x=1`, "旧ドメイン直の /c/<id> がパスとクエリを保ったまま 301 しない");
const spoofed = await worker.fetch(new Request(`https://${OLD_HOST}/`, { headers: { "X-Forwarded-Host": "evil.example" } }), env, { waitUntil() {} });
check(spoofed.status === 301, "X-Forwarded-Host が独自ドメイン以外のときに転送されない（有無ではなく値で見ること）");
const oldApi = await get(`https://${OLD_HOST}/api/feedback`);
check(oldApi.status === 301, "旧ドメイン直の GET /api/feedback が転送されない");
const hook = await worker.fetch(new Request(`https://${OLD_HOST}/line/webhook`, { method: "POST", body: "{}" }), env, { waitUntil() {} });
check(hook.status !== 301, "旧ドメインの POST /line/webhook が転送される（LINE は 301 を追えない）");
const health = await get(`https://${OLD_HOST}/line/health`);
check(health.status === 200 && (await health.text()) === "ok", "旧ドメインの /line/health が壊れた（LINE の Webhook もこのドメイン）");

// ── 4. 静的ファイル ────────────────────────────
const robotsTxt = read("web/robots.txt");
check(!/^\s*Disallow:\s*\/\s*$/m.test(robotsTxt), "robots.txt がまだサイト全体を Disallow している");
check(/^\s*Sitemap:\s*https:\/\//m.test(robotsTxt), "robots.txt に Sitemap 行が無い");

const headersFile = read("web/_headers");
// 「全ページ noindex」の目印は /* パス規則。/mypage のような個別パスの
// noindex（後述の NOINDEX_PAGES）は意図的に許すので、ここは /* ブロックの
// 中だけを見る（全文を見ると /mypage の noindex に誤反応する）。
const globalBlock = /^\/\*\r?\n((?:[ \t].*\r?\n?)*)/m.exec(headersFile);
check(!globalBlock || !/X-Robots-Tag/i.test(globalBlock[1]), "web/_headers の /* 規則に X-Robots-Tag が残っている（全ページが検索に載らない）");

const sitemap = read("web/sitemap.xml");

// ページ一覧は web/*.html を実際に数えて作る。前は
// {index, about, ads, kuchikomi, partners} と べた書きしていたため、
// 新しいページ（mypage）が増えても検査対象に自動で入らず、この門が
// 素通りされていた（2026-08-26 マージレビュー [Minor] 指摘）。
const pageNames = readdirSync(path.join(ROOT, "web"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => f.slice(0, -".html".length))
  .sort();
check(pageNames.length >= 6, `web/*.html の検出件数がおかしい（${pageNames.length}件） ―― readdir の絞り込みが壊れていないか確認`);

// 「検索に載せない」と決めたページはここに理由コメント付きで足す。
// 足し忘れると sitemap 不在チェックに引っかかって気づける（＝黙って漏れない）。
const NOINDEX_PAGES = new Set([
  // localStorage（時間割・お気に入り・プロフィール）だけを読んでJSで
  // 組み立てる個人用ページ。他人と共有できる内容が無いので検索に載せない。
  // web/_headers の /mypage パス規則で noindex にしている。
  "mypage",
]);

for (const name of pageNames) {
  const url = name === "index" ? `https://${HOST}/` : `https://${HOST}/${name}`;
  const html = read(`web/${name}.html`);
  // noindex なページも canonical 自体は他ページと揃えておく方針（OGP共有用）
  // なので、canonical チェックは noindex かどうかに関わらず全ページにかける。
  check(html.includes(`<link rel="canonical" href="${url}">`), `${name}.html の canonical が ${url} になっていない`);

  if (NOINDEX_PAGES.has(name)) {
    check(!sitemap.includes(`<loc>${url}</loc>`), `sitemap.xml に noindex のはずの ${url} が載っている（NOINDEX_PAGES との矛盾）`);
    // web/_headers に /<name> のパス規則ブロックがあり、その中に
    // X-Robots-Tag: noindex が書かれているかを見る（ブロックの終わりは
    // 次の空行またはファイル末尾）。
    const blockRe = new RegExp(`^/${name}\\r?\\n((?:[ \\t].*\\r?\\n?)*)`, "m");
    const block = blockRe.exec(headersFile);
    check(!!block && /X-Robots-Tag:\s*noindex/i.test(block[1]), `web/_headers に /${name} の noindex 規則が無い（NOINDEX_PAGES に入れたなら実際に効かせること）`);
  } else {
    check(sitemap.includes(`<loc>${url}</loc>`), `sitemap.xml に ${url} が無い`);
  }
}

// ── 科目ごとの静的ページ（/c/<時間割コード>・pages.py が焼く）────────
// 検索に載せるためのページなので、noindex が付いていないこと・canonical が
// 自分を指すこと・sitemap-courses.xml と robots.txt が揃っていることを見る。
// 中身（title の一意・相性度を載せない…）は tools/test_course_pages.py の担当。
check(/^\s*Sitemap:\s*https:\/\/[^/]+\/sitemap-courses\.xml\s*$/m.test(robotsTxt), "robots.txt に sitemap-courses.xml の Sitemap 行が無い");
check(!/^\/c\//m.test(headersFile) || !/X-Robots-Tag/i.test(headersFile.split(/^\/c\//m)[1] || ""), "web/_headers で /c/ に X-Robots-Tag が付いている（科目ページが検索に載らない）");
const coursePages = readdirSync(path.join(ROOT, "web/c")).filter((f) => f.endsWith(".html"));
const courseMap = read("web/sitemap-courses.xml");
check(coursePages.length > 1000, `web/c/ のページが少なすぎる（${coursePages.length}件） ―― pages.py を流したか`);
check((courseMap.match(/<loc>/g) || []).length === coursePages.length, "sitemap-courses.xml の件数が web/c/ のページ数と違う");
for (const f of coursePages.slice(0, 50)) {
  const id = f.slice(0, -".html".length);
  const url = `https://${HOST}/c/${id}`;
  const html = read(`web/c/${f}`);
  check(html.includes(`<link rel="canonical" href="${url}">`), `c/${f} の canonical が ${url} になっていない`);
  check(!/name="robots"[^>]*noindex/i.test(html), `c/${f} に noindex の meta がある`);
  check(courseMap.includes(`<loc>${url}</loc>`), `sitemap-courses.xml に ${url} が無い`);
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
