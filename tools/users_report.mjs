/* 利用者の属性（学年・学部・時間割・授業内容タグ）を数える。
 *
 *   CF_ACCOUNT_ID=<32桁> CF_API_TOKEN=<トークン> node tools/users_report.mjs [--days 30] [--public] [--csv <dir>]
 *
 * spec: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 * ■ 2つの節は足さない
 *   A … 全訪問者の1日1回のスナップショット（Analytics Engine）。単位は「端末・日」。
 *       よく来る人ほど日数ぶん重く数える。--days で期間を決める（最大90日＝保存期間）。
 *   B … LINE ログインした人（D1）。単位は「人」。いまの状態で、期間では絞らない。
 *
 * ■ --public（外部に出すとき）
 *   5未満のセルを「5未満」にし、そのセルの比率も出さない（分母から逆算できるため）。
 *   伏せ方の細部は users_report_lib.mjs の先頭。加えて:
 *   ・A は合計だけ出す。端末・日の数は1人が20日来れば20になり、5未満の門が効かない
 *   ・学年別・学部別のタグの表は、そのグループが5人未満なら出さない
 *
 * ■ --csv <dir>
 *   表ごとに CSV を書く。**リポジトリの外を指定すること**（公開リポジトリ）。
 *   Analytics Engine は90日で消えるので、外部に出す月の数字は月が明けたら書き出して保管する。
 *
 * ■ トークン
 *   tools/stats.mjs と同じトークンに **アカウント / D1 / 読み取り** を足す
 *   （Account Analytics / 読み取り だけでは B が 403 になる）。
 */
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { aggregate, table, toCsv, rowsFromAE, rowsFromD1, showGroup } from "./users_report_lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const DATASET = "rakutan_use";   // wrangler.toml の [[analytics_engine_datasets]] と揃える

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const isPublic = args.includes("--public");
const csvDir = opt("--csv");
const days = Number(opt("--days") ?? 30);

if (!ACCOUNT || !TOKEN) {
  console.error("CF_ACCOUNT_ID と CF_API_TOKEN が要ります。作り方はこのファイルの先頭と tools/stats.mjs の先頭。");
  process.exit(1);
}
if (!Number.isInteger(days) || days < 1 || days > 90) {
  console.error(`--days は 1〜90 の整数で（渡された値: ${opt("--days")}）。保存期間が90日のため。`);
  process.exit(1);
}
/* 作る前に判定する（作ってから弾くと、リポジトリの中に空のフォルダが残る）。 */
if (csvDir && (path.resolve(csvDir) + path.sep).startsWith(realpathSync(ROOT) + path.sep)) {
  console.error("--csv にリポジトリの中は指定できません（公開リポジトリ。内部の数字が出てしまう）。");
  process.exit(1);
}
if (csvDir) mkdirSync(csvDir, { recursive: true });

// 科目 → 授業内容タグ、表示名
const built = JSON.parse(readFileSync(path.join(ROOT, "web/data/courses.built.json"), "utf-8"));
const courseTags = new Map(built.courses.map((c) => [String(c.id), c.subjects || []]));
const courseTitle = new Map(built.courses.map((c) => [String(c.id), c.title]));
const TAG_LABEL = built._meta.subject_labels || {};
const REQ = JSON.parse(readFileSync(path.join(ROOT, "web/data/requirements.json"), "utf-8"));
const FAC_LABEL = Object.fromEntries(REQ.faculties.map((f) => [f.key, f.label]));
const DB_ID = readFileSync(path.join(ROOT, "wrangler.toml"), "utf-8").match(/database_id\s*=\s*"([^"]+)"/)?.[1];

const gradeLabel = (k) => (k === "未回答" ? k : `${k}年`);
const facLabel = (k) => FAC_LABEL[k] || k;
const tagLabel = (k) => TAG_LABEL[k] || k;

async function cf(url, init) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${url}`,
    { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} が ${res.status} を返しました:\n${text}`);
  return JSON.parse(text);
}

/* _sample_interval を掛けるのを省かないこと（traffic.js の注記と同じ理由）。 */
async function fetchA() {
  const sql = `
SELECT blob3 AS grade, blob4 AS faculty, blob5 AS ids, SUM(_sample_interval * double1) AS w
FROM ${DATASET}
WHERE timestamp >= NOW() - INTERVAL '${days}' DAY AND blob1 = 'snap'
GROUP BY grade, faculty, ids
FORMAT JSON`;
  const json = await cf("/analytics_engine/sql", { method: "POST", body: sql });
  return rowsFromAE(json.data ?? []);
}

async function fetchB() {
  const q = async (sql) => {
    const json = await cf(`/d1/database/${DB_ID}/query`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql }),
    });
    return json.result?.[0]?.results ?? [];
  };
  const [profiles, timetables] = await Promise.all([
    q("SELECT line_user_id, grade, faculty FROM line_profiles"),
    q("SELECT line_user_id, course_id FROM timetables"),
  ]);
  return rowsFromD1(profiles, timetables);
}

const out = [];   // [ファイル名, 見出し, 表]
function section(prefix, unit, rows) {
  const a = aggregate(rows, courseTags);
  console.log(`\n■ ${prefix === "a" ? `A 全訪問者（直近 ${days} 日・単位：端末・日）` : "B LINE ログイン者（いまの状態・単位：人）"}`);
  console.log(`  合計 ${Math.round(a.total)} ${unit}・時間割の科目（のべ）${Math.round(a.entries)}`);
  if (isPublic && prefix === "a") {
    console.log("  （外部向けでは A の内訳は出さない。1人が何日も来ると5未満の門が効かないため）");
    return;
  }
  const show = (name, title, header, rowsT) => {
    console.log(`\n  ${title}`);
    for (const r of rowsT) console.log(`    ${r.join("\t")}`);
    out.push([`${prefix}_${name}.csv`, header, rowsT]);
  };
  show("grade", "学年", ["学年", unit, "比率"], table(a.grade, a.total, isPublic, gradeLabel));
  show("faculty", "学部", ["学部", unit, "比率"], table(a.faculty, a.total, isPublic, facLabel));
  show("grade_faculty", "学年 × 学部", ["学年×学部", unit, "比率"],
    table(a.gradeFaculty, a.total, isPublic, (k) => { const [g, f] = k.split("|"); return `${gradeLabel(g)}・${facLabel(f)}`; }));
  show("courses_top20", "時間割に入っている科目 TOP 20", ["科目", `${unit}（のべ）`, "比率"],
    table(a.courses, a.entries, isPublic, (id) => `${courseTitle.get(id) || "（不明な科目）"}（${id}）`, a.coursePeople).slice(0, 20));
  show("tags", "授業内容タグ（1科目に複数タグ。合計は100%を超える）", ["タグ", `${unit}（のべ）`, "比率"],
    table(a.tags, a.entries, isPublic, tagLabel, a.tagPeople));
  for (const g of [...a.grade.keys()].filter((k) => k !== "未回答").sort()) {
    const sub = aggregate(rows.filter((r) => r.grade === g), courseTags);
    if (!showGroup(sub.total, isPublic)) continue;
    show(`tags_grade${g}`, `授業内容タグ（${g}年）`, ["タグ", `${unit}（のべ）`, "比率"], table(sub.tags, sub.entries, isPublic, tagLabel, sub.tagPeople));
  }
  for (const f of [...a.faculty.keys()].filter((k) => k !== "未回答").sort()) {
    const sub = aggregate(rows.filter((r) => r.faculty === f), courseTags);
    if (!showGroup(sub.total, isPublic)) continue;
    show(`tags_${f}`, `授業内容タグ（${facLabel(f)}）`, ["タグ", `${unit}（のべ）`, "比率"], table(sub.tags, sub.entries, isPublic, tagLabel, sub.tagPeople));
  }
}

console.log(`ラクハン 利用者の属性${isPublic ? "（外部向け：5未満は伏せ字）" : "（内部向け）"}`);
console.log("A と B は単位が違うので足さないこと。");
try { section("a", "端末・日", await fetchA()); }
catch (e) { console.error(`\nA を取れませんでした: ${e.message}`); }
try { section("b", "人", await fetchB()); }
catch (e) { console.error(`\nB を取れませんでした: ${e.message}\n（403 ならトークンに D1 の読み取り権限が無い）`); }

if (csvDir) {
  for (const [file, header, rowsT] of out) writeFileSync(path.join(csvDir, file), toCsv(header, rowsT));
  console.log(`\nCSV を ${out.length} 本書きました: ${csvDir}`);
}
