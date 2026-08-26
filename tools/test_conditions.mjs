/* 条件チップが、表示している件数どおりに絞り込めるかを実ブラウザで確かめる。
 *
 *   cd web && python3 -m http.server 8144 &
 *   node tools/test_conditions.mjs http://localhost:8144
 *
 * ■ なぜブラウザ側にも要るか
 * CONDITIONS は server.py と web/assets/app.js の両方にある。
 * **本番は静的配信なので、実際に絞り込んでいるのは app.js のほう。**
 * server.py だけ直しても本番は0件のまま、という直し漏れが起きる。
 * 件数は数え直さず「チップに出ている数」と「絞った結果の件数」を
 * 突き合わせる ―― 期待値をここに書くと tools/test_conditions.py と
 * 二重管理になり、必ず片方が古くなる。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8144";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
const errs = [];
p.on("pageerror", e => errs.push(String(e)));

let n = 0;
const fails = [];
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

// 開屏の問診に邪魔されないよう、済んだことにしてから開く（test_favorite.mjs / test_sort.mjs と同じ）。
await p.addInitScript(() => {
  try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
  try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
});

await p.goto(base, { waitUntil: "networkidle" });
await p.waitForSelector("#list > .card");

/* 既定は学年も学期も「すべて」。ここが変わると件数が全部変わるので先に確かめる。 */
check(await p.$eval("#years .chip.on", e => e.textContent.trim()) === "すべて",
      "学年の既定が「すべて」ではない");
check(await p.$eval("#sems .chip.on", e => e.textContent.trim()) === "すべて",
      "学期の既定が「すべて」ではない");

const chips = async () => p.$$eval("#conds .chip, #trust .chip", cs =>
  cs.map(c => ({
    name: c.textContent.replace(/\d+$/, "").trim(),
    count: +(c.querySelector(".n")?.textContent ?? 0),
  })));

const before = await chips();
check(before.length >= 6, `条件チップが少なすぎる（${before.length}個）`);

/* 「0件のチップを作らない」は**全所属ぶんのデータがあるときだけ**の話。
   server.py を data/courses.json（共通教育1,112件）だけで動かすと、
   集中講義191件は全部が学部の専門科目なので **正しく0件**になる。
   データ不足を不具合として落とさないよう、母数で判定を分ける。 */
const total = +(await p.$eval("#count", e => e.textContent)).replace(/[^\d]/g, "");
const full = total >= 7000;
console.log(`  母数 ${total}件（${full ? "全所属" : "一部のみ ― 0件の判定は飛ばす"}）`);

for (const { name, count } of before) {
  // 「押せるのに1件も出ない」チップを作らない。2026-08-26 まで
  // 出席なし・レポートのみ・集中講義 の3つがこの状態だった。
  if (full) check(count > 0, `「${name}」が0件（押せるのに1件も出ない）`);
  if (count === 0) continue;

  // チップの数字どおりに絞れること。ここが食い違うと、
  // 数えている実装と絞っている実装がずれている。
  const btn = p.locator(`#conds .chip, #trust .chip`).filter({ hasText: name }).first();
  await btn.click();
  await p.waitForTimeout(400);
  const got = +(await p.$eval("#count", e => e.textContent)).replace(/[^\d]/g, "");
  check(got === count, `「${name}」チップは ${count}件 と出ているのに、押すと ${got}件`);
  await btn.click();                    // 外して次へ
  await p.waitForTimeout(300);
}

check(!errs.length, "コンソールに例外: " + errs.join(" | "));

console.log(`  条件チップ ${before.length}個: ` +
            before.map(c => `${c.name} ${c.count}`).join(" / "));
console.log(`  通過 ${n - fails.length} 件 / ${n} 件`);
fails.forEach(f => console.log("  NG  " + f));
console.log(fails.length ? "NG" : "OK");
await b.close();
process.exit(fails.length ? 1 : 0);
