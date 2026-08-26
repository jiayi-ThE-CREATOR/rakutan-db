/* 学部→区分フィルタの受け入れ確認。実ブラウザで19項目を見る。
 *
 *   python3 -m http.server 8140 --directory web   # 静的（Cloudflare 相当）
 *   node tools/check_division_ui.mjs http://localhost:8140 390
 *   node tools/check_division_ui.mjs http://localhost:8140 1280
 *   python3 server.py
 *   node tools/check_division_ui.mjs http://localhost:8000 390
 *
 * 件数は絶対値で持たない ―― 画面の既定は year=1 / sem=aki なので、
 * API を year=all で叩いた数とは違う。チップに出ている件数と突き合わせる。
 * 口コミが増えれば件数は動くが、この確認は動かない。
 *
 * コンソールエラーが1件でもあれば異常終了する（tools/smoke.mjs と同じ作法）。 */
import { chromium } from "playwright";
const url = process.argv[2];
const width = Number(process.argv[3] || 390);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width, height: 900 } });
const errs = [];
const expected = t => /\/api\/(health|meta|requirements)/.test(t) || /status of 404/.test(t);
p.on("console", m => m.type() === "error" && !expected(m.text()) && errs.push(m.text()));
p.on("pageerror", e => errs.push(String(e)));

// 開屏の問診に邪魔されないよう、済んだことにしてから開く（test_favorite.mjs と同じ）。
await p.addInitScript(() => {
  try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
  try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
});

await p.goto(url, { waitUntil: "networkidle" });
await p.waitForSelector(".card", { timeout: 15000 });

const ok = [], ng = [];
const t = (name, cond, extra="") => (cond ? ok : ng).push(name + (extra ? ` — ${extra}` : ""));

// 1 セクションが学年の直後にある
const pos = await p.evaluate(() => {
  const secs = [...document.querySelectorAll(".rail section")];
  const yi = secs.findIndex(s => s.querySelector("#years"));
  const fi = secs.findIndex(s => s.id === "facSec");
  return { yi, fi };
});
t("1 学年の直後にセクション", pos.fi === pos.yi + 1, `years=${pos.yi} fac=${pos.fi}`);

// 2 未選択で 15 チップ
// チップ数は要件表の区分数＋「その他」。区分が増えたら自動で追随する
// ―― ここに数字を書くと、区分を足すたびにテストだけ古くなる。
const nDiv = await p.evaluate(() => (REQ && REQ.divisions
  ? REQ.divisions.filter(d => d.chip !== false).length : 0));
const expectChips = nDiv + 1;
let chips = await p.$$eval("#divs button", bs => bs.map(b => b.textContent.trim()));
t(`2 未選択で${expectChips}チップ`, chips.length === expectChips, `${chips.length}個`);
t("2b 単位数バッジなし", !(await p.$("#divs small")), "");

// 3 理学部
await p.selectOption("#facSel", "science");
await p.waitForTimeout(400);
const sci = await p.evaluate(() => ({
  senmon: document.querySelector('#divs button[data-d="senmon_kiso"]')?.textContent.trim(),
  jinbun: document.querySelector('#divs button[data-d="kiban_jinbun"]')?.textContent.trim(),
  jinbunTitle: document.querySelector('#divs button[data-d="kiban_jinbun"]')?.title,
  notes: document.querySelector("#facNotes")?.textContent,
  tobira: document.querySelector('#divs button[data-d="tobira"]')?.textContent.trim(),
}));
t("3a 専門基礎 24〜25単位", /24〜25単位/.test(sci.senmon || ""), sci.senmon);
t("3b 人文 計6単位", /計6単位/.test(sci.jinbun || ""), sci.jinbun);
t("3c 合計の説明が title に", /人文科学系・社会科学系・自然科学系・総合型 の合計で 6単位/.test(sci.jinbunTitle || ""), sci.jinbunTitle);
t("3d 学問への扉 2単位", /2単位/.test(sci.tobira || ""), sci.tobira);
t("3e 注記に自然科学系", /自然科学系.*卒業要件外/.test(sci.notes || ""), (sci.notes||"").slice(0,60));

// 4 0件は disabled、0件でないものは押せる
// どの区分が0件かはデータの入り具合で変わるので区分名を決め打ちしない。
// 2026-08-25 に語学1,160件が入って lang1_sogo / lang2 が0件でなくなり、
// 名指しで「押せないこと」を確かめていた旧版が落ちた（＝仕様どおりの変化）。
const divChips = await p.evaluate(() =>
  [...document.querySelectorAll("#divs button[data-d]")].map(b => ({
    k: b.dataset.d,
    n: +(b.querySelector(".n")?.textContent || 0),
    disabled: !!b.disabled,
    title: b.title,
  })));
const zero = divChips.filter(c => c.n === 0);
t("4 0件は押せない", zero.every(c => c.disabled) && divChips.every(c => c.n > 0 ? !c.disabled : true),
  `0件 ${zero.length}個（${zero.map(c=>c.k).join("/") || "なし"}）／ 非0 ${divChips.length - zero.length}個`);
t("4b 理由が出る", zero.every(c => /まだ取れていません/.test(c.title || "")),
  zero.map(c => c.title).join(" | ").slice(0, 80));

// 5 情報教育科目を押す
// ※ 画面の既定は year=1 / sem=aki なので、API 全件（76件）とは数が違う。
//    絶対値ではなく「チップに出ている件数」と一致するかで見る。
const facetOf = k => p.evaluate(key =>
  +(document.querySelector(`#divs button[data-d="${key}"] .n`)?.textContent || 0), k);
const nJoho = await facetOf("joho"), nJinbun = await facetOf("kiban_jinbun");
await p.click('#divs button[data-d="joho"]');
await p.waitForTimeout(500);
const afterJoho = await p.evaluate(() => ({
  count: +document.querySelector("#count").textContent,
  others: [...document.querySelectorAll("#divs button")]
    .map(b => +(b.querySelector(".n")?.textContent || 0)).filter(n => n > 0).length,
}));
t("5a チップの件数どおりに絞られる", afterJoho.count === nJoho, `${afterJoho.count}件 / チップ${nJoho}`);
t("5b 他の区分が0件にならない", afterJoho.others >= 8, `${afterJoho.others}区分が非0`);

// 6 人文も押す → OR
await p.click('#divs button[data-d="kiban_jinbun"]');
await p.waitForTimeout(500);
const orCount = await p.evaluate(() => +document.querySelector("#count").textContent);
t("6 OR で足し算になる", orCount === nJoho + nJinbun, `${orCount}件 / ${nJoho}+${nJinbun}=${nJoho+nJinbun}`);

// 7 折りたたみ
const tog = await p.evaluate(() => ({
  hidden: document.querySelector("#divTog").hidden,
  text: document.querySelector("#divTog").textContent,
}));
t("7a トグルが出ている", !tog.hidden, tog.text);
await p.click("#divTog");
await p.waitForTimeout(200);
const off = await p.$$eval("#divsOff button", bs => bs.map(b => b.dataset.d));
t("7b 選択外国語が入っている", off.includes("lang_opt"), JSON.stringify(off));

// 8 学部を戻す
await p.selectOption("#facSel", "");
await p.waitForTimeout(500);
const cleared = await p.evaluate(() => ({
  small: document.querySelectorAll("#divs small").length,
  chips: document.querySelectorAll("#divs button").length,
  count: +document.querySelector("#count").textContent,
}));
t("8a バッジが消える", cleared.small === 0, `${cleared.small}個`);
t("8b 区分は全部出たまま", cleared.chips === expectChips, `${cleared.chips}個`);
t("8c 学部を外しても区分の選択は残る", cleared.count === nJoho + nJinbun, `${cleared.count}件`);

// 9 横スクロールしていないか
const overflow = await p.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
t("9 横はみ出しなし", overflow <= 1, `${overflow}px`);

console.log(`\n=== ${url}  幅${width}px ===`);
ok.forEach(x => console.log("  OK  " + x));
ng.forEach(x => console.log("  NG  " + x));
if (errs.length) { console.log("  コンソールエラー:"); errs.forEach(e => console.log("    " + e)); }
await b.close();
process.exit(ng.length || errs.length ? 1 : 0);
