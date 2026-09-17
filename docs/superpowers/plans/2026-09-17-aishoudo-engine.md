# 採点エンジンを「相性度」に作り直す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 動的重みの採点を、試験の取り分を固定し試験以外は「その科目にある項目だけ」で平均する相性度に置き換え、口コミを人数に応じた体感層として足す。

**Architecture:** `score.py` の採点の中身を丸ごと置き換える（Task 1。焼き直しと閾値の測り直しを同じコミットに入れないと参照分布のテストが落ちる）。続けて口コミの門の改名（Task 2）、LINE のプリセットの当て方（Task 3）、画面の文言（Task 4）、引き継ぎ（Task 5）。どのタスクのコミットでも既存テストが全件通る順にしてある。

**Tech Stack:** Python 3.14（標準ライブラリのみ）、素の JavaScript、テストは `python3 tools/test_*.py` と `node tools/test_*.mjs`（Playwright）の自作ハーネス

**Spec:** `docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md`

## Global Constraints

- Python は標準ライブラリのみ。`python3` の実体は `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`
- 作業場所は worktree `.worktrees/aishou`、ブランチ `feat/aishoudo-engine`。**本体の `main` を動かさない**。push・PR・マージは wang の確認を取ってから
- 相性度 ＝ (1 − s) × 事実層 ＋ s × 体感層。事実層 ＝ 0.50 × 試験の楽さ ＋ 0.50 × 試験以外の楽さ
- 試験の楽さ: 試験なし 100。あり 100 − (40 ＋ 比率 × 0.20)、中間と期末の両方 −8、持込可 +15、持込不可 −5
- 試験以外の重み: 発表 .20 ／ レポート .15 ／ 出席 .15 ／ 小テスト .10。**その科目にある項目だけで正規化**（比率 0 は入れない。小テストは毎回小テストがあれば比率 0 でも入れる）。1つも無ければ 100
- 体感層: テストの難しさ（試験がある科目だけ）・出席・授業中の課題・授業外の課題を `100 − 50 × 値` にして平均。取り分は中身の違う回答の人数で 1人 6.7% ／ 2人 13.3% ／ 3人以上 20%
- **口コミでシラバスの事実（持ち込み可否・レポート字数）を埋める門は3人のまま**
- `needs_review` ＝ 試験があり、口コミにテストの難しさが1件も無い
- band 閾値は実装時に測り直す（spec の 84/71/65 を写さない。P=35 のように地形が崩れる値がある）
- JS テストは静的サーバ（`python3 -m http.server <port> --directory web`）に向けて流す。`tools/test_kuchikomi_modal.mjs` は main でも落ちている既知の NG

---

### Task 1: 採点の中身を相性度に置き換える

**Files:**
- Create: `tools/test_aishoudo.py`
- Modify: `score.py`（冒頭の重みの説明・`EVAL_TOTAL_MIN` の説明・係数定数から `dynamic_weights` まで・`_exam_load`・`_scale_ease`・`AXES`・`score`・band 閾値・`AXIS_LABEL`・`PRESETS`）
- Modify: `tools/test_happyou_axis.py`（B の「保底」節）、`tools/test_haiten_filter.py`（③ の重みの合計・`REF`）、`tools/test_scoring_gate.py`（全体を書き直す）
- Modify: `web/data/courses.built.json`（`build.py --rescore`）

**Interfaces:**
- Consumes: なし
- Produces:
  - 定数 `score.EXAM_BASE = 40.0`、`score.EXAM_RATIO_COEF = 0.20`、`score.EXAM_SHARE = 0.50`、`score.OTHER_WEIGHTS = {"presentation": 0.20, "report": 0.15, "attendance": 0.15, "quiz": 0.10}`、`score.FEEL_MAX_SHARE = 0.20`、`score.FEEL_FULL_AT = 3`
  - `score._present_others(c: dict) -> list[str]`
  - `score._feel(c: dict) -> tuple[float | None, float]`（楽さ、取り分）
  - `score.aishoudo(values: dict, present: list[str], feel: tuple[float | None, float], exam_share: float = EXAM_SHARE, other_weights: dict | None = None) -> float`
  - `score.score(course)` の戻り値に `present: list[str]` と `feel: {"value": float | None, "share": float}` を足し、`coverage` と各軸の `weight` を消す
  - 消えるもの: `dynamic_weights`・`_min_for_scoring`・`_scale_ease`・`COVERAGE_MIN`・`AXIS_FLOOR`・`AXIS_SHARE`・`SCALE_WEIGHT`、`AXES`・`AXIS_LABEL`・`PRESETS` の `scale`

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_aishoudo.py` を新規作成:

```python
"""採点エンジン（相性度）のテスト。ネットワークには出ない。

    python3 tools/test_aishoudo.py

設計は docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import score as scoring  # noqa: E402

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


def course(ratio, raw=None, **kw):
    return {"eval_ratio": ratio, "eval_raw": raw or {k: v for k, v in ratio.items()},
            "exam_type": None, "weekly_quiz": False, **kw}


# ── ① 方針どおりの並び：試験のみ ＜ 出席のみ ＜ レポートのみ ──────────
# 試験 100 − (40 + 100×0.20) = 40 → 0.5×40 + 0.5×100 = 70
# 出席 100 − 100×0.55 = 45       → 0.5×100 + 0.5×45 = 72.5
# レポート 100 − 100×0.45 = 55    → 0.5×100 + 0.5×55 = 77.5
ex = scoring.score(course({"exam": 100.0}))["overall"]
at = scoring.score(course({"attendance": 100.0}))["overall"]
rp = scoring.score(course({"report": 100.0}))["overall"]
check(ex == 70.0, f"試験のみは 70.0 のはず: {ex}")
check(at == 72.5, f"出席のみは 72.5 のはず: {at}")
check(rp == 77.5, f"レポートのみは 77.5 のはず: {rp}")
check(ex < at < rp, f"試験のみ＜出席のみ＜レポートのみ になっていない: {ex} {at} {rp}")

# ── ② 試験の楽さの細部 ─────────────────────────────
v, why = scoring._exam_load(course({"report": 100.0}))
check(v == 100.0 and why == ["試験なし"], f"試験が内訳に無いのは 100: {v} {why}")
v, _ = scoring._exam_load({"eval_ratio": None})
check(v is None, "内訳が読めない科目に試験の点が付いている")
v, _ = scoring._exam_load(course({"exam": 100.0}, exam_type="持込可"))
check(v == 55.0, f"持込可は +15（100−60+15=55）: {v}")
v, _ = scoring._exam_load(course({"exam": 100.0}, exam_type="持込不可"))
check(v == 35.0, f"持込不可は −5（100−60−5=35）: {v}")
v, _ = scoring._exam_load(course({"exam": 100.0}, {"中間試験": 50.0, "期末試験": 50.0}))
check(v == 32.0, f"中間と期末の両方は −8（100−68=32）: {v}")

# ── ③ 試験以外は「その科目にある項目」だけで平均する ───────────────
check(scoring._present_others(course({"report": 100.0})) == ["report"],
      "レポートだけの科目の「ある項目」がレポートだけになっていない")
check(scoring._present_others(course({"report": 100.0}, weekly_quiz=True)) == ["report", "quiz"],
      "毎回小テストがあれば比率0でも小テストを入れる")
# レポート 55 と 毎回小テスト 75 を .15 と .10 で平均 → 63 → 0.5×100 + 0.5×63 = 81.5
s = scoring.score(course({"report": 100.0}, weekly_quiz=True))
check(s["overall"] == 81.5, f"レポート＋毎回小テストは 81.5 のはず: {s['overall']}")
check(scoring.aishoudo({"exam": 100.0}, [], (None, 0.0)) == 100.0,
      "試験以外の項目が1つも無ければ試験以外の楽さは 100")

# ── ④ 体感層：取り分は人数で増える ─────────────────────
def with_reviews(people, hard=2.0, att=1.0):
    c = course({"exam": 100.0})
    c["reviews"] = {"n": people, "n_distinct": people, "exam_hard": hard,
                    "attendance": att, "in_class": 1.0, "out_class": 1.0}
    return c

shares = [scoring._feel(with_reviews(k))[1] for k in (1, 2, 3, 4)]
check(abs(shares[0] - 0.2 / 3) < 1e-9 and abs(shares[1] - 0.4 / 3) < 1e-9,
      f"1人 6.7%・2人 13.3% になっていない: {shares}")
check(abs(shares[2] - 0.2) < 1e-9 and shares[3] == shares[2],
      f"3人以上は 20% で止まる: {shares}")
ease, _ = scoring._feel(with_reviews(1))
check(ease == 37.5, f"難しさ2→0・出席1→50・授業中1→50・授業外1→50 の平均は 37.5: {ease}")
no = scoring.score(course({"exam": 100.0}))["overall"]
one = scoring.score(with_reviews(1))["overall"]
check(one < no and no - one <= 100 * 0.2 / 3,
      f"1人の口コミで動くのは取り分 6.7% ぶんまで: {no} → {one}")
c = course({"report": 100.0})
c["reviews"] = {"n": 1, "n_distinct": 1, "exam_hard": 2.0,
                "attendance": None, "in_class": None, "out_class": None}
check(scoring._feel(c) == (None, 0.0), "試験の無い科目にテストの難しさを入れている")

# ── ⑤ 難しさが確認されていないか ───────────────────────
check(scoring.score(course({"exam": 100.0}))["needs_review"] is True,
      "試験があって口コミが無ければ needs_review")
check(scoring.score(with_reviews(1))["needs_review"] is False,
      "口コミにテストの難しさが1件でもあれば needs_review は下りる")
check(scoring.score(with_reviews(1, hard=None))["needs_review"] is True,
      "口コミがあってもテストの難しさが無ければ needs_review のまま")
check(scoring.score(course({"report": 100.0}))["needs_review"] is False,
      "試験の無い科目は needs_review にならない")

# ── ⑥ 総合値を出さない条件は変わらない ────────────────────
s = scoring.score({"eval_ratio": None})
check(s["overall"] is None and s["band"] == "判定不可", f"内訳が無いのは判定不可: {s['band']}")
s = scoring.score(course({"exam": 60.0}))
check(s["overall"] is None and s["band"] == "情報不足",
      f"内訳が 80% に届かないのは情報不足: {s['overall']} {s['band']}")

# ── ⑦ 古い仕組みが残っていないこと ─────────────────────
for name in ("dynamic_weights", "_scale_ease", "COVERAGE_MIN", "AXIS_FLOOR",
             "AXIS_SHARE", "SCALE_WEIGHT", "_min_for_scoring"):
    check(not hasattr(scoring, name), f"{name} がまだ残っている")
check("scale" not in [k for k, _, _ in scoring.AXES], "規模・形態の軸が残っている")
check(all("scale" not in w for w in scoring.PRESETS.values()), "PRESETS に scale が残っている")
s = scoring.score(course({"report": 100.0}))
check("coverage" not in s and all("weight" not in a for a in s["axes"].values()),
      "coverage や軸ごとの weight がまだ返っている")
check(s["present"] == ["report"] and s["feel"] == {"value": None, "share": 0.0},
      f"present / feel が返っていない: {s.get('present')} {s.get('feel')}")


print(f"{n - len(fails)}/{n} 件が通過")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
```

- [ ] **Step 2: 走らせて落ちることを確かめる**

```bash
cd .worktrees/aishou
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_aishoudo.py
```

期待: FAIL（`AttributeError: module 'score' has no attribute '_present_others'` などで止まる）。

- [ ] **Step 3: 冒頭の重みの説明を置き換える**

`score.py` の「`# 4軸それぞれの重み。合計 1.0。`」で始まり `COVERAGE_MIN = 0.60` で終わる段落（`COVERAGE_MIN` の行を含む）を、次に置き換える:

```python
# 2026-09-17: 採点を「相性度」に作り直した
# （docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md）。
#
#   相性度 ＝ (1 − s) × 事実層 ＋ s × 体感層
#   事実層 ＝ EXAM_SHARE × 試験の楽さ ＋ (1 − EXAM_SHARE) × 試験以外の楽さ
#
# 重みは科目の成績評価内訳からではなく、学生の側から来る（いまは多数派の好み1つ）。
# 以前の動的重みは「試験があるか」の差を潰し、試験のみの科目がレポートのみの
# 科目より軽く出ていた（85.0 ＞ 55.0）。
#
# ここに以前書かれていた「固定重みでやると、レポート1本12,000字・試験なし・出席なしの
# 科目が満点の軸に引っぱられて軽く出る」問題は、試験以外を「その科目にある項目だけ」で
# 平均することで解いている（aishoudo）。
```

同じく次の2行:

```python
# COVERAGE_MIN が守るのは「4軸のうちいくつ測れたか」で、こちらが守るのは
# 「その軸の重み自体が正しいか」。別物なので両方要る。
```

を次に置き換える:

```python
# 2026-09-17 に COVERAGE_MIN（算出できた重みの割合）は消した。
# いまは内訳が読めて、この割合に届いているかだけが「総合値を出すか」を決める。
```

- [ ] **Step 4: 係数定数から `dynamic_weights` までを置き換える**

`score.py` の「`# 「試験で評価される」「レポートで評価される」こと自体への加重。`」の行から、
`dynamic_weights` 関数の最後の `    return w` の行までを、次に置き換える:

```python
# 試験の楽さ。試験が内訳に無ければ 100、あれば 100 −（EXAM_BASE ＋ 比率 × EXAM_RATIO_COEF）。
# EXAM_BASE は「試験があること自体の重さ」。38〜42 が平地（最大 band 29.5%）で、
# 35 にすると 43.1% に崩れた（全 7,906件で実測）。40 はその真ん中。
EXAM_BASE = 40.0
EXAM_RATIO_COEF = 0.20
# 2026-09-11: 0.15 → 0.45。0.15 では「レポートが成績の80%」でも 12点しか
# 引かれず 88点＝軽い になる。これが 2026-08-14 に軸ごと None にした原因
# だったが、誤りは ratio を使ったことではなく係数が小さすぎたことだった。
# 0.45 なら 80% → 64点「標準」で妥当な位置に来る。
REPORT_RATIO_COEF = 0.45

# 2026-09-16: 発表を独立した軸にした。PRESENTATION_BASE は「発表があること自体の
# 負担」―― 人前に立つ・日程が動かせない・グループなら他人と合わせる、という
# レポートとは違う性質の重さ。
PRESENTATION_BASE = 30.0
PRESENTATION_RATIO_COEF = 0.25

# 事実層のうち試験が占める割合と、試験以外の項目どうしの重み。
# **試験以外は、その科目に実際にある項目だけで正規化する**（aishoudo）。
# 全項目に固定で配ると、無い項目の満点 100 が混ざり、試験なしの科目 3,959件が
# 6点幅に潰れた。ある項目だけにすると 15.5点幅に広がる（実測）。
EXAM_SHARE = 0.50
OTHER_WEIGHTS = {"presentation": 0.20, "report": 0.15, "attendance": 0.15, "quiz": 0.10}

# 体感層（口コミ）の取り分。中身の違う回答の人数で増やし、FEEL_FULL_AT 人で上限。
# 1人 6.7% ／ 2人 13.3% ／ 3人以上 20%。上限が 20% なので、1人の回答で
# band を何段も跨ぐ事故（2026-08-21 の 78.0 → 41.6）は起きない。
FEEL_MAX_SHARE = 0.20
FEEL_FULL_AT = 3

# /api/meta 用の説明
WEIGHTS = {
    "model": "aishoudo",
    "exam_share": EXAM_SHARE,
    "other_weights": OTHER_WEIGHTS,
    "feel_max_share": FEEL_MAX_SHARE,
    "feel_full_at": FEEL_FULL_AT,
    "note": "相性度 ＝ (1−体感の取り分)×事実層 ＋ 体感の取り分×体感層。事実層は試験と、その科目にある試験以外の項目で決まる",
}
```

- [ ] **Step 5: `_exam_load` を置き換え、`_scale_ease` を消す**

`def _exam_load` から次の `def _report_load` の直前までを、次に置き換える:

```python
def _exam_load(c: dict) -> tuple[float | None, list[str]]:
    """試験の楽さ。返り値は 0〜100（高いほど楽）。

    2026-09-17: 「試験があること」自体を重さとして数えるようにした（EXAM_BASE）。
    それまでは「試験で評価されるのは難しさではなく形」として比率×0.15 しか引かず、
    試験のみの科目がレポートのみの科目より軽く出ていた。方針は「多くの学生は
    試験を嫌い、レポートのほうがまし」。

    口コミの「テストの難しさ」はここには入れない。体感層（_feel）が持つ。
    内訳そのものが読めない科目だけ None。試験が内訳に無いのは「試験なし」＝100。
    """
    er = c.get("eval_ratio")
    if er is None:
        return None, []
    ratio = float(er.get("exam") or 0.0)
    if ratio == 0:
        return 100.0, ["試験なし"]
    why = [f"試験が成績の{ratio:.0f}%"]
    load = EXAM_BASE + ratio * EXAM_RATIO_COEF
    raw = c.get("eval_raw") or {}
    if any("中間" in k for k in raw) and any("期末" in k for k in raw):
        load += 8
        why.append("中間と期末の2回ある")
    if c.get("exam_type") == "持込可":
        load -= 15
        why.append("持込可")
    elif c.get("exam_type") == "持込不可":
        load += 5
        why.append("持込不可")
    return _clamp(100.0 - load), why


```

`def _scale_ease` から次の `def _schedule_note` の直前までを**削除**する。

- [ ] **Step 6: `AXES` と、式の関数を置き換える**

`AXES = [` から、その閉じ `]` までを次に置き換え、その直後（`def confidence` の前）に3つの関数を足す:

```python
AXES = [
    ("exam", "試験", _exam_load),
    ("report", "レポート・課題", _report_load),
    ("attendance", "出席拘束", _attendance_load),
    ("quiz", "小テスト", _quiz_load),
    ("presentation", "発表", _presentation_load),
]


def _present_others(c: dict) -> list[str]:
    """試験以外で、その科目に実際にある項目。比率が 0 の項目は入れない。

    小テストは比率 0 でも、本文に「毎回小テスト」とあれば負担なので入れる。
    """
    er = c.get("eval_ratio") or {}
    return [k for k in OTHER_WEIGHTS
            if float(er.get(k) or 0.0) > 0 or (k == "quiz" and c.get("weekly_quiz"))]


def _feel(c: dict) -> tuple[float | None, float]:
    """体感層の楽さ（0〜100）と取り分。口コミから楽さが1つも取れなければ (None, 0.0)。

    口コミの値はどれも 0〜2（2 が重い）。100 − 50 × 値 で楽さにして平均する。
    テストの難しさは試験がある科目だけ見る。
    「課題はなかった」は取り込み時に未回答と同じ None になっていて区別できない。
    """
    rv = c.get("reviews") or {}
    if not rv.get("n"):
        return None, 0.0
    signals = []
    has_exam = float((c.get("eval_ratio") or {}).get("exam") or 0.0) > 0
    if has_exam and rv.get("exam_hard") is not None:
        signals.append(100.0 - 50.0 * rv["exam_hard"])
    for k in ("attendance", "in_class", "out_class"):
        if rv.get(k) is not None:
            signals.append(100.0 - 50.0 * rv[k])
    if not signals:
        return None, 0.0
    people = rv.get("n_distinct") or rv["n"]
    share = FEEL_MAX_SHARE * min(people, FEEL_FULL_AT) / FEEL_FULL_AT
    return sum(signals) / len(signals), share


def aishoudo(values: dict, present: list[str], feel: tuple[float | None, float],
             exam_share: float = EXAM_SHARE,
             other_weights: dict | None = None) -> float:
    """相性度。values は各軸の楽さ、present は _present_others、feel は _feel の返り値。

    exam_share と other_weights は、LINE のプリセットのように好みを変えて
    並べ直すときだけ渡す（match）。既定は多数派の好み。
    """
    ow = OTHER_WEIGHTS if other_weights is None else other_weights
    ws = sum(ow.get(k, 0.0) for k in present)
    other = (100.0 if ws <= 0
             else sum(values[k] * ow.get(k, 0.0) for k in present) / ws)
    fact = exam_share * values["exam"] + (1 - exam_share) * other
    ease, share = feel
    total = fact if ease is None else (1 - share) * fact + share * ease
    return round(total, 1)
```

- [ ] **Step 7: `score` を置き換える**

`def score(course: dict) -> dict:` から、その `return {...}` の閉じ `}` までを次に置き換える:

```python
def score(course: dict) -> dict:
    """科目1件の相性度プロファイルを返す。

    内訳が読めない科目、内訳が EVAL_TOTAL_MIN に届かない科目には総合値を出さない。
    欠けた分を平均値で埋めることはしない。
    """
    axes = {}
    for key, label, fn in AXES:
        value, why = fn(course)
        axes[key] = {"label": label, "value": value, "evidence": why}

    er = course.get("eval_ratio") or {}
    eval_captured = round(sum(er.values()), 1) if er else None
    readable = (course.get("eval_ratio") is not None
                and eval_captured is not None and eval_captured >= EVAL_TOTAL_MIN)
    present = _present_others(course)
    feel = _feel(course)
    overall = (aishoudo({k: a["value"] for k, a in axes.items()}, present, feel)
               if readable else None)
    conf = confidence(course)

    # 試験があるのに、口コミでテストの難しさを確かめた人がまだいない。
    # おすすめ順の第1キー（build.py の preset_key）と band の「拘束は軽い」が読む。
    rv = course.get("reviews") or {}
    pending = float(er.get("exam") or 0.0) > 0 and rv.get("exam_hard") is None

    return {
        "overall": overall,
        "band": band_of(overall, conf["level"], 1.0 if er else 0.0, pending),
        "needs_review": pending,
        # LINE のプリセットで並べ直すとき（match）に、科目の中身を読まずに済むように持つ。
        "present": present,
        "feel": {"value": None if feel[0] is None else round(feel[0], 3),
                 "share": round(feel[1], 3)},
        "eval_captured": eval_captured,
        "eval_unclassified": course.get("eval_unclassified"),
        "missing_axes": [a["label"] for a in axes.values() if a["value"] is None],
        "axes": axes,
        "confidence": conf,
        "notes": _schedule_note(course),
        # tags はスコアに一切入らない。表示のみ。
        "tags": course.get("tags", []),
    }
```

- [ ] **Step 8: 表示名とプリセットから `scale` を消す**

`AXIS_LABEL` の次の1行を削除する:

```python
    "scale": "成績の甘さ",   # 規模からの推定。口コミが貯まるまでは確度が低い
```

`PRESETS` の4行を次に置き換える:

```python
    "バイト優先":   {"attendance": 5, "quiz": 5, "report": 3, "exam": 2, "presentation": 3},
    "GPA重視":     {"attendance": 2, "quiz": 3, "report": 3, "exam": 3, "presentation": 3},
    "とにかく軽い": {"attendance": 4, "quiz": 4, "report": 4, "exam": 4, "presentation": 4},
    "テストが苦手": {"attendance": 2, "quiz": 4, "report": 3, "exam": 5, "presentation": 3},
```

- [ ] **Step 9: 新しいテストが通ることを確かめる**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_aishoudo.py
```

期待: 全件通過。

- [ ] **Step 10: 旧エンジンを前提にしたテストを直す**

**(a)** `tools/test_happyou_axis.py` の「`# ── B. 採点：保底は内訳に出てくる軸だけ ───────────────`」の行から、
「`      f"覆いが 0.88 でない（COVERAGE_MIN の判定が変わる）: {s['coverage']}")`」の行までを次に置き換える:

```python
# ── B. 採点：試験以外は「その科目にある項目」だけで平均する（2026-09-17）──
s = scoring.score({"eval_ratio": {"report": 100.0}, "eval_raw": {"レポート": 100.0}})
check(s["overall"] == 77.5,
      f"レポート100%だけの科目は 0.5×100 ＋ 0.5×55 ＝ 77.5 のはず: {s['overall']}")
s = scoring.score({"eval_ratio": {"presentation": 100.0}, "eval_raw": {"発表": 100.0}})
check(s["overall"] == 72.5,
      f"発表100%だけの科目は 0.5×100 ＋ 0.5×45 ＝ 72.5 のはず: {s['overall']}")
```

**(b)** `tools/test_haiten_filter.py` の「`# 重みの合計は 1.0 のまま（AXIS_FLOOR×4 + AXIS_SHARE + SCALE_WEIGHT）。`」の行から、
「`    check("quiz" in w, f"重みに quiz が無い（eval_ratio={er}）")`」の行までを次に置き換える:

```python
# 2026-09-17: 動的重みを廃止した。軸は5つで、規模・形態は消した。
check([k for k, _, _ in scoring.AXES] == ["exam", "report", "attendance", "quiz", "presentation"],
      f"AXES の並びが想定と違う: {[k for k, _, _ in scoring.AXES]}")
check(not hasattr(scoring, "dynamic_weights"), "動的重みがまだ残っている")
```

**(c)** `tools/test_scoring_gate.py` の中身を**全部**次に置き換える:

```python
#!/usr/bin/env python3
"""口コミの効き方を検査する。

    python3 tools/test_scoring_gate.py

2026-09-17 に「3人そろうまで数字に効かせない」門を採点から外した。
いまは口コミの人数で体感層の取り分が増える（1人 6.7% ／ 2人 13.3% ／ 3人以上 20%）。
**ただしシラバスに無い事実（持ち込み可否・レポート字数）を口コミで埋めるのは、
3人そろうまで行わない。** それは事実層（8割）に入り、1人の回答で原則を迂回するため。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import reviews  # noqa: E402
import score  # noqa: E402

ok = 0
fail: list[str] = []


def eq(got, want, what: str) -> None:
    global ok
    if got == want:
        ok += 1
    else:
        fail.append(f"{what}\n      期待 {want!r}\n      実際 {got!r}")


def rv(cid="X", **kw) -> dict:
    base = {"course_id": cid, "taken_year": 2026, "attendance": 1,
            "in_class": 1, "out_class": 1, "exam": True, "exam_bring": None,
            "exam_hard10": None, "report": False, "report_words": None,
            "note": None, "at": "08-21"}
    return {**base, **kw}


def course(**kw) -> dict:
    """一発試験だけの科目。"""
    base = {"id": "X", "title": "テスト科目", "category": "基礎教養",
            "term": "春", "day_period": "月2", "campus": "豊中",
            "eval_ratio": {"exam": 100}, "eval_raw": {"試験": 100},
            "exam_type": None, "report_count": None, "report_words": None,
            "out_of_class_hours": None, "weekly_quiz": False,
            "class_format": "講義", "credits": 2, "tags": []}
    return {**base, **kw}


MIN = reviews.MIN_FOR_SCORING
base = score.score(course())["overall"]


# ── 1人目から数字に入る。ただし取り分ぶんしか動かない ─────────────
prev = base
for k in (1, 2, 3):
    rows = [rv(exam_hard10=10, note=f"{i}人目") for i in range(k)]
    c = course()
    reviews.apply([c], reviews.aggregate(rows))
    got = score.score(c)["overall"]
    eq(got < prev, True, f"{k}人目の「難しい」で総合値が下がる")
    eq(base - got <= 100 * score.FEEL_MAX_SHARE * min(k, 3) / 3 + 1e-9, True,
       f"{k}人では取り分 {min(k, 3)}/3×20% ぶんまでしか動かない（{base} → {got}）")
    eq(score.score(c)["needs_review"], False, f"{k}人がテストの難しさを書けば needs_review は下りる")
    prev = got


# ── 重複は人数に数えない ────────────────────────────────
same = [rv(exam_hard10=10) for _ in range(MIN + 2)]
agg = reviews.aggregate(same)["X"]
eq(agg["n"], MIN + 2, "表示する件数は生の件数のまま")
eq(agg["n_distinct"], 1, "中身が同じものは1人として数える")
c = course()
reviews.apply([c], {"X": agg})
eq(score._feel(c)[1], score.FEEL_MAX_SHARE / 3, "重複を積んでも取り分は1人ぶん")


# ── シラバスに無い事実の穴埋めは、3人そろうまで行わない ───────────
c = course()
reviews.apply([c], reviews.aggregate([rv(exam_bring="可", exam_hard10=5)]))
eq(c.get("exam_type"), None, "1人では持ち込み可否を事実として入れない")

c = course()
rows = [rv(exam_bring="可", exam_hard10=5, note=f"{i}") for i in range(MIN)]
reviews.apply([c], reviews.aggregate(rows))
eq(c.get("exam_type"), "持込可", f"{MIN}人そろえば持ち込み可否が入る")

c = course()
rows = [rv(report=True, report_words=2000, note=f"{i}") for i in range(MIN)]
reviews.apply([c], reviews.aggregate(rows))
eq(c.get("report_words"), 2000, f"{MIN}人そろえばレポート語数が入る")


# ── 表示側は全部見せる ────────────────────────────────
agg = reviews.aggregate([rv(exam_hard10=9, note="きつい")])["X"]
eq(agg["n"], 1, "件数は出す")
eq(agg["exam_hard10"], 9.0, "難易度の値も出す（表示用）")
eq(agg["notes"], ["きつい"], "一言も出す")


print(f"  通過 {ok} 件（事実の穴埋めの門 = {MIN}人）")
for f in fail:
    print(f"  ✗ {f}")
print("NG" if fail else "OK")
sys.exit(1 if fail else 0)
```

- [ ] **Step 11: 焼き直す**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 build.py --rescore
```

- [ ] **Step 12: band 閾値の地形を測る**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 - <<'PY'
import json, sys
sys.path.insert(0, ".")
import score
rows = json.load(open("web/data/courses.built.json"))["courses"]
vals = sorted(s for s in (score.score(c)["overall"] for c in rows) if s is not None)
n = len(vals)
above = {t: sum(1 for v in vals if v >= t) for t in range(0, 102)}
flat = [t for t in range(0, 100) if (above[t] - above[t + 1]) / n * 100 <= 1.5]
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

期待（2026-09-16 の #110 取り込み前のデータでの実測。**ズレたら出力のほうを正として Step 13 と 15 に使う**）:
判定できた 7482、閾値 84/71/65 前後、最大 band 30% 前後。

- [ ] **Step 13: 閾値を差し替える**

`score.py` の3行:

```python
LIGHT_MIN = 83
NORMAL_MIN = 77
HEAVYISH_MIN = 69
```

を次に置き換える（数字は Step 12 の出力に合わせる）:

```python
# 2026-09-17: 採点を相性度に作り直し、ほぼ全科目の点数が動いた。83/77/69 は
# その前の分布の値なので置き直す。選び方は同じ（±1 で 1.5pt 以下しか動かない
# 平らな場所から、4つの band の最大が最も小さくなる3点）。
# 試験の固定罰点 EXAM_BASE を 35 にすると最大 band 43.1% まで崩れた。
# 係数を変えたら必ず測り直すこと。
LIGHT_MIN = 84
NORMAL_MIN = 71
HEAVYISH_MIN = 65
```

- [ ] **Step 14: 新しい閾値で焼き直す**

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 build.py --rescore
```

- [ ] **Step 15: 参照分布を入れ替える**

`tools/test_haiten_filter.py` の `    REF = {` で始まる1行を、次に置き換える（数字は Step 12 の `REF =` の行に合わせる）:

```python
    # 2026-09-17: 採点を相性度に作り直し、ほぼ全科目の点数が動いたので参照値を入れ替えた。
    REF = {"軽い": 0.254, "標準": 0.273, "やや重め": 0.177, "重め": 0.296}
```

- [ ] **Step 16: Python テストを全件流す**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: 全件 `ok`。NG が出たら単独で流して出力を読み、**そのテストの期待が旧エンジン（動的重み・
保底・3人の門・規模軸・試験なしで None）を前提にしているかを報告して止まる**。期待値を黙って書き換えない。

- [ ] **Step 17: コミット**

```bash
git add score.py tools/test_aishoudo.py tools/test_happyou_axis.py tools/test_haiten_filter.py \
        tools/test_scoring_gate.py web/data/courses.built.json
git commit -m "feat(score): 採点を相性度に作り直す（試験の取り分 .50・試験以外はある項目だけで平均・口コミは人数で取り分）"
```

---

### Task 2: 口コミの門の名前を「事実の穴埋め」用に改める

**Files:**
- Modify: `reviews.py`（`MIN_FOR_SCORING` の定義と説明、`scored` の説明、`apply()` の説明）
- Modify: `build.py:455`、`server.py:574`（メタ情報のキー）
- Modify: `web/assets/app.js`（`minForScoring()` の削除、`META` の `min_for_scoring`）
- Modify: `tools/test_scoring_gate.py`（定数名）

**Interfaces:**
- Consumes: Task 1 の `tools/test_scoring_gate.py`
- Produces: `reviews.MIN_FOR_BACKFILL = 3`、メタ情報のキー `min_for_backfill`

- [ ] **Step 1: テストの定数名を先に変える（落ちるのを確かめる）**

`tools/test_scoring_gate.py` の次の1行:

```python
MIN = reviews.MIN_FOR_SCORING
```

を次に置き換えて走らせる:

```python
MIN = reviews.MIN_FOR_BACKFILL
```

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_scoring_gate.py
```

期待: `AttributeError: module 'reviews' has no attribute 'MIN_FOR_BACKFILL'`

- [ ] **Step 2: `reviews.py` を直す**

次の1行:

```python
MIN_FOR_SCORING = 3
```

を次に置き換える（その上の 2026-08-21 の説明は経緯として残す）:

```python
#
# 2026-09-17: 採点の門ではなくなった。口コミは1人目から体感層に入る（取り分は人数で
# 増え、上限 20%。score.py の FEEL_MAX_SHARE）。この数が守るのは
# **シラバスに無い事実（持ち込み可否・レポート字数）を口コミで埋めるかどうか**だけ。
# それは事実層（8割）に入るので、1人の回答で入れると「口コミは最大2割」を迂回する。
MIN_FOR_BACKFILL = 3
```

`aggregate()` の中の次の4行:

```python
            # この口コミを採点に効かせてよいか。False なら score.py は
            # 一切読まない ―― 数字には触れず「確認してください」を出すだけ。
            # 表示（件数・数値・一言）は scored に関係なく全部出す。
            "scored": _distinct(rs) >= MIN_FOR_SCORING,
```

を次に置き換える:

```python
            # 中身の違う回答が MIN_FOR_BACKFILL 人以上そろったか。
            # 2026-09-17 から採点（score.py）はこれを読まない。読むのは
            # apply() の事実の穴埋めと、画面の「あなたに合う」枠（確かめられた科目だけ出す）。
            "scored": _distinct(rs) >= MIN_FOR_BACKFILL,
```

`apply()` の中の次の4行:

```python
        # ここから先は採点に効く。持ち込み可否は load を ±25、レポート語数も
        # レポート軸を動かすので、テストの難易度と同じ門をくぐらせる。
        # 門の手前でも a（＝c["reviews"]）には値が入っているので、
        # 詳細パネルには今まで通り全部出る。消えるのは採点への影響だけ。
```

を次に置き換える:

```python
        # ここから先はシラバスの事実を埋める。持ち込み可否は試験の楽さを ±15〜20、
        # レポート語数はレポート軸を動かし、どちらも事実層（8割）に入るので、
        # MIN_FOR_BACKFILL 人そろうまで入れない。口コミそのもの（難しさ・出席・課題）は
        # 人数に関係なく体感層に入る（score.py の _feel）。
```

- [ ] **Step 3: メタ情報のキーを揃える**

`build.py` の:

```python
            "min_for_scoring": reviews.MIN_FOR_SCORING,
```

を次に置き換える:

```python
            "min_for_backfill": reviews.MIN_FOR_BACKFILL,
```

`server.py` の:

```python
                "min_for_scoring": reviews_mod.MIN_FOR_SCORING,
```

を次に置き換える:

```python
                "min_for_backfill": reviews_mod.MIN_FOR_BACKFILL,
```

- [ ] **Step 4: 画面の使われていない関数を消す**

`web/assets/app.js` の次の9行（どこからも呼ばれていない）を削除する:

```js
/* 口コミが採点に効き始める人数。reviews.py の MIN_FOR_SCORING が正本で、
   build.py が courses.built.json の _meta に焼き、API は /api/meta で返す。
   ここで数字を書くと、門を変えたときに文言だけ古くなる
   （2026-08-24 まで「1件入ると出ます」と出していたが、実際は3件だった）。 */
function minForScoring(){
  // API モードは /api/meta、静的モードは courses.built.json の _meta 由来。
  // どちらも届かないときだけ 3（reviews.py の既定）に落とす。
  return (META && META.min_for_scoring) || 3;
}
```

同じファイルの次の1行を削除する:

```js
    min_for_scoring: m.min_for_scoring,
```

- [ ] **Step 5: 残りが無いことを確かめ、テストを流す**

```bash
grep -rn "MIN_FOR_SCORING\|min_for_scoring\|minForScoring" --include='*.py' --include='*.js' --include='*.mjs' . | grep -v node_modules | grep -v '\.worktrees' | grep -v '^./docs'
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
$P build.py --rescore
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: grep は `reviews.py` の 2026-08-21 の説明文の中の語だけ（コードの参照は0件）。Python テスト全件 `ok`。

- [ ] **Step 6: コミット**

```bash
git add reviews.py build.py server.py web/assets/app.js tools/test_scoring_gate.py web/data/courses.built.json
git commit -m "refactor(reviews): 口コミの門を「事実の穴埋め」専用の MIN_FOR_BACKFILL に改める"
```

---

### Task 3: LINE のプリセットを相性度で並べる

**Files:**
- Modify: `score.py`（`match()` と、その前に `profile_from_weights()` を足す）
- Modify: `tools/test_aishoudo.py`（⑧ を足す）
- Modify: `web/data/courses.built.json`（`preset_top` の組み直し）

**Interfaces:**
- Consumes: Task 1 の `score.aishoudo`、`score()` の戻り値の `present` / `feel`
- Produces: `score.profile_from_weights(weights: dict) -> tuple[float, dict]`（試験の取り分、試験以外の重み）

- [ ] **Step 1: 失敗するテストを書く**

`tools/test_aishoudo.py` の末尾の `print(f"{n - len(fails)}/{n} 件が通過")` の**直前**に足す:

```python
# ── ⑧ LINE のプリセット：試験の取り分 ＝ 試験の重み ÷（試験の重み ＋ 試験以外の平均）──
e, ow = scoring.profile_from_weights(scoring.PRESETS["とにかく軽い"])
check(e == 0.5, f"すべて同じ重みなら試験の取り分は 0.50: {e}")
e, _ = scoring.profile_from_weights(scoring.PRESETS["テストが苦手"])
check(abs(e - 0.625) < 1e-9, f"テストが苦手は 5/(5+3)=0.625: {e}")
e, _ = scoring.profile_from_weights(scoring.PRESETS["バイト優先"])
check(abs(e - 1 / 3) < 1e-9, f"バイト優先は 2/(2+4)=0.333: {e}")
rk = scoring.score(course({"exam": 100.0}))
fit_test = scoring.match(rk, scoring.PRESETS["テストが苦手"])["fit"]
fit_baito = scoring.match(rk, scoring.PRESETS["バイト優先"])["fit"]
check(fit_test < fit_baito,
      f"試験のみの科目は「テストが苦手」で「バイト優先」より低く出る: {fit_test} {fit_baito}")
check(scoring.match(scoring.score({"eval_ratio": None}), scoring.PRESETS["バイト優先"])["fit"] is None,
      "総合値を出さない科目にプリセットの相性を出している")
```

```bash
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 tools/test_aishoudo.py
```

期待: `AttributeError: module 'score' has no attribute 'profile_from_weights'`

- [ ] **Step 2: `match()` を置き換える**

`def match(course_score: dict, weights: dict | None = None) -> dict:` から、その関数の最後の
`return {"fit": fit, "reason": "".join(parts), "weights": w, "labels": AXIS_LABEL}`（2行にまたがる）までを、次に置き換える:

```python
def profile_from_weights(weights: dict) -> tuple[float, dict]:
    """プリセットの重み（0〜5）を、試験の取り分と試験以外の重みに当てる。

    試験の取り分 ＝ 試験の重み ÷（試験の重み ＋ 試験以外の重みの平均）。
    すべて同じ重み（とにかく軽い）なら 0.50 で、既定の式と一致する。
    """
    others = {k: float(weights.get(k, 0)) for k in OTHER_WEIGHTS}
    mean_other = sum(others.values()) / len(others)
    exam_w = float(weights.get("exam", 0))
    if exam_w + mean_other <= 0:
        return EXAM_SHARE, dict(OTHER_WEIGHTS)
    return exam_w / (exam_w + mean_other), others


def match(course_score: dict, weights: dict | None = None) -> dict:
    """学生の重み（LINE のプリセット）で並べ直した相性と、その理由の文章を返す。

    2026-09-17: 中身を「軸の値の加重平均」から相性度の式（aishoudo）に替えた。
    プリセットの重みは profile_from_weights で試験の取り分と試験以外の重みに当てる。
    """
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    axes = course_score["axes"]

    # 総合値を出さないと決めた科目に、相性の数字だけ出してはいけない。
    if course_score.get("overall") is None:
        return {"fit": None, "reason": _unjudged_reason(course_score),
                "weights": w, "labels": AXIS_LABEL}

    exam_share, other_weights = profile_from_weights(w)
    feel = course_score.get("feel") or {}
    fit = aishoudo({k: a.get("value") for k, a in axes.items()},
                   course_score.get("present") or [],
                   (feel.get("value"), feel.get("share", 0.0)),
                   exam_share, other_weights)

    # 重視している順に見て、満たした軸／満たさない軸を拾う
    ranked = sorted(w.items(), key=lambda kv: -kv[1])
    good, bad = [], []
    for k, weight in ranked:
        v = axes.get(k, {}).get("value")
        if v is None or weight < 3:
            continue
        (good if v >= 66 else bad if v < 45 else []).append(AXIS_LABEL[k])

    parts = []
    if good:
        parts.append(f"あなたが重視する{'・'.join(good[:2])}を満たしています。")
    if bad:
        parts.append(f"一方で{'・'.join(bad[:2])}は期待できません。")
    if not parts:
        parts.append("重視している条件については、この科目は平均的です。")

    return {"fit": fit, "reason": "".join(parts),
            "weights": w, "labels": AXIS_LABEL}
```

- [ ] **Step 3: テストを流し、`preset_top` を組み直す**

```bash
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
$P tools/test_aishoudo.py
git show HEAD:web/data/courses.built.json > /tmp/aishou_before.json
$P build.py --rescore
$P - <<'PY'
import json
old = json.load(open("/tmp/aishou_before.json"))["preset_top"]
new = json.load(open("web/data/courses.built.json"))["preset_top"]
for y in ("1", "2", "4"):
    print(y + "年: " + "  ".join(f"{k} 残る{len(set(old[y][k]) & set(new[y][k]))}/100" for k in new[y]))
PY
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: `test_aishoudo.py` 全件通過。`preset_top` は大きく入れ替わる（spec の実測では1年で 1〜31/100 が残る）。
Python テスト全件 `ok`。

- [ ] **Step 4: コミット**

```bash
git add score.py tools/test_aishoudo.py web/data/courses.built.json
git commit -m "feat(score): LINE のプリセットを相性度の式で並べる（試験の取り分をプリセットの重みから決める）"
```

---

### Task 4: 画面の名前を「相性度」にし、嘘になった注意帯を消す

**Files:**
- Modify: `web/assets/app.js`（カードの名前・`reviewMark`・2026-09-03 の注記2か所）
- Modify: `server.py`（`explain` を呼ぶ所の注記）、`web/index.html`（並び順の注記）、`tools/smoke.mjs`（表示名）

**Interfaces:**
- Consumes: Task 1〜3 で焼き直した `web/data/courses.built.json`
- Produces: なし（表示のみ）

- [ ] **Step 1: カードの名前を変える**

`web/assets/app.js` の:

```js
      <div class="fit"><b>${r.overall ?? "—"}</b><small>楽単スコア</small></div>
```

を次に置き換える:

```js
      <div class="fit"><b>${r.overall ?? "—"}</b><small>相性度</small></div>
```

- [ ] **Step 2: 2026-09-03 の注記を書き換える**

`web/assets/app.js` の次の6行:

```js
/* score.py の match() と同じ。数字は総合の楽単スコアで、理由は軸の値だけから書く。

   2026-09-03: スライダーが「重み」から「上限」に変わったので、内積で出す
   「相性」という数字は入力を失った。ユーザーの重み無しで出した数字に
   「あなたとの相性」という名前を付けると嘘になるので、表に出すのは
   総合の楽単スコアにした。上限は絞り込み、順位は楽単スコア。 */
```

を次に置き換える:

```js
/* score.py の explain() と同じ。数字は相性度で、理由は軸の値だけから書く。

   2026-09-17: 表の名前を「楽単スコア」から「相性度」に戻した。2026-09-03 には
   「好みの入力が無いのに『相性』と呼ぶのは嘘になる」として楽単スコアにしていたが、
   採点を多数派の好み（試験がいちばん負担）で計算する相性度に作り直したのに合わせ、
   wang がこの経緯を承知のうえで「相性度」と決めた。**この注記を根拠に戻さないこと。**
   上限は絞り込み、順位は相性度。 */
```

同じファイルの次の2行:

```js
     2026-09-03: match.fit の中身は「重みとの内積」ではなく総合の楽単スコアに
     なった（matchLocal 参照）。上限は絞り込み、順位は楽単スコア。 */
```

を次に置き換える:

```js
     2026-09-17: match.fit の中身は相性度（matchLocal 参照）。上限は絞り込み、
     順位は相性度。 */
```

- [ ] **Step 3: 注意帯を消す**

`web/assets/app.js` の次の関数:

```js
function reviewMark(rv){
  if (!rv?.n || rv.scored) return { alert:"" };
  return { alert:`<div class="rvAlert"><i>⚠</i><div>口コミ ${rv.n}件 ―
      まだ数字には入っていません。下の「口コミを読む」で中身を確認してください</div></div>` };
}
```

を次に置き換える:

```js
function reviewMark(rv){
  /* 2026-09-17: 「口コミ N件 ― まだ数字には入っていません」の注意帯を消した。
     口コミは1人目から相性度の体感層に入る（取り分は人数で増え、上限20%）ので、
     この文は嘘になる。呼び出し側を崩さないよう、空の形だけ返す。 */
  return { alert:"" };
}
```

- [ ] **Step 4: ほかの注記と表示名を揃える**

`server.py` の:

```python
        # 画面に出すのは総合の楽単スコア。ユーザーの重みはもう無い。
```

→

```python
        # 画面に出すのは相性度（多数派の好みで計算した総合値）。
```

`web/index.html` の:

```html
               「難しさが確認ずみ → 楽単スコアの高い順」になった。
```

→

```html
               「難しさが確認ずみ → 相性度の高い順」になった。
```

`tools/smoke.mjs` の:

```js
console.log(`  先頭      ${r.first}  楽単スコア ${r.fit}`);
```

→

```js
console.log(`  先頭      ${r.first}  相性度 ${r.fit}`);
```

- [ ] **Step 5: 残りが無いことを確かめ、JS と Python のテストを流す**

```bash
grep -rn "楽単スコア\|まだ数字には入っていません" web/ server.py tools/*.mjs
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
($P -m http.server 8771 --directory web >/dev/null 2>&1 & echo $! > /tmp/aishou_srv.pid)
until curl -s -o /dev/null http://localhost:8771/; do sleep 0.5; done
pass=0; failed=""
for t in tools/test_*.mjs; do node "$t" http://localhost:8771 >/tmp/aishou_mjs.txt 2>&1 && pass=$((pass+1)) || failed="$failed $t"; done
kill $(cat /tmp/aishou_srv.pid)
echo "JS: $pass 通過 / 失敗:$failed"
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

期待: grep は2026-09-17 の注記の中の「楽単スコア」だけ。JS の失敗は `tools/test_kuchikomi_modal.mjs` だけ。
Python テスト全件 `ok`。それ以外が落ちたら出力を貼って止まる。

- [ ] **Step 6: コミット**

```bash
git add web/assets/app.js server.py web/index.html tools/smoke.mjs
git commit -m "feat(web): 表の名前を「相性度」にし、口コミの「まだ数字に入っていない」注意帯を消す"
```

---

### Task 5: 引き継ぎを書いて、PR の前に確認する

**Files:**
- Modify: `HANDOFF.md`（ルール節の最初の `---` の直後）
- Modify: `docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md`（状態の行）

- [ ] **Step 1: main を取り込み、全テストを流し直す**

```bash
git fetch origin && git merge --no-edit origin/main
P=/Library/Frameworks/Python.framework/Versions/3.14/bin/python3
$P build.py --rescore
for t in tools/test_*.py; do $P "$t" >/dev/null 2>&1 && echo "ok  $t" || echo "NG  $t"; done
```

衝突したら、`web/data/courses.built.json` は main の版を取って `build.py --rescore` し直す。
HANDOFF.md と docs/version-pending.md は双方の追記を残す。

- [ ] **Step 2: HANDOFF に追記する**

ルール節の最初の `---` の直後に、次を足す（数字は Task 1 Step 12 と Task 3 Step 3 の実測に合わせる）:

```markdown
## 2026-09-17 ｜ 採点を「相性度」に作り直した（採点の作り直しの2段目）｜ Claude → 次の人

設計は `docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md`、手順は
`docs/superpowers/plans/2026-09-17-aishoudo-engine.md`。ブランチ `feat/aishoudo-engine`（**未マージ**）。

### 1. 何が動く状態か

    python3 tools/test_aishoudo.py       # 式・体感層・needs_review・プリセット
    python3 tools/test_scoring_gate.py   # 口コミの取り分と、事実の穴埋めの門

- 相性度 ＝ (1−s)×事実層 ＋ s×体感層、事実層 ＝ 0.50×試験の楽さ ＋ 0.50×試験以外の楽さ
- 試験以外は**その科目にある項目だけ**で平均（発表.20／レポート.15／出席.15／小テスト.10）
- 試験のみ 70.0 ＜ 出席のみ・発表のみ 72.5 ＜ レポートのみ 77.5
- 口コミは1人目から体感層に入る（1人 6.7%／2人 13.3%／3人以上 20%）
- 持ち込み可否・レポート字数を口コミで埋めるのは3人そろってから（`reviews.MIN_FOR_BACKFILL`）
- カードの名前は「相性度」

### 2. 何をしていないか

- **ほぼ全科目の band が変わり、LINE の `preset_top` もほぼ入れ替わる。** 版のお知らせで説明が要る
- `docs/version-pending.md` に載せるかは未決（wang に聞く）
- 好みを調整する UI（3段目）
- 口コミの「課題はなかった」が未回答と区別できない（取り込み側の問題）

### 3. 次の人が最初に打つコマンド

    git fetch origin && git checkout feat/aishoudo-engine
    python3 tools/test_aishoudo.py

### 4. 踏んだ罠

- **全項目に固定の重みを配ると、無い項目の満点が混ざって試験なしの科目が6点幅に潰れる。**
  係数を急にしても平行移動するだけで広がらない。「ある項目だけで正規化」で解いた
- **試験の固定罰点 40 は 38〜42 の平地の真ん中。** 35 にすると最大 band 43.1% に崩れる
- 口コミの「門」は2つの役割を兼ねていた（採点に効かせるか／シラバスの事実を埋めるか）。
  前者だけ外し、後者は3人のまま残した。事実層に入る穴埋めを1人で許すと「口コミは最大2割」を迂回する

---
```

`docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md` の:

```
2026-09-16 ｜ 状態: 設計ずみ・未実装 ｜
```

→

```
2026-09-16 ｜ 状態: 実装ずみ（ブランチ `feat/aishoudo-engine`、未マージ）｜
```

- [ ] **Step 3: コミット**

```bash
git add HANDOFF.md docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md web/data/courses.built.json
git commit -m "docs(handoff): 採点を相性度に作り直した件の引き継ぎ"
```

- [ ] **Step 4: wang に確認してから push と PR**

次の3点を伝えて許可を取る:

1. ほぼ全科目の band が変わり、LINE のおすすめもほぼ入れ替わる
2. `docs/version-pending.md` に載せるか（判断を先に言う：利用者から見て評価が大きく変わるので、載せたうえで説明文が要る）
3. マージすると約80秒で本番に出る

**マージは wang の指示があるまでしない。**
