/* bot の問診が、サイト側と同じ線で作られているかを見る。
 *   node tools/test_bot_flow.mjs
 *
 * 線：降りられるのは greeting の1箇所だけ。設問の中に逃げ道を置かない。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* 絶対パスをそのまま import 指定子に渡さない（環境によっては通らない）。
   file:// URL にしてから渡す。 */
const mod = await import(pathToFileURL(path.join(ROOT, "worker/index.js")).href);

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const labels = (m) => (m.quickReply?.items || []).map(i => i.action.label);

// greeting には降り口が在る
check(labels(mod.greetingMessage()).includes("とにかく楽単を知りたい"),
      "greeting に降り口が無い");

// 学年の設問には降り口が無い
const g = mod.gradeQuestionMessage();
check(!labels(g).includes("答えたくない"),
      "学年の設問に「答えたくない」が残っている（降りるのは greeting だけ）");
check(labels(g).length === 6, `学年は6択であるべき（いま ${labels(g).length}）`);

// 学部の設問が在り、11学部＋降り口なしで11択
const f = mod.facultyQuestionMessage("2");
check(labels(f).length === 11, `学部は11択であるべき（いま ${labels(f).length}）`);
check(labels(f).includes("外国語学部"), "学部の選択肢に外国語学部が無い");
// LINE の quick reply は13件まで
check(labels(f).length <= 13, "quick reply の上限13を超えている");

// 学年 → 学部 → 優先度 の順で進むこと
const r1 = mod.handlePostback(null, "action=grade&grade=2", "https://example.test");
check(r1 && labels(r1).includes("法学部"),
      "学年のあとに学部を聞いていない");
const r2 = mod.handlePostback(null, "action=faculty&grade=2&fac=law", "https://example.test");
check(r2 && labels(r2).includes("出席なし"),
      "学部のあとに条件を聞いていない");
/* 2026-09-23: 聞くものをサイトの「条件」7つに揃えた（きむら依頼）。
   LINE で選んだ言葉がサイトに無いと、続きをサイトで探せない。 */
check(labels(r2).length === 7, `条件は7択であるべき（いま ${labels(r2).length}）`);
check(!labels(r2).includes("バイト優先"),
      "旧プリセット（バイト優先）が選択肢に残っている");
check(JSON.stringify(r2).includes("fac=law"),
      "学部が次の postback に引き継がれていない");

/* 問診完了（action=preset）だけが「ラクハンで見る」のURLに答えを載せる。
 * quick_default（何も聞いていない）と自由検索は載せない。
 * fac がFACULTIESに無い／grade が1〜6の外なら、何も乗せない（siteUri）。 */
const fakeData = {
  courses: [{ id: "c1", title: "テスト科目", rakutan: { overall: 4 } }],
  preset_top: { "2": { "とにかく軽い": ["c1"] }, "3": { "バイト優先": ["c1"] } },
  cond_top: { "2": { "出席なし": ["c1"] } },
};
function uriOf(m) {
  const withQR = Array.isArray(m) ? m.find((x) => x && x.quickReply) : m;
  return withQR && withQR.quickReply ? withQR.quickReply.items[0].action.uri : undefined;
}

// 見つかった場合（coursesReply 経由の配列）にも答えが乗ること
const rFound = mod.handlePostback(fakeData, "action=cond&grade=2&fac=law&cond=出席なし", "https://example.test");
const uFound = uriOf(rFound);
check(uFound && uFound.includes("faculty=law") && uFound.includes("year=2") && uFound.includes("from=line"),
      `問診完了後（見つかった場合）のURLに答えが載っていない（いま ${uFound}）`);

// 見つからなかった場合（withSiteButton 経由の文字列）にも答えが乗ること
const rNotFound = mod.handlePostback(fakeData, "action=cond&grade=3&fac=law&cond=発表なし", "https://example.test");
const uNotFound = uriOf(rNotFound);
check(uNotFound && uNotFound.includes("faculty=law") && uNotFound.includes("year=3") && uNotFound.includes("from=line"),
      `問診完了後（見つからなかった場合）のURLに答えが載っていない（いま ${uNotFound}）`);

// quick_default（「とにかく楽単を知りたい」）は何も聞いていないので答えを乗せない
const rQuick = mod.handlePostback(fakeData, "action=quick_default", "https://example.test");
const uQuick = uriOf(rQuick);
check(uQuick === "https://example.test/", `quick_default のURLに答えが乗ってはいけない（いま ${uQuick}）`);

// 自由検索（handleText）も profile を集めていないので答えを乗せない
const rText = mod.handleText("テスト科目", fakeData, "https://example.test");
const uText = uriOf(rText);
check(uText === "https://example.test/", `自由検索のURLに答えが乗ってはいけない（いま ${uText}）`);

// 学部キーが FACULTIES に無いなら、何も乗せない（壊れたURLを作らない）
const rBadFac = mod.handlePostback(fakeData, "action=cond&grade=2&fac=xxx&cond=出席なし", "https://example.test");
const uBadFac = uriOf(rBadFac);
check(uBadFac === "https://example.test/", `学部キーが不正なのにURLにパラメータが乗った（いま ${uBadFac}）`);

// 学年が1〜6の範囲外なら、何も乗せない
const rBadGrade = mod.handlePostback(fakeData, "action=cond&grade=9&fac=law&cond=出席なし", "https://example.test");
const uBadGrade = uriOf(rBadGrade);
check(uBadGrade === "https://example.test/", `学年が範囲外なのにURLにパラメータが乗った（いま ${uBadGrade}）`);

/* worker/index.js の FACULTIES は表示用の写し。正本は requirements.json。
   ずれると bot とサイトで学部の綴りが食い違い、Phase 2 の合流で壊れる。 */
const req = JSON.parse(readFileSync(path.join(ROOT, "web/data/requirements.json"), "utf-8"));
const src = readFileSync(path.join(ROOT, "worker/index.js"), "utf-8");
const block = src.match(/const FACULTIES = \[([\s\S]*?)\];/);
check(block, "worker/index.js に FACULTIES が無い");
if (block) {
  const keys = [...block[1].matchAll(/\["([^"]+)"/g)].map(m => m[1]);
  const want = req.faculties.map(f => f.key);
  check(keys.join(",") === want.join(","),
    `FACULTIES が requirements.json とずれている\n    worker: ${keys.join(",")}\n    正本  : ${want.join(",")}`);
}


/* 過去のトーク履歴に残っている旧ボタン（action=preset）を押しても答えること。
   選択肢からは消したが、押した人に「もう使えません」と言わずに済ませる。 */
const rLegacy = mod.handlePostback(fakeData, "action=preset&grade=3&fac=law&preset=バイト優先", "https://example.test");
check(Array.isArray(rLegacy) || typeof rLegacy === "object",
      "旧ボタン（action=preset）が答えを返さなくなっている");

/* 自由入力でもサイトと同じ言葉で引けること。 */
const rCondText = mod.handleText("2年 出席なし", fakeData, "https://example.test");
check(Array.isArray(rCondText), "「2年 出席なし」で条件のおすすめが返らない");

/* 語彙の正本は score.py の CONDITIONS（画面・server.py と同じ1か所）。
   ずれると LINE で選んだ条件がサイトのチップに無い、が起きる。 */
const scorePy = readFileSync(path.join(ROOT, "score.py"), "utf-8");
const condBlock = scorePy.match(/^CONDITIONS = \{([\s\S]*?)^\}/m);
check(condBlock, "score.py に CONDITIONS が無い");
if (condBlock) {
  const want = [...condBlock[1].matchAll(/^\s*"([^"]+)":/gm)].map(m => m[1])
    .filter(n => n !== "口コミあり");
  const workerBlock = src.match(/const CONDITION_NAMES = \[([\s\S]*?)\];/);
  check(workerBlock, "worker/index.js に CONDITION_NAMES が無い");
  if (workerBlock) {
    const got = [...workerBlock[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
    check(got.join(",") === want.join(","),
      `CONDITION_NAMES が score.py とずれている\n    worker: ${got.join(",")}\n    正本  : ${want.join(",")}`);
  }
}


/* 学年・学部を覚えている人の経路（おかえり…）。**初回の問診だけ直して
   ここを忘れていた**ので、常連ほど古い選択肢が出ていた（2026-09-23 きむら報告）。
   選択肢は初回と同じ条件7つ＋「学年・学部を変える」。 */
const known = mod.knownProfileMessage({ grade: "3", fac: "foreign-s" });
const kLabels = labels(known);
check(/どんな条件がいい/.test(known.text),
      `記憶ありの設問が条件を聞いていない（いま「${known.text}」）`);
check(!kLabels.includes("バイト優先"),
      "記憶ありの経路に旧プリセット（バイト優先）が残っている");
check(kLabels.includes("出席なし") && kLabels.includes("発表なし"),
      "記憶ありの経路の選択肢がサイトの条件になっていない");
check(kLabels.includes("学年・学部を変える"), "記憶ありの経路から学年・学部を変えられない");
check(kLabels.length === 8, `記憶ありは条件7＋変更1の8択であるべき（いま ${kLabels.length}）`);
check(kLabels.length <= 13, "quick reply の上限13を超えている");
check(JSON.stringify(known).includes("action=cond"),
      "記憶ありの経路が旧 action=preset のまま");

console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f2 of fails) console.log("  -", f2);
process.exit(fails.length ? 1 : 0);
