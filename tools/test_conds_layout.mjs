/* 条件チップの並びと点灯を実ブラウザで見張る。
 *
 *   cd web && python3 -m http.server 8144 &
 *   node tools/test_conds_layout.mjs http://localhost:8144
 *
 * ■ 何を見ているか（2026-09-11 の指摘3件がそのまま項目になっている）
 *   ① 「レポートのみ」を押すと出席なし・小テストなしも同じ濃さで光る
 *      → 押した1つは .chip.on、含まれた側は .chip.on.imp（淡い地）で区別する。
 *        絞り込みは変えない。実際に効いているものを消灯させると画面が嘘をつく。
 *   ② 押すボタンによって配置の形が変わる
 *      → 件数の桁が変わると flex-wrap は折り返し位置がずれる。押す前後で
 *        1pxも動かないことを座標で確かめる。
 *   ③ 3列×2行で並ぶこと。
 *
 * 件数そのものの正しさは tools/test_conditions.mjs が見ている。ここは形だけ。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8144";
const b = await chromium.launch();
let ng = 0;
const check = (c, m) => { console.log((c ? "  OK  " : "  NG  ") + m); if (!c) ng++; };

/* チップの位置と、文字が枠に収まっているかをまとめて採る。 */
const snap = p => p.$$eval("#conds .chip", cs => cs.map(c => {
  const r = c.getBoundingClientRect();
  return { name: c.textContent.replace(/\d+$/, "").trim(),
           x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
           clipped: c.scrollWidth > c.clientWidth + 1 };
}));

/* スマホが基準、PC も必須形態（CLAUDE.md）。レールの幅は 768 / 1160 / 1440px で
   段が変わる（240 → 260 → 280px）ので、変わり目の両側を全部踏む。
   340px は現役で一番狭い部類の端末（iPhone SE 第1世代 320px + 余裕）。 */
for (const [label, width] of [["スマホ(最小)", 340], ["スマホ", 390], ["タブレット", 768],
                              ["PC(小)", 1024], ["PC", 1160], ["PC(中)", 1280], ["PC(大)", 1440]]) {
  const p = await b.newPage({ viewport: { width, height: 1400 } });
  // 開屏の問診に邪魔されないよう、済んだことにしてから開く（test_conditions.mjs と同じ）。
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  await p.goto(base, { waitUntil: "networkidle" });
  await p.waitForSelector("#conds .chip");

  console.log(`\n=== ${label}（幅${width}px） ===`);
  const a = await snap(p);
  check(a.length === 6, `条件チップは6個（実測 ${a.length}個）`);

  const rows = [...new Set(a.map(c => c.y))].sort((x, y) => x - y);
  check(rows.length === 2, `2行に並ぶ（実測 ${rows.length}行）`);
  rows.forEach((y, i) => {
    const cols = a.filter(c => c.y === y);
    check(cols.length === 3, `  ${i + 1}行目は3列: ${cols.map(c => c.name).join(" / ")}`);
  });
  const ws = [...new Set(a.map(c => c.w))];
  check(ws.length === 1, `6個とも同じ幅（実測 ${ws.join(",")}px）`);
  const clip = a.filter(c => c.clipped);
  check(!clip.length, `文字が切れていない${clip.length ? "（切れ: " + clip.map(c => c.name).join(",") + "）" : ""}`);

  /* 押して件数の桁が変わっても位置が動かないこと ―― これが「形が変わる」の本体。
     「レポートのみ」は含まれる2つも一緒に光るので、点灯の区別もここで見る。 */
  for (const name of ["レポートのみ", "持ち込み可"]) {
    await p.locator("#conds .chip").filter({ hasText: name }).first().click();
    await p.waitForTimeout(400);
    const after = await snap(p);
    const moved = after.filter((c, i) => c.x !== a[i].x || c.y !== a[i].y || c.w !== a[i].w);
    check(!moved.length,
      `「${name}」を押しても配置が動かない${moved.length ? "（動いた: " + moved.map(c => c.name).join(",") + "）" : ""}`);

    if (name === "レポートのみ") {
      const cls = await p.$$eval("#conds .chip", cs => cs.map(c =>
        ({ name: c.textContent.replace(/\d+$/, "").trim(), cls: c.className, title: c.title })));
      cls.filter(t => t.cls !== "chip").forEach(t =>
        console.log(`       ${t.name} → class="${t.cls}"${t.title ? ` title="${t.title}"` : ""}`));
      const of = n => cls.find(c => c.name === n);
      check(of("レポートのみ").cls === "chip on",     "レポートのみ＝濃い（押した本人）");
      check(of("出席なし").cls === "chip on imp",     "出席なし＝淡い（含まれている）");
      check(of("小テストなし").cls === "chip on imp", "小テストなし＝淡い（含まれている）");
      check(of("出席なし").title.includes("レポートのみ"), "淡い側に理由が title で出る");
    }
    await p.locator("#conds .chip").filter({ hasText: name }).first().click();  // 外して次へ
    await p.waitForTimeout(300);
  }
  await p.close();
}

console.log(ng ? `\nNG ${ng}件` : "\n全部OK");
await b.close();
process.exit(ng ? 1 : 0);
