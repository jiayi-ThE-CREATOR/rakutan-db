/* お気に入りの星が「押せて」「残って」「詳細を開かない」ことを実ブラウザで見る。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_favorite.mjs http://localhost:8140
 *
 * 静的配信に当てるのが肝。本番で動くのは web/assets/app.js のほう。
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();
const page = await browser.newPage();

/* 開屏の問診に邪魔されないよう、済んだことにしてから開く。 */
await page.addInitScript(() => {
  try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
  try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
});
await page.goto(BASE + "/");
await page.waitForSelector(".card .favBtn");

const first = page.locator(".card").first();
const star  = first.locator(".favBtn");
const id    = await first.getAttribute("data-id");

check(await star.getAttribute("aria-pressed") === "false", "初期状態が押されている");

await star.click();
check(await star.getAttribute("aria-pressed") === "true", "押しても aria-pressed が変わらない");

/* 星は .head の外に在るので、押しても詳細が開いてはいけない。 */
const opened = await first.locator(".detail").evaluate(el => el.children.length > 0);
check(opened === false, "星を押したら詳細まで開いてしまった（.head の中に置いている）");

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rk_favorites") || "{}"));
check(saved.ids && saved.ids[id], "localStorage に入っていない");

/* 再読込しても残ること。 */
await page.reload();
await page.waitForSelector(".card .favBtn");
const star2 = page.locator(`.card[data-id="${id}"] .favBtn`);
check(await star2.getAttribute("aria-pressed") === "true", "再読込で消えた");

await star2.click();
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("rk_favorites") || "{}"));
check(!(after.ids && after.ids[id]), "もう一度押しても外れない");

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
