/* 授業内容タグで絞り込めることを、実ブラウザ（静的配信＝本番と同じ経路）で確かめる。
 *
 *   cd web && python3 -m http.server 8231 &
 *   node tools/test_subject_filter.mjs http://127.0.0.1:8231 [スクショの出力先]
 *
 * ■ とくに見張っていること
 * - ダイアログで各タグに出す件数＝そのタグを足して実際に残る件数（設計 7章の検算）。
 *   数え方を queryLocal() と別に持つと、表示と結果が黙って食い違う
 * - 0件になるタグを選択肢に出さない／選んだタグは選択肢から消えて上に並ぶ
 * - URL（?subject=a&subject=b）から開き直しても同じ件数・同じ選択になる
 * - カードのタグは .head の外にある ―― 押しても詳細が開かず、絞り込みだけが効く
 * - リセットで選択も URL も消える
 * - PC は右カラムの詳細に「授業内容」が出る／スマホはカードの中で開くので重複して出さない
 * スマホ（390px）と PC（1280px）の両方で見る。 */
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:8231";
const SHOTS = process.argv[3] || "";
const fails = []; const check = (c, m) => { if (!c) fails.push(m); };
const browser = await chromium.launch();
async function newPage(w, h){
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  p.errors = [];
  p.on("pageerror", e => p.errors.push(String(e)));
  /* 「Failed to load resource」は数えない。静的配信（python3 -m http.server）では
     POST /api/hit（計測・501）、GET /api/health と /api/me（API モードかの探り・404）が
     必ず落ちる ―― main でも同じで、このテストの対象ではない。JS の例外とそれ以外のエラーだけ見る。 */
  p.on("console", m => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) p.errors.push(m.text());
  });
  return p;
}
async function gotoRetry(p, url){
  for (let i = 0; i < 40; i++){ try { await p.goto(url, { waitUntil: "networkidle" }); return; } catch (e) { await p.waitForTimeout(250); } }
  throw new Error("server not up");
}
const count = p => p.$eval("#count", el => +el.textContent);
const waitCount = async (p, n) => { try { await p.waitForFunction(n => +document.querySelector("#count").textContent === n, n, { timeout: 8000 }); return true; } catch { return false; } };

for (const [label, w, h] of [["sp", 390, 844], ["pc", 1280, 900]]){
  const p = await newPage(w, h);
  await gotoRetry(p, base + "/");
  await p.waitForSelector("#subjSec #subjOpen", { timeout: 15000 });
  const total = await count(p);
  console.log(`[${label}] 初期件数 ${total}`);
  await p.click("#subjOpen");
  await p.waitForSelector("#subjDlg[open] #subjOpts .chip");
  const opts0 = await p.$$eval("#subjOpts .chip", bs => bs.map(b => [b.dataset.subject, +b.querySelector(".n").textContent]));
  console.log(`[${label}] 選択肢 ${opts0.length}語  上位: ${opts0.slice(0,4).map(x=>x.join(":")).join(" ")}`);
  check(opts0.length === 31, `${label}: 最初の選択肢が31語でない (${opts0.length})`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}_1_dialog.png` });
  const rek = opts0.find(x => x[0] === "rekishi");
  await p.click('#subjOpts .chip[data-subject="rekishi"]');
  check(await waitCount(p, rek[1]), `${label}: 歴史を選んだ件数が表示 ${rek[1]} と違う (${await count(p)})`);
  await p.waitForSelector('#subjSel .chip[data-subject="rekishi"]');
  const opts1 = await p.$$eval("#subjOpts .chip", bs => bs.map(b => [b.dataset.subject, +b.querySelector(".n").textContent]));
  check(opts1.every(x => x[1] > 0), `${label}: 0件のタグが出ている`);
  check(!opts1.some(x => x[0] === "rekishi"), `${label}: 選んだタグが選択肢に残っている`);
  const second = opts1[0];
  await p.click(`#subjOpts .chip[data-subject="${second[0]}"]`);
  check(await waitCount(p, second[1]), `${label}: 2つ目(${second[0]})の件数が表示 ${second[1]} と違う (${await count(p)})`);
  const dlgCount = await p.$eval("#subjCount", el => +el.textContent);
  check(dlgCount === second[1], `${label}: 決定ボタンの件数 ${dlgCount} ≠ ${second[1]}`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}_2_dialog_two.png` });
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => !document.querySelector("#subjDlg").open);
  const picked = await p.$$eval("#subjPicked .chip", bs => bs.map(b => b.dataset.subject));
  check(picked.length === 2, `${label}: 左の選択済みが2つでない (${picked})`);
  const url = new URL(p.url());
  check(url.searchParams.getAll("subject").join(",") === ["rekishi", second[0]].join(","), `${label}: URL の subject が違う (${url.search})`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${label}_3_list.png` });
  // 共有リンクとして開き直す
  const n2 = await count(p);
  const p2 = await newPage(w, h);
  await gotoRetry(p2, p.url());
  await p2.waitForSelector("#subjPicked .chip");
  check(await waitCount(p2, n2), `${label}: URL から開き直した件数が違う`);
  // カードのタグで絞り込み（選んでいないタグを押す）
  const cardTag = await p2.$('#list .card .subjRow .subjTag:not(.on)');
  if (cardTag){
    const k = await cardTag.getAttribute("data-subject");
    await cardTag.click();
    await p2.waitForFunction(k => new URL(location.href).searchParams.getAll("subject").includes(k), k, { timeout: 8000 }).catch(() => {});
    check(new URL(p2.url()).searchParams.getAll("subject").includes(k), `${label}: カードのタグ(${k})を押しても絞り込まれない`);
    const opened = await p2.$$eval("#list .card.open, #inspector .detail", els => els.length);
    check(opened === 0, `${label}: カードのタグを押したら詳細が開いた`);
    if (SHOTS) await p2.screenshot({ path: `${SHOTS}/${label}_4_cardtag.png` });
  } else check(false, `${label}: カードにタグが無い`);
  // リセット
  const rb = await p2.$("[data-reset]:not([hidden])");
  const visibleReset = await p2.$$eval("[data-reset]", bs => bs.filter(b => !b.hidden && b.offsetParent !== null).length);
  if (visibleReset){
    await p2.$$eval("[data-reset]", bs => bs.find(b => !b.hidden && b.offsetParent !== null).click());
    check(await waitCount(p2, total), `${label}: リセットで全件に戻らない`);
    check(new URL(p2.url()).searchParams.getAll("subject").length === 0, `${label}: リセットで URL の subject が残る`);
    check((await p2.$$("#subjPicked .chip")).length === 0, `${label}: リセットで選択済みが残る`);
  } else check(false, `${label}: リセットボタンが見えない`);
  // PC は右カラムの詳細にタグが出るか
  if (label === "pc"){
    /* リセット直後は一覧の描き直しとスクロールで位置が動くので、座標で押す click() だと
       空振りする（2026-09-17 実測：右カラムが開かないまま）。要素に直接 click を送る。
       #list への委譲で受けているので、実際の操作と同じ経路を通る。タグのあるカードを選ぶ。 */
    await p2.locator("#list .card:has(.subjRow) .head").first().dispatchEvent("click");
    await p2.waitForSelector("#inspector .detail .dSec", { timeout: 8000 }).catch(() => {});
    const hasSubj = await p2.$$eval("#inspector .detail .subjRow .subjTag", els => els.length);
    if (!hasSubj){
      const why = await p2.evaluate(() => {
        const ins = document.querySelector("#inspector");
        return { vis: !!(ins && ins.offsetParent), len: ins ? ins.innerHTML.length : -1,
                 dSec: ins ? ins.querySelectorAll(".dSec").length : -1,
                 tags: ins ? ins.querySelectorAll(".subjTag").length : -1,
                 sel: document.querySelectorAll(".card.sel").length, url: location.search,
                 head: ins ? ins.querySelector("h3")?.textContent : null };
      });
      console.log("  [診断] pc inspector:", JSON.stringify(why));
    }
    check(hasSubj > 0, "pc: 右カラムの詳細に授業内容タグが無い");
    if (SHOTS) await p2.screenshot({ path: `${SHOTS}/${label}_5_inspector.png` });
  } else {
    /* リセット直後は一覧の描き直しとスクロールで位置が動くので、座標で押す click() だと
       空振りする（2026-09-17 実測：右カラムが開かないまま）。要素に直接 click を送る。
       #list への委譲で受けているので、実際の操作と同じ経路を通る。タグのあるカードを選ぶ。 */
    await p2.locator("#list .card:has(.subjRow) .head").first().dispatchEvent("click");
    await p2.waitForSelector("#list .card.open .detail .dSec", { timeout: 8000 }).catch(() => {});
    const dup = await p2.$$eval("#list .card.open .detail .subjRow", els => els.length);
    check(dup === 0, "sp: カード内の詳細にタグが重複して出ている");
  }
  for (const pg of [p, p2]) if (pg.errors.length) fails.push(`${label}: console/page error: ${pg.errors.slice(0,3).join(" | ")}`);
  await p.close(); await p2.close();
}
await browser.close();
console.log(fails.length ? "✗ " + fails.length + "件\n  - " + fails.join("\n  - ") : "✓ すべて通過");
process.exit(fails.length ? 1 : 0);
