/* 何も選んでいないときに、2カラムが視口の中央に寄ることを実ブラウザで見る。
 *
 *   python3 server.py --port 8798 &
 *   node tools/test_inspector_center.mjs http://127.0.0.1:8798
 *
 * 背景：右カラム（380px / 1440px 以上は 440px）は grid-template-columns が
 * 常に確保していたので、開いた直後の画面は右が丸ごと空いて見えていた。
 * 空のときだけ列を畳み、残りを中央へ寄せる。
 *
 * 見張っている回帰:
 *   1. 中央に寄らない（justify-content か :has() の書き忘れ／1fr のまま）
 *   2. 科目を選んでも3カラムに戻らない（選択後も中央寄せのまま右が空く）
 *   3. 3カラムが成立しない幅（1160px 未満）にまで中央寄せが漏れる
 *      ―― そこは元から右カラムが無いので、寄せると意味の無い余白が増えるだけ
 *   4. 絞り込みを畳んだ状態（.railOff）で中央寄せが効かない
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8798";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const open = async (browser, size) => {
  const p = await browser.newPage({ viewport: size });
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#list .card");
  return p;
};

/* .wrap の内側で、実際に見えている列の左右にどれだけ余っているか。
   #workbench そのものを測ってはいけない ―― justify-content:center が寄せるのは
   グリッドの「列」で、コンテナ自身は寄せても幅いっぱいのままなので、
   コンテナを測ると中央寄せが効いていても 0/0 に見える。 */
const gaps = p => p.evaluate(() => {
  const el = document.querySelector(".wrap");
  const w = el.getBoundingClientRect();
  const st = getComputedStyle(el);            // .wrap 自身の padding は余白ではない
  const shown = id => {
    const e = document.getElementById(id);
    return e && e.offsetParent !== null ? e.getBoundingClientRect() : null;
  };
  const first = shown("rail") || shown("results");     // 畳むと #rail は消える
  const last  = shown("inspector") || shown("results");
  return {
    left:  Math.round(first.left - (w.left + parseFloat(st.paddingLeft))),
    right: Math.round((w.right - parseFloat(st.paddingRight)) - last.right),
  };
});

const browser = await chromium.launch();

/* ── 1440px：空 → 中央寄せ、選ぶ → 3カラムに戻る ── */
{
  const p = await open(browser, { width: 1440, height: 900 });

  check(!(await p.locator("#inspector").isVisible()),
        "何も選んでいないのに右カラムが出ている");

  const g = await gaps(p);
  check(Math.abs(g.left - g.right) <= 2,
        `空のときに中央へ寄っていない（左${g.left} / 右${g.right}）`);
  check(g.left > 40,
        `左右の余白が小さすぎる（${g.left}px）―― 列が畳まれていない`);

  /* 中央寄せは「幅を変える」ので、カードの列数まで変わると
     選んだ瞬間に一覧が組み直されて読んでいた場所を見失う。
     空のときの一覧幅（736px）は2列の閾値 770px の手前に置いてあり、
     前後どちらも1列であることをここで固定する。 */
  const cols = () => p.evaluate(() => new Set(
    [...document.querySelectorAll("#list > .card")]
      .map(el => Math.round(el.getBoundingClientRect().x))).size);
  const before = await cols();

  await p.locator("#list > .card .head").first().click();
  await p.waitForTimeout(250);

  const after = await cols();
  check(before === 1 && after === 1,
        `選ぶ前後でカードの列数が変わる（${before}列 → ${after}列）―― 一覧が組み直される`);

  check(await p.locator("#inspector").isVisible(), "科目を選んでも右カラムが出ない");
  const g2 = await gaps(p);
  check(g2.left <= 1 && g2.right <= 1,
        `選んだあと3カラムに戻っていない（左${g2.left} / 右${g2.right}）`);

  await p.close();
}

/* ── 1160px（3カラムの下限）：ここでも中央に寄る ── */
{
  const p = await open(browser, { width: 1160, height: 900 });
  const g = await gaps(p);
  check(Math.abs(g.left - g.right) <= 2,
        `1160px で中央へ寄っていない（左${g.left} / 右${g.right}）`);
  check(g.left > 20, `1160px で列が畳まれていない（余白 ${g.left}px）`);
  await p.close();
}

/* ── 絞り込みを畳んだ状態でも中央に寄る ── */
{
  const p = await open(browser, { width: 1440, height: 900 });
  await p.locator("#grip").click();
  await p.waitForTimeout(120);
  check(!(await p.locator("#rail").isVisible()), "前提が崩れている（畳めていない）");
  const g = await gaps(p);
  /* 左右が等しいだけでは足りない ―― 寄せる前も 0/0 で等しい。
     畳んだぶん右カラムも消えているので、余白は開いているときより広くなる。 */
  check(Math.abs(g.left - g.right) <= 2 && g.left > 40,
        `畳んだ状態で中央へ寄っていない（左${g.left} / 右${g.right}）`);
  await p.close();
}

/* ── 1024px：3カラムが成立しない幅。中央寄せは持ち込まない ── */
{
  const p = await open(browser, { width: 1024, height: 900 });
  const g = await gaps(p);
  check(g.left <= 1 && g.right <= 1,
        `1024px にまで中央寄せが漏れている（左${g.left} / 右${g.right}）`);
  await p.close();
}

/* ── スマホ幅：何も変わらない ── */
{
  const p = await open(browser, { width: 390, height: 844 });
  const g = await gaps(p);
  check(g.left <= 1 && g.right <= 1,
        `スマホ幅にまで中央寄せが漏れている（左${g.left} / 右${g.right}）`);
  await p.close();
}

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}\n  ${fails.join("\n  ")}` : `通過 ${n} 件\nOK`);
process.exit(fails.length ? 1 : 0);
