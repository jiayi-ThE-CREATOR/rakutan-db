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
// 上段に出るのは「全学部に共通の区分」だけ。学部だけの区分（only 付き）は
// 学部を選ぶまで下段に隠れているので数に入れない ―― 2026-08-26 修正。
// それまでは only を数えていて、外国語学部の14区分が入った時点から
// この2項目が落ちたままだった（30個を期待して16個）。
const nDiv = await p.evaluate(() => (REQ && REQ.divisions
  ? REQ.divisions.filter(d => d.chip !== false && !d.only).length : 0));
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

// 10 学部だけの区分（下段）と学科セレクタ。9学部ぶんを 2026-08-26 に追加
for (const [key, label, nChip, nTrack] of [
  ["science", "理学部", 3, 4],          // 必修 / 選択必修 / 専攻
  ["letters", "文学部", 2, 0],          // 必修 / 専攻（別表が無いので選択必修なし）
  ["pharmacy", "薬学部", 2, 0],
  ["medicine", "医学部", 2, 4],
]) {
  await p.selectOption("#facSel", key);
  await p.waitForTimeout(400);
  const own = await p.evaluate(() => ({
    hidden: document.querySelector("#facOwn").hidden,
    head: document.querySelector("#facOwnH")?.textContent || "",
    chips: [...document.querySelectorAll("#divsOwn button")].map(b => b.dataset.d),
    tracks: [...document.querySelectorAll("#trackSel option")].length,
    trackHidden: document.querySelector("#trackSel").hidden,
    notes: document.querySelector("#facNotes")?.textContent || "",
  }));
  t(`10 ${label} 下段に${nChip}チップ`, !own.hidden && own.chips.length === nChip,
    `${own.chips.join("/") || "なし"}`);
  t(`10b ${label} 見出しが学部名`, own.head.startsWith(label), own.head.slice(0, 20));
  // セレクタは「すべて」の1件を先頭に持つので +1
  t(`10c ${label} 学科セレクタ${nTrack || "なし"}`,
    nTrack ? (!own.trackHidden && own.tracks === nTrack + 1) : own.trackHidden,
    `${own.tracks}項目 hidden=${own.trackHidden}`);
  t(`10d ${label} 必修の出所を注記`, /学部規程の別表/.test(own.notes), own.notes.slice(-40));
}

// 11 学科を選ぶと絞られる。学科を持たない科目（複数学科にまたがる科目）は残す
await p.selectOption("#facSel", "science");
await p.waitForTimeout(400);
// 区分の chip だけ外す（学年・学期・プリセットの chip には data-d が無い）
await p.evaluate(() =>
  [...document.querySelectorAll("#facSec .chip.on[data-d]")].forEach(b => b.click()));
await p.waitForTimeout(400);
const beforeTrack = await p.evaluate(() => +document.querySelector("#count").textContent);
await p.selectOption("#trackSel", "science_dept:math");
await p.waitForTimeout(500);
const afterTrack = await p.evaluate(() => +document.querySelector("#count").textContent);
t("11 学科で絞ると減る", afterTrack > 0 && afterTrack < beforeTrack,
  `${beforeTrack} → ${afterTrack}件`);

// 12 学部を変えたら学科は捨てる（「数学科のまま文学部」を作らない）
await p.selectOption("#facSel", "letters");
await p.waitForTimeout(400);
// 見るのは「効いているか」であって select の value ではない。学科を持たない学部では
// セレクタごと隠れるので、中に古い値が残っていても画面にも URL にも出ない。
const kept = await p.evaluate(() => ({
  hidden: document.querySelector("#trackSel").hidden,
  url: location.search,
  count: +document.querySelector("#count").textContent,
}));
t("12 学部を変えると学科が効かなくなる",
  kept.hidden && !/track=/.test(kept.url) && kept.count > afterTrack,
  JSON.stringify(kept));

// 13 学部を変えたら「その学部だけの区分」の選択は捨てる（共通の区分は残す）
await p.selectOption("#facSel", "economics");
await p.waitForTimeout(400);
await p.evaluate(() =>
  [...document.querySelectorAll("#facSec .chip.on[data-d]")].forEach(b => b.click()));
await p.waitForTimeout(400);
const all = await p.evaluate(() => +document.querySelector("#count").textContent);
await p.click('#divsOwn button[data-d="economics_hisshu"]');
await p.waitForTimeout(500);
const onlyEcon = await p.evaluate(() => +document.querySelector("#count").textContent);
t("13 学部だけの区分で絞れる", onlyEcon > 0 && onlyEcon < all, `${all} → ${onlyEcon}件`);

await p.selectOption("#facSel", "science");
await p.waitForTimeout(500);
const moved = await p.evaluate(() => ({
  count: +document.querySelector("#count").textContent,
  on: [...document.querySelectorAll("#facSec .chip.on[data-d]")].map(b => b.dataset.d),
}));
t("13b 学部を変えると選択が消える", moved.count === all && moved.on.length === 0,
  `${moved.count}件 / 選択 ${moved.on.join("/") || "なし"}`);

// 共通の区分は学部をまたいでも残る（学部は「どれが必要か」を並べる軸でしかない）
await p.click('#divs button[data-d="joho"]');
await p.waitForTimeout(500);
const joho = await p.evaluate(() => +document.querySelector("#count").textContent);
await p.selectOption("#facSel", "law");
await p.waitForTimeout(500);
const afterFac = await p.evaluate(() => ({
  count: +document.querySelector("#count").textContent,
  on: [...document.querySelectorAll("#facSec .chip.on[data-d]")].map(b => b.dataset.d),
}));
t("13c 共通の区分は残る", afterFac.count === joho && afterFac.on.includes("joho"),
  `${afterFac.count}件 / ${afterFac.on.join("/")}`);

// 学部を外したときも同じ
await p.click('#divsOwn button[data-d="law_hisshu"]');
await p.waitForTimeout(500);
await p.selectOption("#facSel", "");
await p.waitForTimeout(500);
const cleared2 = await p.evaluate(() => ({
  count: +document.querySelector("#count").textContent,
  on: [...document.querySelectorAll("#facSec .chip.on[data-d]")].map(b => b.dataset.d),
}));
t("13d 学部を外しても同じ", cleared2.count === joho && cleared2.on.join() === "joho",
  `${cleared2.count}件 / ${cleared2.on.join("/")}`);

console.log(`\n=== ${url}  幅${width}px ===`);
ok.forEach(x => console.log("  OK  " + x));
ng.forEach(x => console.log("  NG  " + x));
if (errs.length) { console.log("  コンソールエラー:"); errs.forEach(e => console.log("    " + e)); }
await b.close();
process.exit(ng.length || errs.length ? 1 : 0);
