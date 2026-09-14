# レポート軸を割合ベースに戻す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レポート軸を成績評価の割合で算出するようにして、全 7,906 件のうち 4,121 件（54%）が「情報不足」で点数を持たない状態を解消する。

**Architecture:** `score.py` の `_report_load` 一箇所を、本数・分量が無ければ `None` を返す実装から「まず割合で形を測り、量が取れていれば加算する」実装へ変える。軸が生き返ると分布が変わるので、同じ PR で band の閾値を実測に合わせて置き直す。`web/assets/app.js` と `server.py` は採点を複製していない（前者は `build.py` が焼いた値を読むだけ、後者は `import score`）ので変更しない。

**Tech Stack:** Python 3.14（標準ライブラリのみ、依存ゼロ）、テストは `python3 tools/test_*.py` の自作ハーネス（pytest は使わない）

**Spec:** `docs/superpowers/specs/2026-09-11-report-axis-ratio-design.md`

## Global Constraints

- Python は標準ライブラリのみ。新しい依存を足さない
- 採点の正本は `score.py` ひとつ。JS へ移植しない
- テストはネットワークに出ない
- `python3` の実体は `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`
- 作業ブランチは `docs/report-axis-ratio-spec`、worktree は `.worktrees/aisho-spec`。**本体の `main` を動かさない**
- band 閾値は切り上げない。同じ値に固まっている科目群の**上**に閾値を置かない

---

### Task 1: spec の「同期が必要な箇所」を実測に合わせて訂正

spec には `web/assets/app.js` と `server.py` の同期が要ると書いてあるが、実際に読むと
どちらも `_report_load` を複製していない。誤った指示のまま実装に入ると、要らない
変更を入れてしまう。

**Files:**
- Modify: `docs/superpowers/specs/2026-09-11-report-axis-ratio-design.md`（「同期が必要な箇所」節）

- [ ] **Step 1: 複製が無いことを自分の目で確かめる**

```bash
cd .worktrees/aisho-spec
grep -n "matchLocal" web/assets/app.js | head -3     # 1042行目で c.rakutan を渡している
sed -n '1030,1045p' web/assets/app.js                 # 焼いた値を読むだけ
grep -n "import score" server.py                      # 24行目 import score as scoring
```

期待: `app.js` は `c.rakutan`（`build.py` が焼いた採点結果）を受け取るだけで軸の値を
計算していない。`server.py` は `score.py` をそのまま import している。

- [ ] **Step 2: spec の該当節を書き換える**

「## 同期が必要な箇所」の中身を次に置き換える:

```markdown
## 同期が必要な箇所

実測で確認した結果、**採点の複製は無い**ので変更は `score.py` だけで足りる:

- `web/assets/app.js` の `matchLocal()` は `build.py` が焼いた `c.rakutan` を
  読むだけで、軸の値を計算していない（`app.js:1042`）
- `server.py` は `import score as scoring` で正本をそのまま使う（`server.py:24`）
- band の名前（「軽め」等）は変わらないので `app.js:9` の severity 表も触らない

必要なのは `build.py --rescore` による `web/data/courses.built.json` の焼き直しだけ。
```

- [ ] **Step 3: コミット**

```bash
git add docs/superpowers/specs/2026-09-11-report-axis-ratio-design.md
git commit -m "docs: spec の同期箇所を実測に合わせて訂正（app.js / server.py に複製は無い）"
```

---

### Task 2: レポート軸を割合ベースにする

**Files:**
- Create: `tools/test_report_axis.py`
- Modify: `score.py`（`REPORT_RATIO_COEF` の定義、`_report_load` は 185-224 行）

**Interfaces:**
- Consumes: なし
- Produces: `score._report_load(course: dict) -> tuple[float | None, list[str]]`
  ―― 戻り値の意味は従来どおり「0〜100 の楽さ（高いほど楽）」と evidence の文字列リスト。
  `eval_ratio` そのものが無い科目でだけ `(None, [])` を返す。
  定数 `score.REPORT_RATIO_COEF: float` を Task 3 は参照しない（閾値のみ扱う）。

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_report_axis.py` を新規作成:

```python
"""レポート軸のテスト。ネットワークには出ない。

    python3 tools/test_report_axis.py

設計は docs/superpowers/specs/2026-09-11-report-axis-ratio-design.md
"""
import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import score as scoring  # noqa: E402

BUILT = ROOT / "web" / "data" / "courses.built.json"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


# ── ① 割合だけでも値が出る ────────────────────────────
# 本数・分量が無いときに軸ごと None を返していたため、全7,906件の98%で
# レポート軸が動かず、科目ごと「情報不足」に落ちていた（4,121件）。
v, _ = scoring._report_load({"eval_ratio": {"report": 80.0, "exam": 20.0}})
check(v is not None, "割合だけの科目でレポート軸が None のまま")
check(v is not None and abs(v - 64.0) < 0.01,
      f"レポートが成績の80%なら 100-80*0.45=64 のはず: {v}")

# ── ② 割合が増えるほど軽さは単調に下がる ──────────────
seq = [scoring._report_load({"eval_ratio": {"report": r}})[0]
       for r in (0, 20, 50, 80, 100)]
check(all(a > b for a, b in zip(seq, seq[1:])),
      f"割合が増えても軽さが下がっていない: {seq}")

# ── ③ 内訳そのものが読めない科目は None のまま ────────
# 勝手に満点にすると「重い科目を軽いと言う」方向にだけ外れる。
v, _ = scoring._report_load({})
check(v is None, "内訳が無い科目に点が付いている")

# ── ④ report キーが無いのは「0%」であって「不明」ではない ──
# 出席軸・小テスト軸と同じ扱い。内訳は読めていて、そこにレポートが
# 無いのだから、レポートの負担はゼロだと読み取れている。
v, _ = scoring._report_load({"eval_ratio": {"exam": 100.0}})
check(v == 100.0, f"レポートが内訳に無い科目は満点のはず: {v}")

# ── ⑤ 量が取れている科目では従来の加算が効く（回帰防止）──
# 詳細ページを全件取得した日に、式を書き換えずに精度が上がるようにしておく。
base, _ = scoring._report_load({"eval_ratio": {"report": 50.0}})
withc, _ = scoring._report_load({"eval_ratio": {"report": 50.0},
                                 "report_count": 3})
check(withc < base, f"report_count が効いていない: {base} → {withc}")
withw, _ = scoring._report_load({"eval_ratio": {"report": 50.0},
                                 "report_words": 8000})
check(withw < base, f"report_words が効いていない: {base} → {withw}")
withh, _ = scoring._report_load({"eval_ratio": {"report": 50.0},
                                 "out_of_class_hours": 4})
check(withh < base, f"out_of_class_hours が効いていない: {base} → {withh}")

# ── ⑥ 形しか測っていないことを evidence に書く ────────
# 「レポート40%」が1本2,000字なのか5本1万字なのかは区別できない。
_, why = scoring._report_load({"eval_ratio": {"report": 60.0}})
check(any("形" in w for w in why),
      f"形だけで判定していることが evidence に無い: {why}")

# ── ⑦ 実データで「情報不足」が解消していること ────────
if BUILT.exists():
    raw = json.loads(BUILT.read_text(encoding="utf-8"))
    rows = raw["courses"] if isinstance(raw, dict) else raw
    b = collections.Counter(scoring.score(c)["band"] for c in rows)
    judged = sum(v for k, v in b.items() if k not in ("情報不足", "判定不可"))
    check(b["情報不足"] < 500,
          f"情報不足が多すぎる（4,121件の状態に戻った疑い）: {b['情報不足']}")
    check(judged > 7000, f"判定できた件数が少なすぎる: {judged}")

print(f"{n - len(fails)}/{n} 件が通過")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: テストを走らせて落ちることを確かめる**

```bash
cd .worktrees/aisho-spec
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_report_axis.py
```

期待: FAIL。①が「割合だけの科目でレポート軸が None のまま」で落ちる（現行は
本数・分量・時間外が全て無いと `None` を返すため）。⑦も情報不足 4,121 で落ちる。

- [ ] **Step 3: 係数を上げる**

`score.py` の `REPORT_RATIO_COEF` の定義を差し替える。現行:

```python
EXAM_RATIO_COEF = 0.15
REPORT_RATIO_COEF = 0.15
```

差し替え後:

```python
EXAM_RATIO_COEF = 0.15
# 2026-09-11: 0.15 → 0.45。0.15 では「レポートが成績の80%」でも 12点しか
# 引かれず 88点＝軽い になる。これが 2026-08-14 に軸ごと None にした原因
# だったが、誤りは ratio を使ったことではなく係数が小さすぎたことだった。
# 0.45 なら 80% → 64点「標準」で妥当な位置に来る。
REPORT_RATIO_COEF = 0.45
```

- [ ] **Step 4: `_report_load` を書き換える**

`score.py:185` からの関数全体を次に置き換える:

```python
def _report_load(c: dict) -> tuple[float | None, list[str]]:
    """レポート負荷。まず割合で「形」を測り、量が取れていれば足す。

    2026-09-11: 本数・分量・時間外学習が全て無いときに軸ごと None を返す
    実装をやめた。KOAN はこの3つを実測で 0件 / 3件 / 149件（全7,906件中）
    しか埋めておらず、レポート軸は 98% の科目で動いていなかった。軸が1本
    死ぬと weight_sum が COVERAGE_MIN を割り、科目ごと「情報不足」に落ちる
    ―― 4,121件（54%）がこれだった。

    2026-08-14 に軸を止めた判断は、係数が小さすぎた標定の問題（100 −
    ratio×0.15 なので 80% でも 88点＝軽い）に対して軸の廃止で答えたもの。
    係数を上げれば 80% → 64点になる（REPORT_RATIO_COEF のコメント参照）。

    試験軸も ratio だけで「形」を測り、難しさは口コミ待ちにしている。
    レポート軸だけが別の基準で黙るのは非対称なので揃える。

    **測っているのは形だけ。**「レポート40%」が1本2,000字なのか5本1万字
    なのかは区別できない。evidence にそう書いて画面に出す。
    """
    er = c.get("eval_ratio")
    if er is None:
        # 内訳そのものが読めない科目。勝手に満点にすると、ズレは必ず
        # 「実際より楽に見える」方向にだけ出る。
        return None, []

    # キーが無い＝0%（不明ではない）。出席軸・小テスト軸と同じ扱い。
    ratio = float(er.get("report") or 0.0)
    count = c.get("report_count")
    words = c.get("report_words")
    hours = c.get("out_of_class_hours")

    why = []
    load = ratio * REPORT_RATIO_COEF
    if ratio > 0:
        why.append(f"レポートが成績の{ratio:.0f}%")
    else:
        why.append("レポートなし")
    if count is not None:
        load += min(count, 10) * 6.0
        why.append(f"レポート{count}本")
    if words:
        load += min(words / 8000.0, 1.0) * 20.0
        why.append(f"1本あたり約{words:,}字")
    if hours is not None:
        load += min(hours / 4.0, 1.0) * 25.0
        why.append(f"時間外学習の指示 週{hours}時間")
    if ratio > 0 and count is None and words is None:
        why.append("本数・分量は取得できていないため、形のみで判定")
    return _clamp(100.0 - load), why
```

- [ ] **Step 5: テストを走らせて ①〜⑥ が通ることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_report_axis.py
```

期待: 全件 PASS。⑦ の情報不足は 4,121 → 280 前後まで落ちているはず。

この時点で band はまだ偏っている（実測で「拘束は軽い」が判定できた 7,474 件の
44.4%）。閾値が古いままなので当然で、Task 3 で直す。偏りの検査もそこで足す
―― ここで足すと、通らないテストを抱えたままコミットすることになる。

- [ ] **Step 6: 既存テストが壊れていないか確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_haiten_filter.py
```

期待: 49/49 件が通過（改修前と同じ）。落ちた場合は上限フィルタ側の前提を
壊しているので、先に原因を潰す。

- [ ] **Step 7: コミット**

```bash
git add score.py tools/test_report_axis.py
git commit -m "fix(score): レポート軸を割合ベースに戻す（情報不足 4,121→280件）"
```

---

### Task 3: band 閾値を実測に合わせて置き直す

**Files:**
- Modify: `score.py`（`LIGHT_MIN` / `NORMAL_MIN` / `HEAVYISH_MIN` の定義）

**Interfaces:**
- Consumes: Task 2 の `_report_load`（実データの分布がこれで決まる）
- Produces: `score.LIGHT_MIN: int` / `score.NORMAL_MIN: int` / `score.HEAVYISH_MIN: int`

- [ ] **Step 1: 閾値の地形を自分で測る**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 - <<'PY'
import json, sys
sys.path.insert(0, ".")
import score
rows = json.load(open("web/data/courses.built.json"))
rows = rows["courses"] if isinstance(rows, dict) else rows
vals = sorted(s for s in (score.score(c)["overall"] for c in rows) if s is not None)
n = len(vals)
above = lambda t: sum(1 for v in vals if v >= t)
print(f"判定できた {n} 件")
print("±1 で動くのが 1.5pt 以下の＝安定した閾値候補:")
for t in range(60, 95):
    j = (above(t) - above(t + 1)) / n * 100
    if j <= 1.5:
        print(f"  {t}: 以上が {above(t)/n*100:5.1f}%   +1 で {j:4.1f}pt")
PY
```

期待される出力（2026-09-11 時点の実測。ズレたら分布が変わったということなので
**出力のほうを正**として次の Step で選び直す）:

```
判定できた 7474 件
  64: 以上が  93.5%   +1で  0.1pt
  67: 以上が  86.5%   +1で  0.5pt
  70: 以上が  85.0%   +1で  0.7pt
  73: 以上が  81.7%   +1で  1.0pt
  75: 以上が  73.2%   +1で  0.9pt
  79: 以上が  45.3%   +1で  1.3pt
  87: 以上が  21.6%   +1で  0.7pt
  89: 以上が  16.9%   +1で  1.2pt
```

**76・77・78 は候補に出ない。** 78 は +1 で 16.2pt 跳ぶ（78.2 ちょうどに 742 件が
固まっている）。この穴を踏まないことがこの Step の目的。

- [ ] **Step 2: 偏りの検査を足す（まだ通らない）**

`tools/test_report_axis.py` の ⑦ のブロックの末尾、`check(judged > 7000, ...)` の
直後に足す:

```python
    # ── ⑧ 1つの band に偏っていないこと ──────────────
    # 改修前は判定できた 3,638 件の 72% が「拘束は軽い」だった。点数が
    # 出ていても、全部が同じ札なら科目を分別できていない。
    biggest = max(v for k, v in b.items()
                  if k not in ("情報不足", "判定不可"))
    check(biggest / judged < 0.35,
          f"1つの band に偏っている: {b.most_common()}")
```

- [ ] **Step 3: 走らせて ⑧ だけが落ちることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_report_axis.py
```

期待: FAIL。「1つの band に偏っている」1件だけが落ちる（実測では
「拘束は軽い」が 3,316 件＝44.4%）。他が落ちているなら Task 2 が壊れている。

- [ ] **Step 4: 閾値を差し替える**

`score.py` の3定数を差し替える。現行:

```python
LIGHT_MIN = 79
NORMAL_MIN = 67
HEAVYISH_MIN = 53
```

差し替え後:

```python
# 2026-09-11: レポート軸が生き返って判定できる科目が 3,638 → 7,474 件に
# 増えたので、4,121件が判定不能だった頃の分布で決めた 79/67/53 は使えない。
#
# 選び方は 2026-09-03 と同じ ―― 実測分布で「±1 動かしても大きく跳ばない」
# 平らな場所だけを候補にして、その中から4つの band が均等に近くなる位置を採る。
#
# 🚨 76・77・78 には置けない。78.2 ちょうどに 742 件が固まっており、
#   78 → 79 で 16.2pt 跳ぶ。閾値をこの塊の上に置くと 742 件が一斉に band を
#   変える（2026-09-03 に 53.1 の 348件 で同じことを避けたのと同じ理屈）。
#
# 87 / 79 / 75 はいずれも ±1 で 1.3pt 以下しか動かない平らな場所で、
# 結果の分布は やや重め 26.0% ／ 重め 25.1% ／ 標準 22.2% ／
# 拘束は軽い 20.1% ―― 最大の band でも 27.5%（改修前は 72% が
# 「拘束は軽い」に集まっていた）。
LIGHT_MIN = 87
NORMAL_MIN = 79
HEAVYISH_MIN = 75
```

- [ ] **Step 5: テストを走らせて全件通ることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_report_axis.py
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_haiten_filter.py
```

期待: `test_report_axis.py` が全件 PASS（⑧ を含む）、`test_haiten_filter.py` が 49/49。

- [ ] **Step 6: 分布を目で見て確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 - <<'PY'
import collections, json, sys
sys.path.insert(0, ".")
import score
rows = json.load(open("web/data/courses.built.json"))
rows = rows["courses"] if isinstance(rows, dict) else rows
b = collections.Counter(score.score(c)["band"] for c in rows)
for k, v in b.most_common():
    print(f"  {k:8s} {v:5d}  {v/len(rows)*100:5.1f}%")
PY
```

期待:

```
  やや重め      2058   26.0%
  重め        1981   25.1%
  標準        1757   22.2%
  拘束は軽い     1588   20.1%
  情報不足       280    3.5%
  判定不可       152    1.9%
  参考値          89   1.1%
  軽め             1   0.0%
```

**「軽め」が 1 件しかないのは正常。** 試験がある科目は口コミが3件そろうまで
`pending` 扱いで「拘束は軽い」に振られる（`band_of` の pending 分岐）。これは
今回の変更で生まれたものではなく元からの挙動なので、直さない。

- [ ] **Step 7: コミット**

```bash
git add score.py tools/test_report_axis.py
git commit -m "fix(score): band 閾値を新しい分布に合わせて 87/79/75 へ置き直す"
```

---

### Task 4: `courses.built.json` を焼き直して画面に出す

ここまでの変更は `score.py` の中だけで、サイトが読む
`web/data/courses.built.json` にはまだ古い採点結果が焼かれている。

**Files:**
- Modify: `web/data/courses.built.json`（`build.py --rescore` が書き換える）

**Interfaces:**
- Consumes: Task 2・3 の `score.py`
- Produces: 各科目の `rakutan` フィールド（`overall` / `band` / `axes` / `coverage`）

- [ ] **Step 1: 焼き直す前の状態を控える**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 -c "
import json, collections
rows = json.load(open('web/data/courses.built.json'))
rows = rows['courses'] if isinstance(rows, dict) else rows
print(collections.Counter(c['rakutan']['band'] for c in rows).most_common())
"
```

期待: 焼かれている値はまだ古いので `情報不足 4121` を含む分布が出る。

- [ ] **Step 2: 焼き直す**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 build.py --rescore
```

- [ ] **Step 3: 焼いた結果が Task 3 Step 6 と一致することを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 -c "
import json, collections
rows = json.load(open('web/data/courses.built.json'))
rows = rows['courses'] if isinstance(rows, dict) else rows
print(collections.Counter(c['rakutan']['band'] for c in rows).most_common())
"
```

期待: `やや重め 2058 / 重め 1981 / 標準 1757 / 拘束は軽い 1588 / 情報不足 280 /
判定不可 152 / 参考値 89 / 軽め 1`。Task 3 Step 6 と数字が一致すること
（一致しなければ `build.py --rescore` が `score.py` を使っていない）。

- [ ] **Step 4: 画面で確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 server.py --port 8000
```

ブラウザで `http://localhost:8000` を開き、次の3点を見る:

1. 一覧のカードに「情報不足」が並んでいないこと（改修前は半分以上がこれだった）
2. レポート比率が高い科目を開いて、軸の evidence に
   「レポートが成績の◯%」と「本数・分量は取得できていないため、形のみで判定」の
   両方が出ていること
3. band が「拘束は軽い」一色になっていないこと

- [ ] **Step 5: 全テストを通す**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_report_axis.py
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_haiten_filter.py
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_conditions.py
```

期待: 3本とも exit 0。

- [ ] **Step 6: コミット**

```bash
git add web/data/courses.built.json
git commit -m "chore(data): 新しい採点で courses.built.json を焼き直す"
```

---

## 完了後

- `docs/version-pending.md` に版の項目を足すかは、**本番に出す前に必ず wang に聞く**
  （このリポジトリの決まり。判断を先に言ってから聞く）
- push と PR も wang の確認を取ってから。直 push は Discord に流れない
- 次の spec（相性度への一本化・発表の独立軸・試験の有無の落差・死に軸 `_scale_ease`
  の削除）は、この PR がマージされてから書き始める。`feat/eval-hosoku` や
  `fix/kimatsu-exam-bucket` と衝突する範囲なので、着手前にその2本の状態を見る
