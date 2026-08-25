# マイページと お気に入り（Phase 1）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログインせずに「気になる科目」と「自分の時間割」を持ち歩けるようにする。

**Architecture:** 状態は全部ブラウザの localStorage。読み書きの正本は新規
`web/assets/store.js` 1つに集め、`app.js` と 新規 `mypage.js` の両方がそれを読む。
サーバーもデータベースも LINE の設定変更も **一切増やさない**。

**Tech Stack:** 素の JavaScript（フレームワーク無し・ビルド無し）／Python 3 の
`http.server` と `server.py`／テストは 素の node と Playwright 1.62.1。

**Spec:** `docs/plans/2026-08-26-line-login-mypage-design.md`

## Global Constraints

- **ログイン不要**。この計画で作るものは全部、ログインせずに使える
- **外部ライブラリを足さない**。`npm i` するのは Playwright（既に devDependencies に在る）だけ
- **`web/assets/kuchikomi.js` には触らない**（1ファイル1オーナー）
- **学部の一覧を JS にべた書きしない**。正本は `web/data/requirements.json` の `faculties[]`
  （`key` は `letters` `human-sci` `law` `economics` `foreign-s` `science` `medicine`
  `dentistry` `pharmacy` `engineering` `engr-sci` の11個）
- **localStorage の読み書きは必ず try/catch**。プライベートモードでは例外が飛ぶ
- **学期の語彙は `haru` / `aki`**。kuchikomi の `spring` / `autumn` は使わない
- **曜限の鍵は `"月2"` の文字列**。添字にしない
- Playwright のテストは**静的配信に当てる**（`cd web && python3 -m http.server 8140`）。
  本番で動くのは `web/assets/*.js` であって `server.py` ではない
- ブランドの色は `#DB6209` 単色。グラデーション禁止
- 実装は `feat/wang-line-login`（`main` から分岐）。`main` で直接作業しない

---

### Task 1: 6限への統一（バグ修正・単独でマージできる）

6限にしか開かれない29件が空きコマグリッドから辿れない。`PERIODS` が3箇所に
散っているのが根で、1箇所漏らすと片方のモードでだけ壊れる。

**Files:**
- Create: `tools/test_periods.mjs`
- Modify: `server.py:81`
- Modify: `web/assets/app.js:3`
- Modify: `web/assets/app.js:762`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: グリッドが6行になる。以降のタスクの Playwright テストは
  6行を前提にしてよい

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_periods.mjs`:

```js
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
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_periods.mjs`
Expected: **NG**。`PERIODS が 1..6 でない（いま 1,2,3,4,5）` と
`グリッドの外に落ちる曜限がある: 月6 水6 木6 金6 火6` が出る。

- [ ] **Step 3: 3箇所を直す**

`server.py:81`:

```python
PERIODS = ["1", "2", "3", "4", "5", "6"]
```

`web/assets/app.js:3`:

```js
const DAYS = ["月","火","水","木","金"], PERIODS = ["1","2","3","4","5","6"];
```

`web/assets/app.js:762`（`META` の静的モードのフォールバック）:

```js
    days: ["月","火","水","木","金"], periods: ["1","2","3","4","5","6"],
```

**曜日は変えない。** 土曜の9件は `他` の桶に居り `slots` には現れない。

- [ ] **Step 4: 通ることを確かめる**

Run: `node tools/test_periods.mjs`
Expected: `OK 6 checks`

- [ ] **Step 5: 6限の科目が実際にグリッドから辿れることを目で見る**

```bash
cd web && python3 -m http.server 8140 &
open http://localhost:8140/          # グリッドが6行になっている
# 「木6」を押す → 【人文】現代の差別を考える が出ること（春学期）
kill %1
```

グリッドが5行から6行になるので、CSS の高さと PC 3カラムの収まりが動く。
崩れていたら `web/assets/app.css` の `.grid` を見る。

- [ ] **Step 6: 既存のテストを全部流す**

```bash
for f in tools/test_*.py; do python3 "$f" >/dev/null || echo "FAIL $f"; done
node tools/test_periods.mjs
```

- [ ] **Step 7: commit**

```bash
git add tools/test_periods.mjs server.py web/assets/app.js
git commit -m "fix: 6限をグリッドに出す（6限にしか開かれない29件が辿れなかった）"
```

---

### Task 2: `store.js` ―― localStorage の正本

**Files:**
- Create: `web/assets/store.js`
- Create: `tools/test_store.mjs`

**Interfaces:**
- Consumes: Task 1 の成果は使わない（独立）
- Produces: `window.rkStore` に以下を出す。以降の全タスクがこれだけを使い、
  `localStorage` を直に触らない。

```
rkStore.getProfile()                  -> { faculty: string|"", grade: string|"" }
rkStore.setProfile({faculty, grade})  -> void   （既存の他の鍵は壊さない）
rkStore.isOnboarded()                 -> boolean
rkStore.markOnboarded()               -> void
rkStore.getFavorites()                -> string[]   （追加が新しい順）
rkStore.isFavorite(id)                -> boolean
rkStore.toggleFavorite(id)            -> boolean    （操作後に入っているか）
rkStore.getTimetable(term)            -> { slots: {[slot:string]: string}, extra: string[] }
rkStore.setSlot(term, slot, id)       -> void
rkStore.clearSlot(term, slot)         -> void
rkStore.addExtra(term, id)            -> void
rkStore.removeExtra(term, id)         -> void
```

`term` は `"haru"` か `"aki"`。`slot` は `"月2"` の形。

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_store.mjs`:

```js
/* store.js は localStorage の唯一の窓口。ここが黙って落ちると
 * お気に入りも時間割も静かに消えるので、壊れた値と例外を必ず試す。
 *   node tools/test_store.mjs
 *
 * store.js はブラウザ用の素のスクリプト（window.rkStore を作る）なので、
 * node:vm で偽の window と localStorage を与えて読み込む。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(path.join(ROOT, "web/assets/store.js"), "utf-8");

const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

/* 偽の localStorage。throws:true にすると全操作が例外を投げる
   （プライベートモードの再現）。 */
function makeStore(initial = {}, throws = false) {
  const m = new Map(Object.entries(initial));
  const boom = () => { throw new Error("SecurityError"); };
  return {
    getItem: throws ? boom : (k) => (m.has(k) ? m.get(k) : null),
    setItem: throws ? boom : (k, v) => void m.set(k, String(v)),
    removeItem: throws ? boom : (k) => void m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

function load(initial, throws) {
  const ls = makeStore(initial, throws);
  const ctx = { window: {}, localStorage: ls, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { s: ctx.window.rkStore, ls };
}

// ── プロフィール ───────────────────────────
{
  const { s, ls } = load({});
  check(s.getProfile().faculty === "", "初期の faculty は空文字であるべき");
  s.setProfile({ faculty: "law", grade: "2" });
  check(s.getProfile().grade === "2", "setProfile したのに読めない");
  const raw = JSON.parse(ls._dump()["osaka_u_settings"]);
  check(raw.faculty === "law", "osaka_u_settings に書かれていない");
}
{
  // kuchikomi が先に書いた semester / department を壊さないこと
  const pre = JSON.stringify({ semester: "autumn", department: "denshi" });
  const { s, ls } = load({ osaka_u_settings: pre });
  s.setProfile({ faculty: "engineering", grade: "3" });
  const raw = JSON.parse(ls._dump()["osaka_u_settings"]);
  check(raw.semester === "autumn", "kuchikomi の semester を消してしまった");
  check(raw.department === "denshi", "kuchikomi の department を消してしまった");
}

// ── onboarded ─────────────────────────────
{
  const { s } = load({});
  check(s.isOnboarded() === false, "初回は false であるべき");
  s.markOnboarded();
  check(s.isOnboarded() === true, "markOnboarded が効いていない");
}

// ── お気に入り ─────────────────────────────
{
  const { s } = load({});
  check(s.getFavorites().length === 0, "初期は空であるべき");
  check(s.toggleFavorite("111") === true, "1回目の toggle は true を返すべき");
  check(s.isFavorite("111") === true, "isFavorite が false を返す");
  check(s.toggleFavorite("111") === false, "2回目の toggle は false を返すべき");
  check(s.getFavorites().length === 0, "外したのに残っている");
}

// ── 時間割 ────────────────────────────────
{
  const { s } = load({});
  s.setSlot("aki", "月2", "138531");
  check(s.getTimetable("aki").slots["月2"] === "138531", "setSlot が読めない");
  check(s.getTimetable("haru").slots["月2"] === undefined,
        "学期をまたいで漏れている（haru と aki は別の表）");
  // 1科目が複数コマを持てること
  s.setSlot("aki", "月3", "138531");
  check(s.getTimetable("aki").slots["月3"] === "138531",
        "同じ科目を2つのコマに置けない");
  s.clearSlot("aki", "月2");
  check(s.getTimetable("aki").slots["月2"] === undefined, "clearSlot が効かない");
  s.addExtra("aki", "020277");
  s.addExtra("aki", "020277");
  check(s.getTimetable("aki").extra.length === 1, "extra が重複して入る");
  s.removeExtra("aki", "020277");
  check(s.getTimetable("aki").extra.length === 0, "removeExtra が効かない");
}

// ── 壊れた値 ──────────────────────────────
{
  const { s } = load({ rk_favorites: "{壊れている", rk_timetable: "null",
                       osaka_u_settings: "[]" });
  check(s.getFavorites().length === 0, "壊れた rk_favorites で落ちる/変な値を返す");
  check(s.getTimetable("aki").extra.length === 0, "壊れた rk_timetable で落ちる");
  check(s.getProfile().faculty === "", "配列が入った osaka_u_settings で落ちる");
}

// ── localStorage が例外を投げる（プライベートモード） ──
{
  const { s } = load({}, true);
  check(s.getProfile().faculty === "", "例外を投げる環境で getProfile が落ちた");
  check(s.getFavorites().length === 0, "例外を投げる環境で getFavorites が落ちた");
  check(s.isOnboarded() === false, "例外を投げる環境で isOnboarded が落ちた");
  s.toggleFavorite("111");          // 投げないこと
  s.setSlot("aki", "月2", "111");   // 投げないこと
  check(true, "書き込みが例外を外へ漏らさない");
}

console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_store.mjs`
Expected: FAIL。`ENOENT ... web/assets/store.js`

- [ ] **Step 3: `web/assets/store.js` を書く**

```js
/* ブラウザに残す状態の、唯一の窓口。
 *
 * app.js と mypage.js の両方がここだけを通す。localStorage を直に触ると
 * 「片方だけ try/catch を忘れる」「鍵の名前がずれる」が必ず起きる。
 *
 * プライベートモードでは getItem/setItem がその場で例外を投げる。
 * だから全部を read()/write() でくるみ、**失敗しても既定値で動き続ける**。
 * 保存できないだけで、その回の操作は画面上では成立させる。
 *
 * 鍵は4つ:
 *   osaka_u_settings … kuchikomi と共用。こちらは faculty / grade だけ触る
 *   rk_onboarded     … 開屏の問診が一度出た印。localStorage（一生に一度）
 *   rk_favorites     … { v:1, ids:{ "<id>": <追加時刻> } }
 *   rk_timetable     … { v:1, aki:{slots,extra}, haru:{slots,extra} }
 */
(() => {
  const K_SET = "osaka_u_settings";
  const K_ON  = "rk_onboarded";
  const K_FAV = "rk_favorites";
  const K_TT  = "rk_timetable";
  const TERMS = ["haru", "aki"];

  const read = (k) => {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, v); } catch (e) { /* 保存できないだけ */ }
  };
  /* JSON.parse は壊れた値でも投げる。既定値へ落として先へ進む。
     「情報が無い」で止めない ―― 止めると画面が真っ白になる。 */
  const readObj = (k) => {
    const raw = read(k);
    if (!raw) return {};
    try {
      const o = JSON.parse(raw);
      return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  };

  const emptyTerm = () => ({ slots: {}, extra: [] });

  function readTT() {
    const o = readObj(K_TT);
    const out = { v: 1 };
    for (const t of TERMS) {
      const s = o[t];
      out[t] = (s && typeof s === "object")
        ? { slots: (s.slots && typeof s.slots === "object") ? s.slots : {},
            extra: Array.isArray(s.extra) ? s.extra : [] }
        : emptyTerm();
    }
    return out;
  }
  const writeTT = (tt) => write(K_TT, JSON.stringify(tt));
  const term = (t) => (TERMS.includes(t) ? t : "aki");

  window.rkStore = {
    getProfile() {
      const o = readObj(K_SET);
      return { faculty: o.faculty || "", grade: o.grade || "" };
    },
    /* 既存の semester / department には触らない（kuchikomi の領分）。
       だから丸ごと上書きせず、読んでから2つだけ差し替える。 */
    setProfile({ faculty, grade }) {
      const o = readObj(K_SET);
      if (faculty !== undefined) o.faculty = faculty;
      if (grade !== undefined) o.grade = grade;
      write(K_SET, JSON.stringify(o));
    },

    isOnboarded()  { return read(K_ON) === "1"; },
    markOnboarded(){ write(K_ON, "1"); },

    getFavorites() {
      const ids = readObj(K_FAV).ids;
      if (!ids || typeof ids !== "object") return [];
      return Object.keys(ids).sort((a, b) => (ids[b] || 0) - (ids[a] || 0));
    },
    isFavorite(id) {
      const ids = readObj(K_FAV).ids;
      return !!(ids && ids[id]);
    },
    toggleFavorite(id) {
      const o = readObj(K_FAV);
      const ids = (o.ids && typeof o.ids === "object") ? o.ids : {};
      const now = !ids[id];
      if (now) ids[id] = Date.now(); else delete ids[id];
      write(K_FAV, JSON.stringify({ v: 1, ids }));
      return now;
    },

    getTimetable(t) { return readTT()[term(t)]; },
    setSlot(t, slot, id) {
      const tt = readTT(); tt[term(t)].slots[slot] = id; writeTT(tt);
    },
    clearSlot(t, slot) {
      const tt = readTT(); delete tt[term(t)].slots[slot]; writeTT(tt);
    },
    addExtra(t, id) {
      const tt = readTT(); const e = tt[term(t)].extra;
      if (!e.includes(id)) e.push(id);
      writeTT(tt);
    },
    removeExtra(t, id) {
      const tt = readTT(); const k = term(t);
      tt[k].extra = tt[k].extra.filter((x) => x !== id);
      writeTT(tt);
    },
  };
})();
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node tools/test_store.mjs`
Expected: `OK 22 checks`（件数は多少ずれてよい。`NG` が出なければ通り）

- [ ] **Step 5: commit**

```bash
git add web/assets/store.js tools/test_store.mjs
git commit -m "feat(web): ブラウザに残す状態の正本 store.js を置く"
```

---

### Task 3: お気に入り（一覧と詳細に星を付ける）

**Files:**
- Modify: `web/assets/app.js`（`card()` 439行付近／詳細 542行付近／起動の配線）
- Modify: `web/assets/app.css`（`.favBtn`）
- Modify: `web/index.html`（`store.js` を読む）
- Create: `tools/test_favorite.mjs`

**Interfaces:**
- Consumes: `window.rkStore.isFavorite(id)` / `toggleFavorite(id)`（Task 2）
- Produces: `.favBtn[data-id]` という DOM の約束。Task 7 のマイページは
  `rkStore.getFavorites()` だけを見るので、この DOM には依存しない

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_favorite.mjs`:

```js
/* お気に入りの星が「押せて」「残って」「詳細を開かない」ことを実ブラウザで見る。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_favorite.mjs http://localhost:8140
 *
 * 静的配信に当てるのが肝。本番で動くのは web/assets/app.js のほう。
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();
const page = await browser.newPage();

/* 開屏の問診に邪魔されないよう、済んだことにしてから開く。 */
await page.addInitScript(() => {
  try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
  try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
});
await page.goto(BASE + "/");
await page.waitForSelector(".card .favBtn");

const first = page.locator(".card").first();
const star  = first.locator(".favBtn");
const id    = await first.getAttribute("data-id");

check(await star.getAttribute("aria-pressed") === "false", "初期状態が押されている");

await star.click();
check(await star.getAttribute("aria-pressed") === "true", "押しても aria-pressed が変わらない");

/* 星は .head の外に在るので、押しても詳細が開いてはいけない。 */
const opened = await first.locator(".detail").evaluate(el => el.children.length > 0);
check(opened === false, "星を押したら詳細まで開いてしまった（.head の中に置いている）");

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rk_favorites") || "{}"));
check(saved.ids && saved.ids[id], "localStorage に入っていない");

/* 再読込しても残ること。 */
await page.reload();
await page.waitForSelector(".card .favBtn");
const star2 = page.locator(`.card[data-id="${id}"] .favBtn`);
check(await star2.getAttribute("aria-pressed") === "true", "再読込で消えた");

await star2.click();
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("rk_favorites") || "{}"));
check(!(after.ids && after.ids[id]), "もう一度押しても外れない");

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 落ちることを確かめる**

```bash
cd web && python3 -m http.server 8140 &
node tools/test_favorite.mjs http://localhost:8140
```
Expected: FAIL（`.card .favBtn` を待って timeout）

- [ ] **Step 3: `web/index.html` に `store.js` を足す**

`app.js` より**前**に読ませる。`app.js` は起動時に `rkStore` を呼ぶ。

```html
<script src="/assets/splash.js"></script>
<script src="/assets/store.js"></script>
<script src="/assets/shell.js" defer></script>
<script src="/assets/app.js" defer></script>
```

- [ ] **Step 4: `card()` に星を足す（`.head` の外）**

`web/assets/app.js` の `card()`（439行付近）の `return` を差し替える。
**`</div>`（`.head` の閉じ）の後ろ、`.detail` の前**に置くのが肝。
`.head` は `role="button"` で押すと詳細が開くので、中に入れると
`stopPropagation` が要る。外なら要らない。

```js
function card(c){
  const r = c.rakutan, m = c.match;
  const dp = c.day_period || (c.term === "集中" ? "集中" : "—");
  const tags = [...r.tags, ...r.notes];
  const rv = reviewMark(c.reviews);
  const fav = rkStore.isFavorite(c.id);
  return `<article class="card${rv.alert ? " unscored" : ""}" data-id="${esc(c.id)}">
    <div class="head" role="button" tabindex="0">
      <div>
        <h3 class="title">${esc(c.title)}</h3>
        <div class="meta"><span>${esc(dp)}</span>${insMetaSpan(c)}<span>${esc(c.campus||"—")}</span><span>${esc(c.category)}</span></div>
        ${rv.badge}
      </div>
      <div class="fit"><b>${m.fit ?? "—"}</b><small>相性</small></div>
      <div class="reason"><span class="band b${BAND_CLS[r.band] ?? 0}">${esc(r.band)}</span>${esc(m.reason)}
        ${r.needs_review ? `<span class="bandNote">テストの難しさは誰も確認していません</span>` : ""}</div>
      ${rv.alert}
      ${tags.length ? `<div class="tags">${tags.slice(0,4).map(t=>`<span class="tag${r.notes.includes(t)?" g":""}">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
    <button class="favBtn" data-id="${esc(c.id)}" aria-pressed="${fav}"
            aria-label="お気に入り">${fav ? "★" : "☆"}</button>
    <div class="detail"></div>
  </article>`;
}
```

- [ ] **Step 5: 押されたときの配線を足す**

`app.js` の末尾、`window.addEventListener("resize", …)` の**手前**に置く。
既存の `.panelBtn` / `.reviewBtn` と同じ委譲の型（`app.js:958` 参照）。
`#list` と `#inspector` の両方に効かせる。

```js
/* お気に入りの星。カードは絞り込みのたびに作り直されるので、
   1枚ずつに onclick を付けず、親で受ける（.panelBtn と同じ型）。 */
for (const sel of ["#list", "#inspector"]) {
  $(sel).addEventListener("click", e => {
    const btn = e.target.closest(".favBtn");
    if (!btn) return;
    const now = rkStore.toggleFavorite(btn.dataset.id);
    /* 一覧と詳細に同じ科目の星が同時に出ていることがある。両方直す。 */
    document.querySelectorAll(`.favBtn[data-id="${CSS.escape(btn.dataset.id)}"]`)
      .forEach(b => { b.setAttribute("aria-pressed", String(now));
                      b.textContent = now ? "★" : "☆"; });
  });
}
```

- [ ] **Step 6: 詳細パネルにも星を置く**

`app.js:542` 付近、`.panelBtn` / `.reviewBtn` を組み立てている所へ
同じ形のボタンを1つ足す。

```js
      <button class="favBtn" data-id="${esc(c.id)}" aria-pressed="${rkStore.isFavorite(c.id)}"
              aria-label="お気に入り">${rkStore.isFavorite(c.id) ? "★" : "☆"}</button>
```

- [ ] **Step 7: CSS**

`web/assets/app.css` の末尾に足す。カードの右上に浮かせるので
`.card` に `position: relative` が要る（既に在れば足さない）。

```css
/* お気に入りの星。.head の外に在るので、押しても詳細は開かない。 */
.card { position: relative; }
.favBtn{
  position:absolute; top:6px; right:6px;
  width:40px; height:40px;              /* 指で押せる大きさ。44px 未満にしない場合は要検討 */
  border:0; background:transparent; cursor:pointer;
  font-size:20px; line-height:1; color:var(--brand);
  border-radius:8px;
}
.favBtn:hover{ background:rgba(219,98,9,.08); }
.favBtn[aria-pressed="false"]{ color:#b9b9b9; }
```

- [ ] **Step 8: 通ることを確かめる**

```bash
cd web && python3 -m http.server 8140 &
node tools/test_favorite.mjs http://localhost:8140
kill %1
```
Expected: `OK 6 checks`

- [ ] **Step 9: commit**

```bash
git add web/assets/app.js web/assets/app.css web/index.html tools/test_favorite.mjs
git commit -m "feat(web): 科目をお気に入りに入れられるようにする"
```

---

### Task 4: 開屏の問診

**Files:**
- Create: `web/assets/onboard.js`
- Modify: `web/assets/splash.js`（`end()` で完了を知らせる）
- Modify: `web/assets/app.js`（起動完了を知らせる／答えを受け取る）
- Modify: `web/index.html`
- Modify: `web/assets/app.css`
- Create: `tools/test_onboard.mjs`

**Interfaces:**
- Consumes: `rkStore.isOnboarded()` / `markOnboarded()` / `setProfile()`（Task 2）
- Produces: 3つの `CustomEvent`。
  - `rk:splash-done`（splash.js が出す・引数なし）
  - `rk:app-ready`（app.js が最初の `load()` の後に出す・引数なし）
  - `rk:profile-set`（onboard.js が出す・`detail: {faculty, grade}`）

  **問診は `rk:splash-done` と `rk:app-ready` の両方が揃ってから出す。**
  演出は 1.4秒で終わるが、`courses.built.json` の読み込みはそれより
  遅いことがある。先に問診を出すと、答えた瞬間に反映するものがまだ無い。

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_onboard.mjs`:

```js
/* 開屏の問診。「降りるのは問診そのもの、設問ごとではない」を守れているか。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_onboard.mjs http://localhost:8140
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();

async function fresh() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // 演出は飛ばす。問診の門は rk_onboarded であって splash ではない。
  await page.addInitScript(() => {
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  return { ctx, page };
}

// ① 初回は出る
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/");
  await page.waitForSelector("#onboard[data-step='gate']", { timeout: 15000 });
  check(true, "初回に問診が出る");

  // ② 「そのまま使う」で降りると1問も聞かれず、profile も書かれない
  await page.click("#onboardSkip");
  check(await page.locator("#onboard").isHidden(), "降りたのに閉じない");
  const set = await page.evaluate(() => localStorage.getItem("osaka_u_settings"));
  check(!set || !JSON.parse(set).faculty, "降りたのに学部が書かれている");
  check(await page.evaluate(() => localStorage.getItem("rk_onboarded")) === "1",
        "降りたのに rk_onboarded が立っていない");

  // ③ 再訪では出ない
  await page.reload();
  await page.waitForSelector(".card", { timeout: 15000 });
  check(await page.locator("#onboard").isHidden(), "2回目にも問診が出た");
  await ctx.close();
}

// ④ 答えると settings に入り、絞り込みに反映される
{
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/");
  await page.waitForSelector("#onboard[data-step='gate']", { timeout: 15000 });
  await page.click("#onboardStart");

  await page.waitForSelector("#onboard[data-step='faculty']");
  const facs = await page.locator("#onboard [data-faculty]").count();
  check(facs === 11, `学部が11個出るべき（いま ${facs}）`);
  // 設問の中に逃げ道が無いこと ―― 降りるのは gate だけ
  check(await page.locator("#onboard[data-step='faculty'] #onboardSkip").count() === 0,
        "設問の中に「答えたくない」が居る（gate だけに置く約束）");

  await page.click("#onboard [data-faculty='law']");
  await page.waitForSelector("#onboard[data-step='grade']");
  await page.click("#onboard [data-grade='2']");

  check(await page.locator("#onboard").isHidden(), "答え終わっても閉じない");
  const set = JSON.parse(await page.evaluate(() => localStorage.getItem("osaka_u_settings")));
  check(set.faculty === "law", "学部が保存されていない");
  check(set.grade === "2", "学年が保存されていない");

  // 画面に反映されていること（学年チップの 2年 が選ばれている）
  await page.waitForSelector("#years .chip.on");
  const on = await page.locator("#years .chip.on").textContent();
  check(on.includes("2年"), `学年チップが反映されていない（いま ${on}）`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_onboard.mjs http://localhost:8140`
Expected: FAIL（`#onboard[data-step='gate']` の timeout）

- [ ] **Step 3: `splash.js` に完了の合図を足す**

`web/assets/splash.js` の `end()`（68行付近）の中、
`document.documentElement.classList.add("splash-skip");` の直後に1行。

```js
      document.documentElement.classList.add("splash-skip");
      window.dispatchEvent(new CustomEvent("rk:splash-done"));
```

さらに、演出を**流さない**分岐（`if (reduced || seen)`、43行付近）も直す。
ここを忘れると、2回目以降の訪問者と reduced-motion の人に問診が永久に出ない。

**この分岐が難しいのは順序。** `splash.js` は同期スクリプト（`defer` 無し）で
`onboard.js`（`defer`）より先に走り切る。つまりこの分岐で `dispatchEvent` しても
**`onboard.js` はまだ聞いていない**。だからイベントに加えて、
あとから問い合わせられるフラグ `rkSplash.done()` も置く。

```js
  if (reduced || seen){
    document.documentElement.classList.add("splash-skip");
    // 演出を流さないので、この時点でもう「終わっている」。
    // onboard.js はまだ読み込まれていないので、イベントだけでは届かない。
    // あとから聞けるように rkSplash も置く（skip は何もしない関数）。
    window.rkSplash = { skip(){}, done: () => true };
    window.dispatchEvent(new CustomEvent("rk:splash-done"));
    return;
  }
```

`splash.js` の末尾、`window.rkSplash = { skip: done };` も次に変える。

```js
  window.rkSplash = { skip: done, done: () => finished };
```

- [ ] **Step 4: `app.js` に「起動できた」と「答えを受け取る」を足す**

`app.js` 末尾の起動 IIFE、`await load();` の直後に1行足す。

```js
  await load();
  window.dispatchEvent(new CustomEvent("rk:app-ready"));
```

同じ IIFE の中、`await load();` より**前**に受け口を置く。

```js
  /* 開屏の問診の答え。絞り込みに即あてて描き直す ――
     答えたのに画面が変わらないと、聞かれ損になる。 */
  window.addEventListener("rk:profile-set", e => {
    const { faculty, grade } = e.detail || {};
    if (faculty) state.faculty = faculty;
    if (grade) state.year = grade;
    buildYears();
    load();
  });
```

- [ ] **Step 5: `web/assets/onboard.js` を書く**

```js
/* 開屏の問診。
 *
 * 守っていること：
 *  1. **一生に一度だけ出す。** 門は localStorage の rk_onboarded。
 *     splash が sessionStorage なのは「閉じて開き直したらまた見たい」から。
 *     問診は逆で、履修登録期に1日何度も開く学生を毎回止めてはいけない。
 *  2. **降りるのは問診そのものであって、設問ごとではない。**
 *     最初のカードで [そのまま使う] を押したら1問も聞かない。
 *     設問に入ったら学部と学年は両方答える。
 *  3. **演出とデータの両方が揃ってから出す。** 演出は1.4秒で終わるが
 *     courses.built.json はもっと掛かることがある。先に出すと、
 *     答えた瞬間に反映するものがまだ無い。
 *  4. 学部の一覧をここに持たない。正本は requirements.json。
 */
(() => {
  if (rkStore.isOnboarded()) return;

  let splashDone = !!(window.rkSplash && window.rkSplash.done && window.rkSplash.done());
  let appReady = false;
  window.addEventListener("rk:splash-done", () => { splashDone = true; maybeShow(); });
  window.addEventListener("rk:app-ready",   () => { appReady = true;   maybeShow(); });

  let shown = false;
  let el = null;
  const answer = { faculty: "", grade: "" };

  function maybeShow(){
    if (shown || !splashDone || !appReady) return;
    shown = true;
    build();
    step("gate");
  }

  function build(){
    el = document.createElement("div");
    el.className = "onboard";
    el.id = "onboard";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="onboardInner">
      <div class="onboardCard" data-card="gate">
        <h2>学部と学年を教えてもらえますか</h2>
        <p>あなたが履修できる科目だけを出せます。答えなくてもすべての機能が使えます。</p>
        <div class="onboardBtns">
          <button id="onboardStart" class="primary">教える</button>
          <button id="onboardSkip">そのまま使う</button>
        </div>
      </div>
      <div class="onboardCard" data-card="faculty">
        <h2>学部はどれですか</h2>
        <div class="onboardOpts" id="onboardFaculties"></div>
      </div>
      <div class="onboardCard" data-card="grade">
        <h2>いま何年生ですか</h2>
        <div class="onboardOpts" id="onboardGrades"></div>
      </div>
    </div>`;
    document.body.appendChild(el);

    /* 学部の一覧は requirements.json が正本。app.js が読んだものを借りる。 */
    const facs = (window.REQ && window.REQ.faculties) || [];
    document.getElementById("onboardFaculties").innerHTML = facs.map(f =>
      `<button data-faculty="${f.key}">${f.label}</button>`).join("");
    document.getElementById("onboardGrades").innerHTML = [1,2,3,4,5,6].map(g =>
      `<button data-grade="${g}">${g}年</button>`).join("");

    document.getElementById("onboardSkip").onclick = () => finish(false);
    document.getElementById("onboardStart").onclick = () => step("faculty");
    el.querySelectorAll("[data-faculty]").forEach(b => b.onclick = () => {
      answer.faculty = b.dataset.faculty; step("grade");
    });
    el.querySelectorAll("[data-grade]").forEach(b => b.onclick = () => {
      answer.grade = b.dataset.grade; finish(true);
    });
  }

  function step(name){
    el.dataset.step = name;
    const card = el.querySelector(`[data-card="${name}"]`);
    const first = card && card.querySelector("button");
    if (first) first.focus();
  }

  function finish(answered){
    rkStore.markOnboarded();
    if (answered){
      rkStore.setProfile({ faculty: answer.faculty, grade: answer.grade });
      window.dispatchEvent(new CustomEvent("rk:profile-set", { detail: { ...answer } }));
    }
    el.remove();
  }
})();
```

> **`window.REQ` が要る。** `onboard.js` は学部の一覧を持たない約束なので、
> `app.js` が読んだ `requirements.json` を借りる。`REQ` はモジュール内の
> `let`（`app.js:32`）で、`boot()` の中の2箇所（API 版 `745`／静的版 `755`）で
> 代入される。**両方を拾うため、代入側ではなく `boot()` を呼んだ直後に置く。**

`app.js` 末尾の起動 IIFE、`await boot();` の直後に1行足す。

```js
  await boot();
  window.REQ = REQ;   // onboard.js が学部の一覧を借りる（べた書きを作らないため）
  applyPostMode();
```

- [ ] **Step 6: `index.html` に読み込みを足す**

`app.js` の**後**（`REQ` が入ってから走らせたいので `defer` の順序に乗せる）。

```html
<script src="/assets/app.js" defer></script>
<script src="/assets/onboard.js" defer></script>
```

- [ ] **Step 7: CSS**

`web/assets/app.css` の末尾。

```css
/* 開屏の問診。splash の上には出ない（splash が消えてから出る）。 */
.onboard{
  position:fixed; inset:0; z-index:60;
  display:grid; place-items:center;
  background:rgba(0,0,0,.45);
  padding:20px;
}
.onboardInner{
  background:#fff; border-radius:16px; padding:24px 20px;
  width:100%; max-width:420px; box-shadow:0 10px 40px rgba(0,0,0,.2);
}
.onboardCard{ display:none; }
.onboard[data-step="gate"]    [data-card="gate"],
.onboard[data-step="faculty"] [data-card="faculty"],
.onboard[data-step="grade"]   [data-card="grade"]{ display:block; }
.onboardInner h2{ font-size:18px; margin:0 0 8px; }
.onboardInner p{ font-size:13px; color:#666; margin:0 0 16px; line-height:1.6; }
.onboardBtns{ display:flex; flex-direction:column; gap:8px; }
.onboardBtns button, .onboardOpts button{
  padding:12px; border-radius:10px; border:1px solid #ddd;
  background:#fff; font-size:15px; cursor:pointer;
}
.onboardBtns .primary{ background:var(--brand); color:#fff; border-color:var(--brand); }
.onboardOpts{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
```

- [ ] **Step 8: 通ることを確かめる**

```bash
cd web && python3 -m http.server 8140 &
node tools/test_onboard.mjs http://localhost:8140
node tools/test_favorite.mjs http://localhost:8140   # 壊していないこと
kill %1
```
Expected: どちらも `OK`

- [ ] **Step 9: commit**

```bash
git add web/assets/onboard.js web/assets/splash.js web/assets/app.js \
        web/assets/app.css web/index.html tools/test_onboard.mjs
git commit -m "feat(web): 開屏に学部・学年の問診を出す（丸ごと降りられる）"
```

---

### Task 5: マイページの外殻

**Files:**
- Modify: `templates/shell.html`（ナビに4項目め）
- Modify: `web/assets/shell.js:12-14`（現在地の判定）
- Create: `web/mypage.html`
- Create: `web/assets/mypage.js`
- Create: `web/assets/mypage.css`
- Modify: `tools/test_shell_inject.py`
- Run: `python3 build.py`（`<!--SHELL:*-->` を3ページへ注入）

**Interfaces:**
- Consumes: `rkStore.getProfile()` / `setProfile()`（Task 2）
- Produces: `web/mypage.html` に `#mpProfile` `#mpTimetable` `#mpFavorites` の
  3つの入れ物。Task 6 と 7 がその中身を作る

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_mypage.mjs`（Task 6・7 でも育てるので、まずは外殻の分だけ）:

```js
/* マイページ。まずは「在ること」と「プロフィールが往復すること」。
 *   cd web && python3 -m http.server 8140 &
 *   node tools/test_mypage.mjs http://localhost:8140
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8140";
const fails = [];
let n = 0;
const check = (cond, msg) => { n++; if (!cond) fails.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("rk_onboarded", "1");
    localStorage.setItem("osaka_u_settings",
      JSON.stringify({ faculty: "law", grade: "2", semester: "autumn" }));
  } catch (e) {}
});

await page.goto(BASE + "/mypage.html");
await page.waitForSelector("#mpProfile");

check(await page.locator("#mpTimetable").count() === 1, "時間割の入れ物が無い");
check(await page.locator("#mpFavorites").count() === 1, "お気に入りの入れ物が無い");

// ナビが4項目で、現在地が付いていること
check(await page.locator(".nav a").count() === 4, "ナビが4項目でない");
check(await page.locator('.nav a[data-nav="mypage"][aria-current="page"]').count() === 1,
      "マイページに現在地が付いていない");

// プロフィールが読めていること
check(await page.locator("#mpFaculty").inputValue() === "law", "学部が読めていない");
check(await page.locator("#mpGrade").inputValue() === "2", "学年が読めていない");

// 変えると保存され、kuchikomi の semester を壊さないこと
await page.selectOption("#mpGrade", "3");
const set = JSON.parse(await page.evaluate(() => localStorage.getItem("osaka_u_settings")));
check(set.grade === "3", "学年の変更が保存されない");
check(set.semester === "autumn", "kuchikomi の semester を壊した");

await browser.close();
console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_mypage.mjs http://localhost:8140`
Expected: FAIL（404 / `#mpProfile` の timeout）

- [ ] **Step 3: ナビに4項目めを足す**

`templates/shell.html` の `<nav class="nav">` に1つ足す。**正本はここだけ。**
`web/*.html` を直に触らない（`build.py` が上書きする）。

```html
<a href="/" data-nav="home">科目をさがす</a><a href="/about" data-nav="about">About ラクハン</a><a href="/mypage" data-nav="mypage">マイページ</a><a href="/kuchikomi" data-nav="kuchikomi">口コミを書く</a>
```

- [ ] **Step 4: `shell.js` の現在地判定に枝を足す**

`web/assets/shell.js:12-14`:

```js
  const key = (here === "/" || here === "/index.html") ? "home"
            : here.startsWith("/about") ? "about"
            : here.startsWith("/mypage") ? "mypage"
            : here.startsWith("/kuchikomi") ? "kuchikomi" : null;
```

- [ ] **Step 5: `web/mypage.html` を作る**

`<!--SHELL:HEADER-->` と `<!--SHELL:FOOTER-->` の空の枠だけ置く。
中身は `build.py` が入れる。

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>マイページ — ラクハン</title>
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/app.css">
<link rel="stylesheet" href="/assets/mypage.css">
</head>
<body><!--SHELL:HEADER--><!--/SHELL:HEADER-->

<div class="wrap mypage">
  <h2 class="mpTitle">マイページ</h2>
  <p class="mpLead">ここに残るものは、この端末のブラウザの中だけにあります。
    サーバーには送っていません。</p>

  <section id="mpProfile">
    <h3>プロフィール</h3>
    <div class="mpRow">
      <label for="mpFaculty">学部</label>
      <select id="mpFaculty"></select>
    </div>
    <div class="mpRow">
      <label for="mpGrade">学年</label>
      <select id="mpGrade"></select>
    </div>
  </section>

  <section id="mpTimetable">
    <h3>私の時間割</h3>
    <div class="mpTerms" id="mpTerms"></div>
    <div class="mpGrid" id="mpGrid"></div>
    <div id="mpExtra"></div>
  </section>

  <section id="mpFavorites">
    <h3>お気に入りの授業</h3>
    <div id="mpFavList"></div>
  </section>
</div>

<!--SHELL:FOOTER--><!--/SHELL:FOOTER-->

<script src="/assets/store.js"></script>
<script src="/assets/shell.js" defer></script>
<script src="/assets/mypage.js" defer></script>
</body>
</html>
```

- [ ] **Step 6: `web/assets/mypage.js`（プロフィールの分だけ）**

```js
/* マイページ。
 *
 * app.js は読まない。あちらは一覧・絞り込み・詳細のためのもので、
 * #list の無いページで読むと途中で落ちる（shell.js の冒頭に同じ注意がある）。
 * 科目のデータは web/data/timetable.json（6,808件・gzip 135KB）だけ使う。
 * courses.built.json は12MBあり、ここに要るのは名前・担当・曜限だけ。
 */
const $ = (s) => document.querySelector(s);
/* app.js と同じ書き方。科目名は KOAN 由来の外部文字列なので必ず通す。 */
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));
const DAYS = ["月","火","水","木","金"];
const PERIODS = ["1","2","3","4","5","6"];   // Task 1 で6限に揃えたのと同じ

let COURSES = [];          // timetable.json
let BY_ID = new Map();
let REQ = null;            // requirements.json（学部の一覧の正本）
let term = "aki";

async function boot(){
  const [tt, req] = await Promise.all([
    fetch("/data/timetable.json").then(r => r.json()),
    fetch("/data/requirements.json").then(r => r.json()),
  ]);
  COURSES = tt;
  BY_ID = new Map(tt.map(c => [c.id, c]));
  REQ = req;
  buildProfile();
}

function buildProfile(){
  const p = rkStore.getProfile();
  $("#mpFaculty").innerHTML =
    `<option value="">選ばない</option>` +
    REQ.faculties.map(f => `<option value="${f.key}">${f.label}</option>`).join("");
  $("#mpGrade").innerHTML =
    `<option value="">選ばない</option>` +
    [1,2,3,4,5,6].map(g => `<option value="${g}">${g}年</option>`).join("");

  /* 選択肢に無い値をそのまま入れると select は無言で未選択になる
     （kuchikomi が 2026-08-26 に踏んだ罠）。在ることを確かめてから入れる。 */
  if ([...$("#mpFaculty").options].some(o => o.value === p.faculty))
    $("#mpFaculty").value = p.faculty;
  if ([...$("#mpGrade").options].some(o => o.value === p.grade))
    $("#mpGrade").value = p.grade;

  $("#mpFaculty").onchange = e => rkStore.setProfile({ faculty: e.target.value });
  $("#mpGrade").onchange   = e => rkStore.setProfile({ grade: e.target.value });
}

boot();
```

- [ ] **Step 7: `web/assets/mypage.css`（最小限）**

```css
.mypage{ padding:20px 16px 60px; max-width:760px; margin:0 auto; }
.mpTitle{ font-size:22px; margin:0 0 4px; }
.mpLead{ font-size:13px; color:#666; margin:0 0 24px; line-height:1.6; }
.mypage section{ margin:0 0 32px; }
.mypage h3{ font-size:16px; margin:0 0 12px; }
.mpRow{ display:flex; align-items:center; gap:12px; margin:0 0 10px; }
.mpRow label{ width:4em; font-size:14px; color:#555; }
.mpRow select{ flex:1; padding:10px; border:1px solid #ddd; border-radius:8px; font-size:15px; }
```

- [ ] **Step 8: `build.py` を流して注入する**

**データは焼かない。外殻の注入だけ流す。**
`build.py` を丸ごと流すと `courses.built.json` を焼き直そうとするが、
**全所属の `courses.json` はこの機械に無いことが多く**、
「科目が減る焼き直しの護り」（commit 69133c7）に弾かれる。
注入だけなら `read_shell()` と `inject_shell()` を直に呼べばよい
（`PAGES` は import 時の glob なので `mypage.html` も自動で入る）。

```bash
python3 -c "
import build
parts = build.read_shell()
changed = [p.name for p in build.PAGES if build.inject_shell(p, parts)]
print('注入したページ:', changed or '変更なし')
"
grep -c 'data-nav=\"mypage\"' web/index.html web/about.html web/kuchikomi.html web/mypage.html
```
Expected: 注入したページに4ファイル、`grep -c` は4ファイルとも `1`

- [ ] **Step 9: `tools/test_shell_inject.py` を4項目に更新**

`tools/test_shell_inject.py` の中ほど、ナビの文言を数えている行を直す。

```python
    for nav in ["科目をさがす", "About ラクハン", "マイページ", "口コミを書く"]:
        check(nav in s, f"shell.html のナビに「{nav}」が無い")
```

このテストは `web/*.html` を glob しているので、`mypage.html` は
**自動で対象に入る**（「ページが増えたときに自動で対象になる」と
docstring に書いてある）。つまり外殻が1文字でも他ページとズレていれば
ここで落ちる ―― Step 8 の注入を忘れるとこれが検出する。

```bash
python3 tools/test_shell_inject.py
```
Expected: `OK`

- [ ] **Step 10: 通ることを確かめる**

```bash
cd web && python3 -m http.server 8140 &
node tools/test_mypage.mjs http://localhost:8140
kill %1
```
Expected: `OK 7 checks`

- [ ] **Step 11: commit**

```bash
git add templates/shell.html web/assets/shell.js web/mypage.html \
        web/assets/mypage.js web/assets/mypage.css \
        web/index.html web/about.html web/kuchikomi.html \
        tools/test_shell_inject.py tools/test_mypage.mjs
git commit -m "feat(web): マイページを足す（プロフィールまで）"
```

---

### Task 6: 私の時間割

**Files:**
- Modify: `web/assets/mypage.js`
- Modify: `web/assets/mypage.css`
- Modify: `tools/test_mypage.mjs`（時間割の検査を足す）

**Interfaces:**
- Consumes: `rkStore.getTimetable(term)` / `setSlot` / `clearSlot` /
  `addExtra` / `removeExtra`（Task 2）／`COURSES` `BY_ID`（Task 5）
- Produces: `window.mpRenderTimetable()` ―― Task 7 が
  「時間割に入れる」を押したあとに呼ぶ

- [ ] **Step 1: テストを足す（`tools/test_mypage.mjs` の末尾、`browser.close()` の前）**

```js
// ── 時間割 ────────────────────────────────
await page.waitForSelector(".mpCell[data-slot='月2']");
check(await page.locator(".mpCell").count() === DAYS_X_PERIODS,
      `マスが ${DAYS_X_PERIODS} 個であるべき`);

await page.click(".mpCell[data-slot='月2']");
await page.waitForSelector("#mpPicker[open]");
const opts = await page.locator("#mpPicker .mpPick").count();
check(opts > 0, "月2 の科目が1つも出てこない");

const pickedId = await page.locator("#mpPicker .mpPick").first().getAttribute("data-id");
await page.locator("#mpPicker .mpPick").first().click();
check(await page.locator(".mpCell[data-slot='月2']").textContent() !== "",
      "選んだのにマスが空のまま");

let tt = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt.aki.slots["月2"] === pickedId, "aki の 月2 に入っていない");
check(!tt.haru.slots["月2"], "haru にも漏れている（学期は別の表）");

// 学期を切り替えると空であること
await page.click("[data-term='haru']");
check(await page.locator(".mpCell[data-slot='月2']").textContent().then(t => t.trim()) === "",
      "春学期に秋学期の科目が出ている");
await page.click("[data-term='aki']");

// 再読込しても残る
await page.reload();
await page.waitForSelector(".mpCell[data-slot='月2']");
check((await page.locator(".mpCell[data-slot='月2']").textContent()).trim() !== "",
      "再読込で時間割が消えた");
```

テストの冒頭（`const browser = …` の前）に定数を足す:

```js
const DAYS_X_PERIODS = 5 * 6;   // 月〜金 × 1〜6限
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_mypage.mjs http://localhost:8140`
Expected: FAIL（`.mpCell[data-slot='月2']` の timeout）

- [ ] **Step 3: `mypage.html` に選択用の `<dialog>` を足す**

`</div>` （`.wrap` の閉じ）の直前:

```html
<dialog id="mpPicker">
  <h3 id="mpPickerTitle"></h3>
  <div id="mpPickerList"></div>
  <button id="mpPickerClose">閉じる</button>
</dialog>
```

- [ ] **Step 4: `mypage.js` に時間割を足す**

`boot()` の `buildProfile();` の後ろに `buildTerms(); renderTimetable();` を足し、
以下を追加する。

```js
/* 学期は haru / aki の2つだけ。timetable.json の term_group と同じ語彙で、
   full（通年）はどちらの学期でも履修できるので必ず通す（app.js と同じ扱い）。
   kuchikomi の spring / autumn とは別語彙。混ぜないこと。 */
const TERMS = [["aki","秋・冬学期"],["haru","春・夏学期"]];
const TERM_GROUPS = { haru:["haru","full"], aki:["aki","full"] };

function buildTerms(){
  $("#mpTerms").innerHTML = TERMS.map(([v,label]) =>
    `<button class="chip${term===v?" on":""}" data-term="${v}">${label}</button>`).join("");
  $("#mpTerms").querySelectorAll("button").forEach(b => b.onclick = () => {
    term = b.dataset.term; buildTerms(); renderTimetable();
  });
}

function inTerm(c){ return TERM_GROUPS[term].includes(c.term_group); }

function renderTimetable(){
  const tt = rkStore.getTimetable(term);
  let html = '<div class="mpH"></div>' + DAYS.map(d=>`<div class="mpH">${d}</div>`).join("");
  for (const p of PERIODS){
    html += `<div class="mpH">${p}</div>`;
    for (const d of DAYS){
      const slot = d + p;
      const id = tt.slots[slot];
      const c = id ? BY_ID.get(id) : null;
      html += `<button class="mpCell${c?" filled":""}" data-slot="${slot}">`
            + (c ? esc(c.title) : "") + `</button>`;
    }
  }
  $("#mpGrid").innerHTML = html;
  $("#mpGrid").querySelectorAll(".mpCell").forEach(b => b.onclick = () => onCell(b.dataset.slot));
  renderExtra();
}
window.mpRenderTimetable = renderTimetable;

function renderExtra(){
  const tt = rkStore.getTimetable(term);
  if (!tt.extra.length){ $("#mpExtra").innerHTML = ""; return; }
  $("#mpExtra").innerHTML = `<h4>時間割に入らない科目</h4>` + tt.extra.map(id => {
    const c = BY_ID.get(id);
    return `<div class="mpExtraRow"><span>${c ? esc(c.title) : id}</span>
      <button data-rm="${esc(id)}">外す</button></div>`;
  }).join("");
  $("#mpExtra").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    rkStore.removeExtra(term, b.dataset.rm); renderTimetable();
  });
}

function onCell(slot){
  const tt = rkStore.getTimetable(term);
  if (tt.slots[slot]){
    /* 埋まっているマスは外す。確認は出さない ―― 1タップで戻せるので。 */
    rkStore.clearSlot(term, slot);
    renderTimetable();
    return;
  }
  openPicker(slot);
}

function openPicker(slot){
  const list = COURSES.filter(c => inTerm(c) && (c.slots || []).includes(slot));
  $("#mpPickerTitle").textContent = `${slot} の科目`;
  $("#mpPickerList").innerHTML = list.length
    ? list.map(c => `<button class="mpPick" data-id="${esc(c.id)}">
        <b>${esc(c.title)}</b><small>${esc(c.instructor || "―")}</small></button>`).join("")
    : `<p>この学期の ${slot} に科目がありません。</p>`;
  $("#mpPickerList").querySelectorAll(".mpPick").forEach(b => b.onclick = () => {
    putCourse(b.dataset.id, slot);
    $("#mpPicker").close();
  });
  $("#mpPicker").showModal();
}

/* 1科目が複数コマを持つとき（金4・金5・金6 の実験など）は全部のマスを埋める。
   1つだけ埋めると、残りのコマが空いているように見えてしまう。 */
function putCourse(id, slot){
  const c = BY_ID.get(id);
  const slots = (c && c.slots && c.slots.length) ? c.slots : [slot];
  for (const s of slots) rkStore.setSlot(term, s, id);
  renderTimetable();
}
window.mpPutCourse = putCourse;

```

`$("#mpPickerClose").onclick = () => $("#mpPicker").close();` を `boot()` に足す。

- [ ] **Step 5: CSS を足す**

```css
.mpTerms{ display:flex; gap:8px; margin:0 0 12px; }
.mpGrid{ display:grid; grid-template-columns:2em repeat(5,1fr); gap:3px; }
.mpH{ font-size:11px; color:#888; text-align:center; padding:4px 0; }
.mpCell{
  min-height:52px; border:1px solid #e6e6e6; border-radius:6px;
  background:#fafafa; font-size:10px; line-height:1.3; padding:4px;
  cursor:pointer; overflow:hidden; word-break:break-all;
}
.mpCell.filled{ background:var(--brand); color:#fff; border-color:var(--brand); }
#mpPicker{ border:0; border-radius:14px; padding:20px; max-width:420px; width:90vw; }
#mpPicker::backdrop{ background:rgba(0,0,0,.45); }
.mpPick{ display:block; width:100%; text-align:left; padding:10px;
  border:1px solid #eee; border-radius:8px; background:#fff; margin:0 0 6px; cursor:pointer; }
.mpPick small{ display:block; color:#888; font-size:11px; margin-top:2px; }
#mpPickerList{ max-height:50vh; overflow-y:auto; margin:0 0 12px; }
.mpExtraRow{ display:flex; justify-content:space-between; align-items:center;
  padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:13px; }
```

- [ ] **Step 6: 通ることを確かめる**

```bash
cd web && python3 -m http.server 8140 &
node tools/test_mypage.mjs http://localhost:8140
kill %1
```

- [ ] **Step 7: commit**

```bash
git add web/mypage.html web/assets/mypage.js web/assets/mypage.css tools/test_mypage.mjs
git commit -m "feat(web): マイページに私の時間割を足す"
```

---

### Task 7: お気に入りと時間割をつなぐ

星は「候補」、コマに入れて「確定」。曜限を持たない 1,069件も星は付けられる
ので、そちらは `extra` へ入れる。

**Files:**
- Modify: `web/assets/mypage.js`
- Modify: `web/assets/mypage.css`
- Modify: `tools/test_mypage.mjs`

**Interfaces:**
- Consumes: `rkStore.getFavorites()` / `toggleFavorite`（Task 2）、
  `window.mpPutCourse(id, slot)` / `window.mpRenderTimetable()`（Task 6）
- Produces: なし（Phase 1 の最後）

- [ ] **Step 1: テストを足す（`tools/test_mypage.mjs` の末尾）**

```js
// ── お気に入り → 時間割 ──────────────────────
await page.evaluate(() => {
  localStorage.setItem("rk_favorites",
    JSON.stringify({ v:1, ids:{ "137094": Date.now() } }));   // 木6・haru
});
await page.reload();
await page.waitForSelector("#mpFavList .mpFav");
check(await page.locator("#mpFavList .mpFav").count() === 1, "お気に入りが出ない");

// 木6 は春学期。秋学期のままだと入れられない旨が出ること
await page.click("[data-term='haru']");
await page.click("#mpFavList .mpFav [data-add='137094']");
let tt2 = JSON.parse(await page.evaluate(() => localStorage.getItem("rk_timetable")));
check(tt2.haru.slots["木6"] === "137094", "お気に入りから時間割に入らない");

// 外すと一覧から消える
await page.click("#mpFavList .mpFav [data-fav='137094']");
check(await page.locator("#mpFavList .mpFav").count() === 0, "お気に入りを外せない");
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_mypage.mjs http://localhost:8140`
Expected: FAIL（`#mpFavList .mpFav` の timeout）

- [ ] **Step 3: `mypage.js` にお気に入り節を足す**

`boot()` の末尾に `renderFavorites();` を足し、
`renderTimetable()` の末尾にも `renderFavorites();` を足す
（コマが埋まると「入れる」ボタンの出方が変わるため）。

```js
function renderFavorites(){
  const ids = rkStore.getFavorites();
  if (!ids.length){
    $("#mpFavList").innerHTML =
      `<p class="mpEmpty">まだありません。科目の一覧で ☆ を押すと、ここに溜まります。</p>`;
    return;
  }
  const tt = rkStore.getTimetable(term);
  $("#mpFavList").innerHTML = ids.map(id => {
    const c = BY_ID.get(id);
    if (!c) return `<div class="mpFav"><span>${esc(id)}（この学期のデータにありません）</span>
      <button data-fav="${esc(id)}">☆ 外す</button></div>`;

    const slots = c.slots || [];
    let action;
    if (!slots.length){
      /* 曜限がマスに置けない 1,069件（集中講義・土曜）。extra へ。 */
      const inExtra = tt.extra.includes(id);
      action = inExtra
        ? `<span class="mpIn">時間割に入っています</span>`
        : `<button data-addextra="${esc(id)}">時間割に入れる</button>`;
    } else if (!inTerm(c)){
      action = `<span class="mpNote">${term==="aki"?"春・夏":"秋・冬"}学期の科目です</span>`;
    } else {
      const already = slots.every(s => tt.slots[s] === id);
      const busy = slots.filter(s => tt.slots[s] && tt.slots[s] !== id);
      action = already
        ? `<span class="mpIn">時間割に入っています</span>`
        : `<button data-add="${esc(id)}"${busy.length?' data-busy="1"':""}>時間割に入れる</button>`;
    }
    return `<div class="mpFav">
      <span><b>${esc(c.title)}</b><small>${esc(c.day_period || "曜限なし")}
        ・${esc(c.instructor || "―")}</small></span>
      <span class="mpFavActions">${action}
        <button data-fav="${esc(id)}">☆ 外す</button></span>
    </div>`;
  }).join("");

  $("#mpFavList").querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const id = b.dataset.add;
    const c = BY_ID.get(id);
    /* 既に別の科目が入っているコマがあるときだけ確認する。
       黙って上書きすると、組んだ時間割が理由も分からず変わる。 */
    if (b.dataset.busy){
      const tt2 = rkStore.getTimetable(term);
      const names = (c.slots || [])
        .filter(s => tt2.slots[s] && tt2.slots[s] !== id)
        .map(s => `${s}：${(BY_ID.get(tt2.slots[s]) || {}).title || tt2.slots[s]}`);
      if (!confirm(`次のコマを上書きします。\n\n${names.join("\n")}\n\nよろしいですか？`)) return;
    }
    mpPutCourse(id, (c.slots || [])[0]);
  });
  $("#mpFavList").querySelectorAll("[data-addextra]").forEach(b => b.onclick = () => {
    rkStore.addExtra(term, b.dataset.addextra);
    renderTimetable();
  });
  $("#mpFavList").querySelectorAll("[data-fav]").forEach(b => b.onclick = () => {
    rkStore.toggleFavorite(b.dataset.fav);
    renderFavorites();
  });
}
```

> `renderTimetable()` が `renderFavorites()` を呼び、`renderFavorites()` の
> ボタンが `mpPutCourse()` → `renderTimetable()` を呼ぶ。**再帰しない**のは
> `mpPutCourse` が `renderTimetable` を1回呼ぶだけで、
> `renderFavorites` からは `renderTimetable` を直接呼ばないため。
> ここに `renderFavorites` から `renderTimetable` を足すと無限ループになる。

- [ ] **Step 4: CSS を足す**

```css
.mpFav{ display:flex; justify-content:space-between; align-items:center; gap:12px;
  padding:12px 0; border-bottom:1px solid #f0f0f0; font-size:14px; }
.mpFav small{ display:block; color:#888; font-size:11px; margin-top:2px; }
.mpFavActions{ display:flex; gap:6px; flex-shrink:0; }
.mpFavActions button{ padding:6px 10px; font-size:12px; border:1px solid #ddd;
  border-radius:6px; background:#fff; cursor:pointer; white-space:nowrap; }
.mpIn, .mpNote{ font-size:11px; color:#888; align-self:center; white-space:nowrap; }
.mpEmpty{ font-size:13px; color:#888; }
```

- [ ] **Step 5: 全部通ることを確かめる**

```bash
cd web && python3 -m http.server 8140 &
node tools/test_periods.mjs
node tools/test_store.mjs
node tools/test_favorite.mjs http://localhost:8140
node tools/test_onboard.mjs http://localhost:8140
node tools/test_mypage.mjs http://localhost:8140
for f in tools/test_*.py; do python3 "$f" >/dev/null || echo "FAIL $f"; done
kill %1
```
Expected: 全部 `OK` / `FAIL` の行が出ないこと

- [ ] **Step 6: commit**

```bash
git add web/assets/mypage.js web/assets/mypage.css tools/test_mypage.mjs
git commit -m "feat(web): お気に入りから時間割に入れられるようにする"
```

---

### Task 8: LINE bot の問診をサイトと揃える

サイト側は「降りるのは問診そのもの、設問ごとではない」に決めた。
bot はいま `worker/index.js:180` で「答えたくない」を**学年の設問の中**に
置いており、線が違う。あわせて**学部の設問を足す**。

**Files:**
- Modify: `worker/index.js`（`gradeQuestionMessage` / `handlePostback` / 新 `facultyQuestionMessage`）
- Create: `tools/test_bot_flow.mjs`

**Interfaces:**
- Consumes: なし（Worker 側だけで閉じる）
- Produces: postback の `data` が `action=preset&grade=2&fac=law&preset=…` の形になる

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_bot_flow.mjs`:

```js
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
check(r1.message && labels(r1.message).includes("法学部"),
      "学年のあとに学部を聞いていない");
const r2 = mod.handlePostback(null, "action=faculty&grade=2&fac=law", "https://example.test");
check(r2.message && labels(r2.message).includes("GPA重視"),
      "学部のあとに優先度を聞いていない");
check(JSON.stringify(r2.message).includes("fac=law"),
      "学部が次の postback に引き継がれていない");

console.log(fails.length ? `NG ${fails.length}/${n}` : `OK ${n} checks`);
for (const f2 of fails) console.log("  -", f2);
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `node tools/test_bot_flow.mjs`
Expected: FAIL（`mod.facultyQuestionMessage is not a function` ほか）

- [ ] **Step 3: `worker/index.js` を直す**

学部の一覧を定数で置く。**Worker は `requirements.json` を
`env.ASSETS` 経由で読めるが、問診の選択肢に必要なのは
`key` と `label` の11組だけで、そのために 200KB を毎回読むのは重い。
ここは表示用の写しとして持ち、`tools/test_bot_flow.mjs` が
`requirements.json` と一致しているかを見張る**（Step 5 で足す）。

```js
const FACULTIES = [
  ["letters","文学部"], ["human-sci","人間科学部"], ["law","法学部"],
  ["economics","経済学部"], ["foreign-s","外国語学部"], ["science","理学部"],
  ["medicine","医学部"], ["dentistry","歯学部"], ["pharmacy","薬学部"],
  ["engineering","工学部"], ["engr-sci","基礎工学部"],
];
```

`gradeQuestionMessage()` から「答えたくない」を外す（`worker/index.js:180`）:

```js
export function gradeQuestionMessage() {
  const items = [1, 2, 3, 4, 5, 6].map((g) =>
    qrPostback(`${g}年`, `action=grade&grade=${g}`, `${g}年です`)
  );
  return {
    type: "text",
    text: "今何年生？",
    quickReply: { items },
  };
}

/* 学部。降り口はここには置かない ―― 降りるのは greeting の
   「とにかく楽単を知りたい」1箇所だけ、というのがサイト側と揃えた線。
   quick reply の上限は13件なので、11学部はそのまま入る。 */
export function facultyQuestionMessage(grade) {
  return {
    type: "text",
    text: "学部はどこ？",
    quickReply: {
      items: FACULTIES.map(([key, label]) =>
        qrPostback(label, `action=faculty&grade=${grade}&fac=${key}`, label)
      ),
    },
  };
}
```

`presetQuestionMessage` に学部を通す:

```js
export function presetQuestionMessage(grade, fac) {
  const items = PRESET_NAMES.map((name) =>
    qrPostback(name,
      `action=preset&grade=${grade}&fac=${encodeURIComponent(fac || "")}&preset=${encodeURIComponent(name)}`,
      name)
  );
  return { type: "text", text: "何を優先する？", quickReply: { items } };
}
```

`handlePostback` に学部の段を足す:

```js
  if (action === "grade") {
    const grade = params.get("grade") || "1";
    return { message: facultyQuestionMessage(grade) };
  }
  if (action === "faculty") {
    const grade = params.get("grade") || "1";
    return { message: presetQuestionMessage(grade, params.get("fac") || "") };
  }
```

> **学部はいまの推薦結果には効かない。** `preset_top` は学年だけで引いている。
> それでも聞くのは、サイト側の問診と同じことを聞いておかないと
> Phase 2 で合流したときに片方だけ空になるから。
> **推薦のロジックには一切入れない**（数字の出所を増やさない）。

- [ ] **Step 4: 通ることを確かめる**

Run: `node tools/test_bot_flow.mjs`
Expected: `OK 9 checks`

- [ ] **Step 5: 学部の写しがずれないよう見張りを足す**

`tools/test_bot_flow.mjs` の末尾（`console.log` の前）:

```js
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
```

Run: `node tools/test_bot_flow.mjs`
Expected: `OK 11 checks`

- [ ] **Step 6: commit**

```bash
git add worker/index.js tools/test_bot_flow.mjs
git commit -m "feat(line): botの問診に学部を足し、降り口をgreetingだけに揃える"
```

---

## 仕上げ

- [ ] **全テストを流す**

```bash
cd web && python3 -m http.server 8140 &
node tools/test_periods.mjs
node tools/test_store.mjs
node tools/test_bot_flow.mjs
node tools/test_favorite.mjs http://localhost:8140
node tools/test_onboard.mjs http://localhost:8140
node tools/test_mypage.mjs http://localhost:8140
for f in tools/test_*.py; do python3 "$f" >/dev/null || echo "FAIL $f"; done
kill %1
```

- [ ] **`HANDOFF.md` の先頭に引き継ぎ4項目を書く**（`CLAUDE.md` の最重要規則）

- [ ] **PR を出す**。スクショ差分 CI がグリッドの6行化とマイページを写す

- [ ] **`README.md` のファイル担当表に新しい4ファイルを足す**
      （`store.js` / `onboard.js` / `mypage.js` / `mypage.css`）
