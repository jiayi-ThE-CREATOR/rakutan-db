# 口コミを中央モーダルへ（PR-1）実装計画

> **エージェントで進める場合：** 必須サブスキル `superpowers:subagent-driven-development`
> （推奨）または `superpowers:executing-plans` を使い、タスク単位で進めること。
> 手順は `- [ ]` のチェックボックスで追える形にしてある。

**ゴール:** 口コミを科目詳細から出し、PC・スマホ共通の中央モーダル1つに集約する。
一覧カードの下端に「読む・書く・時間割」の操作バーを足し、詳細からは口コミ節と
操作ボタンを外す。

**方針:** 既存の `#panel`（いまはスマホ＝下からのシート／PC＝右カラムにインライン展開の
2形態）を、**上下中央のモーダル1形態**に統一する。組み立てる関数（`reviewHtml`・
`panelListHtml`）は1本のまま、差し込み先だけを1箇所に減らす。クラス名も
`.rv` / `.rvf` / `.pEntry` を作り直して使い、新しい名前は最小限にする。

**技術:** 素の JS（ビルド無し）・CSS カスタムプロパティ・Playwright（`tools/*.mjs`）・
Python（`tools/*.py`）。フレームワークもテストランナーも無い。各テストは単体で実行する
スクリプト。

**Spec:** `docs/plans/2026-09-06-kuchikomi-modal-design.md`

## 全体の制約

- **`web/assets/app.css` に裸の色を書かない。** `#xxxxxx` も `rgba()` も
  `tools/test_tokens.py` が落とす。色は必ず `var(--*)`
- **新しい色の組み合わせを使ったら `tools/test_tokens.py` の `CONTRAST` に1行足す。**
  登録し忘れた組み合わせは誰にも検査されないまま本番へ出る
- **字の大きさもトークンで。** 使えるのは `--fs-xs:11.5px` / `--fs-sm:13px` /
  `--fs-base:15px` / `--fs-lg:17px`。**14px や 12px の新トークンは足さない**
- **余白は `--sp-1:4px` 〜 `--sp-8:64px`、角丸は `--r-xs/sm/md/lg/pill`**
- `.head` は `role="button"`。**その中に押せる要素を入れない。** 新しいボタンは
  `.head` の兄弟として置く（`.favBtn` と同じ扱い）
- **`detailHtml` は1本のまま。** PC 用とスマホ用に分けない
  （`tools/test_layout.py` が本数を数えている）
- 作業ツリーは `.worktrees/kuchimodal`（ブランチ `feat/kuchikomi-modal`）。
  **`git commit` の前に `git rev-parse --abbrev-ref HEAD` で確認する**
- テスト用サーバは `python3 server.py --port 8794`。**API モードになるので
  `CAN_POST=true`**（本番の静的配信とは違う）。静的配信で確かめたいときは
  `cd web && python3 -m http.server 8795`

---

## ファイルの担当

| ファイル | この PR での役割 |
|---|---|
| `web/index.html` | `#panel` を `.sheet` の使い回しから外し、中央モーダルの器にする（副題と固定フッタを足す） |
| `web/assets/app.js` | カードの操作バー・詳細の痩身・`openPanel` の一本化 |
| `web/assets/app.css` | `.cardActs` / `.rvBtn` / `.wrBtn` を新設、`.rv` / `.rvf` / `.pEntry` を作り直し、`.rvb` / `.rvn` / `.panelBtn` を削除 |
| `tools/test_kuchikomi_modal.mjs` | **新規**。この PR の振る舞いを固定する |
| `tools/test_layout.py` | 「詳細に口コミが無い」の判定を足す |
| `tools/test_tokens.py` | `CONTRAST` に1行足す |
| `docs/version-pending.md` | 利用者向けの3行 |
| `HANDOFF.md` | 実測値（正味のカード増分・描画時間）を残す |

`web/assets/kuchikomi.js` は **PR-2** で触る。この PR では触らない。

---

## Task 1: 中央モーダルの器

`#panel` を上下中央のモーダルにする。この時点では中身も入口も従来のまま
（詳細の `.panelBtn` から開く）。**器だけを差し替えて、開閉が壊れていないことを先に固める。**

**Files:**
- Modify: `web/index.html:272-280`（`#panel` のマークアップ）
- Modify: `web/assets/app.css`（`.panelHead` / `.panelClose` の周り・`#panel` 用の規則を新設）
- Modify: `web/assets/app.js`（`openPanel` / `panelSetOpen` / `panelBtnFor`）
- Test: `tools/test_kuchikomi_modal.mjs`（新規）

**Interfaces:**
- Consumes: 既存の `findCourse(id)` / `panelListHtml(id)` / `?c=` の履歴まわり
- Produces:
  - DOM: `#panel.kModal`（開いているとき `.open`）、`#panel > .kBox`、
    `#panelTitle`、`#panelSub`、`#panelBody`、`#panelClose`、`#panelWrite`
  - `openPanel(id, push = true) -> Promise<void>`（画面幅で分岐しない）
  - `panelSetOpen(open: boolean) -> void`（`open === false` のときだけ働く。従来どおり）

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_kuchikomi_modal.mjs` を新規作成：

```javascript
/* 口コミの中央モーダル。PC・スマホで同じ形になっていることを固定する。
 *   node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
 * 口コミ4件の科目 135327 を使う。件数が変わってもテストが落ちないよう、
 * 件数そのものは data から読んで期待値にする。 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:8794";
const ID = "135327";
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

const browser = await chromium.launch();

async function page(w, h){
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => {
    try { localStorage.setItem("rk_onboarded", "1"); } catch (e) {}
    try { sessionStorage.setItem("rk_splash_seen", "1"); } catch (e) {}
  });
  return p;
}

/* 幅を2つとも見る。「PC とスマホで同じ形」がこの PR の約束なので、
   片方だけ通っても意味がない。 */
for (const [label, w, h] of [["スマホ", 390, 844], ["PC", 1280, 900]]){
  const p = await page(w, h);
  await p.goto(`${base}/?c=${ID}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#panel.open", { timeout: 15000 });

  const box = await p.evaluate(() => {
    const el = document.querySelector("#panel .kBox");
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: window.innerHeight - r.bottom,
             left: r.left, right: window.innerWidth - r.right,
             width: r.width };
  });

  /* 上下中央：上下の余白の差が 40px 以内。下からのシート（top が大きく
     bottom が 0）に戻ったらここで落ちる。 */
  check(Math.abs(box.top - box.bottom) <= 40,
        `[${label}] モーダルが上下中央にない（上 ${Math.round(box.top)} / 下 ${Math.round(box.bottom)}）`);
  check(Math.abs(box.left - box.right) <= 2,
        `[${label}] モーダルが左右中央にない（左 ${Math.round(box.left)} / 右 ${Math.round(box.right)}）`);
  check(box.width <= 560 + 1, `[${label}] モーダルが 560px より広い（${Math.round(box.width)}px）`);

  /* 閉じる手段3つ。どれも ?c= が URL から消えること。 */
  await p.click("#panelClose");
  await p.waitForTimeout(300);
  check(!new URL(p.url()).searchParams.get("c"), `[${label}] ✕ で ?c= が消えない`);
  check(!(await p.evaluate(() => document.querySelector("#panel").classList.contains("open"))),
        `[${label}] ✕ でモーダルが閉じない`);

  await p.close();
}

await browser.close();
console.log(fails.length ? "NG" : `OK ${new Date().toISOString().slice(0,10)}`);
for (const f of fails) console.log("  -", f);
process.exit(fails.length ? 1 : 0);
```

- [ ] **Step 2: 落ちることを確かめる**

```bash
cd ~/Developer/rakutan-db/.worktrees/kuchimodal
python3 server.py --port 8794 &
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
```

期待：`NG` ―― スマホ幅で「モーダルが上下中央にない」（いまは下からのシート）、
PC 幅で `#panel.open` が現れずタイムアウト（いまは右カラムにインライン展開するので
`#panel` は開かない）。

- [ ] **Step 3: `#panel` のマークアップを差し替える**

`web/index.html` の **265-280 行**（`<!-- 口コミを1件ずつ読むシート（スマホ用）。` の
コメント段落から `</div>` まで）を丸ごと置き換える。**古いコメントも一緒に消すこと**
―― 「PC では右カラムの詳細の下に展開する」「投稿フォームと同じ .sheet を使い回している」
はどちらも、この変更で嘘になる：

```html
<!-- 口コミの中央モーダル。投稿フォーム（#sheet）と器を共有しない
     ―― あちらは下からのシートのままなので、.sheet を使い回すと
     片方を直したときにもう片方が動く（2026-09-06）。 -->
<div class="kModal" id="panel">
  <div class="kBox" role="dialog" aria-modal="true" aria-labelledby="panelTitle">
    <div class="kHead">
      <div class="kHeadT">
        <h3 id="panelTitle"></h3>
        <p id="panelSub"></p>
      </div>
      <button class="kClose" id="panelClose" aria-label="口コミを閉じる">✕</button>
    </div>
    <div id="panelBody" class="kBody"></div>
    <div class="kFoot">
      <a class="kWrite" id="panelWrite" href="/kuchikomi">この科目の口コミを書く</a>
    </div>
  </div>
</div>
```

`.open` を付け外しする既存のやり方は変えない（`classList.add/remove("open")` のまま）。

- [ ] **Step 4: CSS を足す**

`web/assets/app.css` の `.panelHead` / `.panelClose` の規則（`.empty` の直前）を
次で置き換える：

```css
/* ── 口コミの中央モーダル（2026-09-06）──────────
   PC・スマホで同じ形にする。以前は幅で2形態に分かれていた
   （スマホ＝下からの全画面シート／PC＝右カラムの集計と差し替え）。
   PC の差し替えは「右カラムが 926px → 1,376px になって
   『時間割に追加』が枠の外へ出る」ことへの対処だったが、
   その操作をカードの操作バーへ移したので前提ごと無くなった。 */
.kModal{position:fixed;inset:0;background:var(--scrim);z-index:30;display:none;
  place-items:center;padding:var(--sp-4)}
.kModal.open{display:grid}
.kBox{display:flex;flex-direction:column;width:min(560px,100%);
  max-height:min(82vh,680px);background:var(--card);border-radius:var(--r-lg);
  box-shadow:0 18px 48px var(--shadow-modal);overflow:hidden}
.kHead{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--sp-3);
  padding:var(--sp-4) var(--sp-4) var(--sp-3);border-bottom:1px solid var(--rule);flex:none}
.kHeadT{flex:1;min-width:0}
.kHeadT h3{margin:0;font-size:var(--fs-lg);line-height:1.4}
.kHeadT p{margin:var(--sp-1) 0 0;font-size:var(--fs-sm);color:var(--muted)}
.kClose{flex:none;width:34px;height:34px;border:none;border-radius:var(--r-pill);
  background:var(--dim);color:var(--soft);font:inherit;font-size:var(--fs-base);
  line-height:1;cursor:pointer}
/* 本文だけが伸びる。見出しと下のボタンは常に見える。 */
.kBody{flex:1;overflow-y:auto;padding:0 var(--sp-4);-webkit-overflow-scrolling:touch}
.kFoot{flex:none;padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--rule)}
/* 読み終わった直後がいちばん書きたい瞬間なので、ここに置く。
   <a> なのは別タブで開けるようにするため（投稿は別ページ）。 */
.kWrite{display:block;text-align:center;padding:var(--sp-3);border-radius:var(--r-md);
  background:var(--brand);color:var(--brand-ink);text-decoration:none;
  font-size:var(--fs-sm);font-weight:700}
```

- [ ] **Step 5: `openPanel` / `panelSetOpen` から画面幅の分岐を外す**

`web/assets/app.js`。まず `panelBtnFor` の定義（`const panelBtnFor = id =>` の3行と
その上のコメント）を**削除**する。次に `panelSetOpen` を置き換える：

```javascript
/* 閉じるのはここ1箇所だけ。popstate から呼ばれる。 */
function panelSetOpen(open){
  if (open) return;                       // 開くのは openPanel の仕事
  $("#panel").classList.remove("open");
  $("#panelBody").innerHTML = "";
}
```

`openPanel` を置き換える：

```javascript
async function openPanel(id, push = true){
  const c = await findCourse(id);
  if (!c) return;

  if (push){
    const url = new URL(location.href);
    url.searchParams.set("c", id);
    history.pushState({ panelCourse: id }, "", url);
  }

  const n = c.reviews?.n || 0;
  $("#panelTitle").textContent = c.title;
  $("#panelSub").textContent = `口コミ ${n}件 ― 実際に取った人が書いたもの`;
  $("#panelWrite").href = `/kuchikomi?c=${encodeURIComponent(id)}`;
  $("#panelBody").innerHTML = await panelListHtml(id);
  $("#panel").classList.add("open");
  $("#panelBody").scrollTop = 0;
}
```

- [ ] **Step 6: テストが通ることを確かめる**

```bash
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
```

期待：`OK`

- [ ] **Step 7: 既存テストが壊れていないことを確かめる**

```bash
node tools/smoke.mjs http://127.0.0.1:8794
node tools/test_index_gate.mjs http://127.0.0.1:8794
node tools/test_inspector_center.mjs http://127.0.0.1:8794
python3 tools/test_layout.py
python3 tools/test_tokens.py
python3 tools/test_shell_inject.py
```

期待：全部 OK。`test_tokens.py` は `--shadow-modal` を使ったので通るはず
（裸の `rgba()` を書いていないこと）。

- [ ] **Step 8: コミット**

```bash
git rev-parse --abbrev-ref HEAD    # feat/kuchikomi-modal であること
git add web/index.html web/assets/app.css web/assets/app.js tools/test_kuchikomi_modal.mjs
git commit -m "feat(web): 口コミを上下中央のモーダルに統一する

PC の右カラムへのインライン展開をやめ、スマホの下からのシートも中央へ寄せる。
2026-09-01 にインライン展開にしたのは「右カラムが 1,376px になって
時間割に追加が枠の外へ出る」ためだったが、その操作はこのあと
カードの操作バーへ移すので前提ごと無くなる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: モーダルの中身（集計を上に・字を大きく）

**Files:**
- Modify: `web/assets/app.js`（`reviewHtml` / `panelEntry`）
- Modify: `web/assets/app.css`（`.rv` / `.rvf` / `.pEntry` 系、`.rvn` を削除）
- Modify: `tools/test_tokens.py`（`CONTRAST` に1行）
- Test: `tools/test_kuchikomi_modal.mjs`（追記）

**Interfaces:**
- Consumes: Task 1 の `#panelBody`
- Produces:
  - `reviewHtml(c) -> string` ―― **モーダルの「みんなの平均」専用**になる。
    一言3件（`.rvn`）は出さない。返す DOM は `.rv > .rvf > span > (i, b)` と `.bandNote`
  - `panelEntry(row) -> string` ―― `.pEntry > (.pYear, .pNote, .pFacts > span)`。
    **本文が属性より先**

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_kuchikomi_modal.mjs` の、幅を回すループの中（`await p.click("#panelClose")` の**前**）に足す：

```javascript
  /* 字の大きさ。「読みやすくした」を回帰させないために実測で固定する。
     いまの本文は 13px、集計の数字は 11.5px。 */
  const type = await p.evaluate(() => {
    const px = (el, prop) => el ? parseFloat(getComputedStyle(el)[prop]) : 0;
    const note = document.querySelector("#panelBody .pNote");
    const val  = document.querySelector("#panelBody .rvf b");
    return { note: px(note, "fontSize"),
             lh:   px(note, "lineHeight") / (px(note, "fontSize") || 1),
             val:  px(val, "fontSize"),
             /* 本文が属性より前にあること（DOM 順） */
             noteBeforeFacts: !!(note && note.compareDocumentPosition(
               note.parentElement.querySelector(".pFacts")) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  check(type.note >= 15, `[${label}] 口コミ本文が 15px 未満（${type.note}px）`);
  check(type.lh >= 1.75, `[${label}] 口コミ本文の行高が 1.75 未満（${type.lh.toFixed(2)}）`);
  check(type.val >= 15, `[${label}] 集計の数字が 15px 未満（${type.val}px）`);
  check(type.noteBeforeFacts, `[${label}] 口コミ本文が属性より後ろにある`);

  /* 集計がモーダルの中にあること（詳細から移したので、こちらに無いと消えたことになる） */
  check(await p.$("#panelBody .rvf"), `[${label}] モーダルに集計（.rvf）が無い`);
```

- [ ] **Step 2: 落ちることを確かめる**

```bash
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
```

期待：`NG` ―― 「モーダルに集計（.rvf）が無い」（いまは詳細側にしか無い）、
「口コミ本文が 15px 未満（13px）」。

- [ ] **Step 3: `reviewHtml` から一言3件を外し、値を `<b>` で包む**

`web/assets/app.js` の `reviewHtml` を置き換える（上のコメント群はそのまま残す）：

```javascript
/* 口コミの集計（モーダルの先頭）。詳細には出さない ―― 詳細に出していた
   一言3件（.rvn）は、モーダルに全件が1件ずつ出るので重複になる。
   値を <b> で包むのは、ラベルより数字を大きくするため（CSS 側で効かせる）。 */
function reviewHtml(c){
  const r = c.reviews;
  if (!r || !r.n) return "";
  const f = [["出席", rvAvg(r.attendance)],
             ["授業中の課題", rvAvg(r.in_class)],
             ["授業外の課題", rvAvg(r.out_class)]];
  if (r.exam_hard10 != null) f.push(["テストの難易度", `${r.exam_hard10} / 10`]);
  /* 「その他（持ち帰り形式）」等は 可／不可 に畳むと情報が落ちるので、
     畳んだ値に原文を添えて出す ―― 「可（持ち帰り形式）」。 */
  if (r.exam_bring){
    const m = (r.exam_bring_raw || "").match(/^その他[（(](.+)[）)]$/);
    f.push(["持ち込み", m ? `${r.exam_bring}（${m[1]}）` : r.exam_bring]);
  }
  if (r.report_words)        f.push(["レポート", `1本あたり約${r.report_words.toLocaleString()}字`]);
  /* 値が長いものは2列に割ると折り返して2行になるので、1行ぶん使い切る。 */
  const cell = ([k, v]) =>
    `<span${String(v).length > 9 ? ` class="w"` : ""}><i>${esc(k)}</i><b>${esc(v)}</b></span>`;
  return `<div class="rv">
      <div class="rvf">${f.map(cell).join("")}</div>
      <span class="bandNote">数字は${r.n}件の平均。出席は 0 なし〜2 毎回、課題は 0 軽い〜2 重い${
        r.conflicts?.length ? "。<b>答えが割れている項目があります</b>ので、下の1件ずつを読んでください" : ""}</span>
    </div>`;
}
```

- [ ] **Step 4: `panelEntry` を「本文が先」に組み替える**

同じファイルの `panelEntry` を置き換える：

```javascript
/* null は「―」のまま出す。埋めると「無回答だった」という情報が消える。
   並びは 受講年 → 本人が書いた一言 → 選択式の答え（2026-09-06）。
   以前は選択式が先だったので、読みたい一言に届く前に
   「出席 毎回 ／ 授業中の課題 ― ／ 授業外の課題 ―」を読まされていた。 */
function panelEntry(row){
  const curYear = new Date().getFullYear();
  const yearLabel = row.taken_year == null ? "受講時期不明"
    : row.taken_year_before ? `${row.taken_year}年以前に受講` : `${row.taken_year}年受講`;
  const age = row.taken_year == null ? 0 : curYear - row.taken_year;
  const old = row.taken_year != null && age >= 3;

  const facts = [`出席 ${attFull(row.attendance)}`,
                 `授業中の課題 ${rvLv(row.in_class)}`,
                 `授業外の課題 ${rvLv(row.out_class)}`];
  if (row.exam_hard10 != null) facts.push(`テスト ${row.exam_hard10}/10`);
  if (row.exam_bring)          facts.push(`持ち込み ${row.exam_bring}`);
  if (row.report_words != null) facts.push(`レポート 約${row.report_words.toLocaleString()}字`);

  return `<div class="pEntry">
      <div class="pYear">${esc(yearLabel)}${old ? `<span class="pOld">${age}年前の情報</span>` : ""}</div>
      ${row.note ? `<div class="pNote">${esc(row.note)}</div>` : ""}
      <div class="pFacts">${facts.map(t => `<span>${esc(t)}</span>`).join("")}</div>
    </div>`;
}
```

`.pLine` は使わなくなる。

- [ ] **Step 5: `openPanel` がモーダルに集計を差し込むようにする**

Task 1 の `openPanel` は1件ずつ（`panelListHtml`）しか入れていない。集計を先頭に足す：

```javascript
  $("#panelBody").innerHTML = reviewHtml(c) + await panelListHtml(id);
```

（`reviewHtml` は口コミ0件のとき空文字を返すので、0件の科目でも壊れない。）

- [ ] **Step 6: CSS を作り直す**

`web/assets/app.css`：

1. `.rvn` の規則3つ（`.rvn` / `.rvn li` / `.rvn li::before` / `.rvn li::after`）と、
   その上の「口コミの一言。しゅんやさんの指摘④」コメントを**削除**
   （`.rvb` は Task 3 で markup ごと消すので、ここでは触らない）
2. `.rvf` / `.rvf span` / `.rvf i` を次で置き換える：

```css
/* 集計。モーダルの先頭に置くので、詰めたチップではなく2列の表にする。
   数字（<b>）を --fs-base まで上げる ―― ここが「字が小さい」の
   いちばん強い訴えどころだった（旧 --fs-xs = 11.5px）。 */
.rvf{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);margin:var(--sp-3) 0 var(--sp-2)}
.rvf span{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-2);
  background:var(--dim);border-radius:var(--r-sm);padding:var(--sp-2) var(--sp-3)}
.rvf i{font-style:normal;font-size:var(--fs-sm);color:var(--soft)}
.rvf b{font-family:var(--data);font-size:var(--fs-base);color:var(--ink)}
/* 値が長いもの（レポートの字数など）は2列に割らない。 */
.rvf span.w{grid-column:1/-1}
```

3. `.pLine` の規則を**削除**し、`.pNote` を置き換えて `.pFacts` を足す：

```css
/* 本人が書いた一言。ここだけが自由記述で、KOAN にも集計にも出てこない情報。
   モーダルの主役なので、いちばん大きくする（旧 --fs-sm = 13px）。 */
.pNote{font-size:var(--fs-base);line-height:1.8;color:var(--ink);
  margin:var(--sp-2) 0 var(--sp-3)}
/* 選択式の答え。一言の添え書きなので、一言より弱くする。 */
.pFacts{display:flex;flex-wrap:wrap;gap:var(--sp-1)}
.pFacts span{font-size:var(--fs-sm);color:var(--soft);background:var(--dim);
  border-radius:var(--r-sm);padding:3px var(--sp-2)}
```

4. `.pEntry` の区切りを破線から実線にする（モーダルの中で1件ずつが太くなるため）：

```css
.pEntry{padding:var(--sp-4) 0;border-bottom:1px solid var(--rule)}
```

- [ ] **Step 7: `CONTRAST` に組み合わせを1行足す**

`tools/test_tokens.py` の `CONTRAST` の `("案内帯（.note）", ...)` の次に足す：

```python
    # 集計の数字。--dim の上に --ink（2026-09-06 のモーダル化で足した組み合わせ）。
    ("集計の数字",                  "--ink",              "--dim",              4.5),
```

- [ ] **Step 8: テストが通ることを確かめる**

```bash
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
python3 tools/test_tokens.py
```

期待：両方 OK。`test_tokens.py` は「通過 N 件」の N が2つ増える。

- [ ] **Step 9: 目で1回見る**

```bash
node -e '
import("playwright").then(async ({chromium}) => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  await p.addInitScript(()=>{try{localStorage.setItem("rk_onboarded","1");sessionStorage.setItem("rk_splash_seen","1");}catch(e){}});
  await p.goto("http://127.0.0.1:8794/?c=135327",{waitUntil:"networkidle"});
  await p.waitForSelector("#panel.open"); await p.waitForTimeout(500);
  await p.screenshot({path:"/tmp/kmodal.png"}); await b.close();
});'
open /tmp/kmodal.png
```

見るところ：レポートの「1本あたり約1,500字」が2列に割れて折り返していないか。
一言が数字より大きく見えるか。

- [ ] **Step 10: コミット**

```bash
git rev-parse --abbrev-ref HEAD
git add web/assets/app.js web/assets/app.css tools/test_kuchikomi_modal.mjs tools/test_tokens.py
git commit -m "feat(web): 口コミの集計をモーダルへ移し、本文を 15px にする

一言3件（.rvn）は廃止。モーダルに全件が1件ずつ出るので重複になる。
1件ずつは「受講年 → 本文 → 選択式」の順に組み替えた ―― 以前は
読みたい一言に届く前に「授業中の課題 ―」の並びを読まされていた。

本文 13px/1.6 → 15px/1.8、集計の数字 11.5px → 15px。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: カードの操作バー

**Files:**
- Modify: `web/assets/app.js`（`card()` と `.ttAddBtn` のハンドラ・`.rvBtn` の委譲）
- Modify: `web/assets/app.css`（`.cardActs` / `.rvBtn` / `.wrBtn` / `.ttBtn` を新設）
- Test: `tools/test_kuchikomi_modal.mjs`（追記）

**Interfaces:**
- Consumes: Task 1 の `openPanel(id)`
- Produces:
  - DOM: `.card > .cardActs`（`.head` の**兄弟**）。中に
    `button.rvBtn[data-id]` / `a.wrBtn[href="/kuchikomi?c=<id>"]` /
    `button.ttAddBtn[data-id][aria-pressed]`
  - 口コミ0件の科目では `.rvBtn` の代わりに `a.wrBtn.ghost`（文言つき）が入る

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_kuchikomi_modal.mjs` の**幅ループの外**（ループの後・`await browser.close()` の前）に足す：

```javascript
/* ── カードの操作バー ───────────────────────── */
{
  const p = await page(390, 844);
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await p.waitForSelector(".card");

  const bar = await p.evaluate(() => {
    const card = document.querySelector(".card .cardActs")?.closest(".card");
    if (!card) return null;
    const acts = card.querySelector(".cardActs");
    return {
      /* .head の中に押せる要素を入れない（入れ子ボタンにしない） */
      insideHead: !!card.querySelector(".head .cardActs, .head button, .head a"),
      hasTt: !!acts.querySelector(".ttAddBtn"),
      /* 口コミがある科目なら読むボタン、無ければ書くリンク */
      hasEntry: !!acts.querySelector(".rvBtn, .wrBtn"),
      writeHref: acts.querySelector(".wrBtn")?.getAttribute("href") || "",
      id: card.dataset.id,
    };
  });
  check(bar, "カードに .cardActs が無い");
  if (bar){
    check(!bar.insideHead, ".head の中に押せる要素がある（入れ子ボタン）");
    check(bar.hasTt, "操作バーに .ttAddBtn が無い");
    check(bar.hasEntry, "操作バーに口コミの入口が無い");
    check(bar.writeHref.startsWith(`/kuchikomi?c=${bar.id}`),
          `✎ の href が /kuchikomi?c=<id> でない（${bar.writeHref}）`);
  }

  /* 読むボタンでモーダルが開く。詳細を開かずに、が要件。
     押すカードを id で名指しする ―― 先頭のカードが口コミ0件だと
     .rvBtn がそこに無く、別のカードの状態を見て「通った」ことにしてしまう。 */
  const rvId = await p.evaluate(() =>
    document.querySelector(".card .cardActs .rvBtn")?.closest(".card")?.dataset.id || "");
  const rv = rvId ? await p.$(`.card[data-id="${rvId}"] .cardActs .rvBtn`) : null;
  check(rv, "口コミのある科目に .rvBtn が無い");
  if (rv){
    /* 2行目のプレビュー。1行に収まっていること（省略記号が効くこと）。 */
    const prev = await p.evaluate(id => {
      const s = document.querySelector(`.card[data-id="${id}"] .cardActs .rvBtn small`);
      if (!s) return { none: true };
      return { none: false, text: s.textContent.trim(),
               fits: s.scrollWidth <= s.clientWidth + 1 };
    }, rvId);
    check(prev.none || prev.text.length > 0, "プレビューの2行目が空のまま出ている");
    check(prev.none || prev.fits, "プレビューが1行に収まっていない（省略記号が効いていない）");

    await rv.click();
    await p.waitForTimeout(400);
    check(await p.evaluate(() => document.querySelector("#panel").classList.contains("open")),
          ".rvBtn を押してもモーダルが開かない");
    check(!(await p.evaluate(id =>
            document.querySelector(`.card[data-id="${id}"]`).classList.contains("open"), rvId)),
          ".rvBtn を押すと詳細まで開いてしまう");
  }

  /* 時間割に追加が一覧から押せる */
  await p.evaluate(() => document.querySelector("#panelClose")?.click());
  await p.waitForTimeout(300);
  await p.click(".card .cardActs .ttAddBtn");
  await p.waitForTimeout(300);
  check(await p.evaluate(() =>
          document.querySelector(".card .cardActs .ttAddBtn").getAttribute("aria-pressed") === "true"),
        "一覧の「時間割に追加」を押しても aria-pressed が true にならない");

  await p.close();
}
```

- [ ] **Step 2: 落ちることを確かめる**

```bash
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
```

期待：`NG` ―― 「カードに .cardActs が無い」。

- [ ] **Step 3: `card()` に操作バーを足す**

`web/assets/app.js` の `card()` を置き換える：

```javascript
/* 一覧カードの下端の操作バー（2026-09-06）。
 * 「読む・書く・時間割」をここに集める。詳細を開かないと押せなかった
 * 「時間割に追加」と、2回押さないと届かなかった口コミが1回で届く。
 *
 * .head の**外**に置くこと。.head は role="button" なので、中に入れると
 * 入れ子の押せる要素になる（.favBtn を .card > .favBtn にしてあるのと同じ理由）。
 *
 * プレビュー（2行目）は reviews.notes[0]。notes は publish:false を除いた
 * ぶんしか入っていないので、n > 0 でも notes が空の科目がある
 * ―― そのときは2行目を出さない（空行で 21px 増やさない）。 */
function cardActsHtml(c){
  const n = c.reviews?.n || 0;
  const first = (c.reviews?.notes || [])[0] || "";
  const write = `/kuchikomi?c=${encodeURIComponent(c.id)}`;
  const read = n
    ? `<button class="rvBtn" data-id="${esc(c.id)}" aria-haspopup="dialog">
         <span>💬 口コミ ${n}件を読む ›</span>${
           first ? `<small>「${esc(first)}」ほか</small>` : ""}
       </button>
       <a class="wrBtn" href="${esc(write)}" aria-label="この科目の口コミを書く"
          title="この科目の口コミを書く">✎</a>`
    : `<a class="wrBtn ghost" href="${esc(write)}">✎ 最初の口コミを書く ›</a>`;
  return `<div class="cardActs">${read}
      <button class="ttAddBtn" data-id="${esc(c.id)}" aria-pressed="${rkStore.inTimetable(c)}">
        ${rkStore.inTimetable(c) ? "✓ 時間割に入れた" : "＋ 時間割"}</button>
    </div>`;
}

function card(c){
  const r = c.rakutan, m = c.match;
  const dp = c.day_period || (c.term === "集中" ? "集中" : "—");
  const tags = [...r.tags, ...r.notes];
  const rv = reviewMark(c.reviews);
  const fav = rkStore.isFavorite(c.id);
  return `<article class="card${rv.alert ? " unscored" : ""}" data-id="${esc(c.id)}">
    <div class="head" role="button" tabindex="0">
      <div>
        <h3 class="title"><span class="titleT">${esc(c.title)}</span></h3>
        <div class="meta"><span>${esc(dp)}</span>${insMetaSpan(c)}<span>${esc(c.campus||"—")}</span><span>${esc(c.category)}</span></div>
      </div>
      <div class="fit"><b>${r.overall ?? "—"}</b><small>楽単スコア</small></div>
      <div class="reason"><span class="band b${BAND_CLS[r.band] ?? 0}">${esc(r.band)}</span>${esc(m.reason)}
        ${r.needs_review ? `<span class="bandNote">${esc(needsReviewNote(c))}</span>` : ""}</div>
      ${rv.alert}
      ${tags.length ? `<div class="tags">${tags.slice(0,4).map(t=>`<span class="tag${r.notes.includes(t)?" g":""}">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
    ${cardActsHtml(c)}
    <button class="favBtn" data-id="${esc(c.id)}" aria-pressed="${fav}"
            aria-label="お気に入り：${esc(c.title)}">${fav ? "★" : "☆"}</button>
    <div class="detail"></div>
  </article>`;
}
```

`${rv.badge}` を消したので、`reviewMark` が返す `badge` は使われなくなる。
`reviewMark` 自体は `alert` のために残す（Task 4 で整理する）。

- [ ] **Step 4: CSS を足す**

まず `.rvb` の規則（2行）を**削除**する ―― Step 3 で `${rv.badge}` を出さなくなり、
件数は `.rvBtn` が持つようになるので、宛先の無い規則になる。

そのうえで、`.rvAlert` 系の規則の**直前**に足す：

```css
/* ── カードの操作バー（2026-09-06）──────────────
   .head（role="button"）の外に置く。中に入れると入れ子の押せる要素になる。 */
.cardActs{display:flex;align-items:center;gap:var(--sp-2);
  padding:var(--sp-3) 14px;border-top:1px solid var(--rule);background:var(--paper)}
/* 「口コミ N件を読む」。2行目は先頭の一言。押す理由をここに置く。 */
.rvBtn{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;
  gap:2px;padding:7px var(--sp-3);border:1px solid transparent;border-radius:var(--r-pill);
  background:var(--scale-light-soft);color:var(--scale-light-text);
  font:inherit;font-size:var(--fs-sm);font-weight:700;cursor:pointer;text-align:left}
.rvBtn small{max-width:100%;font-size:var(--fs-xs);font-weight:400;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rvBtn:hover{border-color:currentColor}
/* 書く。読むの隣に置く（読み終わった直後が書きたい瞬間）。
   ラベルは aria-label と title が持つ。 */
.wrBtn{flex:none;display:flex;align-items:center;justify-content:center;
  width:36px;height:34px;border:1px solid var(--rule);border-radius:var(--r-pill);
  background:var(--card);color:var(--brand-text);text-decoration:none;
  font-size:var(--fs-sm)}
.wrBtn:hover{border-color:var(--brand)}
/* 口コミ0件の科目。7,906件のほとんどがこれなので、一覧の既定の見た目になる。
   面を張らず点線にして、口コミのある科目の緑より弱く見せる。 */
/* 色は --soft。--muted は --card との組み合わせしか CONTRAST に無く、
   ここの下地は .cardActs の --paper なので、登録済みの --soft を使う。 */
.wrBtn.ghost{flex:1;width:auto;border-style:dashed;color:var(--soft);
  font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cardActs .ttAddBtn{flex:none;width:auto;padding:7px var(--sp-3);
  border:1px solid var(--brand);border-radius:var(--r-pill);background:none;
  color:var(--brand-text);font:inherit;font-size:var(--fs-sm);font-weight:700;
  cursor:pointer;white-space:nowrap}
.cardActs .ttAddBtn[aria-pressed="true"]{background:var(--brand);color:var(--brand-ink);}
```

- [ ] **Step 5: `.rvBtn` の委譲を足し、`.ttAddBtn` の文言を合わせる**

`web/assets/app.js`。`.panelBtn` を拾っている委譲を `.rvBtn` に変える：

```javascript
/* 口コミの入口は一覧カードの操作バーだけ（詳細からは外した）。
   カードは絞り込みのたびに作り直されるので、親で受ける。 */
$("#list").addEventListener("click", e => {
  const btn = e.target.closest(".rvBtn");
  if (!btn) return;
  e.stopPropagation();            // .head の開閉まで走らせない
  openPanel(btn.dataset.id);
});
```

`.ttAddBtn` のハンドラの中の文言を、バーに収まる長さに変える：

```javascript
      document.querySelectorAll(`.ttAddBtn[data-id="${CSS.escape(id)}"]`).forEach(b => {
        b.setAttribute("aria-pressed", "true");
        b.textContent = "✓ 時間割に入れた";
      });
```

- [ ] **Step 6: テストが通ることを確かめる**

```bash
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
node tools/test_favorite.mjs
```

期待：両方 OK。`test_favorite.mjs` は `.favBtn` の位置が動いていないことを見ている。

- [ ] **Step 7: 描画時間を測って記録する**

カードが1枚あたり増えたぶん、一覧の描画が重くなっていないかを見る。
`app.js:572` のコメントと同じ測り方（50件・390px）：

```bash
node -e '
import("playwright").then(async ({chromium}) => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:390,height:844}});
  await p.addInitScript(()=>{try{localStorage.setItem("rk_onboarded","1");sessionStorage.setItem("rk_splash_seen","1");}catch(e){}});
  await p.goto("http://127.0.0.1:8794/",{waitUntil:"networkidle"});
  await p.waitForSelector(".card");
  const r = await p.evaluate(() => {
    const card = document.querySelector(".card");
    return { nodes: document.querySelectorAll("#list *").length,
             cardH: Math.round(card.getBoundingClientRect().height) };
  });
  console.log(JSON.stringify(r)); await b.close();
});'
```

このタスクの**前**の値と比べる（`git stash` して同じコマンドを1回打つ）。
**得られた「正味のカード増分」を Task 5 で HANDOFF.md に書く。**

- [ ] **Step 8: コミット**

```bash
git rev-parse --abbrev-ref HEAD
git add web/assets/app.js web/assets/app.css tools/test_kuchikomi_modal.mjs
git commit -m "feat(web): 一覧カードに「読む・書く・時間割」の操作バーを足す

詳細を開かないと押せなかった「時間割に追加」と、2回押さないと届かなかった
口コミが1回で届く。読むボタンの2行目に先頭の一言を出して、押す理由を置く。

.head は role=button なので、バーは .head の兄弟に置く（.favBtn と同じ）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 詳細を痩せさせる

**Files:**
- Modify: `web/assets/app.js`（`detailHtml` / `reviewMark` / `goText` / `mqDesktop` の `change`）
- Modify: `web/assets/app.css`（`.panelBtn` / `.rvAlert .go` / `.detail .pList` を削除）
- Modify: `tools/test_layout.py`
- Test: `tools/test_kuchikomi_modal.mjs`（追記）

**Interfaces:**
- Consumes: Task 3 の `.cardActs`（口コミと時間割の入口がここに在ること）
- Produces: `detailHtml(c) -> string` ―― `.dSec`（成績評価の内訳）と
  `.dActs > a.koanLink` だけを返す

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_kuchikomi_modal.mjs` の Task 3 で足したブロックの中、`await p.close()` の前に足す：

```javascript
  /* 詳細に口コミの入口や操作ボタンが残っていないこと（同じ操作を2箇所に置かない）。 */
  await p.evaluate(() => document.querySelector(".card .head").click());
  await p.waitForTimeout(400);
  const dup = await p.evaluate(() => {
    const d = document.querySelector(".card.open .detail") || document.querySelector(".card .detail");
    return { panelBtn: !!d?.querySelector(".panelBtn"),
             tt: !!d?.querySelector(".ttAddBtn"),
             review: !!d?.querySelector(".reviewBtn"),
             rv: !!d?.querySelector(".rv"),
             koan: !!d?.querySelector(".koanLink") };
  });
  check(!dup.panelBtn, "詳細に .panelBtn が残っている");
  check(!dup.tt, "詳細に .ttAddBtn が残っている（操作バーと重複）");
  check(!dup.review, "詳細に .reviewBtn が残っている（本番では出せないフォームを開く）");
  check(!dup.rv, "詳細に口コミの集計（.rv）が残っている");
  check(dup.koan, "詳細から KOAN リンクまで消えている");
```

`tools/test_layout.py` の末尾（`if fails:` の直前）に足す：

```python
# 口コミと操作ボタンは一覧カードの操作バーへ移した（2026-09-06）。
# 詳細に戻すと同じ操作が画面上に2つ並ぶ。
det = js[js.index("function detailHtml("):]
det = det[:det.index("\n}\n")]
for cls in ["panelBtn", "ttAddBtn", "reviewBtn", "reviewHtml"]:
    check(cls not in det, f"detailHtml に {cls} が残っている（操作バーと重複する）")
check("cardActs" in js, "app.js に .cardActs（一覧の操作バー）が無い")
```

- [ ] **Step 2: 落ちることを確かめる**

```bash
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
python3 tools/test_layout.py
```

期待：両方 `NG`。

- [ ] **Step 3: `detailHtml` から口コミ節と操作ボタンを外す**

`web/assets/app.js` の `detailHtml` を置き換える（先頭のコメントは履歴として残し、
最後の段落を書き足す）：

```javascript
function detailHtml(c){
  /* ── 詳細の並び（2026-09-06・口コミをモーダルへ出した後）──────────
   *
   *   ── 成績評価の内訳  KOANの%を積み上げバーで
   *   ── KOAN リンク
   *
   * 口コミ（読む・書く）と「時間割に追加」は一覧カードの操作バー（.cardActs）へ
   * 移した。バーは詳細のすぐ上に常に出ているので、ここにも置くと同じ操作が
   * 画面上に2つ並ぶ。☆ を詳細から外したときと同じ判断。
   *
   * 元は score.py が計算した5軸の「重さ」スコアをバーで見せていたが、
   * 松下さんの依頼で「KOANシラバスに書かれている成績評価の生の%」に置き換えた
   * （2026-09-05）。担当教員の行と信頼度の注記は wang の依頼で削除（2026-09-06）。 */
  return `<div class="dSec">
        <div class="secH">成績評価の内訳</div>
        ${evalCompHtml(c)}
      </div>
      <div class="dActs">
        <a class="koanLink" href="${esc(koanUrl(c))}" target="_blank" rel="noopener noreferrer">この科目のKOAN公式シラバスを見る ↗</a>
      </div>`;
}
```

- [ ] **Step 4: `goText` を消し、`reviewMark` を整理する**

`goText` の関数（3行）とその上のコメント段落（「導線の文言は PC とスマホで
出し分ける」以降）を**削除**し、`reviewMark` を置き換える：

```javascript
/* 口コミの件数表示。件数そのものは操作バーの「口コミ N件を読む」が持つので、
   ここが返すのは「まだ採点に入っていない」の注意帯だけ（2026-09-06）。
   導線の文言（「タップして中身を見る ↓」）も外した ―― 読む先は
   すぐ下の操作バーに在る。 */
function reviewMark(rv){
  if (!rv?.n || rv.scored) return { alert:"" };
  return { alert:`<div class="rvAlert"><i>⚠</i><div>口コミ ${rv.n}件 ―
      まだ数字には入っていません。下の「口コミを読む」で中身を確認してください</div></div>` };
}
```

`card()` の中の `const rv = reviewMark(c.reviews);` はそのまま。`rv.badge` は
Task 3 で既に使っていない。

`mqDesktop` の `change` ハンドラから、`goText` のための再描画を**削除**する：

```javascript
/* 画面幅が変わったとき（PC で窓を縮めた・スマホを回した）に、
   詳細がどちらにも出ていない状態にならないよう描き直す。 */
mqDesktop.addEventListener("change", () => {
  if (!selectedCourseId) return;
  const c = courses.find(x => x.id === selectedCourseId);
  if (!c) return;
  const article = document.querySelector(`.card[data-id="${CSS.escape(c.id)}"]`);
  if (isDesktop()){
    showDetail(c, article);
  } else {
    // PC からスマホ幅へ縮めたとき。右カラムは CSS で隠れるので、
    // 選んでいた科目をカードの中に開き直す。
    $("#inspector").innerHTML = "";
    if (article && !article.classList.contains("open")) showDetail(c, article);
  }
});
```

（`if (courses.length) renderPage(page);` の2行と、その上の「注意帯の導線（.go）は
PC とスマホで文言が違う」コメントが消える。）

- [ ] **Step 5: CSS から使われなくなった規則を消す**

`web/assets/app.css` から削除する：

1. `.rvAlert .go{...}` の規則（3行）
2. `.panelBtn` と `.panelBtn:hover,.panelBtn:active` の規則と、その上の
   「N件すべてを1件ずつ読む →」のコメント段落
3. `.detail .pList{margin-bottom:var(--sp-1)}` とその上のコメント段落
4. 「── 1件ずつを「どこに出すか」」のコメント段落まるごと（PC/スマホで
   置き場所を変える説明。もう1形態しかない）

- [ ] **Step 6: テストが通ることを確かめる**

```bash
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
python3 tools/test_layout.py
python3 tools/test_tokens.py
node tools/smoke.mjs http://127.0.0.1:8794
node tools/test_inspector_center.mjs http://127.0.0.1:8794
```

期待：全部 OK。

- [ ] **Step 7: 詳細の高さを測る（spec の数字の裏取り）**

```bash
node -e '
import("playwright").then(async ({chromium}) => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:390,height:844}});
  await p.addInitScript(()=>{try{localStorage.setItem("rk_onboarded","1");sessionStorage.setItem("rk_splash_seen","1");}catch(e){}});
  await p.goto("http://127.0.0.1:8794/",{waitUntil:"networkidle"});
  await p.waitForSelector(".card");
  const r = await p.evaluate(async () => {
    const a = document.querySelector(`.card[data-id="135327"]`)
           || document.querySelector(".card");
    a.scrollIntoView(); a.querySelector(".head").click();
    await new Promise(r => setTimeout(r, 300));
    return { detail: Math.round(a.querySelector(".detail").getBoundingClientRect().height),
             card: Math.round(a.getBoundingClientRect().height) };
  });
  console.log(JSON.stringify(r)); await b.close();
});'
```

spec の見込みは詳細 170px。**大きく外れたら spec ではなく実測を正としてメモする。**

- [ ] **Step 8: コミット**

```bash
git rev-parse --abbrev-ref HEAD
git add web/assets/app.js web/assets/app.css tools/test_layout.py tools/test_kuchikomi_modal.mjs
git commit -m "fix(web): 科目詳細から口コミ節と操作ボタンを外す

口コミ・時間割・書くは一覧カードの操作バーへ移したので、詳細に残すと
同じ操作が画面上に2つ並ぶ。詳細に残るのは成績評価の内訳と KOAN リンクだけ。

本番（静的配信・CAN_POST=false）で .reviewBtn が「送信しても何も起きない」
投稿フォームを開いていた件も、これで同時に消える。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 静的配信での確認・実測の記録・版に載せる文

**Files:**
- Modify: `HANDOFF.md`（先頭・ルールの直下に追記）
- Modify: `docs/version-pending.md`

- [ ] **Step 1: 静的配信（＝本番と同じ）で通す**

API モード（`server.py`）では `CAN_POST=true` になるので、本番の条件と違う。
静的で1回通す：

```bash
cd web && python3 -m http.server 8795 &
cd ..
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8795
node tools/smoke.mjs http://127.0.0.1:8795
node tools/test_index_gate.mjs http://127.0.0.1:8795
```

期待：全部 OK。ここで `#fab` が隠れていること（`smoke.mjs` が報告する）も確認する。

- [ ] **Step 2: `?c=` 付きの URL が静的配信で届くことを確かめる**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8795/kuchikomi.html?c=135327"
```

期待：`200`。**本番は `/kuchikomi`（拡張子なし）で配信されるので、
Cloudflare の Pages 側でも1回開いて確かめること。** クエリが落ちる設定に
なっていたら PR-2 の前提が崩れる。

- [ ] **Step 3: 全テストを通す**

```bash
python3 server.py --port 8794 &
node tools/smoke.mjs http://127.0.0.1:8794
node tools/test_index_gate.mjs http://127.0.0.1:8794
node tools/test_kuchikomi_modal.mjs http://127.0.0.1:8794
node tools/test_favorite.mjs
node tools/test_inspector_center.mjs http://127.0.0.1:8794
node tools/test_rail_toggle.mjs
node tools/test_kuchikomi_relay.mjs
node tools/test_version.mjs
python3 tools/test_layout.py
python3 tools/test_tokens.py
python3 tools/test_shell_inject.py
```

**1つでも落ちたら次へ進まない。**

- [ ] **Step 4: `docs/version-pending.md` に3行足す**

「## 次の水曜に出すもの」の一覧の末尾に：

```
- [new] 口コミが読みやすくなりました。一覧から直接ひらく大きな画面に変わり、文字も大きくなっています
- [new] 一覧から直接「時間割に追加」できるようになりました。詳細を開かなくても押せます
- [improve] 科目の詳細が短くなりました。口コミと操作ボタンを一覧側にまとめています
```

- [ ] **Step 5: `HANDOFF.md` に引き継ぎを書く**

ルール（`> 直列＝…` の引用ブロック）と `---` の直下に、4項目の形で追記する。
**Task 3 Step 7 と Task 4 Step 7 で測った実測値を必ず入れる**：

- 何が動く状態か ―― Step 3 のコマンド一式をそのまま
- 何をしていないか ―― `/kuchikomi` の `?c=` 受け（PR-2）。それまで ✎ は
  科目が選ばれていない状態で投稿ページを開く
- 次の人が最初に打つコマンド
- 踏んだ罠 ―― `.head` が `role="button"` なので操作バーは兄弟に置くこと。
  API モードは `CAN_POST=true` なので本番の条件と違い、投稿まわりは
  静的配信（`python3 -m http.server`）で確かめる必要があること

- [ ] **Step 6: コミットして PR を出す**

```bash
git rev-parse --abbrev-ref HEAD
git add HANDOFF.md docs/version-pending.md
git commit -m "docs: 口コミモーダル（PR-1）の引き継ぎと版の文面

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin feat/kuchikomi-modal
gh pr create --title "口コミを中央モーダルへ出し、一覧に操作バーを足す（PR-1）" --body "$(cat <<'EOF'
## 何をしたか

口コミを科目詳細から出し、PC・スマホ共通の中央モーダル1つにまとめた。
一覧カードの下端に「読む・書く・時間割」の操作バーを足し、詳細からは
口コミ節と操作ボタンを外した。

設計は `docs/plans/2026-09-06-kuchikomi-modal-design.md`。

## 直ったもの（副産物）

本番（静的配信・`CAN_POST=false`）では、詳細の「この科目の口コミを書く」が
**送信しても何も起きない**投稿フォームを開いていた。詳細から外したので消えた。

## まだやっていないこと

`/kuchikomi` はまだ `?c=` を見ない（PR-2）。それまで ✎ は科目が選ばれていない
状態で投稿ページを開く ―― いまヘッダの CTA を押したときと同じ状態。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**版に載せるかは本人に聞くこと**（`CLAUDE.md`「版に載せるかの判定」）。

---

## 自己点検

**spec の網羅** ―― spec 4章の `app.js` の表12行はすべて Task 1〜4 に割り当てた
（`kuchikomi.js` の行は PR-2）。3章の字の大きさは Task 2 で実測テストにした。
5章の履歴の契約は Task 1 で `?c=` の消滅を、7章のテストは Task 5 で一覧にした。

**spec との差** ―― spec 3章は集計の数字を「14px」、受講年・属性を「12px」と
書いたが、**トークンに 14px も 12px も無く、新しいトークンを足さない**方針なので
`--fs-base`（15px）と `--fs-sm`（13px）にした。どちらも spec の狙い
（11.5px より大きく）は満たす。spec 側の表も直すこと。

**型と名前の一致** ―― `cardActsHtml(c)` は Task 3 で定義し Task 3 の `card()` から
だけ呼ぶ。`reviewMark` は Task 3 の時点で `{badge, alert}` を返したまま
`badge` を使わない状態になり、Task 4 で `{alert}` だけに変わる
（`card()` 側は `rv.alert` しか読んでいないので、順序を入れ替えても壊れない）。
`panelSetOpen(open)` の引数の意味（`false` のときだけ働く）は既存のまま。
