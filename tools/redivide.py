#!/usr/bin/env python3
"""公開ずみの web/data/*.json の「区分・学科・要件表」だけを、いまの規則で焼き直す。

    python3 tools/redivide.py [--dry-run]

■ なぜ build.py を流さないか
`data/courses.json` は gitignore で、**全所属7,877件を持っているのは取得した人だけ**。
いま手元にあるのは共通教育1,112件しか無く、build.py は「科目が減る」と言って
正しく止まる（2026-08-26 に足された護り）。だが今回変えたのは
**区分の付け方だけ**で、科目データそのものは1件も変わらない。
tools/rebucket.py が eval_ratio について書いているのと同じ理由で、
**振り分けだけをやり直すのに元データは要らない**。

■ 規則の正本は1つ
判定は `tools.division.divide()` / `track()`、要件表の合流は各学部モジュールの
`apply_to_requirements()` を import して使う。ここに規則を写さない
―― 写した瞬間に build.py と食い違う。

全所属の courses.json を持っている人は、これではなく `python3 build.py` を流せばよい。
結果は同じ（このファイルが書くのは build.py が書く3つのフィールドだけ）。
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import engineering, foreign_studies, senmon  # noqa: E402
from tools.division import divide, track  # noqa: E402

BUILT = ROOT / "web" / "data" / "courses.built.json"
TIMETABLE = ROOT / "web" / "data" / "timetable.json"
REQ_SRC = ROOT / "data" / "faculty_requirements.json"
REQ_DEST = ROOT / "web" / "data" / "requirements.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    doc = json.loads(BUILT.read_text(encoding="utf-8"))
    courses = doc["courses"]
    before = Counter(c.get("division") for c in courses)
    for c in courses:
        c["division"], c["division_source"] = divide(c)
        c["track"] = track(c)
    after = Counter(c.get("division") for c in courses)

    moved = {k: after[k] - before[k] for k in set(before) | set(after)
             if after[k] != before[k]}
    for k, d in sorted(moved.items(), key=lambda kv: -abs(kv[1])):
        print(f"  {str(k):22s} {d:+5d}  → {after[k]}")
    print(f"  区分なし（その他） {before[None]} → {after[None]}")

    tt = json.loads(TIMETABLE.read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in courses}
    n_tt = 0
    for row in tt:
        got = by_id.get(row["id"])
        if got is not None and row.get("track") != got.get("track"):
            row["track"] = got.get("track")
            n_tt += 1
    print(f"  時間割の学科を更新: {n_tt}件")

    req = json.loads(REQ_SRC.read_text(encoding="utf-8"))
    req = foreign_studies.apply_to_requirements(req)
    req = engineering.apply_to_requirements(req)
    req = senmon.apply_to_requirements(req)

    if args.dry_run:
        print("  --dry-run のため書き出していません")
        return 0
    # 書き方は build.py と揃える。separators を既定のままにすると
    # 全行が差分になり、末尾に改行を足すと同じことが起きる（HANDOFF 2026-08-26）。
    BUILT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                     encoding="utf-8")
    TIMETABLE.write_text(json.dumps(tt, ensure_ascii=False, separators=(",", ":")),
                         encoding="utf-8")
    REQ_DEST.write_text(json.dumps(req, ensure_ascii=False, indent=1), encoding="utf-8")
    for p in (BUILT, TIMETABLE, REQ_DEST):
        print(f"→ {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
