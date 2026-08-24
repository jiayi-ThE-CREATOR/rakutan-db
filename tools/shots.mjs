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
  { name: "06-detail-desktop", path: "/",              w: 1280, h: 1400, koma: true, open: true },
  { name: "07-detail-mobile",  path: "/",              w: 390,  h: 1600, koma: true, open: true },
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
  if (v.koma) {
    // 一覧は時間割起点で、コマを押すまで1件も出ない。2026-08-22 の作り直しで
    // そうなったのに、ここは裸の「/」で .card を待ち続けていて、以来どのブランチでも
    // 06 で必ず落ちていた。詳細を撮る前に、必ず中身のあるコマを押す。
    //
    // CI には data/courses.json が無い（公開リポジトリなので .gitignore 対象）ので
    // server.py は 30 件の data/courses.sample.json に落ちる。そのサンプルは
    // 既定の絞り込み（1年・秋冬）だと1件も残らず、コマが全部 0 になる。
    // 詳細の見た目を撮るのが目的なので、まず学年と学期を「すべて」にする。
    await page.click('#years button[data-y="all"]');
    await page.click('#sems button[data-s="all"]');
    await page.waitForTimeout(600);

    // 決め打ちのコマにしないのは、本番データとサンプルで中身のあるコマが違うから。
    // 件数が最大のコマなら、どちらでも同じ手が通る。
    const cells = page.locator("#grid button:not(.zero)");
    const n = await cells.count();
    if (!n) throw new Error(`${v.name}: 押せるコマが1つも無い。データが空か、絞り込みが効きすぎ`);
    let pick = 0, most = -1;
    for (let i = 0; i < n; i++) {
      const c = parseInt((await cells.nth(i).textContent()) || "0", 10) || 0;
      if (c > most) { most = c; pick = i; }
    }
    await cells.nth(pick).click();
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
