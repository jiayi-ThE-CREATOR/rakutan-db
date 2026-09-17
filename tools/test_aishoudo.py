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
