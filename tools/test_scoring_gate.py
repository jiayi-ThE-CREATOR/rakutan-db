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


MIN = reviews.MIN_FOR_BACKFILL
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
