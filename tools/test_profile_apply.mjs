/* 問診の答え（学部・学年）が「その場の1画面」ではなく、次回以降の
 * 訪問にも既定の絞り込みとして効くこと（final-review.md §3-④）。
 * ただし共有リンクの明示的な値（URL クエリ）には勝たせないこと。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_profile_apply.mjs http://localhost:8140
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();

async function freshWithProfile(profile) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((p) => {
    try {
      localStorage.setItem("rk_onboarded", "1");
      if (p) localStorage.setItem("osaka_u_settings", JSON.stringify(p));
      sessionStorage.setItem("rk_splash_seen", "1");
    } catch (e) {}
  }, profile);
  return { ctx, page };
}

// ① 保存済みプロフィール無し・クリーンな URL ―― 基準値（"all"）を取る
let baseCount;
{
  const { ctx, page } = await freshWithProfile(null);
  await page.goto(BASE + "/");
  await page.waitForSelector(".card");
  baseCount = Number(await page.locator("#count").textContent());
  check(Number.isFinite(baseCount) && baseCount > 0, "基準の件数が取れない");
  await ctx.close();
}

// ② 保存済みプロフィール（1年）＋クリーンな URL ―― 翌日また開いた想定。
//    絞り込みが効き、チップにも反映されていること。
{
  const { ctx, page } = await freshWithProfile({ faculty: "law", grade: "1" });
  await page.goto(BASE + "/");
  await page.waitForSelector(".card");

  const onChip = await page.locator("#years .chip.on").textContent();
  check(onChip.includes("1年"), `学年チップに保存済みプロフィールが反映されていない（いま ${onChip}）`);

  const count = Number(await page.locator("#count").textContent());
  check(count < baseCount,
        `2回目以降の訪問なのに一覧が絞られていない（"all" の${baseCount}件のまま、いま${count}件）`);

  const facSelValue = await page.locator("#facSel").inputValue().catch(() => null);
  if (facSelValue !== null) {
    check(facSelValue === "law", `学部の選択欄に保存済みプロフィールが反映されていない（いま ${facSelValue}）`);
  }
  await ctx.close();
}

// ③ 保存済みプロフィール（1年）＋ URL に ?year=3 ―― 共有リンクが勝つこと
{
  const { ctx, page } = await freshWithProfile({ faculty: "law", grade: "1" });
  await page.goto(BASE + "/?year=3");
  await page.waitForSelector(".card");

  const onChip = await page.locator("#years .chip.on").textContent();
  check(onChip.includes("3年"),
        `URL の year=3 より保存済みプロフィール（1年）が勝ってしまっている（いま ${onChip}）`);
  await ctx.close();
}

// ④ 保存済みプロフィール（1年）＋ URL に ?faculty=engineering ―― 同様に学部も
{
  const { ctx, page } = await freshWithProfile({ faculty: "law", grade: "1" });
  await page.goto(BASE + "/?faculty=engineering");
  await page.waitForSelector(".card");

  const facSelValue = await page.locator("#facSel").inputValue().catch(() => null);
  if (facSelValue !== null) {
    check(facSelValue === "engineering",
          `URL の faculty=engineering より保存済みプロフィール（law）が勝ってしまっている（いま ${facSelValue}）`);
  }
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
