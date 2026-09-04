/* 左の絞り込みを畳めること・畳むと一覧が2列になること・長い科目名が
 * 2行で頭打ちになりホバーで流れることを実ブラウザで見る。
 *
 *   cd web && python3 -m http.server 8141 &
 *   node tools/test_rail_toggle.mjs http://localhost:8141
 *
 * 見張っているのは主に3つの回帰:
 *   1. 畳んだのに中カラムが広がらない（.railOff の grid-template-columns を
 *      3つの断点すべてに書き忘れると、1160px 以上でだけ効かない等が起きる）
 *   2. 畳むと条件が画面から消えるのに、効いている条件の数がどこにも出ない
 *   3. 多列にしたとき、推薦枠（section.picks）が1列目だけに細く出る
 *      （grid-column:1/-1 の付け忘れ）
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8141";
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

const browser = await chromium.launch();

/* ── PC 1440px：畳む → 広がる → 2列 ── */
{
  const p = await open(browser, { width: 1440, height: 900 });

  check(await p.locator("#rail").isVisible(), "初期状態で絞り込みが出ていない");
  check(await p.locator("#railTogLabel").textContent() === "絞り込みを隠す",
        "初期のボタン文言が「絞り込みを隠す」でない");
  check(await p.locator("#railTog").getAttribute("aria-expanded") === "true",
        "初期の aria-expanded が true でない");

  const before = (await p.locator("#results").boundingBox()).width;
  const colsBefore = await p.evaluate(() =>
    new Set([...document.querySelectorAll("#list > .card")]
      .map(el => Math.round(el.getBoundingClientRect().x))).size);
  check(colsBefore === 1, `畳む前に既に多列になっている（${colsBefore}列）`);

  await p.locator("#railTog").click();
  await p.waitForTimeout(80);

  check(!(await p.locator("#rail").isVisible()), "畳んでも絞り込みが消えていない");
  check(await p.locator("#railTog").getAttribute("aria-expanded") === "false",
        "畳んだのに aria-expanded が false でない");
  check(await p.locator("#railTogLabel").textContent() === "絞り込み",
        "畳んだあとのボタン文言が「絞り込み」でない");

  const after = (await p.locator("#results").boundingBox()).width;
  check(after > before + 200, `畳んでも中カラムが広がらない（${before} → ${after}）`);

  const colsAfter = await p.evaluate(() =>
    new Set([...document.querySelectorAll("#list > .card")]
      .map(el => Math.round(el.getBoundingClientRect().x))).size);
  check(colsAfter === 2, `畳んでも一覧が2列にならない（${colsAfter}列）`);

  /* 推薦枠は全列ぶち抜き。1列目の幅で止まっていたら付け忘れ。 */
  const picks = await p.locator("#list > .picks").count();
  if (picks){
    const pw = (await p.locator("#list > .picks").boundingBox()).width;
    check(pw > after * 0.9, `推薦枠が全列ぶち抜きになっていない（${pw} / ${after}）`);
  }

  /* 畳んだ状態が次に来たときも残ること。 */
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForSelector("#list .card");
  check(!(await p.locator("#rail").isVisible()), "再読込で畳んだ状態が戻ってしまう");

  await p.close();
}

/* ── 条件の数バッジ ── */
{
  const p = await open(browser, { width: 1440, height: 900 });

  check(await p.locator("#railTogCount").isVisible() === false,
        "開いているのに条件数バッジが出ている");

  /* 学年チップを1つ押す（既定は「すべて」なので、押せば条件が1つ増える）。 */
  await p.locator("#years .chip:not(.on)").first().click();
  await p.waitForTimeout(250);
  await p.locator("#railTog").click();
  await p.waitForTimeout(80);

  check(await p.locator("#railTogCount").isVisible(),
        "条件が効いているのに、畳んでもバッジが出ない");
  const badge = +(await p.locator("#railTogCount").textContent());
  check(badge >= 1, `バッジの数が 1 未満（${badge}）`);

  await p.close();
}

/* ── 長い科目名：2行で頭打ち、ホバーで流れる ── */
{
  const p = await open(browser, { width: 1440, height: 900 });
  /* 先に畳む。開いたままだとカードが 640px 幅で、2行に 136 半角幅入る
     ―― 実データの最長（122 半角幅）でも溢れない。溢れるのは2列にして
     カードが 464px になったときだけなので、そちらで見る。 */
  await p.locator("#railTog").click();
  await p.waitForTimeout(80);
  /* 「ものづくり」は11件で1ページに収まり、うち2件が2行に入らない
     （最長 122 半角幅の「学問への扉（ものづくりサイエンス「…」）」）。 */
  await p.locator("#q").fill("ものづくり");
  await p.waitForTimeout(400);
  await p.waitForSelector("#list .card");

  /* 窓が2行ぶんで固定されていること（16.5px × 1.35 × 2 ≒ 44.5px）。 */
  const h = await p.locator("#list > .card .title").first().evaluate(el => el.clientHeight);
  check(Math.abs(h - 44.5) < 2, `科目名の窓が2行ぶんになっていない（${h}px）`);

  /* はみ出している科目名を1つ探して、乗せたときに動くことを見る。 */
  /* クランプが効いているあいだ scrollHeight は「切ったあとの高さ」を返すので、
     一瞬だけクランプを外して全高を測る（app.js の mqStart と同じ手順）。 */
  const idx = await p.evaluate(() => {
    const ts = [...document.querySelectorAll("#list > .card .title")];
    return ts.findIndex(t => {
      const inner = t.firstElementChild;
      const prev = inner.style.webkitLineClamp;
      inner.style.webkitLineClamp = "unset";
      const over = inner.offsetHeight > t.clientHeight + 1;
      inner.style.webkitLineClamp = prev;
      return over;
    });
  });
  if (idx >= 0){
    const t = p.locator("#list > .card .title").nth(idx);
    await t.hover();
    await p.waitForTimeout(120);
    const cls = await t.getAttribute("class");
    check(/\bmqRun\b/.test(cls), "はみ出した科目名にホバーしても流れ始めない");
    const shift = await t.evaluate(el => el.style.getPropertyValue("--mqShift"));
    check(parseFloat(shift) > 0, `流す距離が入っていない（--mqShift=${shift}）`);

    await p.mouse.move(5, 5);
    await p.waitForTimeout(400);
    check(!/\bmqRun\b/.test(await t.getAttribute("class")), "離れても流れたまま止まらない");
  } else {
    check(false, "2列幅で2行に収まらない科目名が見つからない（検索語かクランプの回帰）");
  }
  await p.close();
}

/* ── スマホ幅：ボタンを出さない・科目名を切らない ── */
{
  const p = await open(browser, { width: 390, height: 844 });
  check(!(await p.locator("#railTog").isVisible()), "スマホ幅で畳むボタンが出ている");
  const over = await p.evaluate(() =>
    getComputedStyle(document.querySelector("#list > .card .title")).overflow);
  check(over !== "hidden", "スマホ幅で科目名が切られている（クランプが漏れている）");
  await p.close();
}

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}\n  ${fails.join("\n  ")}` : `通過 ${n} 件\nOK`);
process.exit(fails.length ? 1 : 0);
