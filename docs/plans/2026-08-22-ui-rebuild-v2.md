# ラクハン UI 作り直し v2 実装計画

> **エージェント向け：** 必須サブスキル ―― `superpowers:subagent-driven-development`
> または `superpowers:executing-plans` でタスク単位に実行すること。
> 各ステップは `- [ ]` のチェックボックスで進捗を管理する。

**ゴール：** PC で 560px の1列になっている ラクハン を、
3カラムのワークベンチ＋About ページ＋ブランド統一＋オープニング演出を持つ形へ作り直す。

**方針：** モバイルを CSS のベースに置き、PC は `min-width` で上乗せする。
`web/index.html`（744行・CSS と JS が全部インライン）を
`index.html` / `about.html` / `assets/*.css` / `assets/*.js` に分割し、
共有の外殻（ヘッダ・ナビ・フッタ）は `build.py` が両ページへ注入する。
**新しい依存は入れない。** フレームワークもバンドラも使わない。

**技術スタック：** 素の HTML / CSS / JavaScript（ビルドなし）、
Python 3 標準ライブラリ（`build.py` / `server.py` / `tools/test_*.py`）、
Playwright（既存のスクショ差分ワークフローのみ）。

**設計（スペック）：** `ROADMAP.md` の8章「UI 作り直し v2」。
このファイルは8章を実装手順へ落としたもの。**両方を読むこと。**

---

## ロールバック ―― 先にこれを読む

**本番は `main` にマージされた時だけ更新される（約80秒で自動デプロイ）。**
この計画の作業は全て `feat/wang-redesign-v2` 上で行い、**`main` には触らない。**
つまり作業中はいつでも本番が無傷である、というのが第一の保証。

戻したくなったときの手順：

```bash
# ① いま本番に出ているコミットを確認する
git rev-parse prod-before-redesign

# ② 作り直し前の main の状態を手元で見る
git checkout main-before-redesign
python3 server.py        # → http://localhost:8000

# ③ ブランチごと捨てる（作り直しを全部無かったことにする）
git checkout main
git branch -D feat/wang-redesign-v2

# ④ タスク単位で戻す（1タスク = 1コミットなので、気に入らないタスクだけ戻せる）
git log --oneline main..feat/wang-redesign-v2   # タスクの一覧が出る
git revert <そのコミット>
```

**もし誤って main へマージして本番が壊れた場合：**

```bash
git checkout main
git reset --hard prod-before-redesign
git push --force-with-lease origin main    # 約80秒後に元の本番へ戻る
```

**タグ：**
- `prod-before-redesign` ―― 作り直し着手時点で本番に出ていたコミット
- `main-before-redesign` ―― 口コミ門をマージした直後・作り直し前の `main`

---

## Global Constraints（全タスクに適用）

- **新しい依存を入れない。** `package.json` に追加してよいのは既存の `playwright` のみ。
  フロントエンドのフレームワーク（React / Vue / Svelte 等）とバンドラは**採用しない**
- **Python は標準ライブラリのみ。** `build.py` `server.py` `tools/*.py` に外部パッケージを足さない
- **ブランド色は `#DB6209` の単色。グラデーション禁止。** 阪大公式の青系を避けるために選ばれた色なので変更しない
- **オレンジの小さい文字を作らない。** `#DB6209` は明地でコントラストが足りない。
  オレンジは面（塗り）と図形の線にのみ使う
- **`--brand`（操作色）と `--scale-*`（データ目盛り色）を混ぜない。**
  押せるものは `--brand`、4軸バーと band は `--scale-*`
- **`score.py` / 本一覧の並び順 / 4軸の重みを触らない**
- **`CAN_POST` は `false` のまま。** サイト内投稿の入口を出さない
- **`web/` 配下は丸ごと公開される。** 開発用のファイルを置かない（テンプレートは `templates/`、内部ツールは `tools/`）
- **`prefers-reduced-motion: reduce` ではすべての演出を止める**
- **ダークモード（`prefers-color-scheme: dark`）を壊さない**
- **メンバーの実名を公開ページに書かない。**「GUILD メンバー6名（阪大4・京大2）」とだけ書く
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## ファイル構成（完成形）

| ファイル | 責務 |
|---|---|
| `web/index.html` | ワークベンチのマークアップのみ。CSS も JS も持たない。外殻は `<!--SHELL-->` を `build.py` が置換 |
| `web/about.html` | About ラクハン。同じく外殻は注入 |
| `web/assets/tokens.css` | 色・文字・余白・角丸・モーションの CSS 変数。**ここ以外に裸の hex を書かない** |
| `web/assets/app.css` | レイアウトと部品。base → md(768) → lg(1024) → xl(1440) |
| `web/assets/app.js` | 一覧の描画・絞り込み・選択状態・ページング（いまの `<script>` の移設先） |
| `web/assets/splash.js` | オープニング演出。2ページで共用 |
| `templates/shell.html` | ヘッダ／ナビ／フッタ。`build.py` が両ページへ差し込む唯一の正本 |
| `build.py` | データを焼く（既存）＋ 外殻を注入する（追加） |
| `server.py` | 拡張子なしのパス（`/about`）を `.html` へ解決する（追加） |
| `tools/test_web_split.py` | 分割が壊れていないこと |
| `tools/test_tokens.py` | 裸の hex が残っていないこと、必須トークンがあること |
| `tools/test_layout.py` | ブレークポイントが定義されていること |
| `tools/test_shell_inject.py` | 両ページの外殻が一致し、レッドライン文言があること |
| `tools/shots.mjs` | 撮影対象を4段＋About＋ダークへ拡張（既存を修正） |

---

## タスク一覧と「いつ効果が見えるか」

| タスク | 内容 | 見た目の変化 |
|---|---|---|
| 1 | CSS と JS を外に出す（純粋なリファクタ） | **なし**（ゼロであることを検証する） |
| 2 | デザイントークン導入・色を2系統へ | **あり** ―― 全体がオレンジ基調になる |
| 3 | 検索窓を一覧直上のツールバーへ移す | あり（小） |
| 4 | PC 3カラム | **大きい** ―― ここで PC が別物になる |
| 5 | 無限スクロールをやめてページングへ | 大きい |
| 6 | 外殻テンプレ＋ナビ＋ロゴ下の GUILD 2行 | あり |
| 7 | About ページ新設 | 新ページ |
| 8 | オープニング演出 | あり |
| 9 | スクショ対象の拡張と最終確認 | なし（検証のみ） |

**まず効果を見たいなら、タスク4まで進めた時点で一度止めて確認する。**

---

### Task 1: CSS と JS を外部ファイルへ出す（見た目を1px も変えない）

いちばん危険なのはここ。**「分割しても何も変わらない」を先に証明しておくと、
以降のタスクで見た目が変わったとき、原因が分割ではないと断言できる。**

**Files:**
- Modify: `web/index.html`（CSS = 11〜191行、JS = 287〜741行を切り出す）
- Create: `web/assets/app.css`
- Create: `web/assets/app.js`
- Create: `tools/test_web_split.py`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `web/assets/app.css` と `web/assets/app.js` が存在し、
  `web/index.html` が `<link rel="stylesheet" href="/assets/app.css">` と
  `<script src="/assets/app.js" defer></script>` で参照している状態。以降の全タスクがこれに乗る。

- [ ] **Step 1: 失敗するテストを書く**

```python
# tools/test_web_split.py
"""web/index.html から CSS と JS が外に出ていることを確かめる。

分割そのものが目的ではない。分割が中途半端なまま次の作業へ進むと、
「片方はインライン、片方は外部」という状態が生まれて、
どちらを直せばいいのか分からなくなる。それを防ぐための番人。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / "web" / "index.html"
CSS = ROOT / "web" / "assets" / "app.css"
JS = ROOT / "web" / "assets" / "app.js"

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


html = INDEX.read_text(encoding="utf-8")

check(CSS.is_file(), "web/assets/app.css が無い")
check(JS.is_file(), "web/assets/app.js が無い")
check("<style>" not in html, "index.html に <style> が残っている")
check("/assets/app.css" in html, "index.html が app.css を読み込んでいない")
check("/assets/app.js" in html, "index.html が app.js を読み込んでいない")

# インラインの <script> が残っていないこと。ただし
# type="application/json" のようなデータブロックは対象外。
check(html.count("<script>") == 0, "index.html に素の <script> が残っている")

if CSS.is_file():
    css = CSS.read_text(encoding="utf-8")
    # 分割で中身が落ちていないかの粗い検査。代表的なセレクタが生きているか。
    for sel in [".wrap", ".card", ".chip", ".fab", ".sheet"]:
        check(sel in css, f"app.css に {sel} が無い（分割で落ちた可能性）")

if JS.is_file():
    js = JS.read_text(encoding="utf-8")
    for fn in ["function load(", "function renderMore(", "CAN_POST"]:
        check(fn in js, f"app.js に {fn} が無い（分割で落ちた可能性）")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {8 + 5 + 3} 件")
print("OK")
```

- [ ] **Step 2: テストが落ちることを確認する**

実行: `python3 tools/test_web_split.py`
期待: `NG` と出て `web/assets/app.css が無い` などが並ぶ。終了コード 1。

- [ ] **Step 3: 実際に切り出す**

```bash
mkdir -p web/assets
# CSS: <style> の中身（11〜191行）をそのまま app.css へ
sed -n '11,191p' web/index.html > web/assets/app.css
# JS: <script> の中身（287〜741行）をそのまま app.js へ
sed -n '287,741p' web/index.html > web/assets/app.js
```

そのうえで `web/index.html` を編集する。

- 11〜192行（`<style>` 〜 `</style>`）を次の1行に置き換える：

```html
<link rel="stylesheet" href="/assets/app.css">
```

- 286〜742行（`<script>` 〜 `</script>`）を次の1行に置き換える：

```html
<script src="/assets/app.js" defer></script>
```

**注意：** `defer` を必ず付ける。いまの `<script>` は `</body>` の直前にあるので
DOM が出来てから走っていた。`<head>` ではなく元の位置（`</body>` 直前）に置き、
かつ `defer` を付けておけば挙動が変わらない。

- [ ] **Step 4: テストが通ることを確認する**

```bash
python3 tools/test_web_split.py     # OK が出ること
python3 tools/test_scoring_gate.py  # 既存テストが壊れていないこと
python3 tools/test_reviews.py
```

- [ ] **Step 5: 見た目がゼロ変化であることをスクショで証明する**

```bash
python3 server.py --port 8000 &
node tools/shots.mjs /tmp/rk-after
git stash --include-untracked
python3 server.py --port 8001 &
node tools/shots.mjs /tmp/rk-before http://127.0.0.1:8001
git stash pop
```

`/tmp/rk-before` と `/tmp/rk-after` の同名 PNG を見比べる。
**5枚すべてが同一に見えること。** 1枚でも違えば分割で何かを落としている。
差が出たら Step 3 をやり直す。

- [ ] **Step 6: コミット**

```bash
git add web/index.html web/assets/app.css web/assets/app.js tools/test_web_split.py
git commit -m "refactor: index.html から CSS と JS を外部ファイルへ出す

見た目は1px も変えていない（スクショ5枚で確認）。
以降の作業でどこを触ればいいかを明確にするための下ごしらえ。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: デザイントークンを入れ、色を2系統に分ける

**ここで初めて見た目が変わる。** ロゴだけだったオレンジが全体の操作色になる。

**Files:**
- Create: `web/assets/tokens.css`
- Modify: `web/assets/app.css`（`:root` ブロックを削除し、裸の値をトークン参照へ）
- Modify: `web/index.html`（`tokens.css` を `app.css` より先に読み込む）
- Create: `tools/test_tokens.py`

**Interfaces:**
- Consumes: Task 1 の `web/assets/app.css`
- Produces: 次のトークンが `tokens.css` に定義され、以降の全タスクが参照する。
  `--brand` `--brand-ink` `--brand-soft` `--focus`、
  `--scale-light` `--scale-mid` `--scale-heavy`、
  `--sp-1`〜`--sp-8`、`--fs-xs`〜`--fs-hero`、`--r-sm` `--r-md` `--r-lg`、
  `--dur-fast` `--dur` `--dur-slow` `--ease-out` `--ease-brand`

- [ ] **Step 1: 失敗するテストを書く**

```python
# tools/test_tokens.py
"""色・余白・モーションがトークン経由になっていることを確かめる。

裸の #xxxxxx が app.css に残っていると、ダークモードや
ブランド色の変更が「14箇所を手で直す」作業に戻ってしまう。
2026-08-21 まで、ロゴだけオレンジで UI は緑という状態が
2週間放置されたのは、まさにこれが原因だった。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKENS = ROOT / "web" / "assets" / "tokens.css"
APP = ROOT / "web" / "assets" / "app.css"

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


check(TOKENS.is_file(), "web/assets/tokens.css が無い")
check(APP.is_file(), "web/assets/app.css が無い")

if TOKENS.is_file():
    t = TOKENS.read_text(encoding="utf-8")
    required = [
        "--brand:", "--brand-ink:", "--brand-soft:", "--focus:",
        "--scale-light:", "--scale-mid:", "--scale-heavy:",
        "--sp-1:", "--sp-8:", "--fs-xs:", "--fs-hero:",
        "--r-sm:", "--r-lg:",
        "--dur-fast:", "--dur:", "--dur-slow:", "--ease-out:",
    ]
    for name in required:
        check(name in t, f"tokens.css に {name} が無い")

    check("#DB6209" in t, "ブランド色 #DB6209 が tokens.css に無い")
    check("#b4532a" not in t.lower().replace("#B4532A", "#b4532a"),
          "--warn の旧色 #b4532a が残っている（#C0392B へ寄せる約束）")
    check("prefers-reduced-motion" in t,
          "tokens.css に prefers-reduced-motion の打ち消しが無い")
    check("prefers-color-scheme: dark" in t,
          "tokens.css にダークモードの定義が無い")

if APP.is_file():
    a = APP.read_text(encoding="utf-8")
    # app.css に裸の hex が残っていないこと。
    # コメント内の記述は許す（説明のために色名を書きたいことがある）。
    without_comments = re.sub(r"/\*.*?\*/", "", a, flags=re.S)
    bare = re.findall(r"#[0-9a-fA-F]{3,8}\b", without_comments)
    check(not bare, f"app.css に裸の hex が残っている: {sorted(set(bare))[:8]}")

    check(":root{" not in without_comments.replace(" ", ""),
          "app.css に :root ブロックが残っている（tokens.css へ移すこと）")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("  通過 24 件")
print("OK")
```

- [ ] **Step 2: テストが落ちることを確認する**

実行: `python3 tools/test_tokens.py`
期待: `NG`、`web/assets/tokens.css が無い` が先頭。終了コード 1。

- [ ] **Step 3: `web/assets/tokens.css` を作る**

```css
/* ラクハン デザイントークン
 *
 * ここが色・余白・文字・モーションの唯一の定義場所。
 * app.css には裸の値を書かない（tools/test_tokens.py が見張っている）。
 *
 * 色は2系統に分かれていて、混ぜて使わない。
 *   ブランド・操作色（--brand 系） …… 「押せるもの」にだけ使う
 *   データ目盛り色（--scale-* ）  …… 4軸バーと band にだけ使う
 * 混ぜると「ブランドの色」と「この科目は重い」が同じ色になり、
 * 数字の意味が壊れる。
 */
:root{
  /* ── 地と文字 ───────────────────────── */
  --ink:#16181d; --soft:#3b4148; --muted:#6b736f;
  --paper:#f4f6f3; --card:#fff; --dim:#e8ebe6; --rule:#d7dcd6;

  /* ── ブランド・操作色 ─────────────────
     #DB6209 は阪大公式の青系を避けるために選ばれた色。変更しない。
     単色のみ。グラデーション禁止。
     明地ではコントラストが足りないので、小さい文字には使わない。
     面（塗り）と図形の線にだけ使うこと。 */
  --brand:#DB6209;
  --brand-ink:#fff;          /* オレンジの面に載せる文字 */
  --brand-soft:#fbeade;      /* 選択チップの淡い地 */
  --focus:rgba(219,98,9,.45);/* フォーカスリング */
  --brand-ground:#1A1A1A;    /* ヘッダ帯の地。ブランド資料の SUMI */

  /* ── データ目盛り色 ───────────────────
     軽い → 重い。操作色には絶対に使わない。
     --scale-heavy は旧 #b4532a から赤側へ寄せてある。
     ブランドオレンジと色相が近すぎて見分けがつかなかったため。 */
  --scale-light:#0e7c66;
  --scale-light-soft:#e2efeb;
  --scale-mid:#b8862c;
  --scale-heavy:#C0392B;
  --scale-heavy-soft:#f7eae3;

  /* ── 文字 ─────────────────────────── */
  --body:"Hiragino Sans","ヒラギノ角ゴシック",system-ui,sans-serif;
  --data:"Helvetica Neue",Helvetica,Arial,sans-serif;
  --fs-xs:11.5px; --fs-sm:13px; --fs-base:15px; --fs-lg:17px;
  --fs-h2:17px; --fs-hero:clamp(28px,4.2vw,44px);

  /* ── 余白（4px グリッド）─────────────── */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px;
  --sp-5:24px; --sp-6:32px; --sp-7:48px; --sp-8:64px;
  --pad:var(--sp-4);

  /* ── 角丸 ─────────────────────────── */
  --r-sm:6px; --r-md:10px; --r-lg:16px; --r-pill:999px;

  /* ── モーション ───────────────────── */
  --dur-fast:120ms; --dur:200ms; --dur-slow:320ms; --dur-brand:1400ms;
  --ease-out:cubic-bezier(.2,.8,.2,1);
  --ease-brand:cubic-bezier(.65,0,.35,1);
}

@media (prefers-color-scheme: dark){
  :root{
    --ink:#eef1ec; --soft:#c3c9c4; --muted:#8b938d;
    --paper:#131519; --card:#1b1e23; --dim:#23272d; --rule:#333941;
    /* ブランド色は暗地で 5.1:1 あるのでそのまま使う */
    --brand-soft:#3a2312;
    --scale-light:#3fbfa1; --scale-light-soft:#15302b;
    --scale-mid:#d3a955;
    --scale-heavy:#e0725c; --scale-heavy-soft:#33211a;
  }
}

/* 演出を止める設定の人には、いっさい動かさない。
   duration を 0 ではなく 1ms にするのは、
   transitionend を待つコードが止まらないようにするため。 */
@media (prefers-reduced-motion: reduce){
  :root{
    --dur-fast:1ms; --dur:1ms; --dur-slow:1ms; --dur-brand:1ms;
  }
  *,*::before,*::after{
    animation-duration:1ms !important;
    animation-iteration-count:1 !important;
    transition-duration:1ms !important;
    scroll-behavior:auto !important;
  }
}

/* 数字は必ず等幅で。4軸の 78 / 71 / 68 が縦に揃う。
   CSS 2行だが、見た目の「素人っぽさ」にいちばん効く。 */
.num,.fit b,.ax .v,.chip .n,#count{
  font-family:var(--data);
  font-variant-numeric:tabular-nums;
}
```

- [ ] **Step 4: `app.css` を書き換える**

1. 先頭の `:root{...}` と `@media (prefers-color-scheme: dark){:root{...}}` を**削除**する
   （中身は `tokens.css` へ移した）
2. 旧 `--go` の参照を**役割ごとに**振り分ける。全部で14箇所。

| 対象 | 旧 | 新 |
|---|---|---|
| `.chip.on`（選択チップの地） | `--go` | `--brand`（地）＋ `--brand-ink`（文字） |
| `.fab` | `--go` | `--brand` ＋ `--brand-ink` |
| `.fit b`（相性の数字） | `--go` | `--brand` |
| リンク `a` | `--go` | `--brand` |
| `:focus-visible` の輪郭 | `--go` | `--focus` |
| `.ax .fill.g`（4軸バー・軽い） | `--go` | `--scale-light` |
| `.band.b0` `.band.b1` 等 | `--go` `--mid` `--warn` | `--scale-light` `--scale-mid` `--scale-heavy` |
| `.tag.g` | `--go-soft` | `--scale-light-soft` |
| `.note`（上部の注意帯） | `--warn` `--warn-soft` | `--scale-heavy` `--scale-heavy-soft` |

3. 裸の数値をトークンへ置換する（`tools/test_tokens.py` は色しか見ないが、
   ここで一緒にやらないと二度手間になる）

| 旧 | 新 |
|---|---|
| `padding:11px 13px` | `padding:var(--sp-3) var(--sp-3)` |
| `border-radius:9px` | `border-radius:var(--r-md)` |
| `border-radius:16px` | `border-radius:var(--r-lg)` |
| `border-radius:99px` | `border-radius:var(--r-pill)` |
| `font-size:11.5px` | `font-size:var(--fs-xs)` |
| `font-size:13px` | `font-size:var(--fs-sm)` |
| `font-size:15px` | `font-size:var(--fs-base)` |
| `margin-top:26px` | `margin-top:var(--sp-5)` |
| `gap:10px` | `gap:var(--sp-2)` |

4. `web/index.html` の `<link rel="stylesheet" href="/assets/app.css">` の**前**に足す：

```html
<link rel="stylesheet" href="/assets/tokens.css">
```

**順番が逆だと変数が未定義のまま参照される。必ず tokens.css が先。**

- [ ] **Step 5: テストが通ることを確認する**

```bash
python3 tools/test_tokens.py       # OK
python3 tools/test_web_split.py    # OK（壊していないこと）
```

- [ ] **Step 6: 目で見て確認する**

```bash
python3 server.py    # → http://localhost:8000
```

確認すること：
- チップの選択・FAB・相性の数字が**オレンジ**になっている
- 4軸のバーと band は**緑→黄→赤のまま**（オレンジになっていたら混ぜている）
- OS をダークモードにしても読める
- どこにもオレンジの小さい文字が無い

- [ ] **Step 7: コミット**

```bash
git add web/assets/tokens.css web/assets/app.css web/index.html tools/test_tokens.py
git commit -m "feat: デザイントークンを入れ、色を操作色とデータ目盛りに分ける

ロゴだけオレンジで UI は緑、という状態（旧 B-1）を解消。
押せるものは --brand、4軸と band は --scale-* に分けたので、
今後どちらかを変えてももう一方を壊さない。

--warn は #b4532a → #C0392B。ブランドオレンジと色相が
近すぎて「ブランド」と「重い科目」が同じ色に見えていたため。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 検索窓を一覧直上のツールバーへ移す

`CLAUDE.md` は「空の検索窓を最上部に置かない」と決めているのに、
実装は `.wrap` の先頭が検索窓だった。**実装が規約を破っている状態を直す。**
ただし検索窓を消しはしない。具体的な科目名を持って調べに来る人は実在する。

**Files:**
- Modify: `web/index.html`（207行付近の `<input type="search" id="q">` を `.bar` の中へ移す）
- Modify: `web/assets/app.css`（`.bar` を3要素のレイアウトへ）

**Interfaces:**
- Consumes: Task 2 のトークン
- Produces: `#q` が `.bar` の中にある DOM 構造。Task 4 の3カラムでは `.bar` が中カラムの
  ヘッダになるので、この位置を前提にする。

- [ ] **Step 1: `web/index.html` を編集する**

`.wrap` の先頭にあるこの行を**削除**する：

```html
  <input type="search" id="q" placeholder="科目名でさがす" autocomplete="off">
```

`.bar` を次に差し替える：

```html
  <div class="bar">
    <div class="barCount"><b id="count">–</b> <span>件</span></div>
    <input type="search" id="q" placeholder="科目名でしぼりこむ" autocomplete="off">
    <select id="sort">
      <option value="fit">あなたとの相性順</option>
      <option value="rakutan">全体の軽い順</option>
      <option value="confidence">情報が揃っている順</option>
      <option value="title">科目名順</option>
    </select>
  </div>
```

**placeholder を「さがす」から「しぼりこむ」に変えている。**
一覧の直上に置いた以上、これは「一覧に効く道具」であって入口ではない、
という位置づけを言葉でも一致させる。

- [ ] **Step 2: `web/assets/app.css` の `.bar` を書き換える**

```css
/* 一覧の直上のツールバー。件数・検索・並び替えを1列に並べる。
   ここは「一覧に効く道具」を集めた場所。入口ではない
   （入口は空きコマグリッド ―― CLAUDE.md の前提）。 */
.bar{
  display:grid;
  grid-template-columns:auto 1fr auto;
  align-items:center;
  gap:var(--sp-2);
  padding:var(--sp-2) 0;
  border-bottom:1px solid var(--rule);
  position:sticky; top:0; z-index:5;
  background:var(--paper);
}
.barCount{white-space:nowrap}
.barCount b{font-family:var(--data);font-variant-numeric:tabular-nums}
.barCount span{font-size:var(--fs-sm);color:var(--muted)}
.bar input[type=search]{
  width:100%;
  padding:var(--sp-2) var(--sp-3);
  border:1px solid var(--rule);
  border-radius:var(--r-md);
  background:var(--card); color:var(--ink);
  font:inherit; font-size:var(--fs-base);
}
.bar input[type=search]:focus-visible{
  outline:2px solid var(--focus); outline-offset:1px;
}

/* 幅が足りないと3つ並べられないので、狭い画面では2段にする。 */
@media (max-width:479px){
  .bar{grid-template-columns:1fr auto;}
  .bar input[type=search]{grid-column:1 / -1; grid-row:2;}
}
```

- [ ] **Step 3: 動作を確認する**

```bash
python3 server.py
```

- 検索窓が一覧のすぐ上にあり、件数と並び替えと同じ列にいること
- 文字を打つと件数が変わり、一覧が絞られること（`app.js` の `#q` の
  イベントハンドラは移設していないのでそのまま効くはず。効かなければ
  `app.js` 内で `$("#q")` を取得しているタイミングを確認する）
- 幅 390px で2段になること
- ページを下へスクロールしてもツールバーが上に張り付くこと

- [ ] **Step 4: コミット**

```bash
git add web/index.html web/assets/app.css
git commit -m "fix: 検索窓を最上部から一覧直上のツールバーへ移す

CLAUDE.md は「空の検索窓を最上部に置かない」と決めているのに、
実装は .wrap の先頭が検索窓だった。実装のほうを規約に合わせる。

消しはしない。「自分が取る科目が楽に単位を取れるか確かめたい」
という具体的な科目名を持ってくる使い方は実在するため。
placeholder も「さがす」→「しぼりこむ」に変えて位置づけを揃えた。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: PC を3カラムにする

**このタスクで PC が別物になる。ここまで来たら一度止めて確認すること。**

**Files:**
- Modify: `web/index.html`（`.wrap` の中を3つの領域へ組み替える）
- Modify: `web/assets/app.css`（ブレークポイントを追加）
- Modify: `web/assets/app.js`（`selectedCourseId` と、詳細の描画先の切り替え）
- Create: `tools/test_layout.py`

**Interfaces:**
- Consumes: Task 3 の `.bar` 構造
- Produces:
  - DOM: `.workbench > .rail`（左）＋ `.results`（中）＋ `.inspector`（右）
  - JS: `let selectedCourseId = null;`、
    `function isDesktop()` → `boolean`、
    `function showDetail(course)` → `void`（PC なら `.inspector` へ、スマホなら `.detail` へ）
  - Task 5（ページング）は `.results` の中で動く

- [ ] **Step 1: 失敗するテストを書く**

```python
# tools/test_layout.py
"""PC 用のレイアウトが実在することを確かめる。

2026-08-22 まで、この CSS には幅ベースの @media が1つも無かった。
あったのは prefers-color-scheme の2つだけで、
.wrap .hd .sheet .inner が全部 max-width:560px。
つまり PC でもスマホと同じ1列だった。
同じことが二度起きないよう、ここで固定する。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "web" / "assets" / "app.css"
INDEX = ROOT / "web" / "index.html"

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


css = APP.read_text(encoding="utf-8")
html = INDEX.read_text(encoding="utf-8")

for bp in ["768px", "1024px", "1440px"]:
    check(re.search(r"@media[^{]*min-width:\s*" + bp, css),
          f"ブレークポイント min-width:{bp} が無い")

for cls in ["workbench", "rail", "results", "inspector"]:
    check(f'class="{cls}"' in html or f"{cls}" in html,
          f"index.html に {cls} が無い")
    check("." + cls in css, f"app.css に .{cls} が無い")

# 560px 決め打ちが本文レイアウトに残っていないこと。
# .sheet .inner（スマホの投稿シート）だけは 560px のままでよい。
body_560 = re.findall(r"\.wrap\s*\{[^}]*max-width:\s*560px", css)
check(not body_560, ".wrap に max-width:560px が残っている（PC が1列に戻る）")

check("grid-template-columns" in css,
      "3カラムの grid-template-columns が無い")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("  通過 12 件")
print("OK")
```

- [ ] **Step 2: テストが落ちることを確認する**

実行: `python3 tools/test_layout.py`
期待: `NG`、`ブレークポイント min-width:768px が無い` から始まる。終了コード 1。

- [ ] **Step 3: `web/index.html` の `.wrap` の中を組み替える**

いまの `.wrap` 直下は「検索窓 → 学年 → 空きコマ → 優先度 → 条件 → 口コミ →
`.bar` → `#list` → footer」という一直線。これを3つの領域に分ける。
**セクションの中身は一切変えない。囲いを足すだけ。**

```html
<div class="wrap">
  <div class="workbench">

    <aside class="rail">
      <div class="slotBar" id="slotBar" hidden>
        <span id="slotBarText"></span>
        <button id="slotBarClear" aria-label="コマ選択を解除">✕</button>
      </div>

      <section>
        <h2>空きコマからさがす <span class="sub">数字はその枠の科目数</span></h2>
        <div class="grid" id="grid"></div>
        <div class="hint" id="slotHint">「火3が空いてる、何取ろう」から始められる。検索語は要らない。</div>
      </section>

      <section>
        <h2>学年 <span class="sub">履修できない科目は出しません</span></h2>
        <div class="chips" id="years"></div>
      </section>

      <section>
        <h2>あなたの優先度 <span class="sub">同じ科目でも、人によって「楽」は違う</span></h2>
        <div class="chips" id="presets"></div>
        <button class="toggle" id="tog">スライダーで細かく調整する</button>
        <div class="sliders" id="sliders"></div>
      </section>

      <section>
        <h2>条件</h2>
        <div class="chips" id="conds"></div>
      </section>

      <section>
        <h2>口コミ</h2>
        <div class="chips" id="trust"></div>
      </section>
    </aside>

    <main class="results">
      <div class="bar">
        <div class="barCount"><b id="count">–</b> <span>件</span></div>
        <input type="search" id="q" placeholder="科目名でしぼりこむ" autocomplete="off">
        <select id="sort">
          <option value="fit">あなたとの相性順</option>
          <option value="rakutan">全体の軽い順</option>
          <option value="confidence">情報が揃っている順</option>
          <option value="title">科目名順</option>
        </select>
      </div>
      <div id="list"></div>
    </main>

    <aside class="inspector" id="inspector">
      <div class="inspectorEmpty">
        <h3>数字の読み方</h3>
        <p>科目を選ぶと、ここに4軸の内訳と根拠が出ます。</p>
        <ul class="legend">
          <li><span class="sw light"></span>軽い ―― 負担が小さい</li>
          <li><span class="sw mid"></span>ふつう</li>
          <li><span class="sw heavy"></span>重い ―― 負担が大きい</li>
        </ul>
        <p class="fine">「信頼度」は、シラバスの形だけで出した数字か、
        人が確認した数字かの区別です。</p>
      </div>
    </aside>

  </div>

  <footer>
    <!-- いまの footer の中身をそのまま残す。Task 6 で外殻へ移す -->
  </footer>
</div>
```

**「空きコマからさがす」を学年より上へ動かしている。** 入口は空きコマグリッド、
という `CLAUDE.md` の前提を、並び順でも一致させるため。

- [ ] **Step 4: `web/assets/app.css` にレイアウトを足す**

```css
/* ── レイアウト ────────────────────────────
 * ベースはモバイル（1列）。PC は min-width で上乗せする。
 * 「PC は第2の必須形態」―― CLAUDE.md の前提（2026-08-22 改訂）。
 */
.wrap{
  max-width:none;             /* 560px の縛りを外す */
  margin:0 auto;
  padding:0 var(--pad) var(--sp-8);
}
.workbench{display:block}     /* モバイル：いまと同じ縦一列 */
.inspector{display:none}      /* モバイルでは詳細をカード内に開くので不要 */

/* md：2カラム。詳細は右からのドロワー。 */
@media (min-width:768px){
  .wrap{max-width:960px}
  .workbench{
    display:grid;
    grid-template-columns:240px minmax(0,1fr);
    gap:var(--sp-5);
    align-items:start;
  }
  .rail{position:sticky; top:var(--sp-3); max-height:calc(100vh - var(--sp-6)); overflow-y:auto}
}

/* lg：3カラム。ここからが本命。 */
@media (min-width:1024px){
  .wrap{max-width:1400px}
  .workbench{grid-template-columns:260px minmax(420px,1fr) 380px}
  .inspector{
    display:block;
    position:sticky; top:var(--sp-3);
    max-height:calc(100vh - var(--sp-6));
    overflow-y:auto;
    background:var(--card);
    border:1px solid var(--rule);
    border-radius:var(--r-lg);
    padding:var(--sp-4);
  }
  /* PC では詳細は右カラムに出るので、カード内の折りたたみは使わない */
  .card .detail{display:none}
  .card.sel{outline:2px solid var(--brand); outline-offset:-1px}
}

@media (min-width:1440px){
  .wrap{max-width:1560px}
  .workbench{grid-template-columns:280px minmax(0,1fr) 440px}
}

/* 右カラムの空状態。数字を読む直前の人に、いちばん必要な説明を出す。 */
.inspectorEmpty h3{margin:0 0 var(--sp-2); font-size:var(--fs-h2)}
.inspectorEmpty .legend{list-style:none; padding:0; margin:var(--sp-3) 0}
.inspectorEmpty .legend li{display:flex; align-items:center; gap:var(--sp-2);
  margin-bottom:var(--sp-1); font-size:var(--fs-sm)}
.inspectorEmpty .sw{width:14px; height:14px; border-radius:var(--r-sm); flex:none}
.inspectorEmpty .sw.light{background:var(--scale-light)}
.inspectorEmpty .sw.mid{background:var(--scale-mid)}
.inspectorEmpty .sw.heavy{background:var(--scale-heavy)}
.inspectorEmpty .fine{font-size:var(--fs-xs); color:var(--muted)}

/* ヘッダの幅も本文に合わせる（いまは 560px 決め打ち） */
.hd{max-width:none}
@media (min-width:1024px){ .hd{max-width:1400px} }
@media (min-width:1440px){ .hd{max-width:1560px} }
```

- [ ] **Step 5: `web/assets/app.js` に選択状態を足す**

いまカードのクリックは `bindCardHandler` が `.detail` を開いている。
**描画関数は増やさない。出力先だけ切り替える。**

`app.js` の末尾近く、`bindCardHandler` の定義の直後に足す：

```javascript
/* ── 選択状態 ─────────────────────────
 * PC（1024px 以上）では詳細を右カラムに出す。
 * スマホではいままで通りカードの中に開く。
 * 詳細を組み立てる関数は1つのまま。差し込む場所だけ変える。
 * ここを2本に分けると、片方だけ直して片方が古いまま、が必ず起きる。
 */
let selectedCourseId = null;
const mqDesktop = window.matchMedia("(min-width:1024px)");
const isDesktop = () => mqDesktop.matches;

function showDetail(course, cardEl){
  selectedCourseId = course.id;
  document.querySelectorAll(".card.sel").forEach(el => el.classList.remove("sel"));
  if (cardEl) cardEl.classList.add("sel");

  const html = detailHTML(course);          // 既存の詳細組み立て関数
  if (isDesktop()){
    document.querySelector("#inspector").innerHTML = html;
    document.querySelector("#inspector").scrollTop = 0;
  } else {
    if (cardEl){
      cardEl.querySelector(".detail").innerHTML = html;
      cardEl.classList.toggle("open");
    }
  }
}

/* 画面幅が変わったとき（PC で横幅を縮めた・スマホを回した）に、
   詳細が「どちらにも出ていない」状態にならないよう描き直す。 */
mqDesktop.addEventListener("change", () => {
  if (!selectedCourseId) return;
  const c = courses.find(x => x.id === selectedCourseId);
  if (!c) return;
  const cardEl = document.querySelector(`.card[data-id="${CSS.escape(c.id)}"]`);
  showDetail(c, cardEl);
});
```

**`detailHTML(course)` は、いまカード内に差している詳細 HTML を組み立てている
処理を関数として切り出したもの。** `bindCardHandler` の中でインラインに
組み立てているなら、そこを `function detailHTML(c){ return `...`; }` として
外に出し、`bindCardHandler` からは `showDetail(course, cardEl)` を呼ぶだけにする。

カードに `data-id` が付いていない場合は、カード生成箇所（`renderMore` の中の
テンプレート文字列）で `<div class="card" data-id="${esc(c.id)}">` にしておく。

- [ ] **Step 6: テストが通ることを確認する**

```bash
python3 tools/test_layout.py       # OK
python3 tools/test_tokens.py       # OK
python3 tools/test_web_split.py    # OK
```

- [ ] **Step 7: 4つの幅で目視確認する**

```bash
python3 server.py
```

ブラウザの幅を変えながら確認する：

| 幅 | 期待 |
|---|---|
| 390px | いまと同じ1列。カードを押すと中に詳細が開く |
| 800px | 左に絞り込み、右に一覧の2カラム |
| 1280px | 3カラム。カードを押すと**右カラム**に詳細。カードにオレンジの枠 |
| 1500px | 3カラムのまま、右カラムが広がる |

さらに：
- 1280px で左カラムだけを下までスクロールできること（中カラムが動かないこと）
- 何も選んでいないとき、右カラムに「数字の読み方」が出ていること
- 1280px から 800px へ縮めても詳細が消えないこと

- [ ] **Step 8: コミット**

```bash
git add web/index.html web/assets/app.css web/assets/app.js tools/test_layout.py
git commit -m "feat: PC を3カラムのワークベンチにする

これまで幅ベースの @media が1つも無く、PC でも 560px の1列だった。
768 / 1024 / 1440 の3段を足し、1024 以上で
左：絞り込み／中：一覧／右：詳細 の3カラムにする。

詳細の組み立て関数は1本のまま、差し込む場所だけ
matchMedia で切り替える。2本に分けると片方が古くなるため。

入口は空きコマグリッド、という前提に合わせて
左カラムの並びも「空きコマ → 学年 → 優先度」へ変えた。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 無限スクロールをやめてページングにする

**Files:**
- Modify: `web/assets/app.js`（`renderMore` / `onScrollCheck` / `load` を書き換え）
- Modify: `web/assets/app.css`（ページャと推薦枠のスタイル）
- Modify: `web/index.html`（`#list` の後にページャを置く）

**Interfaces:**
- Consumes: Task 4 の `.results`
- Produces: `let page = 1;` と `const PAGE_SIZE = 24;`、
  `function renderPage(n)` → `void`、`function renderPager()` → `void`。
  `onScrollCheck` と `LOAD_MARGIN` は**削除**され、以降のタスクは参照しない。

- [ ] **Step 1: `app.js` から無限スクロールを取り除く**

削除するもの：
- `function onScrollCheck()` の定義全体
- `window.addEventListener("scroll", onScrollCheck, { passive: true });`
- `window.addEventListener("resize", onScrollCheck);`
- `const LOAD_MARGIN = ...`（あれば）
- `let shown = 0;` とその参照

- [ ] **Step 2: ページングを書く**

```javascript
/* ── 一覧のページング ───────────────────
 * 無限スクロールをやめた理由：
 * 1,112件が終わりなく流れるだけで、終点も現在位置も分からなかった。
 * それに「1,112件」という数字を並べて見せること自体が、
 * 「あなたが1,112件を見比べてください」という意味になっていた。
 * このサービスの価値は絞ったことのほうにある。
 */
const PAGE_SIZE = 24;
const TOP_PICKS = 5;
let page = 1;

/* 1ページ目の先頭に出す推薦枠。検証ずみの科目からだけ選ぶ。
   ⚠️ 本一覧の並び順そのものは変えない。
   ROADMAP 1章の「おすすめ順を検証ずみ優先に」は未決定のまま。
   ここで足すのは視覚的に独立した枠だけで、その決定を先取りしない。 */
function topPicks(){
  return courses.filter(c => c.reviews && c.reviews.scored).slice(0, TOP_PICKS);
}

function renderPage(n){
  page = Math.max(1, Math.min(n, Math.ceil(courses.length / PAGE_SIZE) || 1));
  const list = document.querySelector("#list");
  list.innerHTML = "";

  if (page === 1){
    const picks = topPicks();
    if (picks.length){
      const box = document.createElement("section");
      box.className = "picks";
      box.innerHTML = `<h2 class="picksH">あなたに合う${picks.length}件
        <span class="sub">人が確認ずみの科目から</span></h2>`;
      picks.forEach(c => {
        const n = cardEl(c);
        box.appendChild(n);
        bindCardHandler(n, c);
      });
      list.appendChild(box);
    }
  }

  const start = (page - 1) * PAGE_SIZE;
  courses.slice(start, start + PAGE_SIZE).forEach(c => {
    const n = cardEl(c);
    list.appendChild(n);
    bindCardHandler(n, c);
  });

  renderPager();

  /* 動くのは一覧のカラムだけ。左の絞り込みと右の詳細は動かさない。
     ページ全体が飛ぶと、いま何を絞っていたのか分からなくなる。 */
  const results = document.querySelector(".results");
  if (results) results.scrollTop = 0;
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderPager(){
  const total = Math.ceil(courses.length / PAGE_SIZE) || 1;
  const el = document.querySelector("#pager");
  if (!el) return;
  if (total <= 1){ el.innerHTML = ""; return; }

  const shownTo = Math.min(page * PAGE_SIZE, courses.length);
  const nums = [];
  for (let i = 1; i <= total; i++){
    // 先頭・末尾・現在の前後2つだけ出す。1,112件だと47ページになるので全部は出せない。
    if (i === 1 || i === total || Math.abs(i - page) <= 2) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }

  el.innerHTML = `
    <div class="pagerPos">${shownTo} / ${courses.length}件</div>
    <button class="pagerMore" ${page >= total ? "disabled" : ""}>もっと見る</button>
    <div class="pagerNums">
      ${nums.map(n => n === "…"
        ? `<span class="gap">…</span>`
        : `<button class="pn${n === page ? " on" : ""}" data-p="${n}">${n}</button>`).join("")}
    </div>`;

  el.querySelectorAll(".pn").forEach(b => {
    b.onclick = () => renderPage(+b.dataset.p);
  });
  const more = el.querySelector(".pagerMore");
  if (more) more.onclick = () => renderPage(page + 1);
}
```

`cardEl(c)` は、いま `renderMore` の中でカードの DOM を作っている処理を
関数として切り出したもの。`renderMore` を消す際に一緒に切り出す。

- [ ] **Step 3: `load()` の末尾を差し替える**

```javascript
  $("#list").innerHTML = "";
  if (d.count){
    renderPage(1);
  } else {
    $("#list").innerHTML =
      `<div class="empty">条件に合う科目がありません。<br>条件チップを外すか、別のコマを押してみてください。</div>`;
    renderPager();
  }
```

- [ ] **Step 4: `web/index.html` にページャを置く**

`<div id="list"></div>` の直後に：

```html
      <nav class="pager" id="pager" aria-label="ページ送り"></nav>
```

- [ ] **Step 5: `app.css` にスタイルを足す**

```css
/* 推薦枠。下の一覧とはっきり分ける。
   同じ見た目で上に置くと「ただの並び順」に見えてしまい、
   「人が確認ずみのものを選んである」という意味が伝わらない。 */
.picks{
  background:var(--brand-soft);
  border-radius:var(--r-lg);
  padding:var(--sp-3);
  margin-bottom:var(--sp-5);
}
.picksH{margin:0 0 var(--sp-2); font-size:var(--fs-h2)}
.picksH .sub{font-weight:400; font-size:var(--fs-xs); color:var(--muted); margin-left:var(--sp-2)}

/* ページャ。スマホは「もっと見る」、PC はページ番号を主にする。 */
.pager{
  display:flex; flex-direction:column; align-items:center;
  gap:var(--sp-2); padding:var(--sp-5) 0;
}
.pagerPos{font-size:var(--fs-sm); color:var(--muted);
  font-family:var(--data); font-variant-numeric:tabular-nums}
.pagerMore{
  padding:var(--sp-3) var(--sp-6);
  border:1px solid var(--brand); border-radius:var(--r-pill);
  background:transparent; color:var(--brand);
  font:inherit; font-size:var(--fs-base); cursor:pointer;
  transition:background var(--dur) var(--ease-out);
}
.pagerMore:hover:not(:disabled){background:var(--brand-soft)}
.pagerMore:disabled{opacity:.4; cursor:default}
.pagerNums{display:none; gap:var(--sp-1); flex-wrap:wrap; justify-content:center}
.pagerNums .pn{
  min-width:34px; padding:var(--sp-1) var(--sp-2);
  border:1px solid var(--rule); border-radius:var(--r-sm);
  background:var(--card); color:var(--ink);
  font:inherit; font-family:var(--data); cursor:pointer;
}
.pagerNums .pn.on{background:var(--brand); color:var(--brand-ink); border-color:var(--brand)}
.pagerNums .gap{color:var(--muted); padding:0 var(--sp-1)}

@media (min-width:768px){
  .pager{flex-direction:row; justify-content:space-between}
  .pagerNums{display:flex}
}
```

- [ ] **Step 6: 目視で確認する**

```bash
python3 server.py
```

- 一覧が24件で止まり、下にページャが出ること
- 「24 / 1,112件」の位置表示が正しいこと
- 1ページ目の先頭に推薦枠が出ること（`scored` の科目が0件なら**出ないのが正しい**。
  現時点で門を越えた科目は0件なので、枠が出ないのが期待値）
- PC でページ番号を押すと**中カラムだけ**が先頭へ戻ること
- 47ページ目まで行けること、`…` の省略が壊れていないこと
- スクロールしても勝手に追加読み込みが起きないこと

- [ ] **Step 7: コミット**

```bash
git add web/index.html web/assets/app.js web/assets/app.css
git commit -m "feat: 無限スクロールをやめてページングにする

1,112件が終わりなく流れるだけで、終点も現在位置も無かった。
24件ずつに区切り、PC はページ番号、スマホは「もっと見る」。
ページ送りで動くのは一覧のカラムだけにする。

1ページ目の先頭に、人が確認ずみの科目だけを集めた
推薦枠を置く。本一覧の並び順は触っていない
（ROADMAP 1章の「検証ずみ優先」案は未決定のまま）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 外殻テンプレート＋ナビ＋ロゴ下の GUILD 2行

**Files:**
- Create: `templates/shell.html`
- Modify: `build.py`（外殻を注入する関数を追加）
- Modify: `web/index.html`（ヘッダとフッタを `<!--SHELL:HEADER-->` `<!--SHELL:FOOTER-->` へ）
- Modify: `web/assets/app.css`（ヘッダ・ナビ・ロックアップ）
- Modify: `server.py`（拡張子なしのパスを `.html` へ解決）
- Create: `tools/test_shell_inject.py`

**Interfaces:**
- Consumes: Task 2 のトークン
- Produces: `build.py` の `inject_shell(html_path: Path, shell: dict[str, str]) -> None`。
  `templates/shell.html` が `<!--PART:HEADER-->` と `<!--PART:FOOTER-->` で
  区切られ、対象ページ側の `<!--SHELL:HEADER-->` `<!--SHELL:FOOTER-->` を置換する。
  Task 7 の `about.html` も同じ仕組みに乗る。

- [ ] **Step 1: 失敗するテストを書く**

```python
# tools/test_shell_inject.py
"""2ページの外殻が同一で、レッドライン文言があることを確かめる。

ブランド資料と実装が2週間ズレた（旧 B-3）のと同じことが、
index.html と about.html の間で起きるのを防ぐ。
コピーを2つ持つと必ず漂う。正本は templates/shell.html ひとつ。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / "web" / "index.html"
ABOUT = ROOT / "web" / "about.html"
SHELL = ROOT / "templates" / "shell.html"

REDLINE = "学生団体 GUILD が運営しています"

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


check(SHELL.is_file(), "templates/shell.html が無い")
check(INDEX.is_file(), "web/index.html が無い")

if SHELL.is_file():
    s = SHELL.read_text(encoding="utf-8")
    check("<!--PART:HEADER-->" in s, "shell.html に <!--PART:HEADER--> が無い")
    check("<!--PART:FOOTER-->" in s, "shell.html に <!--PART:FOOTER--> が無い")
    check("Designed by GUILD" in s, "shell.html に Designed by GUILD が無い")
    check("AI Community" in s, "shell.html に AI Community が無い")
    check(REDLINE in s, f"shell.html に「{REDLINE}」が無い（レッドライン）")
    for nav in ["科目をさがす", "About ラクハン", "口コミを書く"]:
        check(nav in s, f"shell.html のナビに「{nav}」が無い")


def shell_of(path):
    """注入ずみのページから header と footer を抜き出す。"""
    t = path.read_text(encoding="utf-8")
    head = re.search(r"<header[\s\S]*?</header>", t)
    foot = re.search(r"<footer[\s\S]*?</footer>", t)
    return (head.group(0) if head else None, foot.group(0) if foot else None)


if INDEX.is_file() and ABOUT.is_file():
    ih, if_ = shell_of(INDEX)
    ah, af = shell_of(ABOUT)
    check(ih is not None, "index.html に <header> が無い（注入されていない）")
    check(ah is not None, "about.html に <header> が無い（注入されていない）")
    check(ih == ah, "index.html と about.html のヘッダが違う（外殻が漂っている）")
    check(if_ == af, "index.html と about.html のフッタが違う（外殻が漂っている）")
    check(if_ is not None and REDLINE in if_,
          f"フッタに「{REDLINE}」が無い")
    check("<!--SHELL:HEADER-->" not in INDEX.read_text(encoding="utf-8"),
          "index.html にプレースホルダが残っている（build.py を流していない）")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("  通過 16 件")
print("OK")
```

- [ ] **Step 2: テストが落ちることを確認する**

実行: `python3 tools/test_shell_inject.py`
期待: `NG`、`templates/shell.html が無い` から始まる。終了コード 1。

- [ ] **Step 3: `templates/shell.html` を作る**

```html
<!--PART:HEADER-->
<header>
  <div class="hd">
    <!-- マークが「ラ」の字形なので、読み上げは h1 側でまとめて与える。
         そうしないと「ラ」が絵として飛ばされ「クハン」だけが読まれる。 -->
    <a class="lockup" href="/">
      <h1 aria-label="ラクハン ― 阪大 全学教育科目">
        <svg class="mark" viewBox="11 10 41 45" fill="none" aria-hidden="true">
          <g stroke="var(--brand)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
            <path class="s1" d="M26 14H48"/>
            <path class="s2" d="M15 29H45c5 0 6.5 4 3 7L30 51"/>
          </g>
        </svg><span class="wm">クハン</span><small>阪大 全学教育科目</small>
      </h1>
      <!-- ロゴ本体（ロックアップ）には GUILD を入れない、というのが
           ブランド資料の決定。だからこの2行は視覚的に分離した添え物として
           置いている。細い縦線で2行を1つの塊にまとめているのは、
           「GUILD＝AI コミュニティ」と読ませるため。並列の宣言に見えると
           「ラクハンが AI 製品」と誤読される。 -->
      <span class="by">
        <span class="byMain">Designed by GUILD</span>
        <span class="bySub">AI Community</span>
      </span>
    </a>
    <nav class="nav" aria-label="メインメニュー">
      <a href="/" data-nav="home">科目をさがす</a>
      <a href="/about" data-nav="about">About ラクハン</a>
      <a href="https://magnificent-scone-0d2071.netlify.app/" target="_blank" rel="noopener">口コミを書く<span class="ext" aria-hidden="true">↗</span></a>
    </nav>
  </div>
</header>
<!--/PART:HEADER-->

<!--PART:FOOTER-->
<footer>
  <p class="disclaimer">
    数値はシラバスの事実項目からの機械的な算出で、単位取得を保証するものではありません。
    <b>履修の最終判断は必ず KOAN の公式シラバスで確認してください。</b>
  </p>
  <p class="who">
    <b>学生団体 GUILD が運営しています。</b>
    大阪大学の公式サービスではありません。
  </p>
</footer>
<!--/PART:FOOTER-->
```

口コミフォームの URL は `tools/ingest_reviews.py` の docstring に書かれている
実際のもの（しゅんやさんが運用しているフォーム）。**2箇所に同じ URL を書くことになるので、
差し替えるときは shell.html と about.html の両方を直すこと。**

- [ ] **Step 4: `build.py` に注入を足す**

`build.py` の `main()` の**末尾**（`print` で結果を出している箇所の後）に足す。
まず import と定数をファイル上部（`OUT_REVIEWS` の定義の下）に：

```python
SHELL = ROOT / "templates" / "shell.html"
PAGES = [ROOT / "web" / "index.html", ROOT / "web" / "about.html"]
```

そして関数を `main()` の前に：

```python
def read_shell() -> dict[str, str]:
    """templates/shell.html から差し込む部品を取り出す。

    ヘッダとフッタを2ページに手でコピーすると、必ず片方だけ古くなる。
    ブランド資料と実装が2週間ズレたのと同じ事故（旧 B-3）を、
    ページ間で繰り返さないための唯一の正本。
    """
    t = SHELL.read_text(encoding="utf-8")
    parts = {}
    for name in ("HEADER", "FOOTER"):
        start = t.index(f"<!--PART:{name}-->") + len(f"<!--PART:{name}-->")
        end = t.index(f"<!--/PART:{name}-->")
        parts[name] = t[start:end].strip()
    return parts


def inject_shell(page: Path, parts: dict[str, str]) -> bool:
    """1ページ分の <!--SHELL:XXX--> を置き換える。中身が変わったら True。"""
    if not page.is_file():
        return False
    before = page.read_text(encoding="utf-8")
    after = before
    for name, html in parts.items():
        # 2回目以降は、前回入れた中身ごと入れ替える。
        # プレースホルダを残したままにしないと1度しか注入できない。
        marker = f"<!--SHELL:{name}-->"
        endmark = f"<!--/SHELL:{name}-->"
        if marker not in after:
            continue
        i = after.index(marker) + len(marker)
        j = after.index(endmark) if endmark in after else i
        after = after[:i] + "\n" + html + "\n" + after[j:]
    if after != before:
        page.write_text(after, encoding="utf-8")
        return True
    return False
```

`main()` の末尾に：

```python
    parts = read_shell()
    changed = [p.name for p in PAGES if inject_shell(p, parts)]
    if changed:
        print(f"  外殻を注入: {', '.join(changed)}")
    else:
        print("  外殻に変更なし")
```

- [ ] **Step 5: `web/index.html` をプレースホルダ方式にする**

いまの `<header>...</header>` を丸ごと次に置き換える：

```html
<!--SHELL:HEADER--><!--/SHELL:HEADER-->
```

いまの `<footer>...</footer>` を丸ごと次に置き換える：

```html
<!--SHELL:FOOTER--><!--/SHELL:FOOTER-->
```

- [ ] **Step 6: `server.py` に拡張子なしパスの解決を足す**

`server.py` の 445行付近、`rel = "index.html" if path == "/" else path.lstrip("/")` の直後に：

```python
        # /about のように拡張子が無いパスは .html として探す。
        # Cloudflare の静的アセット配信は既定でこれをやるので、
        # 手元のサーバでも同じ挙動にしておかないと
        # 「本番では動くのにローカルで 404」になる。
        if "." not in rel.rsplit("/", 1)[-1]:
            cand = WEB_DIR / (rel + ".html")
            if cand.is_file():
                rel = rel + ".html"
```

- [ ] **Step 7: `app.css` にヘッダとナビを足す**

```css
/* ── ヘッダ ─────────────────────────── */
header{background:var(--brand-ground); padding:var(--sp-3) var(--pad)}
.hd{
  max-width:none; margin:0 auto;
  display:flex; align-items:center; justify-content:space-between;
  gap:var(--sp-4); flex-wrap:wrap;
}
.lockup{display:flex; align-items:center; gap:var(--sp-3);
  text-decoration:none; flex-wrap:wrap}
h1{margin:0; display:flex; align-items:baseline}
h1 .mark{display:block; height:19px; width:auto; align-self:center;
  margin-right:.11em; transform:translateY(.5px)}
h1 .wm{font-size:20px; font-weight:800; color:#fff; letter-spacing:.11em;
  line-height:1; padding-right:.11em; white-space:nowrap}
h1 small{font-size:var(--fs-xs); font-weight:400; letter-spacing:.02em;
  color:rgba(255,255,255,.62); margin-left:var(--sp-2); align-self:center}

/* GUILD の2行。縦線で1つの塊にまとめ、
   「GUILD＝AI コミュニティ」と読ませる。
   2行が並列に見えると「ラクハンが AI 製品」と誤読される。 */
.by{
  display:flex; flex-direction:column;
  padding-left:var(--sp-2);
  border-left:1px solid rgba(255,255,255,.28);
  line-height:1.35;
}
.byMain{font-size:var(--fs-xs); font-weight:600; color:rgba(255,255,255,.82)}
.bySub{font-size:10px; font-weight:400; letter-spacing:.14em;
  color:rgba(255,255,255,.5); text-transform:uppercase}

/* ── ナビ ───────────────────────────── */
.nav{display:flex; gap:var(--sp-4); align-items:center}
.nav a{
  color:rgba(255,255,255,.78); text-decoration:none;
  font-size:var(--fs-sm); padding:var(--sp-1) 0;
  border-bottom:2px solid transparent;
  transition:color var(--dur) var(--ease-out),
             border-color var(--dur) var(--ease-out);
}
.nav a:hover{color:#fff}
.nav a[aria-current="page"]{color:#fff; border-bottom-color:var(--brand)}
.nav .ext{font-size:10px; margin-left:2px; opacity:.7}

/* 狭い画面ではロックアップとナビを2段にする。 */
@media (max-width:639px){
  .hd{flex-direction:column; align-items:flex-start; gap:var(--sp-2)}
  .nav{gap:var(--sp-3); font-size:var(--fs-xs)}
}
@media (min-width:1024px){ .hd{max-width:1400px} }
@media (min-width:1440px){ .hd{max-width:1560px} }

/* ── フッタ ─────────────────────────── */
footer{
  border-top:1px solid var(--rule);
  margin-top:var(--sp-7); padding:var(--sp-5) 0;
  font-size:var(--fs-xs); color:var(--muted);
}
footer .who{margin-top:var(--sp-3)}
footer .who b{color:var(--soft)}
```

- [ ] **Step 8: 現在ページを示す**

`app.js` の末尾に：

```javascript
/* ナビの現在地。ページを分けた以上、どこにいるか分からないのは事故。 */
(() => {
  const here = location.pathname.replace(/\/$/, "") || "/";
  const key = here === "/" || here === "/index.html" ? "home"
            : here.startsWith("/about") ? "about" : null;
  if (!key) return;
  const el = document.querySelector(`.nav a[data-nav="${key}"]`);
  if (el) el.setAttribute("aria-current", "page");
})();
```

- [ ] **Step 9: 流して確認する**

```bash
python3 build.py                    # 「外殻を注入: index.html」が出ること
python3 tools/test_scoring_gate.py  # 既存テストが壊れていないこと
python3 tools/test_reviews.py
python3 server.py
```

`tools/test_shell_inject.py` は `about.html` がまだ無いので**この時点では落ちる**。
Task 7 で通す。

目視：
- ヘッダのロゴ下に `Designed by GUILD` / `AI Community` が縦線付きで出ていること
- ナビ3項目が出て、「科目をさがす」に下線（現在地）が付いていること
- フッタに「学生団体 GUILD が運営しています。大阪大学の公式サービスではありません。」があること
- 390px でヘッダが2段になること

- [ ] **Step 10: コミット**

```bash
git add templates/shell.html build.py server.py web/index.html web/assets/app.css web/assets/app.js tools/test_shell_inject.py
git commit -m "feat: 外殻をテンプレート化し、ナビと GUILD の記載を入れる

ヘッダ・ナビ・フッタの正本を templates/shell.html ひとつにして、
build.py が各ページへ注入する。コピーを2つ持つと必ず漂うため。

- ロゴ下に Designed by GUILD / AI Community の2行
  （ロゴ本体には入れない、というブランド資料の決定は守る）
- フッタに「学生団体 GUILD が運営しています」（旧 B-2 完了）
- server.py が拡張子なしのパスを .html へ解決（本番と挙動を揃える）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: About ラクハン のページを作る

**Files:**
- Create: `web/about.html`
- Modify: `web/assets/app.css`（About の文章レイアウト）
- Modify: `web/index.html`（説明の小字をここへ引き揚げ、リンクに置き換える）

**Interfaces:**
- Consumes: Task 6 の `<!--SHELL:HEADER-->` 方式
- Produces: `/about` で開けるページ。`tools/test_shell_inject.py` がここで初めて通る。

- [ ] **Step 1: `web/about.html` を作る**

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>About ラクハン ― 学生団体 GUILD が作る、阪大の全学教育科目の重さを出すサービス</title>
<meta name="description" content="ラクハンは阪大の全学教育科目の「重さ」を試験・レポート・出席・規模の4軸で出すサービスです。学生団体 GUILD が運営しています。">
<link rel="icon" href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14.4" fill="%23DB6209"/><svg x="12.16" y="12.16" width="39.68" height="39.68" viewBox="0 0 64 64" fill="none"><g stroke="%23fff" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"><path d="M26 14H48"/><path d="M15 29H45c5 0 6.5 4 3 7L30 51"/></g></svg></svg>'>
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>

<!--SHELL:HEADER--><!--/SHELL:HEADER-->

<div class="wrap prose">

  <h2 id="what">ラクハンとは</h2>
  <p>阪大の全学教育科目 1,112件について、その科目が
  <b>どれくらい手間がかかるか</b>を、シラバスに書かれている事実から機械的に出しています。
  登録もログインも要りません。</p>

  <h2 id="why">なぜ作ったか</h2>
  <p>「楽な科目を知りたい」という需要は、紙の講義情報誌が長いあいだ引き受けてきました。
  ただ紙は、毎年配り直さないと更新できません。
  シラバスは毎年 KOAN で公開されているのだから、そこから機械的に出せば
  毎年ひとりでに新しくなる、というのが出発点です。</p>

  <h2 id="howto">数字の読み方</h2>

  <h3>4つの軸</h3>
  <p>ひとつの点数に潰していません。潰すと「なぜその点なのか」を示せなくなり、
  数字が外れた瞬間に信用がなくなるからです。</p>
  <ul>
    <li><b>試験</b> ―― 定期試験の比重と、持ち込みの可否</li>
    <li><b>レポート</b> ―― レポート・課題の比重</li>
    <li><b>出席</b> ―― 出席や平常点の比重</li>
    <li><b>規模</b> ―― 受講者数の目安</li>
  </ul>

  <h3>相性</h3>
  <p>4軸に「あなたが何を避けたいか」の重みを掛けたものです。
  同じ科目でも、試験が嫌な人とレポートが嫌な人では答えが変わります。
  だから全員に同じ順位を出していません。</p>

  <h3>信頼度</h3>
  <p>その数字が<b>シラバスの形だけから出したもの</b>か、
  <b>実際に受けた人が確認したもの</b>かの区別です。
  一番重い軸が測れていない科目には総合値を出さず「情報不足」と表示します。
  分からないことは、分からないと出します。</p>

  <h3>S〜F のような一文字を出さない理由</h3>
  <p>一文字に潰すと根拠を示せません。
  また「この科目は C」と書くことは、その科目への評価そのものになります。
  ラクハンが出すのは<b>手間の内訳</b>であって、良し悪しの判定ではありません。</p>

  <h3>教員のランキングを作らない理由</h3>
  <p>担当教員名はコマを特定するために必要なので、事実として載せています。
  ただし「教員別ランキング」「この先生の他の科目」を作った瞬間、
  事実の並記が<b>人物の評価</b>に変わります。評価の対象は科目だけです。</p>

  <h2 id="data">データの出どころ</h2>
  <p>KOAN の公開シラバス（ログイン不要で誰でも見られるもの）です。
  2026年度の共通教育科目 1,112件を取得しています。</p>
  <p>ただし、シラバスに<b>載っていない</b>ものがあります。</p>
  <ul>
    <li>定員</li>
    <li>レポートの本数</li>
    <li>レポートの字数</li>
    <li>授業時間外の学習時間</li>
    <li>毎回の小テストの有無</li>
  </ul>
  <p>この5つは、実際に受けた人にしか分かりません。
  だから口コミで聞いているのは、ちょうどこの5つです。
  シラバスから取れるものを口コミで聞き直したりはしていません。</p>
  <p><a href="https://magnificent-scone-0d2071.netlify.app/" target="_blank" rel="noopener">口コミを書く ↗</a></p>

  <h2 id="guild">GUILD とは</h2>
  <p>GUILD は AI コミュニティです。
  「作りたいものを、作れる人が集まって作る」ことを続けている学生の集まりで、
  ラクハンはそこから出た最初のサービスです。</p>
  <p>ラクハンは<b>6名</b>（大阪大学4名・京都大学2名）で作っています。
  スクレイピング、採点、フロントエンド、口コミの収集、LINE 連携を分担しています。</p>

  <h2 id="who">運営</h2>
  <p class="callout">
    <b>学生団体 GUILD が運営しています。</b><br>
    大阪大学の公式サービスではありません。
    大学から提供された情報でも、大学が承認したものでもありません。
  </p>

  <h2 id="disclaimer">免責</h2>
  <p>数値はシラバスの事実項目からの機械的な算出で、単位取得を保証するものではありません。
  <b>履修の最終判断は必ず KOAN の公式シラバスで確認してください。</b></p>
  <p>過去問は扱っていません。載せているのは試験の傾向までです。</p>

</div>

<!--SHELL:FOOTER--><!--/SHELL:FOOTER-->

<script src="/assets/app.js" defer></script>
</body>
</html>
```

**⚠️ メンバーの実名は書いていない。** 全員の同意が取れるまでこのまま。
`HANDOFF.md` に名前があることと、公開ページに載せることは別。

- [ ] **Step 2: `app.css` に文章用のスタイルを足す**

```css
/* ── About などの読み物ページ ───────────── */
.prose{max-width:68ch; padding-top:var(--sp-6)}
.prose h2{
  margin:var(--sp-7) 0 var(--sp-3);
  font-size:var(--fs-lg);
  padding-bottom:var(--sp-2);
  border-bottom:2px solid var(--brand);
  display:inline-block;
}
.prose h3{margin:var(--sp-5) 0 var(--sp-2); font-size:var(--fs-base)}
.prose p{margin:0 0 var(--sp-3)}
.prose ul{margin:0 0 var(--sp-3); padding-left:1.3em}
.prose li{margin-bottom:var(--sp-1)}
.prose a{color:var(--brand); text-underline-offset:2px}
.prose .callout{
  background:var(--brand-soft);
  border-left:3px solid var(--brand);
  border-radius:0 var(--r-md) var(--r-md) 0;
  padding:var(--sp-3) var(--sp-4);
}
@media (min-width:1024px){ .prose{padding-top:var(--sp-7)} }
```

- [ ] **Step 3: ワークベンチから説明の小字を引き揚げる**

`web/index.html` の各 `<h2>` に付いている `<span class="sub">` のうち、
**説明になっているもの**を削り、右カラムの空状態と About への導線に任せる。

| 残す | 消す |
|---|---|
| `空きコマからさがす` の「数字はその枠の科目数」（操作の説明） | ― |
| ― | `口コミ` の「シラバスの形だけで出した数字か、人が確認した数字か」 |
| ― | `あなたの優先度` の「同じ科目でも、人によって「楽」は違う」 |

代わりに左カラムの末尾へ：

```html
      <p class="railNote"><a href="/about#howto">数字の読み方 →</a></p>
```

```css
.railNote{margin-top:var(--sp-5); font-size:var(--fs-sm)}
.railNote a{color:var(--brand); text-decoration:none}
.railNote a:hover{text-decoration:underline}
```

- [ ] **Step 4: 流してテストを通す**

```bash
python3 build.py                     # 「外殻を注入: index.html, about.html」
python3 tools/test_shell_inject.py   # ここで初めて OK
python3 tools/test_layout.py
python3 tools/test_tokens.py
python3 tools/test_web_split.py
python3 server.py
```

目視：
- `http://localhost:8000/about` が開くこと（拡張子なしで）
- `http://localhost:8000/about.html` も開くこと
- ナビの「About ラクハン」に下線が付いていること
- ヘッダとフッタが index と完全に同じ見た目であること
- 1280px で本文が読みやすい幅（68文字）に収まっていること

- [ ] **Step 5: コミット**

```bash
git add web/about.html web/index.html web/assets/app.css
git commit -m "feat: About ラクハン のページを作る

7節構成（とは／なぜ作ったか／数字の読み方／データの出どころ／
GUILD とは／運営／免責）。実ファイルにしたのは、
8/26 の noindex 解除後に検索へ載せるため。

ワークベンチの見出し横にぶら下がっていた説明の小字を
ここへ引き揚げ、左カラムからはリンク1本にした。

メンバーの実名は載せていない（全員の同意が未取得のため）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: オープニング演出

**Files:**
- Create: `web/assets/splash.js`
- Modify: `web/assets/app.css`（演出のスタイル）
- Modify: `web/index.html`（ヒーローと覆いのマークアップ、`splash.js` の読み込み）
- Modify: `templates/shell.html`（覆いを外殻へ入れる場合はここ。今回は index のみ）

**Interfaces:**
- Consumes: Task 2 のモーショントークン、Task 6 のロゴマークアップ
- Produces: `window.rkSplash = { play(): Promise<void> }`。データ取得は
  `app.js` 側で先に発火しているので、演出は待たせない。

- [ ] **Step 1: `web/index.html` にヒーローと覆いを足す**

`<!--SHELL:HEADER-->` の**直後**に：

```html
<div class="splash" id="splash" aria-hidden="true" hidden>
  <div class="splashInner">
    <svg class="splashMark" viewBox="11 10 41 45" fill="none">
      <g stroke="var(--brand)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
        <path class="s1" d="M26 14H48"/>
        <path class="s2" d="M15 29H45c5 0 6.5 4 3 7L30 51"/>
      </g>
    </svg>
    <div class="splashWm"><span>ク</span><span>ハ</span><span>ン</span></div>
    <div class="splashBy">
      <span class="byMain">Designed by GUILD</span>
      <span class="bySub">AI Community</span>
    </div>
  </div>
</div>

<section class="hero">
  <h2 class="heroT">その科目、どれくらい手間がかかるか。</h2>
  <p class="heroP">阪大の全学教育科目 1,112件を、試験・レポート・出席・規模の4軸で。
  登録もログインも要りません。</p>
  <a class="heroCta" href="#workbench">科目をさがす</a>
  <p class="heroBy"><a href="/about">ラクハンについて / GUILD について →</a></p>
</section>
```

`.workbench` に `id="workbench"` を足す。

`</body>` の直前、`app.js` の**前**に：

```html
<script src="/assets/splash.js"></script>
```

**`defer` を付けない。** 覆いは最初の描画の前に出したい。

- [ ] **Step 2: `web/assets/splash.js` を書く**

```javascript
/* ラクハン オープニング演出
 *
 * ロゴは元から2本の SVG stroke path なので、筆順どおりに書き出せる。
 * 外部ライブラリは使わない。自分たちのブランド資産をそのまま動かす。
 *
 * 守っていること：
 *  1. データ取得を待たせない。app.js の fetch はこれと並行に走る。
 *     演出が終わってもデータが来ていなければ、一覧はスケルトンを出す。
 *     演出は「もともとある待ち時間」を覆うものであって、待ちを増やすものではない。
 *  2. 再訪では流さない。履修登録の時期は1日に何度も開く。
 *     毎回1.4秒止められるのは、道具としては邪魔でしかない。
 *  3. prefers-reduced-motion では完全にスキップする。
 *  4. 覆いの下のページはすでに描画ずみ。DOM もスクリーンリーダーも塞がない。
 */
(() => {
  const KEY = "rk_splash_at";
  const AGAIN_AFTER = 24 * 60 * 60 * 1000;   // 24時間

  const el = document.getElementById("splash");
  if (!el) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let last = 0;
  try { last = Number(localStorage.getItem(KEY) || 0); } catch (e) { last = 0; }
  const fresh = Date.now() - last > AGAIN_AFTER;

  if (reduced || !fresh){
    // 何もしない。覆いは hidden のまま。
    document.documentElement.classList.add("splash-skip");
    return;
  }

  try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* 無視 */ }

  el.hidden = false;
  document.documentElement.classList.add("splash-on");

  // 筆の長さを測って dashoffset の初期値にする。
  // 決め打ちの数字にすると、パスを直したとき静かに壊れる。
  el.querySelectorAll(".splashMark path").forEach(p => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
  });

  // 次のフレームでクラスを付けて、CSS のアニメーションを開始させる。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add("run");
  }));

  const done = () => {
    el.classList.add("out");
    el.addEventListener("transitionend", () => {
      el.hidden = true;
      document.documentElement.classList.remove("splash-on");
      document.documentElement.classList.add("splash-skip");
    }, { once: true });
  };

  // 1400ms 後に必ず終わる。transitionend を待つだけだと、
  // タブが裏に回ってアニメーションが走らなかったとき覆いが残る。
  setTimeout(done, 1400);

  // 押したら飛ばせるようにする。待たされるのが嫌な人を人質にしない。
  el.addEventListener("click", done);
  window.addEventListener("keydown", e => { if (e.key === "Escape") done(); }, { once: true });

  window.rkSplash = { skip: done };
})();
```

- [ ] **Step 3: `app.css` に演出とヒーローを足す**

```css
/* ── オープニング演出 ─────────────────── */
.splash{
  position:fixed; inset:0; z-index:100;
  background:var(--brand-ground);
  display:grid; place-items:center;
  opacity:1; transition:opacity var(--dur-slow) var(--ease-out);
}
.splash.out{opacity:0; pointer-events:none}
.splash[hidden]{display:none}
/* 覆いが出ているあいだは背後をスクロールさせない。
   下のページはもう描画ずみなので、DOM は塞がない。 */
html.splash-on{overflow:hidden}

.splashInner{display:flex; flex-direction:column; align-items:center; gap:var(--sp-3)}
.splashMark{height:64px; width:auto}

/* ① 「ラ」を2画で書き出す。2画目は 80ms 遅らせる。 */
.splash.run .splashMark .s1{animation:draw 380ms var(--ease-brand) forwards}
.splash.run .splashMark .s2{animation:draw 440ms var(--ease-brand) 80ms forwards}
@keyframes draw{ to{ stroke-dashoffset:0 } }

/* ② 「クハン」を1文字ずつ。40ms ずつずらす。 */
.splashWm{display:flex; font-size:34px; font-weight:800; color:#fff; letter-spacing:.11em}
.splashWm span{opacity:0; transform:translateY(3px)}
.splash.run .splashWm span{animation:rise 260ms var(--ease-out) forwards}
.splash.run .splashWm span:nth-child(1){animation-delay:420ms}
.splash.run .splashWm span:nth-child(2){animation-delay:460ms}
.splash.run .splashWm span:nth-child(3){animation-delay:500ms}
@keyframes rise{ to{ opacity:1; transform:translateY(0) } }

/* ③ 縦線が伸びて GUILD の2行が出る。 */
.splashBy{
  display:flex; flex-direction:column; align-items:flex-start;
  padding-left:var(--sp-2);
  border-left:1px solid rgba(255,255,255,.28);
  opacity:0; transform:scaleY(.6); transform-origin:top;
}
.splash.run .splashBy{animation:rise 300ms var(--ease-out) 700ms forwards}

/* ── ヒーロー ───────────────────────── */
.hero{
  padding:var(--sp-7) var(--pad) var(--sp-6);
  max-width:1560px; margin:0 auto;
}
.heroT{
  margin:0 0 var(--sp-3);
  font-size:var(--fs-hero); line-height:1.25; letter-spacing:-.01em;
  max-width:18ch;
}
.heroP{margin:0 0 var(--sp-5); max-width:52ch; color:var(--soft)}
.heroCta{
  display:inline-block; padding:var(--sp-3) var(--sp-6);
  background:var(--brand); color:var(--brand-ink);
  border-radius:var(--r-pill); text-decoration:none; font-weight:600;
  transition:transform var(--dur) var(--ease-out);
}
.heroCta:hover{transform:translateY(-1px)}
.heroBy{margin-top:var(--sp-4); font-size:var(--fs-sm)}
.heroBy a{color:var(--brand)}

/* 演出を見ていない人（再訪・reduced motion）にも、
   中身が順に入ってくる感じは残す。ただし一度だけ。 */
html.splash-skip .hero > *{animation:rise 320ms var(--ease-out) backwards}
html.splash-skip .heroT{animation-delay:0ms}
html.splash-skip .heroP{animation-delay:60ms}
html.splash-skip .heroCta{animation-delay:120ms}
```

- [ ] **Step 4: 確認する**

```bash
python3 server.py
```

| 確認 | 手順 | 期待 |
|---|---|---|
| 初回 | `localStorage.clear()` してリロード | 「ラ」が書かれ→「クハン」→ GUILD 2行→ 覆いが開く |
| 再訪 | そのままもう一度リロード | 演出なし。すぐヒーロー |
| 24時間後 | `localStorage.setItem("rk_splash_at","0")` してリロード | また流れる |
| 途中で飛ばす | 覆いをクリック / Esc | すぐ消える |
| reduced motion | OS の「視差効果を減らす」を ON | 演出なし |
| 裏タブ | 開いてすぐ別タブへ、5秒後に戻る | 覆いが残っていない |
| データ | Network を Slow 3G にしてリロード | 演出は 1.4秒で終わり、一覧はその後に入る（演出が伸びない） |

- [ ] **Step 5: コミット**

```bash
git add web/index.html web/assets/splash.js web/assets/app.css
git commit -m "feat: 筆順で書き出すオープニング演出を入れる

ロゴが元から2本の SVG stroke path なので、
stroke-dashoffset で筆順どおりに書ける。外部ライブラリ不要。

データ取得は演出と並行に走らせ、演出が終わってもデータが
来ていなければスケルトンを出す。演出は courses.built.json
（1.6MB / gzip 83KB）のもともとの待ちを覆うもので、
待ちを増やすものではない。

再訪では流さない（localStorage・24時間）。
prefers-reduced-motion では完全にスキップ。
クリックと Esc でいつでも飛ばせる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: スクショ対象を広げ、全体を確認する

**Files:**
- Modify: `tools/shots.mjs`
- Modify: `HANDOFF.md`（引き継ぎ4項目）

**Interfaces:**
- Consumes: Task 1〜8 すべて
- Produces: なし（検証のみ）

- [ ] **Step 1: `tools/shots.mjs` の `VIEWS` を差し替える**

```javascript
// 「壊れたら痛い画面」だけを撮る。増やしすぎると誰も見なくなる。
// 2026-08-22：PC は 1280 を1枚だけ撮っていたが、
// 「PC が 560px の縦棒」はその画像に22日間写っていたのに直らなかった。
// 段ごとに撮って、崩れが1枚に閉じ込められないようにする。
const VIEWS = [
  { name: "01-top-mobile",     path: "/",       w: 390,  h: 1600 },
  { name: "02-top-tablet",     path: "/",       w: 800,  h: 1400 },
  { name: "03-top-desktop",    path: "/",       w: 1280, h: 1400 },
  { name: "04-top-wide",       path: "/",       w: 1500, h: 1400 },
  { name: "05-search-mobile",  path: "/",       w: 390,  h: 1400, q: "統計" },
  { name: "06-detail-desktop", path: "/",       w: 1280, h: 1400, open: true },
  { name: "07-about-mobile",   path: "/about",  w: 390,  h: 2200 },
  { name: "08-about-desktop",  path: "/about",  w: 1280, h: 2000 },
  { name: "09-top-dark",       path: "/",       w: 1280, h: 1400, dark: true },
  { name: "10-progress",       path: "/progress.html", w: 1280, h: 1000 },
];
```

ページ生成の箇所を、ダークモードと演出スキップに対応させる：

```javascript
for (const v of VIEWS) {
  const page = await browser.newPage({
    viewport: { width: v.w, height: v.h },
    colorScheme: v.dark ? "dark" : "light",
    // 演出は毎回 1.4秒待たされるうえ、途中の1コマが写ると差分が毎回出る。
    // 撮影時は必ずスキップさせる。
    reducedMotion: "reduce",
  });
  await page.goto(base + v.path, { waitUntil: "networkidle" });

  if (v.q) {
    await page.fill("#q", v.q);
    await page.waitForTimeout(600);
  }
  if (v.open) {
    await page.waitForSelector(".card");
    await page.evaluate(() => document.querySelector(".card")?.click());
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${v.name}.png`, fullPage: true });
  console.log("shot:", v.name);
  await page.close();
}
```

**`open: true` の中身を変えている。** 旧コードは `.card` に `open` クラスを
足していたが、PC では詳細が右カラムに出るので、実際にクリックする形にした。

- [ ] **Step 2: 全テストを流す**

```bash
python3 build.py
python3 tools/test_web_split.py
python3 tools/test_tokens.py
python3 tools/test_layout.py
python3 tools/test_shell_inject.py
python3 tools/test_scoring_gate.py
python3 tools/test_reviews.py
```

**7つすべてが OK であること。** 1つでも落ちたら先へ進まない。

- [ ] **Step 3: スクショを撮って目で見る**

```bash
python3 server.py --port 8000 &
node tools/shots.mjs /tmp/rk-v2
open /tmp/rk-v2
```

10枚すべてを見て、崩れがないこと。

- [ ] **Step 4: 実機（スマホ）で見る**

```bash
python3 server.py --host 0.0.0.0
# 同じ Wi-Fi のスマホから http://<PCのIP>:8000
```

**このサービスの利用はほぼスマホなので、実機確認は必須。**
Task 1〜8 でモバイルの見た目を壊していないことを、ここで最終確認する。

- [ ] **Step 5: `HANDOFF.md` に引き継ぎ4項目を書く**

`HANDOFF.md` の先頭（ルールの直下）に、次の4項目を追記する。

1. 何が動く状態か ―― `python3 build.py && python3 server.py` で全部見られること、テスト7本
2. 何をしていないか ―― メンバー実名が未掲載であること、推薦枠が0件で出ないこと（門を越えた科目が0件なので正常）
3. 次の人が最初に打つコマンド
4. 踏んだ罠

- [ ] **Step 6: コミット**

```bash
git add tools/shots.mjs HANDOFF.md
git commit -m "test: スクショ対象を4段＋About＋ダークへ広げる

PC は 1280 の1枚だけだった。「PC が 560px の縦棒」は
その画像に22日間写っていたのに直らなかったので、
段ごとに撮って崩れが1枚に閉じ込められないようにする。

撮影時は reducedMotion:reduce を指定して演出をスキップさせる
（毎回1.4秒待つうえ、途中の1コマが写ると差分が毎回出るため）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 完了後 ―― 本番へ出す前に

**この計画が終わっても、まだ `main` にマージしない。**

1. 松下さんの合意が取れていること（`web/index.html` の担当者）
2. スクショ10枚をチームで確認すること
3. `ROADMAP.md` 5章の判定基準に照らすこと

マージすると約80秒で本番へ自動デプロイされる。戻し方はこのファイルの
冒頭「ロールバック」の節にある。
