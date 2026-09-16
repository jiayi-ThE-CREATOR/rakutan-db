"""発表を独立した軸にしたことのテスト。ネットワークには出ない。

    python3 tools/test_happyou_axis.py

設計は docs/superpowers/specs/2026-09-16-happyou-axis-design.md
"""
import contextlib
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scrape.parse import bucket_of  # noqa: E402
from tools.rebucket import rebucket  # noqa: E402
import score as scoring  # noqa: E402

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


print(f"{n - len(fails)}/{n} 件が通過")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
