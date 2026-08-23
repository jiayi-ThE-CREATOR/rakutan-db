// 主要画面のスクリーンショットを撮る。PR ごとに before/after を並べるために使う。
// 使い方: node tools/shots.mjs <出力ディレクトリ> [ベースURL]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const outDir = process.argv[2] || "shots";
const base = process.argv[3] || "http://127.0.0.1:8000";

// 「壊れたら痛い画面」だけを撮る。増やしすぎると誰も見なくなる。
//
// 2026-08-22：PC は 1280 を1枚だけ撮っていた。「PC が 560px の縦棒」は
// その画像に22日間ずっと写っていたのに直らなかった。
// スクショを撮ることと、それを見て「壊れている」と言うことは別の作業。
// せめて段ごとに撮って、崩れが1枚に閉じ込められないようにする。
const VIEWS = [
  { name: "01-top-mobile",     path: "/",              w: 390,  h: 1600 },
  { name: "02-top-tablet",     path: "/",              w: 800,  h: 1400 },
  { name: "03-top-desktop",    path: "/",              w: 1280, h: 1400 },
  { name: "04-top-wide",       path: "/",              w: 1500, h: 1400 },
  { name: "05-search-mobile",  path: "/",              w: 390,  h: 1400, q: "統計" },
  { name: "06-detail-desktop", path: "/",              w: 1280, h: 1400, open: true },
  { name: "07-detail-mobile",  path: "/",              w: 390,  h: 1600, open: true },
  { name: "08-about-mobile",   path: "/about",         w: 390,  h: 2400 },
  { name: "09-about-desktop",  path: "/about",         w: 1280, h: 2000 },
  { name: "10-top-dark",       path: "/",              w: 1280, h: 1400, dark: true },
  { name: "11-progress",       path: "/progress.html", w: 1280, h: 1000 },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const v of VIEWS) {
  const page = await browser.newPage({
    viewport: { width: v.w, height: v.h },
    colorScheme: v.dark ? "dark" : "light",
    // オープニング演出は毎回1.4秒待たされるうえ、途中の1コマが写ると
    // 中身が変わっていなくても差分が毎回出る。撮影時は必ず止める。
    reducedMotion: "reduce",
  });
  await page.goto(base + v.path, { waitUntil: "networkidle" });

  if (v.q) {
    await page.fill("#q", v.q);
    await page.waitForTimeout(600);
  }
  if (v.open) {
    // PC では詳細が右カラムに出るので、クラスを足すのではなく実際に押す。
    await page.waitForSelector(".card");
    await page.click(".card .head");
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${v.name}.png`, fullPage: true });
  console.log("shot:", v.name);
  await page.close();
}

await browser.close();
