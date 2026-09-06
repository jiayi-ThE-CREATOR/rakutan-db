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

  const lw = Math.round((await p.locator("#results").boundingBox()).width);
  check(Math.abs(lw - 860) <= 2, `空のときの一覧が 860px でない（${lw}px）`);

  /* 空のときは2列（2026-09-06 の決定）。それ以前は「畳んだときだけ2列」で、
     選ぶ前後とも1列に保っていた。いまは 860px > 770px なので空のときは
     2列になり、選ぶと1列へ組み直る ―― この組み直しは承知のうえ。 */
  const cols = () => p.evaluate(() => new Set(
    [...document.querySelectorAll("#list > .card")]
      .map(el => Math.round(el.getBoundingClientRect().x))).size);
  check(await cols() === 2, `空のときに一覧が2列になっていない（${await cols()}列）`);

  /* カードの高さが揃っていること。バラつきの原因は3つ ―― 口コミバッジ
     （+28px）／タグの行（+30px）／理由が2行に折り返す（+20px）。
     揃えないと2列にしたとき段違いになる。

     例外は口コミの注意帯（.rvAlert）が入る科目で、そこは帯を切るより
     行ごと伸ばす。だからここは「行」で見る:
       ・注意帯のいない行 … すべて同じ高さ（--cardH）
       ・注意帯のいる行   … その行の2枚が互いに同じ高さ（stretch が効く）
     .unscored を単に除くだけでは、その相方（stretch で引き伸ばされた
     ふつうのカード）が残って落ちる。 */
  const rows = await p.evaluate(() => {
    const by = {};
    document.querySelectorAll("#list > .card").forEach(c => {
      const r = c.getBoundingClientRect();
      (by[Math.round(r.y)] ||= []).push({ h: Math.round(r.height), alert: c.classList.contains("unscored") });
    });
    return Object.values(by);
  });
  const plain = rows.filter(r => !r.some(c => c.alert)).flatMap(r => r.map(c => c.h));
  const uniq = [...new Set(plain)].sort((a, b) => a - b);
  check(uniq.length === 1, `カードの高さが揃っていない（${uniq.join(" / ")}）`);
  const ragged = rows.filter(r => r.length > 1 && new Set(r.map(c => c.h)).size > 1);
  check(ragged.length === 0,
        `同じ行のカードで高さが違う（${ragged.map(r => r.map(c => c.h).join("と")).join(" / ")}）`);

  await p.locator("#list > .card .head").first().click();
  await p.waitForTimeout(250);

  check(await p.locator("#inspector").isVisible(), "科目を選んでも右カラムが出ない");
  const g2 = await gaps(p);
  check(g2.left <= 1 && g2.right <= 1,
        `選んだあと3カラムに戻っていない（左${g2.left} / 右${g2.right}）`);

  /* ── ✕ で閉じられること（2026-09-06 追加）──────────────
     これが無いと、いちど科目を押した人は再読込するまで
     「開いた直後の中央寄せ」に戻れない。 */
  check(await p.locator(".insClose").isVisible(), "詳細に閉じる ✕ が無い");
  await p.locator(".insClose").click();
  await p.waitForTimeout(250);
  check(!(await p.locator("#inspector").isVisible()), "✕ を押しても右カラムが閉じない");
  check(await p.locator(".card.sel").count() === 0,
        "✕ を押してもカードの選択の印（.sel）が残っている");
  const g3 = await gaps(p);
  check(Math.abs(g3.left - g3.right) <= 2 && g3.left > 40,
        `✕ のあと中央寄せに戻っていない（左${g3.left} / 右${g3.right}）`);

  /* Esc でも同じ。閉じ方が2つあるので、両方が同じ場所を通ることを見る。 */
  await p.locator("#list > .card .head").first().click();
  await p.waitForTimeout(250);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  check(!(await p.locator("#inspector").isVisible()), "Esc で右カラムが閉じない");

  await p.close();
}

/* ── 1160px（3カラムの下限）：はみ出さないこと ── */
{
  const p = await open(browser, { width: 1160, height: 900 });
  const g = await gaps(p);
  check(Math.abs(g.left - g.right) <= 2,
        `1160px で中央へ寄っていない（左${g.left} / 右${g.right}）`);
  /* この幅では 860px が入りきらず、min(860px, calc(100% - 284px)) が
     容器いっぱいまで縮める。余白が 0 なのは正しい。見るべきは
     「横にはみ出していないこと」―― ここを固定値で書くと、
     1160〜1176px で一覧が画面外へ出る回帰を素通りさせる。 */
  const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check(!ov, "1160px で横にはみ出している（一覧の幅が容器を越えた）");
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
