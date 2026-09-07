/* 口コミの中央モーダル。PC・スマホで同じ形になっていることを固定する。
 *   node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
 * 口コミ4件の科目 135327 を使う。件数が変わってもテストが落ちないよう、
 * 件数そのものは data から読んで期待値にする。 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8794";
const ID = "135327";
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

const browser = await chromium.launch();

async function page(w, h){
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  return p;
}

/* 幅を2つとも見る。「PC とスマホで同じ形」がこの PR の約束なので、
   片方だけ通っても意味がない。 */
for (const [label, w, h] of [["スマホ", 390, 844], ["PC", 1280, 900]]){
  const p = await page(w, h);
  await p.goto(`${base}/?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#panel.open", { timeout: 15000 });

  const box = await p.evaluate(() => {
    const el = document.querySelector("#panel .kBox");
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: window.innerHeight - r.bottom,
             left: r.left, right: window.innerWidth - r.right,
             width: r.width };
  });

  /* 上下中央：上下の余白の差が 40px 以内。下からのシート（top が大きく
     bottom が 0）に戻ったらここで落ちる。 */
  check(Math.abs(box.top - box.bottom) <= 40,
        `[${label}] モーダルが上下中央にない（上 ${Math.round(box.top)} / 下 ${Math.round(box.bottom)}）`);
  check(Math.abs(box.left - box.right) <= 2,
        `[${label}] モーダルが左右中央にない（左 ${Math.round(box.left)} / 右 ${Math.round(box.right)}）`);
  check(box.width <= 560 + 1, `[${label}] モーダルが 560px より広い（${Math.round(box.width)}px）`);

  /* 閉じる手段3つ。どれも ?c= が URL から消えること。 */
  await p.click("#panelClose");
  await p.waitForTimeout(300);
  check(!new URL(p.url()).searchParams.get("c"), `[${label}] ✕ で ?c= が消えない`);
  check(!(await p.evaluate(() => document.querySelector("#panel").classList.contains("open"))),
        `[${label}] ✕ でモーダルが閉じない`);

  await p.close();
}

await browser.close();
console.log(fails.length ? "NG" : `OK ${new Date().toISOString().slice(0,10)}`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
