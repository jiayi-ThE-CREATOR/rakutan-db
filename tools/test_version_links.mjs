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
 * tools/serve.py も拡張子なし（/about）は解決しないので、別ページの飛び先は
 * .html を直接開いて確かめる（本番の Workers 静的配信は解決する）。
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

const browser = await chromium.launch();
const rows = [];

for (const width of [1280, 390]) {   // PC と スマホ。幅で出方が変わるリンクがある
  for (const { href, label } of links) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
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
      if (await page.locator(`#verList a.verJump[href="${href}"]`).count() === 0) {
        push(false, "リンクが DOM に無い"); await page.close(); continue;
      }
      if (await a.evaluate((el) => el.hidden)) {
        push(null, "リンクを隠している（飛び先がこの画面に無い）"); await page.close(); continue;
      }

      const wantPath = href.split("#")[0] || "/";
      const hash = href.includes("#") ? "#" + href.split("#")[1] : null;
      const cross = wantPath !== "/";
      if (cross) {
        await page.goto(base + wantPath + ".html" + (hash || ""), { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(800);
      } else {
        await a.scrollIntoViewIfNeeded();
        await a.click();
        await page.waitForTimeout(1200);   // スムーススクロールの着地を待つ
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

      const pathOk = cross ? res.path === wantPath + ".html"
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
