"""区分が判定できていない科目（画面の「その他」）を一覧にする。

    python3 tools/division_survey.py

政岡さんに「どこから取ればいいか」を渡すための道具。
推定規則を増やすための材料でもあるが、**この出力を見て規則を書き足す前に
必ず実データで件数を確かめること**（tools/test_division.py が検算する）。
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.division import divide

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    f = ROOT / "web" / "data" / "courses.built.json"
    if not f.exists():
        raise SystemExit("先に python3 build.py を流してください")
    courses = json.loads(f.read_text(encoding="utf-8"))["courses"]

    unknown = [c for c in courses if divide(c)[0] is None]
    print(f"判定できていない科目: {len(unknown)} / {len(courses)}\n")

    by_seg = Counter((c.get("numbering") or "")[6:8] for c in unknown)
    print("ナンバリング別:")
    for seg, n in by_seg.most_common():
        print(f"  {seg or '(なし)':6s} {n:4d}")

    print("\n科目名:")
    for c in sorted(unknown, key=lambda x: (x.get("numbering") or "", x["title"])):
        print(f"  {(c.get('numbering') or '―'):14s} {c['title']}")

    got = Counter(divide(c)[0] for c in courses if divide(c)[0])
    print("\n判定できている区分:")
    for k, n in got.most_common():
        print(f"  {k:16s} {n:4d}")


if __name__ == "__main__":
    main()
