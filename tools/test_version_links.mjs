/* 更新履歴（右下「バージョン＆最新機能」）の「見てみる →」が、
 * 本当にその機能の場所へ着くかを実ブラウザで確かめる。
 *   python3 tools/serve.py 8791 &
 *   node tools/test_version_links.mjs http://127.0.0.1:8791
 *
 * 飛び先の id（#sliders #grid #rail #grip #list / #mpTimetable …）は
 * app.js・mypage.js 側の持ち物なので、向こうが名前を変えた瞬間に
 * こちらのリンクは黙って死ぬ。押しても何も起きないリンクは、
 * 一度でも踏まれたら二度と押されない ―― だから機械に押させる。
 *
 * 判定は3つ:
 *   ✓ 押したら飛び先が画面に見えている
 *   — リンクを隠している（飛び先がこの画面に無い。PC だけの機能をスマホ幅で見たとき）
 *   ✗ それ以外（id が消えた・画面外・ダイアログが閉じない）
 *
 * 配信によって別ページの開き方が違う:
 *   本番の Workers    /about がそのまま開く（/about.html は 307 で /about へ戻される）
 *   ローカルの静的配信 /about は 404。/about.html を直接開く必要がある
 * どちらかを決め打ちすると、もう一方で全滅する。起動時に一度だけ叩いて見分ける。
 *
 * 本番に向けても使える:
 *   node tools/test_version_links.mjs https://rakuhan.nocode-sol.co.jp
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const base = process.argv[2] || "http://127.0.0.1:8791";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// version.js はブラウザ用の IIFE なので import できない。
// 配列リテラルだけ取り出して評価する（tools/test_version.mjs と同じ手）。
const src = readFileSync(path.join(ROOT, "web/assets/version.js"), "utf-8");
const from = src.indexOf("[", src.indexOf("const RELEASES = ["));
let depth = 0, end = -1;
for (let i = from; i < src.length; i++) {
  if (src[i] === "[") depth++;
  else if (src[i] === "]" && --depth === 0) { end = i + 1; break; }
}
const RELEASES = new Function("return " + src.slice(from, end))();
const links = [];
for (const rel of RELEASES) {
  for (const it of rel.items) {
    if (it.href) links.push({ href: it.href, label: it.head || it.lead });
  }
}
if (!links.length) { console.log("✓ リンクが1件も無い（確かめるものが無い）"); process.exit(0); }

/* 拡張子なし（/about）を解決する配信かを一度だけ確かめる。
   ローカルの静的配信は 404 を返すので、そのときだけ .html を足す。 */
let extensionless = false;
try {
  const r = await fetch(base + "/about", { redirect: "follow" });
  extensionless = r.ok && (r.headers.get("content-type") || "").includes("text/html");
} catch (e) { /* 繋がらなければ下の goto が本来のエラーを出す */ }
const pageSuffix = extensionless ? "" : ".html";
console.log(`${base}  別ページ: ${extensionless ? "/about" : "/about.html"} で開く`);

const browser = await chromium.launch();
const rows = [];

for (const width of [1280, 390]) {   // PC と スマホ。幅で出方が変わるリンクがある
  for (const { href, label } of links) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    /* 科目データをわざと遅らせる。ローカルは速すぎて、本番で出る
       「飛び先が伸びて画面外へ逃げる」不具合を一度も再現できなかった
       （2026-09-22。本番では3回とも出た）。遅いほうだけを試せば、
       速いほうは自動的に通る。 */
    await page.route("**/courses.built.json", async (r) => {
      await new Promise((ok) => setTimeout(ok, 2500));
      await r.continue();
    });
    // 開屏と問診は済んだことにする（smoke.mjs と同じ）
    await page.addInitScript(() => {
      try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
      try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
    });
    const push = (ok, note) => rows.push({ width, href, label, ok, note });
    try {
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#verFab", { state: "visible", timeout: 15000 });
      await page.click("#verFab");
      // 畳みも過去の版も開いて、全部のリンクに手が届く状態にする
      await page.evaluate(() => document.querySelectorAll("#verList details").forEach((d) => { d.open = true; }));
      await page.waitForTimeout(200);

      const a = page.locator(`#verList a.verJump[href="${href}"]`).first();
      // 1回数えて終わりにしない。回線が遅いと、数えた時点ではまだ描き終わっていない
      try {
        await a.waitFor({ state: "attached", timeout: 5000 });
      } catch (e) {
        push(false, "リンクが DOM に無い"); await page.close(); continue;
      }
      if (await a.evaluate((el) => el.hidden)) {
        push(null, "リンクを隠している（飛び先がこの画面に無い）"); await page.close(); continue;
      }

      const wantPath = href.split("#")[0] || "/";
      const hash = href.includes("#") ? "#" + href.split("#")[1] : null;
      const cross = wantPath !== "/";
      if (cross) {
        await page.goto(base + wantPath + pageSuffix + (hash || ""), { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(800);
      } else {
        await a.scrollIntoViewIfNeeded();
        await a.click();
        // 遅らせたデータ（2.5秒）が届いて一覧が伸び切り、
        // version.js が運び直し終わるまで待つ
        await page.waitForTimeout(4500);
      }

      const res = await page.evaluate((h) => {
        const dlgOpen = document.getElementById("verDlg")?.open === true;
        if (!h) return { path: location.pathname, dlgOpen, found: true, visible: true };
        const t = document.querySelector(h);
        if (!t) return { path: location.pathname, dlgOpen, found: false, visible: false };
        const r = t.getBoundingClientRect();
        return { path: location.pathname, dlgOpen, found: true, top: Math.round(r.top),
          visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight };
      }, hash);

      const pathOk = cross ? res.path === wantPath + pageSuffix
                           : (res.path === wantPath || res.path === wantPath + "/");
      if (!pathOk) push(false, `遷移先が ${res.path}`);
      else if (!res.found) push(false, `飛び先の id ${hash} が無い`);
      else if (!res.visible) push(false, `飛び先が画面外（top=${res.top}）`);
      else if (!cross && res.dlgOpen) push(false, "ダイアログが閉じていない");
      else push(true, "");
    } catch (err) {
      push(false, String(err).split("\n")[0].slice(0, 70));
    }
    await page.close();
  }
}
await browser.close();

for (const w of [1280, 390]) {
  console.log(`\n── 幅 ${w}px ──`);
  for (const r of rows.filter((x) => x.width === w)) {
    const mark = r.ok === null ? "—" : r.ok ? "✓" : "✗";
    console.log(`  ${mark} ${r.href.padEnd(22)} ${r.label}${r.note ? "  ← " + r.note : ""}`);
  }
}
const bad = rows.filter((r) => r.ok === false);
const hid = rows.filter((r) => r.ok === null).length;
console.log(`\n✓ ${rows.length - bad.length - hid} / ✗ ${bad.length} / — ${hid}（意図して隠している）`);
if (bad.length) process.exit(1);
