// 注意帯（.rvAlert）が 390px のカードのどれだけを占めるかを測る。
// 使い方: node tools/measure_alert.mjs [出力ディレクトリ] [ベースURL]
//
// 「強すぎる」は主観だが、面積は主観ではない。文言を変えるたびにこれを流して
// 数字で比べる（松下さんが 2026-08-24 に 30% / 24% / 17% を出したのと同じ測り方）。
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const outDir = process.argv[2] || "shots/alert";
const base = process.argv[3] || "http://127.0.0.1:8123";

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

const VIEWS = [
  { name: "390-light", w: 390, h: 1400, dark: false },
  { name: "390-dark", w: 390, h: 1400, dark: true },
  { name: "1280-light", w: 1280, h: 1200, dark: false },
];

for (const v of VIEWS) {
  const page = await browser.newPage({
    viewport: { width: v.w, height: v.h },
    colorScheme: v.dark ? "dark" : "light",
    reducedMotion: "reduce",
  });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  // 既定の表示（秋冬）で注意帯が出る4科目のうちの1つ。口コミ1件・scored:false・
  // needs_review も立っているので「※」と帯が同時に出る一番混む状態になる。
  await page.fill("#q", "化学熱力学");
  await page.waitForTimeout(700);
  await page.waitForSelector(".card.unscored");

  const m = await page.evaluate(() => {
    const card = document.querySelector(".card.unscored");
    const alert = card.querySelector(".rvAlert");
    const cr = card.getBoundingClientRect();
    const ar = alert.getBoundingClientRect();
    const cs = getComputedStyle(alert);
    const lh = parseFloat(cs.lineHeight);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return {
      card: Math.round(cr.height),
      cardW: Math.round(cr.width),
      alert: Math.round(ar.height),
      alertW: Math.round(ar.width),
      lines: Math.round((ar.height - pad) / lh),
      pct: Math.round((ar.height / cr.height) * 100),
      text: alert.innerText.replace(/\n/g, " / "),
    };
  });
  console.log(
    `${v.name.padEnd(12)} カード ${m.card}px(幅${m.cardW}) ／ 帯 ${m.alert}px(幅${m.alertW}) ` +
    `／ ${m.lines}行 ／ カードの ${m.pct}%`
  );
  console.log(`             「${m.text}」`);

  const card = page.locator(".card.unscored").first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await card.screenshot({ path: `${outDir}/${v.name}.png` });
  await page.close();
}

await browser.close();
