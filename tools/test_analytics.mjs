/* 計測の入口（web/assets/analytics.js）を確かめる。
 *   node tools/test_analytics.mjs
 *
 * 守りたいのは6つ。
 *  1. beacon の正本は analytics.js ひとつ。ページ側に複製が戻っていないこと
 *     ―― 2026-09-03 まで6ページに同じタグが並んでいて、トークンを差し替える
 *        日に1ページだけ古いまま残る形だった
 *  2. 除外（?nostats=1）された端末では **beacon を読み込まない**。
 *     読み込んでから捨てるのでは Cloudflare 側に数が残る
 *  3. localStorage が全滅している端末（プライベートモード）でも落ちず、
 *     計測は続く ―― 除外の仕組みのせいで数が減る、が一番まずい
 *  4. 自前の計測（POST /api/hit）が、検索語や科目IDを送っていないこと
 *  5. 同じ検索語を打ち直しただけで数が増えないこと
 *  6. Worker 側がクライアントを信じないこと（種類・UA・Origin を自分で判定）
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf-8");
const SRC = read("web/assets/analytics.js");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const TOKEN = "b0324782e4e44ca58b45e4dd0c270112";
const BEACON = "beacon.min.js";

// ── 1. 正本が1つであること ────────────────────
check(SRC.includes(BEACON), "analytics.js が beacon を読み込んでいない");
check(SRC.includes(TOKEN), "analytics.js にサイトトークンが無い");

const shell = read("templates/shell.html");
check(shell.includes("/assets/analytics.js"), "shell.html が analytics.js を読み込んでいない");
check(!shell.includes(BEACON), "shell.html に beacon のタグが直接残っている（正本は analytics.js）");

// ページを名指ししない。次の人がページを足したとき、計測が付いてこなければ落ちる。
const pages = readdirSync(path.join(ROOT, "web"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => "web/" + f);
check(pages.length >= 6, "web/*.html が見つからない");
for (const page of pages) {
  const html = read(page);
  check(html.includes("/assets/analytics.js"), `${page} に analytics.js が無い（build.py の注入を流していない）`);
  check(!html.includes(BEACON), `${page} に beacon のタグが直接残っている`);
}

// ── 2. 偽ブラウザで動かす ─────────────────────
function makeStore(initial = {}, throws = false) {
  const m = new Map(Object.entries(initial));
  const boom = () => { throw new Error("SecurityError"); };
  return {
    getItem: throws ? boom : (k) => (m.has(k) ? m.get(k) : null),
    setItem: throws ? boom : (k, v) => void m.set(k, String(v)),
    removeItem: throws ? boom : (k) => void m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

function run(href, initial = {}, throws = false, session = {}) {
  const loaded = [];   // head に足されたタグ＝beacon
  const shown = [];    // body に足された帯＝本人へのお知らせ
  const hits = [];     // POST /api/hit の中身
  const el = () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {} });
  const document = {
    body: { appendChild: (e) => shown.push(e) },
    head: { appendChild: (e) => loaded.push(e) },
    createElement: el,
    addEventListener() {},
  };
  /* Blob は中身を読める形に差し替える（本物は text() が非同期で、
     テストの見通しが悪くなるだけで得が無い）。 */
  class FakeBlob {
    constructor(parts, opts) { this.text = String(parts[0]); this.type = opts?.type; }
  }
  const navigator = {
    sendBeacon(url, blob) { hits.push({ url, type: blob.type, body: JSON.parse(blob.text) }); return true; },
  };
  const ctx = {
    window: {}, document, navigator, Blob: FakeBlob,
    localStorage: makeStore(initial, throws),
    sessionStorage: makeStore(session, throws),
    location: { href, pathname: new URL(href).pathname },
    URL, console, setTimeout: () => 0,
    fetch: () => Promise.resolve(),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { loaded, shown, hits, ls: ctx.localStorage, ss: ctx.sessionStorage, track: ctx.window.rkTrack };
}

{ // 普通の訪問者
  const { loaded, hits, ss } = run("https://rakuhan.nocode-sol.co.jp/");
  check(hits.length === 1, "普通の訪問で /api/hit が飛んでいない");
  check(hits[0]?.url === "/api/hit", "自前の計測が同じドメイン宛になっていない（塞がれない理由が消える）");
  check(hits[0]?.body.e === "pv", "最初の1件が pv になっていない");
  check(hits[0]?.body.n === 1, "その訪問の1回目なのに n=1 になっていない");
  check(ss._dump().rk_s === "1", "訪問の印が sessionStorage に残っていない");
  check(loaded.length === 1, "普通の訪問で beacon が読み込まれていない");
  check(String(loaded[0]?.src).includes(`?token=${TOKEN}`),
    "トークンがクエリで渡されていない（動的に足したタグでは data-cf-beacon が読まれない形になる）");
  check(loaded[0]?.type === "module", "type=module が付いていない（古いブラウザで構文エラーになる）");
}
{ // ?nostats=1 を踏んだその場から数えない
  const { loaded, shown, ls, hits, track } = run("https://rakuhan.nocode-sol.co.jp/?nostats=1");
  check(hits.length === 0, "?nostats=1 を踏んだのに自前の計測が飛んでいる");
  check(typeof track === "function", "除外された端末で window.rkTrack が無い（app.js 側が落ちる）");
  track("detail");
  check(hits.length === 0, "除外された端末で rkTrack が数えている");
  check(ls._dump().rk_nostats === "1", "?nostats=1 で印が立っていない");
  check(loaded.length === 0, "?nostats=1 を踏んだのに beacon を読み込んでいる");
  check(shown.length === 1, "?nostats=1 の結果が画面に出ない（やったつもりの人が残る）");
}
{ // 印が立っている端末（2回目以降）
  const { loaded, hits } = run("https://rakuhan.nocode-sol.co.jp/", { rk_nostats: "1" });
  check(loaded.length === 0, "除外ずみの端末で beacon を読み込んでいる");
  check(hits.length === 0, "除外ずみの端末で /api/hit が飛んでいる");
}
{ // 数に戻す
  const { loaded, shown, ls } = run("https://rakuhan.nocode-sol.co.jp/?nostats=0", { rk_nostats: "1" });
  check(ls._dump().rk_nostats === undefined, "?nostats=0 で印が消えていない");
  check(loaded.length === 1, "?nostats=0 のあとに beacon が戻っていない");
  check(shown.length === 1, "?nostats=0 の結果が画面に出ない");
}
{ // プライベートモード（localStorage が全部例外を投げる）
  const { loaded } = run("https://rakuhan.nocode-sol.co.jp/", {}, true);
  check(loaded.length === 1, "localStorage が使えない端末で計測が止まっている");
}
{ // 除外は他人の URL では起きない（?nostats が無いクエリ）
  const { loaded, ls } = run("https://rakuhan.nocode-sol.co.jp/?year=2&sem=haru");
  check(ls._dump().rk_nostats === undefined, "関係の無いクエリで除外の印が立った");
  check(loaded.length === 1, "普通の絞り込みで beacon が読み込まれていない");
}

// ── 3. 数え方（重複・上限・送る中身） ──────────
{ // 同じ検索語を打ち直しても1回。語そのものは送らない
  const { hits, track } = run("https://rakuhan.nocode-sol.co.jp/");
  track("search", "統計");
  track("search", "統計");
  check(hits.length === 2, "同じ検索語で2回数えている（pv 1 + search 1 のはず）");
  track("search", "線形代数");
  check(hits.length === 3, "違う検索語が数えられていない");
  const bodies = JSON.stringify(hits.map((h) => h.body));
  check(!bodies.includes("統計") && !bodies.includes("線形代数"),
    "検索語そのものが送信されている（/about の「個人を特定する情報も送らない」を崩す）");
}
{ // 1ページの上限。将来ループの中から呼んでしまっても無料枠を溶かさない
  const { hits, track } = run("https://rakuhan.nocode-sol.co.jp/");
  for (let i = 0; i < 200; i++) track("detail", i);
  check(hits.length <= 60, `1ページで ${hits.length} 件送っている（上限60のはず）`);
}
{ // 送るのはパスだけ。クエリ（?c=<科目id>）は載せない
  const { hits } = run("https://rakuhan.nocode-sol.co.jp/l/insta?c=12345");
  check(hits[0]?.body.p === "/l/insta", `パス以外が送られている: ${hits[0]?.body.p}`);
}
{ // 同じ訪問の2ページ目は n=0（訪問を二重に数えない）
  const { hits } = run("https://rakuhan.nocode-sol.co.jp/about", {}, false, { rk_s: "1" });
  check(hits[0]?.body.n === 0, "同じ訪問の2ページ目を新しい訪問として数えている");
}
{ // sessionStorage が全滅していても計測は続く（訪問数だけ落ちる）
  const { hits } = run("https://rakuhan.nocode-sol.co.jp/", {}, true);
  check(hits.length === 1, "sessionStorage が使えない端末で計測が止まっている");
  check(hits[0]?.body.n === 0, "読めなかったのに新しい訪問として数えている");
}

// ── 4. Worker の POST /api/hit ────────────────
const worker = (await import(path.join(ROOT, "worker/index.js"))).default;
const ASSETS = { fetch: async () => new Response("asset", { status: 200 }) };
const CTX = { waitUntil() {} };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const ORIGIN = "https://rakuhan.nocode-sol.co.jp";

async function post(body, { ua = UA, origin = ORIGIN, method = "POST", referer } = {}) {
  const written = [];
  const env = { ASSETS, STATS: { writeDataPoint: (d) => written.push(d) } };
  const headers = { "Content-Type": "application/json" };
  if (ua) headers["User-Agent"] = ua;
  if (origin) headers["Origin"] = origin;
  if (referer) headers["Referer"] = referer;
  const req = new Request(ORIGIN + "/api/hit", {
    method, headers,
    body: method === "GET" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const res = await worker.fetch(req, env, CTX);
  return { res, written };
}

{
  const { res, written } = await post({ e: "pv", p: "/", n: 1 });
  check(res.status === 204, `正しい1件で ${res.status} を返した（204 のはず）`);
  check(written.length === 1, "正しい1件が記録されていない");
  check(written[0]?.blobs[0] === "pv", "種類が blob1 に入っていない");
  check(written[0]?.blobs[1] === "/", "パスが blob2 に入っていない");
  check(written[0]?.doubles[0] === 1 && written[0]?.doubles[1] === 1,
    "件数と訪問フラグが double に入っていない");
}
{ // クライアントを信じない
  check((await post({ e: "pv" }, { method: "GET" })).written.length === 0, "GET を数えている");
  check((await post({ e: "こんにちは" })).written.length === 0, "知らない種類を数えている");
  check((await post({})).written.length === 0, "種類の無い本文を数えている");
  check((await post("これはJSONではない")).written.length === 0, "壊れた本文で落ちるか数えている");
  check((await post({ e: "pv" }, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" })).written.length === 0,
    "クローラ（UA）を数えている");
  check((await post({ e: "pv" }, { ua: "Mozilla/5.0 ... Chrome/120 HeadlessChrome/120" })).written.length === 0,
    "ヘッドレスブラウザを数えている");
  check((await post({ e: "pv" }, { origin: "https://example.com" })).written.length === 0,
    "他所のサイトから叩かれた分を数えている");
}
{ // Origin が付かない経路は「通す」。中継のヘッダ設定で静かにゼロになる方がまずい
  const { written } = await post({ e: "pv" }, { origin: null });
  check(written.length === 1, "Origin も Referer も無い分を落としている（nginx 中継で全滅しうる）");
  const viaReferer = await post({ e: "pv" }, { origin: null, referer: ORIGIN + "/" });
  check(viaReferer.written.length === 1, "Referer だけの分を落としている");
}
{ // 送られてきたパスを鵜呑みにしない
  const { written } = await post({ e: "detail", p: "/?c=1234567&year=2" });
  check(written[0]?.blobs[1] === "/", `クエリを落としていない: ${written[0]?.blobs[1]}`);
  const long = await post({ e: "pv", p: "/" + "a".repeat(500) });
  check(long.written[0]?.blobs[1].length <= 64, "長すぎるパスを切り詰めていない");
}
{ // 束縛が無い環境（ローカル・まだデプロイしていない）でも落ちない
  const req = new Request(ORIGIN + "/api/hit", {
    method: "POST", headers: { "User-Agent": UA, Origin: ORIGIN }, body: JSON.stringify({ e: "pv" }),
  });
  const res = await worker.fetch(req, { ASSETS }, CTX);
  check(res.status === 204, "STATS 束縛が無い環境で 204 以外を返した（本番前のローカルで落ちる）");
}
{ // 他の経路を壊していない
  const req = new Request(ORIGIN + "/line/health");
  const res = await worker.fetch(req, { ASSETS }, CTX);
  check(res.status === 200, "/line/health を壊した");
}

// ── 結果 ─────────────────────────────────
if (fails.length) {
  console.error(`NG ${fails.length}/${n}`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK ${n}`);
