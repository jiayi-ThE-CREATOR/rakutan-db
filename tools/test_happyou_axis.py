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
