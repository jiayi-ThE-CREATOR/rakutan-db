/* 「あなたに合う◯件」の枠に出した科目が、すぐ下の一覧にも並んでいないかを見る。
 *
 *   cd web && python3 -m http.server 8144 &
 *   node tools/test_picks_dedup.mjs http://localhost:8144
 *
 * ■ なぜ2ページ目まで見るか（2026-09-11 の指摘）
 * 1ページ目の一覧からだけ抜くと、抜いたぶんが後ろへ押し出されて
 * 2ページ目の先頭に現れ、同じ重複が戻るだけになる。全ページから抜けているか、
 * 実際にページを送って確かめる。
 *
 * ■ 件数の口径
 * 上の帯の件数（#count）は枠のぶんも含んだ総数のまま。枠に出した科目も
 * 利用者はもう見ているので、ページ送りの分子にはそれを足している。
 * 分母を listed 側にすると帯とページ送りで数が食い違う。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8144";
const b = await chromium.launch();
let ng = 0;
const check = (c, m) => { console.log((c ? "  OK  " : "  NG  ") + m); if (!c) ng++; };

const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
// 開屏の問診に邪魔されないよう、済んだことにしてから開く（test_conditions.mjs と同じ）。
await p.addInitScript(() => {
  try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
  try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
});
await p.goto(base, { waitUntil: "networkidle" });
await p.waitForSelector("#list .card");

/* 枠の中の id と、下の一覧の id を別々に採る。 */
const idsOf = () => p.evaluate(() => {
  const pick = el => [...el.querySelectorAll(".card")]
    .map(c => c.querySelector("[data-id]")?.dataset.id).filter(Boolean);
  const box = document.querySelector("#list .picks");
  return {
    picks: box ? pick(box) : [],
    rest: [...document.querySelectorAll("#list > .card")]
      .map(c => c.querySelector("[data-id]")?.dataset.id).filter(Boolean),
    count: +document.getElementById("count").textContent.replace(/[^\d]/g, ""),
    pager: document.querySelector(".pagerPos")?.textContent ?? "",
  };
});

const a = await idsOf();
check(a.picks.length > 0, `枠に ${a.picks.length}件 出ている`);
const dup = a.picks.filter(i => a.rest.includes(i));
check(!dup.length, `1ページ目に重複なし${dup.length ? "（重複: " + dup.join(",") + "）" : ""}`);

await p.locator(".pagerNums .pn", { hasText: "2" }).first().click();
await p.waitForTimeout(500);
const c2 = await idsOf();
const dup2 = a.picks.filter(i => c2.rest.includes(i));
check(!dup2.length, `2ページ目にも出てこない${dup2.length ? "（重複: " + dup2.join(",") + "）" : ""}`);
check(c2.picks.length === 0, "2ページ目には枠を出さない");
check(c2.pager.includes(String(c2.count)),
  `ページ送りの分母が帯の件数と同じ（帯 ${c2.count}件 / ページ送り「${c2.pager}」）`);

console.log(ng ? `\nNG ${ng}件` : "\n全部OK");
await b.close();
process.exit(ng ? 1 : 0);
