# 発表を独立した軸にする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成績評価の「発表」を report バケツから独立した `presentation` バケツ・採点軸・配点スライダー・条件チップにし、動的重みの保底を内訳に出てくる軸だけに付けて分布を保つ。

**Architecture:** 振り分け（`scrape/parse.py`・`tools/rebucket.py`）→ 採点（`score.py`、同じ PR で `courses.built.json` を焼き直して band 閾値を測り直す）→ API の条件チップ（`server.py`）→ 静的サイトの画面（`web/assets/app.js`）の順に積む。どのタスクのコミットでも既存テストが全件通る順にしてある。

**Tech Stack:** Python 3.14（標準ライブラリのみ）、素の JavaScript、テストは `python3 tools/test_*.py` と `node tools/test_*.mjs`（Playwright）の自作ハーネス

**Spec:** `docs/superpowers/specs/2026-09-16-happyou-axis-design.md`

## Global Constraints

- Python は標準ライブラリのみ。新しい依存を足さない
- `python3` の実体は `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`
- 作業場所は worktree `.worktrees/happyou`、ブランチ `feat/happyou-axis`。**本体の `main` を動かさない**。push・PR・マージは wang の確認を取ってから
- `server.py` と `web/assets/app.js` の `CHIP_CAPS`・`CONDITIONS` は同じ内容にする（片方だけ直さない）
- **`CAP_AXES` に `presentation` を入れ忘れると、発表の上限も「発表なし」チップも黙って無視され、全 7,906件に一致する**（実測）
- 発表軸は `100 − (30 + 比率 × 0.25)`、発表が内訳に無ければ 100、内訳が読めなければ None
- 保底 `AXIS_FLOOR` は内訳に出てくる軸だけに付け、出てくる軸の重みを合計 `1 − SCALE_WEIGHT`（0.88）に正規化する
- band 閾値は実装時に測り直す。spec の 83/77/69 を写さない（P=25 のように地形が崩れる値がある）
- ルールの**順序**は動かさない。発表ルールは行き先だけ変える
- JS テストは静的サーバ（`python3 -m http.server <port> --directory web`）に向けて流す。`tools/test_kuchikomi_modal.mjs` は main でも落ちている既知の NG

---

### Task 1: 発表を presentation バケツへ振り分ける

**Files:**
- Create: `tools/test_happyou_axis.py`
- Modify: `scrape/parse.py:67`（発表ルール）、`scrape/parse.py` の `one()` 内 `buckets = {...}`
- Modify: `tools/rebucket.py:38`（`rebucket()` 内 `buckets = {...}`）

**Interfaces:**
- Consumes: なし
- Produces: `scrape.parse.bucket_of(name: str) -> str | None` が発表項目に `"presentation"` を返す。`tools.rebucket.rebucket(raw: dict[str, float]) -> tuple[dict | None, dict | None]` の `eval_ratio` に `"presentation"` キーが現れる（0% のキーは従来どおり落とす）

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_happyou_axis.py` を新規作成:

```python
"""発表を独立した軸にしたことのテスト。ネットワークには出ない。

    python3 tools/test_happyou_axis.py

設計は docs/superpowers/specs/2026-09-16-happyou-axis-design.md
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scrape.parse import bucket_of  # noqa: E402
from tools.rebucket import rebucket  # noqa: E402

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


# ── A. 振り分け ─────────────────────────────────────
# 発表ルールの行き先だけを presentation に変え、ルールの順序は動かさない。
for name in ("発表", "最終発表", "中間発表", "グループ発表",
             "Pair presentations", "レジュメと発表"):
    check(bucket_of(name) == "presentation",
          f"「{name}」が presentation に入らない: {bucket_of(name)}")

# レポートと同居する複合項目は、先に当たるレポートのルールに残る。
for name in ("個人のレポートとプレゼンテーション",
             "グループレポートやプレゼンテーション"):
    check(bucket_of(name) == "report",
          f"「{name}」が report から動いた: {bucket_of(name)}")

# 試験・小テストのルールが先に当たるものは動かない。
check(bucket_of("口頭試問") == "exam",
      f"口頭試問が exam でない: {bucket_of('口頭試問')}")
check(bucket_of("その他（レポート、課題提出、小テスト、発表、学習への参加度）") == "quiz",
      "複合項目「その他（…）」の行き先が変わった（今回は触らない）")

ratio, unclassified = rebucket({"発表": 40.0, "期末試験": 60.0})
check(ratio == {"presentation": 40.0, "exam": 60.0},
      f"rebucket が発表を分けていない: {ratio}")
check(unclassified is None, f"未分類は無いはず: {unclassified}")


print(f"{n - len(fails)}/{n} 件が通過")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: 走らせて落ちることを確かめる**

```bash
cd .worktrees/happyou
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_happyou_axis.py
```

期待: FAIL。「「発表」が presentation に入らない: report」など発表6件と、rebucket の分け方の1件、
計7件が落ちる。レポートと同居する2件・口頭試問・その他（…）・未分類が無いことの5件は今でも通る。

- [ ] **Step 3: 発表ルールの行き先を変える**

`scrape/parse.py` の次の1行:

```python
    (r"発表|プレゼン|presentation|leading", "report"),
```

を次に置き換える:

```python
    # 2026-09-16: 発表を report から独立させた
    # （docs/superpowers/specs/2026-09-16-happyou-axis-design.md）。
    # **このルールの位置は動かさない。** レポートのルールより後ろにあるので、
    # 「個人のレポートとプレゼンテーション」のような同居項目はレポートに残る。
    (r"発表|プレゼン|presentation|leading", "presentation"),
```

- [ ] **Step 4: バケツ辞書に presentation を足す（2か所）**

`scrape/parse.py` の `one()` 内と `tools/rebucket.py` の `rebucket()` 内にある、同じ文面の行:

```python
    buckets = {"exam": 0.0, "report": 0.0, "attendance": 0.0, "quiz": 0.0}
```

を、**それぞれ**次に置き換える:

```python
    buckets = {"exam": 0.0, "report": 0.0, "attendance": 0.0, "quiz": 0.0,
               "presentation": 0.0}
```

（足さないと `buckets[b] += pct` が `KeyError: 'presentation'` で落ちる）

- [ ] **Step 5: テストを走らせて通ることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_happyou_axis.py
```

期待: `12/12 件が通過`

- [ ] **Step 6: 既存の Python テストが全件通ることを確かめる**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: 全件 `ok`。`courses.built.json` はまだ焼き直していないので、採点・チップの件数は変わらない。
`tools/test_haiten_filter.py` の `rebucket` の用例は発表を含まないので影響しない。

- [ ] **Step 7: コミット**

```bash
git add scrape/parse.py tools/rebucket.py tools/test_happyou_axis.py
git commit -m "feat(parse): 発表を report から独立した presentation バケツへ振り分ける"
```

---

### Task 2: 発表軸と保底の変更を採点に入れ、焼き直して閾値を測り直す

**Files:**
- Modify: `score.py`（係数定数の直後・保底定数・`WEIGHTS`・`dynamic_weights`・`_quiz_load` の直後・`AXES`・band 閾値・`AXIS_LABEL`・`PRESETS`・`CAP_AXES`・`passes_caps` の docstring）
- Modify: `tools/test_happyou_axis.py`（B を追加）
- Modify: `tools/test_haiten_filter.py:181`（`REF`）
- Modify: `web/data/courses.built.json`（`build.py --rescore` が書き換える）

**Interfaces:**
- Consumes: Task 1 の `bucket_of` / `rebucket`（`--rescore` が内部で使う）
- Produces:
  - `score._presentation_load(c: dict) -> tuple[float | None, list[str]]`
  - `score.dynamic_weights(course: dict) -> dict[str, float]` ―― キーは `exam, report, attendance, quiz, presentation, scale`
  - `score.CAP_AXES == ("attendance", "exam", "quiz", "report", "presentation")`
  - `score.AXIS_LABEL["presentation"] == "発表の少なさ"`
  - 定数 `score.PRESENTATION_BASE = 30.0`、`score.PRESENTATION_RATIO_COEF = 0.25`

- [ ] **Step 1: 失敗するテスト（B）を書く**

`tools/test_happyou_axis.py` の import 部分、`from tools.rebucket import rebucket  # noqa: E402` の次の行に足す:

```python
import score as scoring  # noqa: E402
```

末尾の `print(f"{n - len(fails)}/{n} 件が通過")` の**直前**に足す:

```python
# ── B. 採点：発表軸 ─────────────────────────────────
v, why = scoring._presentation_load({"eval_ratio": {"presentation": 40.0, "exam": 60.0}})
check(v == 60.0, f"発表40%は 100-(30+40*0.25)=60 のはず: {v}")
check(any("発表" in w for w in why), f"evidence に発表が無い: {why}")
v, why = scoring._presentation_load({"eval_ratio": {"exam": 100.0}})
check(v == 100.0 and why == ["発表なし"],
      f"発表が内訳に無い科目は満点のはず: {v} {why}")
v, _ = scoring._presentation_load({})
check(v is None, "内訳が読めない科目に発表軸の点が付いている")
check(any(k == "presentation" for k, _, _ in scoring.AXES), "AXES に presentation が無い")

# ── B. 採点：保底は内訳に出てくる軸だけ ───────────────
AXIS_KEYS = ("exam", "report", "attendance", "quiz", "presentation")
w = scoring.dynamic_weights({"eval_ratio": {"report": 100.0}})
check(abs(w["report"] - 0.88) < 1e-9,
      f"レポートだけの科目でレポートの重みが 0.88 でない: {w}")
check(all(w[k] == 0.0 for k in AXIS_KEYS if k != "report"),
      f"内訳に無い軸に重みが付いている: {w}")
check(w["scale"] == scoring.SCALE_WEIGHT, f"規模の重みが変わった: {w}")

w = scoring.dynamic_weights({"eval_ratio": {"exam": 60.0, "presentation": 40.0}})
check(abs(sum(w[k] for k in AXIS_KEYS) - 0.88) < 1e-9,
      f"出てくる軸の重みの合計が 0.88 でない: {w}")
check(w["exam"] > w["presentation"] > 0, f"配点の大きい軸ほど重くなっていない: {w}")
check(w["report"] == w["attendance"] == w["quiz"] == 0.0,
      f"内訳に無い軸に重みが付いている: {w}")

w = scoring.dynamic_weights({})
check(all(abs(w[k] - 0.88 / 5) < 1e-9 for k in AXIS_KEYS),
      f"内訳が読めない科目が均等配分でない: {w}")

# 保底が内訳に無い軸へ漏れていれば、ここは 55 より上に引っぱられる。
s = scoring.score({"eval_ratio": {"report": 100.0}, "eval_raw": {"レポート": 100.0}})
check(s["overall"] == 55.0,
      f"レポート100%だけの科目の総合値は レポート軸 55 そのもののはず: {s['overall']}")
check(abs(s["coverage"] - 0.88) < 1e-9,
      f"覆いが 0.88 でない（COVERAGE_MIN の判定が変わる）: {s['coverage']}")

# ── B. 上限フィルタが発表を見ていること ───────────────
# CAP_AXES に無いキーの上限は passes_caps が黙って無視する（全件が通る）。
check("presentation" in scoring.CAP_AXES,
      "CAP_AXES に presentation が無い（発表の上限が黙って無視される）")
caps = {k: scoring.NO_CAP for k in scoring.CAP_AXES} | {"presentation": 0}
check(not scoring.passes_caps({"eval_ratio": {"presentation": 40.0, "report": 60.0}}, caps),
      "発表40%の科目が「発表0%まで」の上限を通っている")
check(scoring.passes_caps({"eval_ratio": {"report": 100.0}}, caps),
      "発表の無い科目が「発表0%まで」の上限で落ちている")

check("presentation" in scoring.AXIS_LABEL, "AXIS_LABEL に presentation が無い")
for name, pw in scoring.PRESETS.items():
    check(pw.get("presentation") == pw.get("report"),
          f"プリセット「{name}」の発表の重みがレポートと違う: {pw}")
```

- [ ] **Step 2: 走らせて落ちることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_happyou_axis.py
```

期待: `AttributeError: module 'score' has no attribute '_presentation_load'` で止まる。

- [ ] **Step 3: 発表の係数を足す**

`score.py` の次の行:

```python
REPORT_RATIO_COEF = 0.45
```

の**直後**に足す:

```python

# 2026-09-16: 発表を独立した軸にした。PRESENTATION_BASE は「発表があること自体の
# 負担」―― 人前に立つ・日程が動かせない・グループなら他人と合わせる、という
# レポートとは違う性質の重さ。20 では発表のみの科目がレポートのみと同じ 55 点になり
# 分けた意味が無く、25 では band の地形が崩れ（最大 band 42.5%）、35 では出席のみ
# （45）より重くなるので 30 にした（全7,906件で実測）。
PRESENTATION_BASE = 30.0
PRESENTATION_RATIO_COEF = 0.25
```

- [ ] **Step 4: 保底定数の説明を直す**

`score.py` の次の1行:

```python
AXIS_FLOOR = 0.10       # 4軸それぞれの下限（合計 0.40）
```

を次に置き換える:

```python
# 2026-09-16: 下限は「内訳に出てくる軸」だけに付け、出てくる軸の重みを合計
# 1 − SCALE_WEIGHT に正規化するようにした（dynamic_weights）。上の足し算は
# もう成り立たないが、2つの定数の比（下限：比率ぶん）はそのまま使っている。
AXIS_FLOOR = 0.10       # 内訳に出てくる軸それぞれの下限（正規化の前）
```

同じく `WEIGHTS` の中の次の1行:

```python
    "note": "試験・レポート・出席・小テストの重みは、その科目の成績評価内訳から動的に決まる",
```

を次に置き換える:

```python
    "note": "試験・レポート・出席・小テスト・発表の重みは、その科目の成績評価内訳から動的に決まる。内訳に出てこない軸の重みは 0",
```

- [ ] **Step 5: `dynamic_weights` を置き換える**

`score.py` の関数全体:

```python
def dynamic_weights(course: dict) -> dict[str, float]:
    er = course.get("eval_ratio") or {}
    shares = {k: float(er.get(k) or 0)
              for k in ("exam", "report", "attendance", "quiz")}
    total = sum(shares.values())
    if total <= 0:
        # 評価内訳が不明な科目は均等配分にする（推測で偏らせない）
        shares = {k: 1 / len(shares) for k in shares}
    else:
        shares = {k: v / total for k, v in shares.items()}
    w = {k: AXIS_FLOOR + AXIS_SHARE * s for k, s in shares.items()}
    w["scale"] = SCALE_WEIGHT
    return w
```

を次に置き換える:

```python
def dynamic_weights(course: dict) -> dict[str, float]:
    """軸の重みを、その科目の成績評価内訳から決める。

    2026-09-16: 下限（AXIS_FLOOR）を**内訳に出てくる軸だけ**に付けるようにした。
    以前は内訳に出てこない軸にも 0.10 を付けていたので、発表を独立した軸にすると
    「発表が無い約5,000科目」で満点 100 × 0.10 が総合値に混ざり、全科目が1か所に
    寄った（実測 最大 band 63〜73%）。出てこない軸の重みは 0 にし、出てくる軸だけで
    合計 1 − SCALE_WEIGHT に正規化する。weight_sum が「算出できた割合」である
    ことは変わらないので、COVERAGE_MIN はそのまま使える（正規化しないと、
    レポート100%だけの科目は重みが 0.48 になり COVERAGE_MIN を割る）。
    """
    er = course.get("eval_ratio") or {}
    shares = {k: float(er.get(k) or 0)
              for k in ("exam", "report", "attendance", "quiz", "presentation")}
    total = sum(shares.values())
    axis_total = 1.0 - SCALE_WEIGHT
    if total <= 0:
        # 評価内訳が不明な科目は均等配分にする（推測で偏らせない）。
        # この科目は各軸の値が None になるので、配り方は総合値に影響しない。
        w = {k: axis_total / len(shares) for k in shares}
    else:
        raw = {k: (AXIS_FLOOR + AXIS_SHARE * v / total) if v > 0 else 0.0
               for k, v in shares.items()}
        z = sum(raw.values())
        w = {k: raw[k] / z * axis_total for k in raw}
    w["scale"] = SCALE_WEIGHT
    return w
```

- [ ] **Step 6: 発表軸の関数を足し、`AXES` に入れる**

`score.py` の `_quiz_load` の最後の行 `    return _clamp(100.0 - load), why` と、その後の空行2つの次（`def _scale_ease` の直前）に足す:

```python
def _presentation_load(c: dict) -> tuple[float | None, list[str]]:
    """発表の重さ。返り値は 0〜100 の「楽さ」（高いほど楽）。

    2026-09-16 に report から独立させた。レポートは夜中に書き足せるが、発表は
    人前に立ち、日程が動かせず、グループなら他人と合わせる必要がある。この
    「あること自体の負担」を PRESENTATION_BASE で表し、比率ぶんを足す。

    比率が内訳に無いのは「0%」＝負担なしであって不明ではない。
    内訳そのものが読めない科目だけ None を返す。
    """
    er = c.get("eval_ratio")
    if er is None:
        return None, []
    ratio = float(er.get("presentation") or 0.0)
    if ratio == 0:
        return 100.0, ["発表なし"]
    load = PRESENTATION_BASE + ratio * PRESENTATION_RATIO_COEF
    return _clamp(100.0 - load), [f"発表が成績の{ratio:.0f}%"]


```

`AXES` 全体:

```python
AXES = [
    ("exam", "試験", _exam_load),
    ("report", "レポート・課題", _report_load),
    ("attendance", "出席拘束", _attendance_load),
    ("quiz", "小テスト", _quiz_load),
    ("scale", "規模・形態", _scale_ease),
]
```

を次に置き換える:

```python
AXES = [
    ("exam", "試験", _exam_load),
    ("report", "レポート・課題", _report_load),
    ("attendance", "出席拘束", _attendance_load),
    ("quiz", "小テスト", _quiz_load),
    ("presentation", "発表", _presentation_load),
    ("scale", "規模・形態", _scale_ease),
]
```

- [ ] **Step 7: 表示名・プリセット・上限の軸を足す**

`AXIS_LABEL` の次の1行:

```python
    "quiz": "小テストの少なさ",
```

の直後に足す:

```python
    "presentation": "発表の少なさ",
```

`PRESETS` の4行:

```python
    "バイト優先":   {"attendance": 5, "quiz": 5, "report": 3, "exam": 2, "scale": 2},
    "GPA重視":     {"attendance": 2, "quiz": 3, "report": 3, "exam": 3, "scale": 5},
    "とにかく軽い": {"attendance": 4, "quiz": 4, "report": 4, "exam": 4, "scale": 4},
    "テストが苦手": {"attendance": 2, "quiz": 4, "report": 3, "exam": 5, "scale": 3},
```

を次に置き換える（発表の重みは同じプリセットのレポートと同じ。LINE の `preset_top` は6組とも不変と実測済み）:

```python
    "バイト優先":   {"attendance": 5, "quiz": 5, "report": 3, "exam": 2, "presentation": 3, "scale": 2},
    "GPA重視":     {"attendance": 2, "quiz": 3, "report": 3, "exam": 3, "presentation": 3, "scale": 5},
    "とにかく軽い": {"attendance": 4, "quiz": 4, "report": 4, "exam": 4, "presentation": 4, "scale": 4},
    "テストが苦手": {"attendance": 2, "quiz": 4, "report": 3, "exam": 5, "presentation": 3, "scale": 3},
```

次の1行:

```python
CAP_AXES = ("attendance", "exam", "quiz", "report")
```

を次に置き換える:

```python
# 🚨 2026-09-16 に presentation を足した。**ここに無いキーの上限は passes_caps が
# 黙って無視する**（最初の「全部 100% なら通す」判定がこのタプルしか見ない）。
# 入れ忘れると「発表なし」チップが全 7,906件に一致した（実測）。
# web/assets/app.js の CAP_AXES と同じにすること。
CAP_AXES = ("attendance", "exam", "quiz", "report", "presentation")
```

`passes_caps` の docstring の1行目:

```python
    """科目が4本の上限をすべて満たすか。
```

を次に置き換える:

```python
    """科目が CAP_AXES の上限をすべて満たすか。
```

- [ ] **Step 8: テスト（A・B）が通ることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_happyou_axis.py
```

期待: `34/34 件が通過`（A 12件＋B 22件）。

- [ ] **Step 9: 焼き直す**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 build.py --rescore
```

期待: `eval_ratio が変わった科目 2530 件`。band は旧閾値 87/79/75 のまま付くので、まだ偏っていてよい。

- [ ] **Step 10: band 閾値の地形を測る**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 - <<'PY'
import json, sys
sys.path.insert(0, ".")
import score
rows = json.load(open("web/data/courses.built.json"))["courses"]
vals = sorted(s for s in (score.score(c)["overall"] for c in rows) if s is not None)
n = len(vals)
above = {t: sum(1 for v in vals if v >= t) for t in range(30, 102)}
flat = [t for t in range(30, 100) if (above[t] - above[t + 1]) / n * 100 <= 1.5]
best = None
for L in flat:
    for N_ in (t for t in flat if t < L):
        for H in (t for t in flat if t < N_):
            sh = [above[L] / n, (above[N_] - above[L]) / n,
                  (above[H] - above[N_]) / n, 1 - above[H] / n]
            if best is None or max(sh) < best[0]:
                best = (max(sh), (L, N_, H), sh)
print("判定できた", n)
print("最も均等な平坦閾値 L/N/H =", best[1],
      " 分布（軽い/標準/やや重め/重め）", [round(x * 100, 1) for x in best[2]])
print("REF =", {"軽い": round(best[2][0], 3), "標準": round(best[2][1], 3),
               "やや重め": round(best[2][2], 3), "重め": round(best[2][3], 3)})
PY
```

期待（2026-09-16 の実測。**ズレたら出力のほうを正として Step 11 と Step 13 に使う**）:

```
判定できた 7482
最も均等な平坦閾値 L/N/H = (83, 77, 69)  分布（軽い/標準/やや重め/重め） [22.9, 16.1, 31.4, 29.6]
REF = {'軽い': 0.229, '標準': 0.161, 'やや重め': 0.314, '重め': 0.296}
```

- [ ] **Step 11: 閾値を差し替える**

`score.py` の3行:

```python
LIGHT_MIN = 87
NORMAL_MIN = 79
HEAVYISH_MIN = 75
```

を次に置き換える（数字は Step 10 の出力に合わせる）:

```python
# 2026-09-16: 発表を独立した軸にし、保底を内訳に出てくる軸だけに付けたので、
# 約7,300科目の点数が動いた。87/79/75 はその前の分布の値なので置き直す。
#
# 選び方は同じ ―― ±1 動かしても 1.5pt 以下しか動かない平らな場所だけを候補にし、
# 4つの band の最大が最も小さくなる3点を採る。
#
# 🚨 発表の固定罰点を 25 にすると最良の3点が 83/72/30 になり最大 band 42.5% まで
#   崩れた。地形は係数に対して単調ではないので、係数を変えたら必ず測り直すこと。
#
# 83 / 77 / 69 での分布は やや重め 2,322 ／ 重め 2,192 ／ 拘束は軽い 1,688 ／
# 標準 1,190 ―― tools/test_report_axis.py の⑧が見る最大 band は 31.0%。
LIGHT_MIN = 83
NORMAL_MIN = 77
HEAVYISH_MIN = 69
```

- [ ] **Step 12: 新しい閾値で焼き直す**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 build.py --rescore
```

期待される band の分布（変更後の列）:

```
やや重め 2322 / 重め 2192 / 拘束は軽い 1688 / 標準 1190 / 情報不足 272 / 判定不可 152 / 参考値 89 / 軽め 1
```

- [ ] **Step 13: 参照分布を入れ替える**

`tools/test_haiten_filter.py` の次の1行:

```python
    REF = {"軽い": 0.216, "標準": 0.237, "やや重め": 0.279, "重め": 0.268}
```

を次に置き換える（数字は Step 10 の `REF =` の行に合わせる）:

```python
    # 2026-09-16: 発表を独立した軸にし、保底を内訳に出てくる軸だけに付けた
    # （docs/superpowers/specs/2026-09-16-happyou-axis-design.md）。約7,300科目の
    # 点数が動いたので参照値を入れ替えた。閾値 83/77/69 での実測。
    REF = {"軽い": 0.229, "標準": 0.161, "やや重め": 0.314, "重め": 0.296}
```

- [ ] **Step 14: Python テストを全件流す**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: 全件 `ok`。`tools/test_conditions.py` の件数もまだ変わらない（`server.py` の
`CHIP_CAPS` は Task 3 で直す。「レポートのみ」は発表を制限していないので 508 のまま）。

NG が出たら、そのテストを単独で流して出力を読み、**そのテストの期待が「保底が全軸に付く」
前提に立っているかどうかを報告して止まる**。期待値を黙って書き換えない。

- [ ] **Step 15: コミット**

```bash
git add score.py tools/test_happyou_axis.py tools/test_haiten_filter.py web/data/courses.built.json
git commit -m "feat(score): 発表軸を足し、保底を内訳に出てくる軸だけに付けて閾値を 83/77/69 に置き直す"
```

---

### Task 3: API の条件チップ（「レポートのみ」の定義と「発表なし」）

**Files:**
- Modify: `server.py:150-154`（`CHIP_CAPS`）、`server.py:168`（`CONDITIONS` の「小テストなし」の行の直後）
- Modify: `tools/test_conditions.py:69-70`（`expect`）
- Modify: `tools/test_happyou_axis.py`（C を追加）

**Interfaces:**
- Consumes: Task 2 の `score.CAP_AXES`（`server._chip` がこれで上限の辞書を作る）
- Produces: `server.CONDITIONS["発表なし"]`、`server.CHIP_CAPS["発表なし"] == {"presentation": 0}`、`server.CHIP_CAPS["レポートのみ"]` に `"presentation": 0`

- [ ] **Step 1: 失敗するテスト（C）を書く**

`tools/test_happyou_axis.py` の import 部分の先頭（`import sys` の前）に足す:

```python
import contextlib
import io
```

末尾の `print(f"{n - len(fails)}/{n} 件が通過")` の**直前**に足す:

```python
# ── C. 条件チップ（server.py）──────────────────────────
with contextlib.redirect_stdout(io.StringIO()):
    import server  # noqa: E402
keys = list(server.CONDITIONS)
has_pres = {"eval_ratio": {"presentation": 40.0, "report": 60.0}}
no_pres = {"eval_ratio": {"report": 100.0}}
check("発表なし" in keys, "条件チップ「発表なし」が無い")
if "発表なし" in keys:
    check(keys.index("発表なし") == keys.index("小テストなし") + 1,
          "「発表なし」が「小テストなし」の直後にない（チップの並びが崩れる）")
    check(not server.CONDITIONS["発表なし"](has_pres),
          "発表40%の科目が「発表なし」に入っている")
    check(server.CONDITIONS["発表なし"](no_pres),
          "発表の無い科目が「発表なし」から落ちている")
check(not server.CONDITIONS["レポートのみ"](has_pres),
      "発表を含む科目が「レポートのみ」に入っている")
check(server.CONDITIONS["レポートのみ"](no_pres),
      "レポート100%の科目が「レポートのみ」から落ちている")
```

- [ ] **Step 2: 走らせて落ちることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_happyou_axis.py
```

期待: FAIL。「条件チップ「発表なし」が無い」と「発表を含む科目が「レポートのみ」に入っている」の2件。

- [ ] **Step 3: `CHIP_CAPS` と `CONDITIONS` を直す**

`server.py` の:

```python
CHIP_CAPS = {
    "出席なし":     {"attendance": 0},
    "小テストなし": {"quiz": 0},
    "レポートのみ": {"exam": 0, "attendance": 0, "quiz": 0},
}
```

を次に置き換える:

```python
CHIP_CAPS = {
    "出席なし":     {"attendance": 0},
    "小テストなし": {"quiz": 0},
    # 2026-09-16: 発表を独立した軸にしたので、「レポートのみ」は発表 0% も要る。
    "レポートのみ": {"exam": 0, "attendance": 0, "quiz": 0, "presentation": 0},
    "発表なし":     {"presentation": 0},
}
```

`CONDITIONS` の次の1行:

```python
    "小テストなし": _chip(CHIP_CAPS["小テストなし"]),
```

の直後に足す:

```python
    "発表なし":     _chip(CHIP_CAPS["発表なし"]),
```

- [ ] **Step 4: `test_conditions.py` の期待値を直す**

`tools/test_conditions.py` の:

```python
    expect = {"出席なし": 2176, "レポートのみ": 508, "集中講義": 193,
              "持ち込み可": 18, "1限以外": 6979, "小テストなし": 5953}
```

を次に置き換える:

```python
    #
    # 2026-09-16、発表を report から独立した presentation バケツにした。
    #   レポートのみ  508 →  298  発表を含む210科目が外れた（意図した変化）
    #   発表なし      新設  5004
    #   ほかのチップは、抜けた科目・入った科目とも 0（実測）
    expect = {"出席なし": 2176, "レポートのみ": 298, "集中講義": 193,
              "持ち込み可": 18, "1限以外": 6979, "小テストなし": 5953,
              "発表なし": 5004}
```

- [ ] **Step 5: テストを走らせて通ることを確かめる**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
$P tools/test_happyou_axis.py
$P tools/test_conditions.py
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: `test_happyou_axis.py` 全件通過、`test_conditions.py` が OK、全ファイル `ok`。

- [ ] **Step 6: コミット**

```bash
git add server.py tools/test_conditions.py tools/test_happyou_axis.py
git commit -m "feat(server): 条件チップ「発表なし」を足し、「レポートのみ」に発表0%を要求する"
```

---

### Task 4: 画面（配点スライダー5本目・チップ7個・3列×3行）

**Files:**
- Modify: `web/assets/app.js:27`（既定の `caps`）、`:1047`（`CAP_AXES`）、`:1063-1065`（`NO_CAPS`・`CAP_LABEL`）、`:1111-1115`（`CHIP_CAPS`）、`:1124`（`CONDITIONS` の「小テストなし」の直後）
- Modify: `tools/test_haiten_ui.mjs`（①④⑤⑥）
- Modify: `tools/test_conds_layout.mjs`（③の個数・行・列と、淡い点灯）

**Interfaces:**
- Consumes: Task 2 で焼き直した `web/data/courses.built.json`（各科目の `eval_ratio.presentation`）
- Produces: 画面上の `#s_presentation` スライダーと、`#conds` の「発表なし」チップ

- [ ] **Step 1: JS テストを先に直す（スライダー）**

`tools/test_haiten_ui.mjs` で次の置き換えをする。

```js
/* ── ① 4本のスライダーがあり、既定は 100%（＝制限なし） ── */
const AXES = ["attendance", "exam", "quiz", "report"];
```

→

```js
/* ── ① 5本のスライダーがあり、既定は 100%（＝制限なし） ── */
const AXES = ["attendance", "exam", "quiz", "report", "presentation"];
```

```js
/* 目盛りは 10 刻み（2026-09-04 確定）。4本とも同じ刻みであること。 */
```

→

```js
/* 目盛りは 10 刻み（2026-09-04 確定）。5本とも同じ刻みであること。 */
```

```js
/* 「レポートのみ」は3本まとめて 0% にする */
```

→

```js
/* 「レポートのみ」は4本まとめて 0% にする（2026-09-16 に発表が加わった） */
```

```js
for (const k of ["exam", "attendance", "quiz"]) {
```

→

```js
for (const k of ["exam", "attendance", "quiz", "presentation"]) {
```

```js
for (const k of AXES) await setCap(k, 20);
await p.waitForTimeout(250);
check(await p.$eval("#capWarn", e => !e.hidden),
      "上限の合計が80%なのに警告が出ていない");
check(await count() === 0, `合計80%なのに ${await count()}件 出ている`);
```

→

```js
/* 5本とも 10% で合計 50%。2026-09-16 までは4本×20%＝80% で見ていたが、
   発表を足して5本になると 20% ずつでは合計 100% になり、警告の条件を満たさない。 */
for (const k of AXES) await setCap(k, 10);
await p.waitForTimeout(250);
check(await p.$eval("#capWarn", e => !e.hidden),
      "上限の合計が50%なのに警告が出ていない");
check(await count() === 0, `合計50%なのに ${await count()}件 出ている`);
```

```js
check(/cap_attendance=20/.test(url), `URL に上限が載っていない: ${url}`);
```

→

```js
check(/cap_attendance=10/.test(url), `URL に上限が載っていない: ${url}`);
```

```js
check(await capOf("attendance") === 20, "URL から開き直すと上限が復元されない");
```

→

```js
check(await capOf("attendance") === 10, "URL から開き直すと上限が復元されない");
```

- [ ] **Step 2: JS テストを先に直す（チップの並び）**

`tools/test_conds_layout.mjs` で次の置き換えをする。

```js
 *   ③ 3列×2行で並ぶこと。
```

→

```js
 *   ③ 3列で並ぶこと。2026-09-16 に「発表なし」が加わり 7個・3行になった
 *      （3行目は1個）。4列にしないのは、PC の条件欄が 240〜280px しかなく
 *      3列でも1枠 73〜79px だから（web/assets/app.css の実測コメント）。
```

```js
  check(a.length === 6, `条件チップは6個（実測 ${a.length}個）`);

  const rows = [...new Set(a.map(c => c.y))].sort((x, y) => x - y);
  check(rows.length === 2, `2行に並ぶ（実測 ${rows.length}行）`);
  rows.forEach((y, i) => {
    const cols = a.filter(c => c.y === y);
    check(cols.length === 3, `  ${i + 1}行目は3列: ${cols.map(c => c.name).join(" / ")}`);
  });
  const ws = [...new Set(a.map(c => c.w))];
  check(ws.length === 1, `6個とも同じ幅（実測 ${ws.join(",")}px）`);
```

→

```js
  check(a.length === 7, `条件チップは7個（実測 ${a.length}個）`);

  const rows = [...new Set(a.map(c => c.y))].sort((x, y) => x - y);
  check(rows.length === 3, `3行に並ぶ（実測 ${rows.length}行）`);
  rows.forEach((y, i) => {
    const cols = a.filter(c => c.y === y);
    const want = i < 2 ? 3 : 1;
    check(cols.length === want, `  ${i + 1}行目は${want}列: ${cols.map(c => c.name).join(" / ")}`);
  });
  const ws = [...new Set(a.map(c => c.w))];
  check(ws.length === 1, `7個とも同じ幅（実測 ${ws.join(",")}px）`);
```

```js
      check(of("小テストなし").cls === "chip on imp", "小テストなし＝淡い（含まれている）");
```

の直後に足す:

```js
      check(of("発表なし").cls === "chip on imp",     "発表なし＝淡い（含まれている）");
```

- [ ] **Step 3: 走らせて落ちることを確かめる**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
($P -m http.server 8761 --directory web >/dev/null 2>&1 & echo $! > /tmp/happyou_srv.pid)
until curl -s -o /dev/null http://localhost:8761/; do sleep 0.5; done
node tools/test_haiten_ui.mjs http://localhost:8761
node tools/test_conds_layout.mjs http://localhost:8761
kill $(cat /tmp/happyou_srv.pid)
```

期待: 両方とも終了コードが 0 以外。`test_haiten_ui.mjs` は `#s_presentation` が無いので、
続くループの `p.$eval` が要素を見つけられず**途中で例外になって止まる**（NG の一覧まで行かなくてよい）。
`test_conds_layout.mjs` は「NG 条件チップは7個（実測 6個）」を出す。

- [ ] **Step 4: `app.js` を直す**

`web/assets/app.js` で次の置き換えをする。

```js
                caps:{ attendance:100, exam:100, quiz:100, report:100 },
```

→

```js
                caps:{ attendance:100, exam:100, quiz:100, report:100, presentation:100 },
```

```js
const CAP_AXES = ["attendance", "exam", "quiz", "report"];
```

→

```js
/* 🚨 2026-09-16 に presentation を足した。ここに無いキーの上限は passesCaps が
   黙って無視する（入れ忘れると「発表なし」が全件に一致する）。
   score.py の CAP_AXES と同じにすること。 */
const CAP_AXES = ["attendance", "exam", "quiz", "report", "presentation"];
```

```js
const NO_CAPS = { attendance:NO_CAP, exam:NO_CAP, quiz:NO_CAP, report:NO_CAP };
const CAP_LABEL = { attendance:"出席・平常点", exam:"期末テスト",
                    quiz:"小テスト", report:"レポート" };
```

→

```js
const NO_CAPS = { attendance:NO_CAP, exam:NO_CAP, quiz:NO_CAP, report:NO_CAP,
                  presentation:NO_CAP };
const CAP_LABEL = { attendance:"出席・平常点", exam:"期末テスト",
                    quiz:"小テスト", report:"レポート", presentation:"発表" };
```

```js
const CHIP_CAPS = {
  "出席なし":     { attendance:0 },
  "小テストなし": { quiz:0 },
  "レポートのみ": { exam:0, attendance:0, quiz:0 },
};
```

→

```js
const CHIP_CAPS = {
  "出席なし":     { attendance:0 },
  "小テストなし": { quiz:0 },
  /* 2026-09-16: 発表を独立した軸にしたので「レポートのみ」は発表 0% も要る。
     server.py の CHIP_CAPS と同じにすること。 */
  "レポートのみ": { exam:0, attendance:0, quiz:0, presentation:0 },
  "発表なし":     { presentation:0 },
};
```

```js
  "小テストなし": capChip(CHIP_CAPS["小テストなし"]),
```

の直後に足す:

```js
  "発表なし":     capChip(CHIP_CAPS["発表なし"]),
```

- [ ] **Step 5: JS テストを全件流す**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
($P -m http.server 8761 --directory web >/dev/null 2>&1 & echo $! > /tmp/happyou_srv.pid)
until curl -s -o /dev/null http://localhost:8761/; do sleep 0.5; done
pass=0; fail=0
for t in tools/test_*.mjs; do
  if node "$t" http://localhost:8761 >/tmp/happyou_mjs.txt 2>&1; then pass=$((pass+1));
  else fail=$((fail+1)); echo "NG $t"; tail -3 /tmp/happyou_mjs.txt; fi
done
echo "JS: $pass 通過 / $fail 失敗"
kill $(cat /tmp/happyou_srv.pid)
```

期待: `JS: 24 通過 / 1 失敗`。唯一の NG は `tools/test_kuchikomi_modal.mjs`
「詳細に口コミの集計（.rv）が残っている」（main でも落ちている既知の NG）。
それ以外が落ちたら、出力を貼って止まる。

- [ ] **Step 6: Python テストも全件流す**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: 全件 `ok`。

- [ ] **Step 7: コミット**

```bash
git add web/assets/app.js tools/test_haiten_ui.mjs tools/test_conds_layout.mjs
git commit -m "feat(web): 配点スライダーに「発表」、条件チップに「発表なし」を足す（3列×3行）"
```

---

### Task 5: 引き継ぎを書いて PR を出す

**Files:**
- Modify: `HANDOFF.md`（ルールの `---` の直下に追記）

- [ ] **Step 1: HANDOFF に追記する**

`HANDOFF.md` の冒頭ルール節の後、最初の `---` の直後（既存の最新エントリの前）に足す:

```markdown
## 2026-09-16 ｜ 発表を独立した軸にした（採点の作り直しの1段目）｜ Claude → 次の人

採点を「相性度」へ作り直す3段のうちの1段目。2段目（固定重みの採点エンジン）の既定の重みに
「発表」が入るので、先に分けた。設計は `docs/superpowers/specs/2026-09-16-happyou-axis-design.md`。

### 1. 何が動く状態か

    python3 tools/test_happyou_axis.py        # 振り分け・発表軸・保底・上限・チップ
    cd web && python3 -m http.server 8761 &
    node tools/test_haiten_ui.mjs http://localhost:8761     # スライダー5本
    node tools/test_conds_layout.mjs http://localhost:8761  # チップ7個・3列×3行

- 「発表」は `presentation` バケツ（2,530科目）。ルールの順序は動かしていないので、
  「個人のレポートとプレゼンテーション」のような同居項目はレポートに残る
- 発表軸 `100 − (30 + 比率 × 0.25)`。保底は内訳に出てくる軸だけに付け、出てくる軸で 0.88 に正規化
- band 閾値 83/77/69。やや重め 2,322 ／ 重め 2,192 ／ 拘束は軽い 1,688 ／ 標準 1,190
- 配点スライダーに「発表」、条件チップに「発表なし」（5,004件）。「レポートのみ」は 508 → 298
- LINE の `preset_top` は6組とも不変（実測）

### 2. 何をしていないか

- **「試験のみ 85.0 ／ レポートのみ 55.0」の倒挂が広がった**（前は 90.1 ／ 66.5）。保底を外すと
  成分が1つの科目はその軸の値そのものになるため。方針（多くの学生は試験を嫌う）と逆向きで、
  2段目の採点エンジンで試験軸に有無の落差を入れて直す
- **条件チップを 3列×3行にした件は林さんに未確認。** 9/11 の指摘で決めた 3列×2行を変えている
- 版に載せるか（`docs/version-pending.md`）は未決。wang に聞く
- 2段目以降（固定重み・相性度・規模軸の削除・事実層:体感層 8:2・好みを調整する UI）

### 3. 次の人が最初に打つコマンド

    git fetch origin && git checkout feat/happyou-axis
    python3 tools/test_happyou_axis.py

### 4. 踏んだ罠

- **`CAP_AXES` に無いキーの上限は黙って無視される。** `passes_caps` / `passesCaps` の最初の判定が
  このタプルしか見ないので、入れ忘れると「発表なし」が全 7,906件に一致した。エラーは出ない
- **今の動的重みのまま軸を足すと分布が崩れる。** 保底 0.10 が内訳に無い軸にも付き、新しい軸が
  満点の約5,000科目を押し上げる（最大 band 63〜73%）。保底の付け方を変えて解いた
- **band の地形は係数に対して単調ではない。** 発表の固定罰点 25 だけ最大 band 42.5% に崩れた。
  係数を変えたら閾値を必ず測り直す
- `tools/test_haiten_ui.mjs` の「合計が100%を下回ると警告」は、スライダーの本数×1本の値で決まる。
  5本×20% は 100% なので警告が出ない。10% ずつに変えた

---
```

- [ ] **Step 2: コミット**

```bash
git add HANDOFF.md
git commit -m "docs(handoff): 発表を独立した軸にした件の引き継ぎ"
```

- [ ] **Step 3: wang に確認してから push と PR**

wang に次の3点を伝えて、push と PR の許可を取る:

1. 約7,300科目の点数が動き、「試験のみ／レポートのみ」の倒挂が 23.6 → 30.0 に広がる
2. 条件チップが 3列×3行になる（林さんへの確認がまだ）
3. `docs/version-pending.md` に載せるか（判断を先に言う：点数とスライダー・チップが変わる利用者から見える変更なので、載せるべき）

許可が出たら:

```bash
git push -u origin feat/happyou-axis
gh pr create --base main --head feat/happyou-axis \
  --title "feat: 発表を独立した軸にする（採点の作り直しの1段目）" \
  --body-file docs/superpowers/specs/2026-09-16-happyou-axis-design.md
```

**マージはしない。** 林さんの確認と wang の判断を待つ。
