#!/usr/bin/env python3
"""口コミが採点に効き始める件数の門を検査する。

    python3 tools/test_scoring_gate.py

守りたいこと（2026-08-21 の方針転換）:
  少数の証言で数字を動かさない。1人が「テストは難しい」と言っただけで
  総合値が半分になるのは、根拠として弱すぎる。
  規定件数に届くまで、口コミは数字に触れず「確認してください」と出すだけ。
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
    """一発試験だけの科目。口コミが無ければ「難しさ不明」になる形。"""
    base = {"id": "X", "title": "テスト科目", "category": "基礎教養",
            "term": "春", "day_period": "月2", "campus": "豊中",
            "eval_ratio": {"exam": 100}, "eval_raw": {"試験": 100},
            "exam_type": None, "report_count": None, "report_words": None,
            "out_of_class_hours": None, "weekly_quiz": False,
            "class_format": "講義", "credits": 2, "tags": []}
    return {**base, **kw}


MIN = reviews.MIN_FOR_SCORING
eq(MIN >= 2, True, "門は2件以上に置く（1件では動かさない）")


# ── 門の手前：数字に一切触れない ────────────────────────
for n in range(1, MIN):
    rows = [rv(exam_hard10=10) for _ in range(n)]
    # 同一内容の重複は1人として数える。1人が3回送っても3人分にはならない。
    rows = [rv(exam_hard10=10, note=f"{i}人目") for i in range(n)]
    agg = reviews.aggregate(rows)["X"]
    eq(agg["scored"], False, f"{n}件では採点に効かない")

    c_none = course()
    c_gated = course()
    reviews.apply([c_gated], {"X": agg})
    eq(score.score(c_gated)["overall"], score.score(c_none)["overall"],
       f"{n}件では総合値が動かない")
    eq(score.score(c_gated)["needs_review"], True,
       f"{n}件でも「確認してください」は立ったまま")

# 一番効く証言（テスト最難）でも、門の手前なら1点も動かない
c = course()
reviews.apply([c], reviews.aggregate([rv(exam_hard10=10)]))
eq(score.score(c)["axes"]["exam"]["value"], score.score(course())["axes"]["exam"]["value"],
   "1件では試験軸すら動かない")


# ── 門の先：今まで通り効く ──────────────────────────────
rows = [rv(exam_hard10=10, note=f"{i}") for i in range(MIN)]
agg = reviews.aggregate(rows)["X"]
eq(agg["scored"], True, f"{MIN}件そろえば採点に効く")

c_hard = course()
reviews.apply([c_hard], {"X": agg})
eq(score.score(c_hard)["overall"] < score.score(course())["overall"], True,
   f"{MIN}件で「難しい」なら総合値は下がる")
eq(score.score(c_hard)["needs_review"], False,
   f"{MIN}件そろえば「確認してください」は下りる")


# ── 重複は人数に数えない ────────────────────────────────
# 同じ人が同じ内容を3回送っても「3人が言っている」ことにはならない。
same = [rv(exam_hard10=10) for _ in range(MIN + 2)]
agg = reviews.aggregate(same)["X"]
eq(agg["n"], MIN + 2, "表示する件数は生の件数のまま")
eq(agg["n_distinct"], 1, "中身が同じものは1人として数える")
eq(agg["scored"], False, "重複を積んでも門は開かない")


# ── シラバスに無い事実の穴埋めも門の内側 ────────────────
# 持ち込み可否・レポート語数も採点に効く（load が ±25 動く）ので、
# 少数の証言で入れない。パネルには出るが、数字には入らない。
c = course()
reviews.apply([c], reviews.aggregate([rv(exam_bring="可", exam_hard10=5)]))
eq(c.get("exam_type"), None, "1件では持ち込み可否を採点に入れない")

c = course()
rows = [rv(exam_bring="可", exam_hard10=5, note=f"{i}") for i in range(MIN)]
reviews.apply([c], reviews.aggregate(rows))
eq(c.get("exam_type"), "持込可", f"{MIN}件そろえば持ち込み可否が入る")

c = course()
rows = [rv(report=True, report_words=2000, note=f"{i}") for i in range(MIN)]
reviews.apply([c], reviews.aggregate(rows))
eq(c.get("report_words"), 2000, f"{MIN}件そろえばレポート語数が入る")


# ── 表示側は門に関係なく全部見せる ──────────────────────
agg = reviews.aggregate([rv(exam_hard10=9, note="きつい")])["X"]
eq(agg["n"], 1, "件数は出す")
eq(agg["exam_hard10"], 9.0, "難易度の値も出す（表示用）")
eq(agg["notes"], ["きつい"], "一言も出す")
eq(agg["scored"], False, "が、採点には入らない")


print(f"  通過 {ok} 件（門 = {MIN}件）")
for f in fail:
    print(f"  ✗ {f}")
print("NG" if fail else "OK")
sys.exit(1 if fail else 0)
