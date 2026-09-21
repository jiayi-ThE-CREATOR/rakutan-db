/* 「条件をリセット」を実ブラウザで見張る。
 *
 *   cd web && python3 -m http.server 8144 &
 *   node tools/test_reset.mjs http://localhost:8144
 *
 * ■ 何を見ているか（2026-09-11 の指摘）
 *   一度選ぶと1つずつ押し直すしかなかった → 「絞り込み」見出しの右にリセット。
 *   学部・学年も戻す。ただし保存（マイページ）は消さない。
 *   置き場所は幅で変わる。**.railHead には手を入れていない** ―― 768px 未満で
 *   見出し行を出さないのは huaqianshue さんの取り決め（test_rail_toggle.mjs）で、
 *   そこを触らずに済むよう、スマホぶんは学期の下に別の器を置いている。
 *     PC（768px〜）   … 「絞り込み」見出しの右
 *     スマホ（〜767px）… 学期の下（レールの末尾）
 *   条件チップより「下」に置くのが肝。上に置くと、条件を1つ押した瞬間に
 *   チップ6個が全部ずれる（test_conds_layout.mjs が見張っている回帰）。
 *   （「あなたに合う」枠の重複は tools/test_picks_dedup.mjs の担当）
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8144";
const b = await chromium.launch();
let ng = 0;
const check = (c, m) => { console.log((c ? "  OK  " : "  NG  ") + m); if (!c) ng++; };

/* 学部・学年の保存先は osaka_u_settings（store.js の K_SET）。
   リセットがここを消していないことを確かめたいので、先に入れておく。
   学部の値は data/faculty_requirements.json の key（"engineering" 等）で、
   画面に出ている「工学部」は label のほう。ここを取り違えると
   <select> が既定の "" のままになり、直っているのに落ちる。 */
const SAVED = JSON.stringify({ faculty: "engineering", grade: "2" });

/* saved=null で開くと、保存が無い（＝何も選んでいない）まっさらな状態。 */
const open = async (width, saved = SAVED) => {
  const p = await b.newPage({ viewport: { width, height: 1400 } });
  await p.addInitScript(sv => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sv ? localStorage.setItem("osaka_u_settings", sv)
             : localStorage.removeItem("osaka_u_settings"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  }, saved);
  await p.goto(base, { waitUntil: "networkidle" });
  await p.waitForSelector("#list .card");
  return p;
};

/* 枠の中の id と、下の一覧の id を別々に採る。 */
const idsOf = p => p.evaluate(() => {
  const pick = el => [...el.querySelectorAll(".card")]
    .map(c => c.querySelector("[data-id]")?.dataset.id).filter(Boolean);
  const box = document.querySelector("#list .picks");
  return {
    picks: box ? pick(box) : [],
    rest: [...document.querySelectorAll("#list > .card")]
      .map(c => c.querySelector("[data-id]")?.dataset.id).filter(Boolean),
    count: +document.getElementById("count").textContent.replace(/[^\d]/g, ""),
    pager: document.querySelector(".pagerPos")?.textContent ?? "",
  };
});

/* ── ① リセット ──────────────────────── */
for (const [label, width] of [["PC", 1280], ["スマホ", 390]]) {
  console.log(`\n=== リセット（${label} 幅${width}px） ===`);
  /* まず保存が無い状態。ここでは本当に何も選んでいないので出ない。 */
  {
    const clean = await open(width, null);
    check(!(await clean.locator("[data-reset]:visible").count()),
      "何も選んでいないうちは出ない");
    await clean.close();
  }

  const p = await open(width);
  const btn = p.locator("[data-reset]:visible");
  const seen = () => btn.isVisible();

  /* 保存した学年（2年）が入った状態で開く＝すでに1つ絞り込まれている。
     ここで出ないと、まさに今回の指摘（毎回いちいち直す）が残る。 */
  check(await seen(), "保存した学年で絞られた状態なら、開いた時点で出ている");

  // 条件・学年・学期・検索語を入れる
  await p.locator("#conds .chip").filter({ hasText: "出席なし" }).first().click();
  await p.waitForTimeout(300);
  await p.locator("#years .chip").filter({ hasText: "2年" }).first().click();
  await p.waitForTimeout(300);
  await p.locator("#sems .chip").filter({ hasText: "春・夏学期" }).first().click();
  await p.waitForTimeout(300);
  await p.fill("#q", "経済");
  await p.waitForTimeout(700);

  const before = await idsOf(p);
  check(await seen(), "条件を入れると出てくる");

  /* 置き場所。PC は見出しの右、スマホは学期の下。
     そして **条件チップより下にあること** ―― ここが上だと、出た瞬間に
     チップが全部ずれる。座標で確かめる。 */
  const where = await p.evaluate(() => {
    const b = [...document.querySelectorAll("[data-reset]")]
      .find(e => e.offsetParent !== null);
    if (!b) return null;
    const conds = document.getElementById("conds").getBoundingClientRect();
    const sems  = document.getElementById("sems").getBoundingClientRect();
    return { inHead: !!b.closest(".railHead"), inSp: !!b.closest(".resetSp"),
             y: b.getBoundingClientRect().y, condsY: conds.y, semsY: sems.y };
  });
  if (width >= 768){
    check(where.inHead, "PC は「絞り込み」見出しの中にある");
  } else {
    check(where.inSp, "スマホは学期の下の器（.resetSp）にある");
    check(where.y > where.semsY, `学期より下にある（リセット ${Math.round(where.y)} > 学期 ${Math.round(where.semsY)}）`);
    check(where.y > where.condsY, "条件チップより下にある（出ても上をずらさない）");
  }

  await btn.click();
  await p.waitForTimeout(800);

  const st = await p.evaluate(() => ({
    q: document.getElementById("q").value,
    year: document.querySelector("#years .chip.on")?.textContent.trim(),
    sem: document.querySelector("#sems .chip.on")?.textContent.trim(),
    conds: [...document.querySelectorAll("#conds .chip.on")].length,
    /* 2026-09-21: 目盛りは「上限%」ではなく「好みの重さ」になった。
       しぼり込みは ✕（.sl .xBtn）が持つ。条件の解除で戻すのは ✕ のほうだけで、
       好みは本人の設定なので残す（戻す口は「重さを既定に戻す」）。 */
    xs: [...document.querySelectorAll('.sl .xBtn')]
          .filter(b => b.getAttribute("aria-pressed") === "true").length,
    prefs: [...document.querySelectorAll('.sl input[type=range]')].map(i => +i.value),
    fac: document.getElementById("facSel")?.value ?? "",
    tr:  document.getElementById("trackSel")?.value ?? "",
  }));
  check(st.q === "", "検索語が消える");
  check(st.year === "すべて", `学年が「すべて」に戻る（実測 ${st.year}）`);
  check(st.sem === "すべて", `学期が「すべて」に戻る（実測 ${st.sem}）`);
  check(st.conds === 0, `条件チップが全部消灯（実測 ${st.conds}個）`);
  check(st.xs === 0, `✕（しぼり込み）が全部外れる（実測 ${st.xs}個 残っている）`);
  check(st.prefs.join(",") === "15,50,10,15,20",
        `好みの重さは条件の解除では戻さない（実測 ${st.prefs.join(",")}）`);
  check(st.fac === "", `学部が未選択に戻る（実測「${st.fac}」）`);
  check(st.tr === "", `専攻が未選択に戻る（実測「${st.tr}」）`);

  const after = await idsOf(p);
  check(after.count > before.count, `件数が戻る（${before.count} → ${after.count}）`);
  check(!(await seen()), "押したあとは引っ込む");

  /* 保存は消さない ―― 開き直すと学部・学年はまた入る、が今回の約束
     （消すのはマイページの仕事）。 */
  const saved = await p.evaluate(() => localStorage.getItem("osaka_u_settings"));
  check(saved === SAVED, `マイページの保存は消えていない（実測 ${saved}）`);

  await p.reload({ waitUntil: "networkidle" });
  await p.waitForSelector("#list .card");
  const back = await p.evaluate(() => ({
    year: document.querySelector("#years .chip.on")?.textContent.trim(),
    fac: document.getElementById("facSel")?.value ?? "",
    tr:  document.getElementById("trackSel")?.value ?? "",
  }));
  check(back.year === "2年", `開き直すと保存した学年が戻る（実測 ${back.year}）`);
  check(back.fac === "engineering", `開き直すと保存した学部が戻る（実測「${back.fac}」）`);
  await p.close();
}

console.log(ng ? `\nNG ${ng}件` : "\n全部OK");
await b.close();
process.exit(ng ? 1 : 0);
