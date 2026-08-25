/* PERIODS が3箇所でずれていないか、データがグリッドの外に落ちていないかを見る。
 *   node tools/test_periods.mjs
 *
 * なぜ3箇所も見るのか：PERIODS は server.py（APIモードの正本）と
 * app.js（グリッド描画）と app.js（静的モードのMETAフォールバック）に
 * 別々にべた書きされている。1箇所だけ直すと「APIでは6限が出るが
 * 静的配信では出ない」のような、片方のモードでだけ壊れる状態になる。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const py = read("server.py");
const js = read("web/assets/app.js");

const nums = (s) => (s.match(/\d+/g) || []).join(",");

const pyM   = py.match(/^PERIODS\s*=\s*\[([^\]]*)\]/m);
const jsM   = js.match(/PERIODS\s*=\s*\[([^\]]*)\]/);
const metaM = js.match(/periods:\s*\[([^\]]*)\]/);

check(pyM,   "server.py に PERIODS = [...] が見つからない");
check(jsM,   "app.js に PERIODS = [...] が見つからない");
check(metaM, "app.js の META フォールバックに periods: [...] が見つからない");

if (pyM && jsM && metaM) {
  const a = nums(pyM[1]), b = nums(jsM[1]), c = nums(metaM[1]);
  check(a === b, `server.py の PERIODS(${a}) と app.js の PERIODS(${b}) が違う`);
  check(b === c, `app.js の PERIODS(${b}) と META の periods(${c}) が違う`);
  check(a === "1,2,3,4,5,6", `PERIODS が 1..6 でない（いま ${a}）`);
}

/* データ側：timetable.json のどの slot もグリッドの中に在ること。
   ここが落ちるときは「限」が増えたか曜日が増えたかのどちらか。 */
const tt = JSON.parse(read("web/data/timetable.json"));
const DAYS = ["月", "火", "水", "木", "金"];
const periods = pyM ? nums(pyM[1]).split(",") : [];
const outside = new Set();
for (const c of tt) {
  for (const s of c.slots || []) {
    if (!DAYS.includes(s[0]) || !periods.includes(s.slice(1))) outside.add(s);
  }
}
check(outside.size === 0,
  `グリッドの外に落ちる曜限がある: ${[...outside].sort().join(" ")}`);

console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
