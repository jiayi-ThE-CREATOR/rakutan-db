#!/usr/bin/env python3
"""負担とランク（段②）の検査。設計: docs/superpowers/specs/2026-10-13-futan-rank-design.md §4

    python3 tools/test_futan.py

守りたいこと:
  ・新しい口コミ（form v5）があれば、負担は口コミだけで出る（シラバスが読めない科目でも）
  ・新しい口コミのランクは固定の区切り（<1 SS／<2 S／<3 A／<4 B／他 C）
  ・シラバス式の科目のランクは分布の5等分（build.assign_ranks）
  ・「実際はなかった」が過半数のシラバスの項目は mismatch に出る
  ・古い口コミの物差しをそろえる（calibrate_feel）と、口コミのある科目が系統的に重くも軽くもならない
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build  # noqa: E402
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


def course(ratio: dict | None, cid: str = "X", **kw) -> dict:
    return {"id": cid, "title": "t", "eval_ratio": ratio,
            "eval_raw": {k: v for k, v in (ratio or {}).items()}, **kw}


def v5(**items) -> dict:
    base = {"exam": 0, "report": 0, "attendance": 0, "quiz": 0, "presentation": 0}
    return {"v": 5, "course_id": "X", "items": {**base, **items}}


# ── 新しい口コミだけで負担が出る ───────────────────────────
c = course({"exam": 70.0, "quiz": 30.0})
reviews.apply([c], reviews.aggregate([v5(exam=3, quiz=2), v5(exam=2, quiz=2)]))
r = score.score(c)
b = r["futan"]["value"]
eq(r["futan"]["source"], "kuchikomi", "v5: 出どころは口コミ")
eq(r["overall"], round(100 - b * 20, 1), "v5: overall ＝ 100 − 負担×20")
eq(r["futan"]["rank"], "S", f"v5: 負担 {b} は S（1以上2未満）")
eq(r["needs_review"], False, "v5: テストを答えていれば難しさ未確認ではない")
eq(r["futan"]["people"], 2, "v5: 人数")

c = course(None)    # 内訳が読めない科目
reviews.apply([c], reviews.aggregate([v5(report=3)]))
r = score.score(c)
eq(r["futan"]["source"], "kuchikomi", "v5: 内訳が読めなくても口コミで負担が出る")
eq(r["overall"] is not None, True, "v5: 内訳が読めなくても overall が出る")

# ── 固定の区切り ──────────────────────────────────────
eq([score.rank_v5(x) for x in (0, 0.99, 1, 1.99, 2, 2.99, 3, 3.99, 4, 5)],
   ["SS", "SS", "S", "S", "A", "A", "B", "B", "C", "C"], "v5: 区切り <1 SS／<2 S／<3 A／<4 B／他 C")

# ── mismatch：シラバスにあるのに過半数が「なかった」 ─────────────
c = course({"exam": 70.0, "quiz": 30.0})
reviews.apply([c], reviews.aggregate([v5(exam=0, quiz=2), v5(exam=0, quiz=2), v5(exam=3, quiz=2)]))
eq(score.score(c)["futan"]["mismatch"], ["exam"], "v5: 3人中2人が「テストはなかった」")

# ── シラバス式の科目：分布の5等分 ─────────────────────────
vals = [float(x) for x in range(100)]
cuts = score.rank_cuts(vals)
ranks = [score.rank_of_overall(x, cuts) for x in vals]
eq([ranks.count(k) for k in score.RANKS], [20, 20, 20, 20, 20], "5等分：100件なら20件ずつ")
eq(score.rank_of_overall(99.0, cuts), "SS", "点が高い（楽）ほど SS")

cs = [course({"exam": 100.0}, cid="A"), course({"report": 100.0}, cid="B")]
built = [{"rakutan": score.score(x)} for x in cs]
build.assign_ranks(built)
eq(all(x["rakutan"]["futan"]["rank"] in score.RANKS for x in built), True,
   "assign_ranks がシラバス式の科目にランクを付ける")

# ── 古い口コミの物差しをそろえる ─────────────────────────
# 口コミは中身に関係なく低く出る（古い質問の出席「毎回」＝0点の影響）という状況を作る
pool = []
for i in range(40):
    x = course({"exam": float(i * 2), "report": float(100 - i * 2)}, cid=f"C{i}")
    x["reviews"] = {"n": 1, "n_distinct": 1, "attendance": 2.0 - i / 40,
                    "in_class": 1.0, "out_class": 1.0}
    pool.append(x)
score._FEEL_MAP = None
raw = [score.score(x) for x in pool]
bias_raw = sum(r["overall"] - r["fact"] for r in raw) / len(raw)
info = score.calibrate_feel(pool)
cal = [score.score(x) for x in pool]
bias_cal = sum(r["overall"] - r["fact"] for r in cal) / len(cal)
eq(info["feels"], 40, "calibrate_feel: 口コミのある科目を数えている")
eq(bias_raw < -5, True, f"そろえる前は口コミのある科目が重く出る（{bias_raw:.1f}）")
eq(abs(bias_cal) < 1.0, True, f"そろえた後は系統的なずれが消える（{bias_cal:.2f}）")
order_raw = [r["feel"]["raw"] for r in cal]
order_cal = [r["feel"]["value"] for r in cal]
eq(sorted(range(40), key=lambda i: order_raw[i]) == sorted(range(40), key=lambda i: order_cal[i]),
   True, "そろえても口コミどうしの順番は変わらない")
score._FEEL_MAP = None

if fail:
    print("NG")
    for f in fail:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {ok} 件")
print("OK")
