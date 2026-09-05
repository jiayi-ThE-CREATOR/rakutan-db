#!/usr/bin/env python3
"""既存の data/courses.json の eval_ratio を、今の METHOD_RULES で作り直す。

    python3 tools/rebucket.py [--dry-run]

なぜ parse.py を流し直さないか
──────────────────────────────
1. `data/raw/`（取得したHTML・約1,100件）は gitignore なので、取得した人の
   手元にしか無い。持っていない人は parse.py を実行できない。
2. parse.py を流し直すと `eligible_years` が消える（`scrape/parse.py` の
   docstring 参照）。scrape/years.py を続けて流す必要があり、KOAN を再度叩く。

`eval_raw`（KOAN の元の内訳）は courses.json に保存済みなので、
振り分けだけをやり直すのに HTML は要らない。**振り分けの規則そのものは
`scrape.parse.bucket_of` を import して使う**（正本は1つ）。

HTML を持っている人（政岡さん）は、これではなく
`python3 scrape/parse.py && python3 scrape/years.py` を流せばよい。結果は同じ。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scrape.parse import bucket_of  # noqa: E402

SRC = ROOT / "data" / "courses.json"


def rebucket(raw: dict[str, float]) -> tuple[dict | None, dict | None]:
    """eval_raw → (eval_ratio, eval_unclassified)。parse.py の one() と同じ手順。"""
    buckets = {"exam": 0.0, "report": 0.0, "attendance": 0.0, "quiz": 0.0}
    unclassified: dict[str, float] = {}
    for name, pct in raw.items():
        b = bucket_of(name)
        if b:
            buckets[b] += pct
        else:
            unclassified[name] = pct
    # 小テストは独立した軸（2026-09-03）。scrape/parse.py と同じ扱いにすること。
    # weekly_quiz は本文由来なのでここでは触らない。
    return ({k: v for k, v in buckets.items() if v > 0} or None,
            unclassified or None)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="書き込まずに差分だけ出す")
    args = ap.parse_args()

    if not SRC.exists():
        sys.exit(f"{SRC} が無い。Discord の courses.json を data/ に置くか、"
                 "scrape/parse.py を流すこと")

    doc = json.loads(SRC.read_text(encoding="utf-8"))
    changed, still_unclassified = 0, 0
    for c in doc["courses"]:
        raw = c.get("eval_raw") or {}
        if not raw:
            continue
        ratio, unclassified = rebucket(raw)
        if ratio != c.get("eval_ratio") or unclassified != c.get("eval_unclassified"):
            changed += 1
        c["eval_ratio"] = ratio
        c["eval_unclassified"] = unclassified
        if unclassified:
            still_unclassified += 1

    print(f"eval_ratio を作り直した科目: {changed} 件")
    print(f"まだ振り分けられない項目が残る科目: {still_unclassified} 件"
          " ← 0 でなければ METHOD_RULES に足す")
    if args.dry_run:
        print("--dry-run のため書き込んでいない")
        return
    SRC.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {SRC} を更新した。続けて `python3 build.py` を流すこと")


if __name__ == "__main__":
    main()
