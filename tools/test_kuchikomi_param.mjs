/* /kuchikomi?c=<id> で科目を選んだ状態にする（PR-2・受け側）。
 *   cd web && python3 -m http.server 8795 &
 *   node tools/test_kuchikomi_param.mjs http://127.0.0.1:8795
 *
 * python の http.server は Cloudflare Pages の拡張子なしルーティング
 * （/kuchikomi → kuchikomi.html）をしない（/kuchikomi は404、実体は
 * /kuchikomi.html）。ここで確かめたいのは kuchikomi.js が ?c= をどう読むかで
 * あって clean URL 解決そのものではないので、.html を直接指定して同じ
 * ファイルを開く。
 *
 * 使う科目は timetable.json から faculty:"common"（学部を問わず出る）で
 * 固定した2件 ―― 135327 のような口コミ件数に依存する科目を避けている:
 *   138531 GIS（地理情報システム）入門  水2 に乗る科目（slot 経路）
 *   138537 “見る”を神経科学するⅠ       曜限なし（extra 経路）
 * どちらも term_group:"haru" なので学期は spring で開く。学部は letters
 * （学科・トラックが無い＝ department は自動で "all" になり、テスト側で
 * 学科まで気にしなくていい）。
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8795";
const SLOT_ID = "138531";
const EXTRA_ID = "138537";
const BAD_ID = "not-a-real-course-id";
const FACULTY = "letters";
const SEMESTER = "spring";

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

const browser = await chromium.launch();

// analytics.js のビーコンは静的配信（plain http.server）だと POST を
// 受けられず 501 を返す ―― これは常に出るノイズで、ページ側のバグではない
// （tools/test_sort.mjs と同じく、拾うのは未捕捉例外＝pageerror だけにする）。
function collectErrors(p) {
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function newPage(settings) {
  const p = await browser.newPage();
  if (settings) {
    await p.addInitScript((s) => {
      localStorage.setItem("osaka_u_settings", JSON.stringify(s));
    }, settings);
  }
  return p;
}

const modalOpen = (p) => p.evaluate(() =>
  !document.getElementById("class-modal").classList.contains("hidden"));
const subjectValue = (p) => p.evaluate(() =>
  document.getElementById("modal-subject-select").value);
const noteVisible = (p) => p.evaluate(() =>
  !document.getElementById("course-param-note").classList.contains("hidden"));
const noteText = (p) => p.evaluate(() =>
  document.getElementById("course-param-note").textContent);

// networkidle の時点でまだ非同期の boot() が終わっていない稀な遅延に備え、
// モーダルが開くのを少し待つ（開かない場合はタイムアウトを無視して
// 後続の check にそのまま失敗させる）。
const waitOpen = (p) => p.waitForFunction(
  () => !document.getElementById("class-modal").classList.contains("hidden"),
  { timeout: 5000 }
).catch(() => {});

// ── 1. 設定済み＋時間割のマスに乗る科目（slot 経路） ──────────────
{
  const p = await newPage({ semester: SEMESTER, faculty: FACULTY, department: "all" });
  const errors = collectErrors(p);
  await p.goto(`${base}/kuchikomi.html?c=${SLOT_ID}`, { waitUntil: "networkidle" });
  await waitOpen(p);

  check(await modalOpen(p), "[slot] 学期・学部が設定済みなのにモーダルが開いていない");
  const v1 = await subjectValue(p);
  check(v1 === SLOT_ID, `[slot] #modal-subject-select の値が id と一致しない: ${v1}`);
  check(errors.length === 0, `[slot] コンソールエラー: ${errors.join(" / ")}`);
  await p.close();
}

// ── 2. 設定済み＋時間割に無い科目（extra 経路） ──────────────
{
  const p = await newPage({ semester: SEMESTER, faculty: FACULTY, department: "all" });
  const errors = collectErrors(p);
  await p.goto(`${base}/kuchikomi.html?c=${EXTRA_ID}`, { waitUntil: "networkidle" });
  await waitOpen(p);

  check(await modalOpen(p), "[extra] 学期・学部が設定済みなのにモーダルが開いていない");
  const v2 = await subjectValue(p);
  check(v2 === EXTRA_ID, `[extra] #modal-subject-select の値が id と一致しない: ${v2}`);
  check(errors.length === 0, `[extra] コンソールエラー: ${errors.join(" / ")}`);
  await p.close();
}

// ── 3. 未設定 → 開かず案内文。学期・学部を選ぶと開く ──────────────
{
  const p = await newPage(null); // osaka_u_settings を仕込まない
  await p.goto(`${base}/kuchikomi.html?c=${SLOT_ID}`, { waitUntil: "networkidle" });

  check(!(await modalOpen(p)), "[未設定] モーダルが開いてしまっている");
  check(await noteVisible(p), "[未設定] 案内文が出ていない");
  const text = await noteText(p);
  check(text.includes("GIS"), `[未設定] 案内文に科目名が入っていない: ${text}`);
  check(text.includes("まず学期と学部を選んでください"), `[未設定] 案内文の文言が違う: ${text}`);

  await p.selectOption("#semester-select", SEMESTER);
  await p.selectOption("#faculty-select", FACULTY);

  check(await modalOpen(p), "[選択後] 学期・学部を選んでもモーダルが開かない");
  const v3 = await subjectValue(p);
  check(v3 === SLOT_ID, `[選択後] #modal-subject-select の値が id と一致しない: ${v3}`);
  check(!(await noteVisible(p)), "[選択後] モーダルが開いたのに案内文が残っている");
  await p.close();
}

// ── 4. 存在しない ?c= → パラメータが無いのと同じ扱い ──────────────
{
  const p = await newPage(null);
  const errors = collectErrors(p);
  await p.goto(`${base}/kuchikomi.html?c=${BAD_ID}`, { waitUntil: "networkidle" });

  check(!(await modalOpen(p)), "[不正id] モーダルが開いてしまっている");
  check(!(await noteVisible(p)), "[不正id] 存在しない科目なのに案内文が出ている");
  check(errors.length === 0, `[不正id] コンソールエラー: ${errors.join(" / ")}`);
  await p.close();
}

// ── 5. ?c= 無し → 従来どおり ──────────────────────────────
{
  const p = await newPage(null);
  const errors = collectErrors(p);
  await p.goto(`${base}/kuchikomi.html`, { waitUntil: "networkidle" });

  check(!(await modalOpen(p)), "[パラメータ無し] モーダルが開いてしまっている");
  check(!(await noteVisible(p)), "[パラメータ無し] 案内文が出てしまっている");
  check(errors.length === 0, `[パラメータ無し] コンソールエラー: ${errors.join(" / ")}`);
  await p.close();
}

await browser.close();
console.log(fails.length ? "NG" : "OK");
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
