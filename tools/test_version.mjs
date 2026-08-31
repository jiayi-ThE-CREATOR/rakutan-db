/* 「バージョン＆最新機能」（右下の入口 → 更新履歴）の配線と、版データの形を確かめる。
 *   node tools/test_version.mjs
 *
 * ここで守りたいのは3つ。
 *  1. 入口の正本は templates/shell.html ひとつで、全ページに注入ずみ
 *     （ページを足した人が忘れると、その1ページだけ入口が消える ―― 意見箱で実際に起きた）
 *  2. 版の正本は web/assets/version.js の RELEASES ひとつ。
 *     日付・版番号・タグの形が崩れると、画面に「Invalid Date」や無地のタグが出る
 *  3. 見た目が app.css（科目一覧の担当ファイル）へ漏れていない
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const LABEL = "バージョン＆最新機能";

// ── 1. 静的な配線 ──────────────────────────────
const shell = read("templates/shell.html");
check(shell.includes(LABEL), `shell.html に「${LABEL}」が無い`);
check(shell.includes("/assets/version.js"), "shell.html が version.js を読み込んでいない");
check(shell.includes("/assets/version.css"), "shell.html が version.css を読み込んでいない");
check(existsSync(path.join(ROOT, "web/assets/version.js")), "web/assets/version.js が無い");
check(existsSync(path.join(ROOT, "web/assets/version.css")), "web/assets/version.css が無い");

// 器（JS が中身を入れる先）が揃っているか。id を1つ落とすと version.js は
// 何も言わずに return して、入口ごと消える。
for (const id of ["verFab", "verFabNum", "verDot", "verDlg", "verList", "verNow", "verClose"]) {
  check(shell.includes(`id="${id}"`), `shell.html に #${id} が無い（version.js が黙って止まる）`);
}
// JS が動かないときにボタンだけ残らないように、入口は hidden で置く。
check(/id="verFab"[^>]*\shidden/.test(shell),
  "入口 #verFab が hidden で置かれていない（JS 無しで空のボタンが出る）");

// ページを名指ししない。次の人がページを足したとき、
// 入口が付いてこなければここで落ちる。
const pages = readdirSync(path.join(ROOT, "web"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => "web/" + f);
check(pages.length >= 2, "web/*.html が見つからない");
for (const page of pages) {
  const html = read(page);
  check(html.includes(LABEL), `${page} に入口が無い（build.py を流していない）`);
  check(html.includes("/assets/version.css"), `${page} に version.css が入っていない`);
  check(html.includes("/assets/version.js"), `${page} に version.js が入っていない`);
}

// ── 2. 版データ（RELEASES）の形 ────────────────
// version.js はブラウザ用の IIFE なので import できない。
// 配列リテラルだけ取り出して評価する。
const src = read("web/assets/version.js");
const start = src.indexOf("const RELEASES = [");
check(start > -1, "version.js に const RELEASES = [ が無い");
let releases = [];
if (start > -1) {
  const from = src.indexOf("[", start);
  let depth = 0, end = -1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) { end = i + 1; break; }
  }
  check(end > -1, "RELEASES の配列が閉じていない");
  if (end > -1) {
    releases = new Function("return " + src.slice(from, end))();
  }
}

check(Array.isArray(releases) && releases.length >= 1, "RELEASES が空（1件も版が無い）");

const TAGS = new Set(["new", "improve", "fix"]);
const seenVersions = new Set();
let prev = null;
for (const rel of releases) {
  const where = `RELEASES の ${rel && rel.version ? "v" + rel.version : "ある項目"}`;
  check(/^\d{4}-\d{2}-\d{2}$/.test(rel.date || ""), `${where}: date が YYYY-MM-DD でない`);
  const t = Date.parse(rel.date + "T00:00:00Z");
  check(!Number.isNaN(t), `${where}: date が実在しない日付`);
  check(/^\d+\.\d+(\.\d+)?$/.test(rel.version || ""), `${where}: version が 1.0 / 1.0.1 の形でない`);
  check(!seenVersions.has(rel.version), `${where}: 版番号が重複している`);
  seenVersions.add(rel.version);
  check(typeof rel.title === "string" && rel.title.length > 0, `${where}: title が空`);
  check(Array.isArray(rel.items) && rel.items.length > 0, `${where}: items が空`);
  for (const it of rel.items || []) {
    check(TAGS.has(it.tag), `${where}: tag "${it.tag}" は new / improve / fix のどれでもない`);
    check(typeof it.text === "string" && it.text.trim().length > 0, `${where}: text が空`);
  }
  // 新しいものが上。画面はこの配列の順にそのまま出すので、
  // 並びが崩れると古い版が一番上に出る。
  if (prev !== null) check(t <= prev, `${where}: 日付が上の版より新しい（新しいものを上に）`);
  prev = t;
}

// ── 3. 担当ファイルの越境 ──────────────────────
const appCss = read("web/assets/app.css");
check(!appCss.includes(LABEL), "更新履歴の見た目が app.css に漏れている");
check(!appCss.includes(".verFab"), "更新履歴の見た目が app.css に漏れている（.verFab）");
// tokens.css 経由の原則（tools/test_tokens.py と同じ理由）を、この CSS にも掛ける。
const verCss = read("web/assets/version.css").replace(/\/\*[\s\S]*?\*\//g, "");
const bare = verCss.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
check(bare.length === 0, `version.css に裸の色がある: ${bare.join(", ")}`);

// ── 結果 ───────────────────────────────────────
if (fails.length) {
  console.error(`✗ ${fails.length} / ${n} 件 失敗`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ ${n} 件すべて通過（版: ${releases.map((r) => "v" + r.version).join(", ")}）`);
