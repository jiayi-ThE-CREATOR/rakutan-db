// 主要画面のスクリーンショットを撮る。PR ごとに before/after を並べるために使う。
// 使い方: node tools/shots.mjs <出力ディレクトリ> [ベースURL]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const outDir = process.argv[2] || "shots";
const base = process.argv[3] || "http://127.0.0.1:8000";

// 「壊れたら痛い画面」だけを撮る。増やしすぎると誰も見なくなる。
const VIEWS = [
  { name: "01-top-mobile",    path: "/",                       w: 390,  h: 1400 },
  { name: "02-top-desktop",   path: "/",                       w: 1280, h: 1400 },
  { name: "03-search-mobile", path: "/?",                      w: 390,  h: 1400, q: "統計" },
  { name: "04-detail-open",   path: "/",                       w: 1280, h: 1400, open: true },
  { name: "05-progress",      path: "/progress.html",          w: 1280, h: 1000 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const v of VIEWS) {
  const page = await browser.newPage({ viewport: { width: v.w, height: v.h } });
  await page.goto(base + v.path, { waitUntil: "networkidle" });

  if (v.q) {
    await page.fill("#q", v.q);
    await page.waitForTimeout(600);
  }
  if (v.open) {
    await page.waitForSelector(".card");
    await page.evaluate(() =>
      document.querySelectorAll(".card").forEach((c, i) => { if (i < 2) c.classList.add("open"); }));
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${v.name}.png`, fullPage: true });
  console.log("shot:", v.name);
  await page.close();
}

await browser.close();
