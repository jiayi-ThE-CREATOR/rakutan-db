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
/* 画面の縦位置が止まるまで待って、その値を返す ―― サイトは scroll-behavior:smooth なので、
   スクロールを始めた直後に測ると途中の値を拾う。 */
async function settle(p){
  let prev = -1, now = await p.evaluate(() => scrollY);
  for (let i = 0; i < 20 && now !== prev; i++){
    prev = now; await p.waitForTimeout(120); now = await p.evaluate(() => scrollY);
  }
  return now;
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
    /* 数えるのは .subjRow ではなくタグそのもの ―― 行には「タグが違う？」が同居していて、
       そちらはスマホにも出る（2026-09-21）。 */
    const dup = await p2.$$eval("#list .card.open .detail .subjRow .subjTag", els => els.length);
    check(dup === 0, "sp: カード内の詳細にタグが重複して出ている");
  }
  for (const pg of [p, p2]) if (pg.errors.length) fails.push(`${label}: console/page error: ${pg.errors.slice(0,3).join(" | ")}`);
  await p.close(); await p2.close();
}
/* ── 曜限を選んでいるときのタグの件数（2026-09-18）────────────────
   タグの数字は「そのタグを足したら残る件数」で、ダイアログの中で「決定（N件）」と
   並んで出る。曜限フィルタの前で数えていたので、月1 を選ぶと「文化・地域 530」と
   「決定（17件）」が同じ画面に出て、押すと一桁しか残らなかった。 */
{
  const p = await newPage(1280, 900);
  await gotoRetry(p, base + "/?subject=rekishi");
  await p.waitForSelector("#subjSec #subjOpen", { timeout: 15000 });
  await p.waitForSelector("#grid button:not(.zero)");
  await p.$$eval("#grid button:not(.zero)", bs => bs[0].click());
  await p.waitForFunction(() => !document.querySelector("#slotBar").hidden, null, { timeout: 8000 });
  await p.waitForTimeout(400);
  const withSlot = await count(p);
  console.log(`[コマ] 歴史＋空きコマ1つ = ${withSlot}件`);
  await p.click("#subjOpen");
  await p.waitForSelector("#subjDlg[open] #subjOpts .chip");
  const dlgCount = await p.$eval("#subjCount", el => +el.textContent);
  check(dlgCount === withSlot, `コマ: 決定ボタンの件数 ${dlgCount} ≠ 一覧の件数 ${withSlot}`);
  const opts = await p.$$eval("#subjOpts .chip", bs => bs.map(b => [b.dataset.subject, +b.querySelector(".n").textContent]));
  check(opts.every(x => x[1] <= withSlot),
    `コマ: 足す前の件数(${withSlot})より大きい数字が出ている: ` +
    opts.filter(x => x[1] > withSlot).slice(0,3).map(x=>x.join(":")).join(" "));
  const top = opts[0];
  await p.click(`#subjOpts .chip[data-subject="${top[0]}"]`);
  check(await waitCount(p, top[1]), `コマ: ${top[0]} を足した件数が表示 ${top[1]} と違う (${await count(p)})`);
  if (p.errors.length) fails.push(`コマ: console/page error: ${p.errors.slice(0,3).join(" | ")}`);
  await p.close();
}

/* ── スマホで決定したら一覧まで送る（2026-09-18）──────────────
   390px では絞り込みが縦に積まれていて、一覧は授業内容の節の 1,300px ほど下にある。
   閉じただけでは目の前が絞り込みの続きのままで、何も起きなかったように見えた。 */
{
  const p = await newPage(390, 844);
  await gotoRetry(p, base + "/");
  await p.waitForSelector("#subjSec #subjOpen", { timeout: 15000 });
  const barSeen = () => p.evaluate(() => {
    const r = document.querySelector(".bar").getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  });
  check(!(await barSeen()), "sp送り: 最初から一覧の帯が見えている（前提が崩れている）");
  await p.click("#subjOpen");
  await p.waitForSelector("#subjDlg[open] #subjOpts .chip");
  await p.click('#subjOpts .chip[data-subject="rekishi"]');
  await p.waitForTimeout(300);
  await p.click("#subjDone");
  await p.waitForFunction(() => !document.querySelector("#subjDlg").open);
  const moved = await p.waitForFunction(() => {
    const r = document.querySelector(".bar").getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  check(moved, "sp送り: 決定しても一覧の帯まで動かない");
  /* 何も変えずに閉じた人は動かさない（勝手に画面が飛ばないこと）。
     位置を控えるのは「開いたあと」―― click() が #subjOpen を画面に入れるために
     自分でスクロールするので、その前に控えると開く動作のぶんまで数えてしまう。 */
  await p.click("#subjOpen");
  await p.waitForSelector("#subjDlg[open]");
  const y0 = await settle(p);
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => !document.querySelector("#subjDlg").open);
  await p.waitForTimeout(600);
  const y1 = await settle(p);
  check(Math.abs(y1 - y0) < 8, `sp送り: 何も変えずに閉じたのに画面が動いた (${y0}→${y1})`);
  if (p.errors.length) fails.push(`sp送り: console/page error: ${p.errors.slice(0,3).join(" | ")}`);
  await p.close();
}

/* ── 「タグが違う？」から意見箱が前置きつきで開く（2026-09-21）────────────
   data/subjects.manual.tsv は for_course() が AI より優先して読むのに、直す入口が
   どこにも無かった。詳細（PC は右カラム・スマホはカードの中）から意見箱を、
   科目といまのタグを前置きした状態で開く。 */
for (const [label, w, h] of [["sp", 390, 844], ["pc", 1280, 900]]){
  const p = await newPage(w, h);
  await gotoRetry(p, base + "/");
  await p.waitForSelector("#list .card", { timeout: 15000 });
  await p.locator("#list .card:has(.subjRow) .head").first().dispatchEvent("click");
  const scope = label === "pc" ? "#inspector" : "#list .card.open";
  const rep = p.locator(`${scope} .detail .subjRep`);
  await rep.waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await rep.count())){ check(false, `${label}報告: 詳細に「タグが違う？」が無い`); await p.close(); continue; }
  const seen = await p.evaluate(sc => {
    const b = document.querySelector(sc + " .detail .subjRep");
    const card = document.querySelector(sc + " .detail")?.closest(".card");
    return { id: b.dataset.subjectReport,
             title: (card || document.querySelector(sc))?.querySelector("h3")?.textContent.trim() || "",
             tags: [...document.querySelectorAll(sc + " .detail .subjRow .subjTag")].map(x => x.textContent.trim()) };
  }, scope);
  check(label === "pc" ? seen.tags.length > 0 : seen.tags.length === 0,
    `${label}報告: 詳細のタグの出し方が想定と違う (${seen.tags.length}個)`);
  await rep.dispatchEvent("click");
  const opened = await p.waitForFunction(() => document.querySelector("#fbDlg")?.open, null, { timeout: 5000 })
    .then(() => true).catch(() => false);
  check(opened, `${label}報告: 意見箱が開かない`);
  if (opened){
    const t = await p.$eval("#fbText", e => e.value);
    check(t.includes("【タグの訂正】"), `${label}報告: 前置きの見出しが無い (${t.slice(0,40)})`);
    check(t.includes(seen.id), `${label}報告: 前置きに科目の id が無い (${t.slice(0,60)})`);
    for (const tag of seen.tags)
      check(t.includes(tag), `${label}報告: 前置きに「${tag}」が無い`);
    check(!(await p.$eval("#fbSend", e => e.disabled)), `${label}報告: 前置きを入れたのに送信が押せない`);
    /* 書きかけを上書きしない ―― 開き直しても前に書いた文が残ること。 */
    await p.fill("#fbText", t + "この授業は歴史の話です");
    await p.click("#fbCancel");
    await p.waitForFunction(() => !document.querySelector("#fbDlg").open);
    await rep.dispatchEvent("click");
    await p.waitForFunction(() => document.querySelector("#fbDlg")?.open, null, { timeout: 5000 }).catch(() => {});
    const t2 = await p.$eval("#fbText", e => e.value);
    check(t2.endsWith("この授業は歴史の話です"), `${label}報告: 開き直したら書きかけが消えた`);
    await p.click("#fbCancel");
  }
  if (p.errors.length) fails.push(`${label}報告: console/page error: ${p.errors.slice(0,3).join(" | ")}`);
  await p.close();
}

await browser.close();
console.log(fails.length ? "✗ " + fails.length + "件\n  - " + fails.join("\n  - ") : "✓ すべて通過");
process.exit(fails.length ? 1 : 0);
