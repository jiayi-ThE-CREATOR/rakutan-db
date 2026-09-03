/* 計測の入口（web/assets/analytics.js）を確かめる。
 *   node tools/test_analytics.mjs
 *
 * 守りたいのは3つ。
 *  1. beacon の正本は analytics.js ひとつ。ページ側に複製が戻っていないこと
 *     ―― 2026-09-03 まで6ページに同じタグが並んでいて、トークンを差し替える
 *        日に1ページだけ古いまま残る形だった
 *  2. 除外（?nostats=1）された端末では **beacon を読み込まない**。
 *     読み込んでから捨てるのでは Cloudflare 側に数が残る
 *  3. localStorage が全滅している端末（プライベートモード）でも落ちず、
 *     計測は続く ―― 除外の仕組みのせいで数が減る、が一番まずい
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

function run(href, initial = {}, throws = false) {
  const loaded = [];   // head に足されたタグ＝beacon
  const shown = [];    // body に足された帯＝本人へのお知らせ
  const el = () => ({ style: {}, dataset: {}, setAttribute() {}, remove() {} });
  const document = {
    body: { appendChild: (e) => shown.push(e) },
    head: { appendChild: (e) => loaded.push(e) },
    createElement: el,
    addEventListener() {},
  };
  const ctx = {
    window: {}, document, localStorage: makeStore(initial, throws),
    location: { href }, URL, console, setTimeout: () => 0,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { loaded, shown, ls: ctx.localStorage };
}

{ // 普通の訪問者
  const { loaded } = run("https://rakuhan.nocode-sol.co.jp/");
  check(loaded.length === 1, "普通の訪問で beacon が読み込まれていない");
  check(String(loaded[0]?.src).includes(`?token=${TOKEN}`),
    "トークンがクエリで渡されていない（動的に足したタグでは data-cf-beacon が読まれない形になる）");
  check(loaded[0]?.type === "module", "type=module が付いていない（古いブラウザで構文エラーになる）");
}
{ // ?nostats=1 を踏んだその場から数えない
  const { loaded, shown, ls } = run("https://rakuhan.nocode-sol.co.jp/?nostats=1");
  check(ls._dump().rk_nostats === "1", "?nostats=1 で印が立っていない");
  check(loaded.length === 0, "?nostats=1 を踏んだのに beacon を読み込んでいる");
  check(shown.length === 1, "?nostats=1 の結果が画面に出ない（やったつもりの人が残る）");
}
{ // 印が立っている端末（2回目以降）
  const { loaded } = run("https://rakuhan.nocode-sol.co.jp/", { rk_nostats: "1" });
  check(loaded.length === 0, "除外ずみの端末で beacon を読み込んでいる");
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

// ── 結果 ─────────────────────────────────
if (fails.length) {
  console.error(`NG ${fails.length}/${n}`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK ${n}`);
