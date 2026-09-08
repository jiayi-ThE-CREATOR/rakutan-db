#!/usr/bin/env python3
"""生HTMLから `成績評価に関する補足情報` を拾って courses.json に足す。

    python3 tools/merge_eval_note.py --raw data/raw_hosoku            # 焼き済みの built へ
    python3 tools/merge_eval_note.py --raw data/raw_hosoku --src data/courses.json

なぜ parse.py を流し直さないか
──────────────────────────────
tools/rebucket.py と同じ理由。`data/raw/` は全件を取得した人の手元にしか無く、
parse.py を流し直すと eligible_years が消える（scrape/parse.py の docstring）。
ここは **HTML を持っている科目についてだけ** 1フィールドを足す。

既定の書き込み先は `web/data/courses.built.json`（全7,906件）。手元の
`data/courses.json` は取得した人以外だと共通教育1,112件ぶんしか無く、
補足情報が要る137件はほとんどが学部の専門科目なので当たらない
（実測：45件のうち当たったのは2件）。build.py --rescore と同じ考え方。

抽出そのものは scrape.parse.labeled を import して使う（正本は1つ）。
全件の HTML が揃ったら `python3 scrape/parse.py` が同じ値を入れる。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bs4 import BeautifulSoup                    # noqa: E402
from scrape.parse import labeled                 # noqa: E402

BUILT = ROOT / "web" / "data" / "courses.built.json"


def notes_from(raw_dir: Path) -> dict[str, str]:
    detail = raw_dir / "detail" if (raw_dir / "detail").is_dir() else raw_dir
    out = {}
    for f in sorted(detail.glob("*.html")):
        L = labeled(BeautifulSoup(f.read_text(encoding="utf-8"), "html.parser"))
        note = (L.get("成績評価に関する補足情報") or "").strip()[:400]
        if note:
            out[f.stem] = note
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", action="append", required=True)
    ap.add_argument("--src", default=str(BUILT))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    notes = {}
    for d in args.raw:
        notes |= notes_from(Path(d))
    print(f"HTML から拾えた補足情報: {len(notes)} 件")

    src = Path(args.src)
    doc = json.loads(src.read_text(encoding="utf-8"))
    hit = miss = same = 0
    for c in doc["courses"]:
        n = notes.get(c["id"])
        if n is None:
            miss += 1
            continue
        if c.get("eval_note") == n:
            same += 1
        else:
            hit += 1
        if not args.dry_run:
            c["eval_note"] = n
    print(f"  courses.json に当たった {hit + same} 件（更新 {hit} / 変化なし {same}）"
          f"／この JSON に居ない {len(notes) - hit - same} 件")
    if args.dry_run:
        print("dry-run なので書いていない")
        return
    # built は separators を詰めて焼く（build.py と同じ）。courses.json は読む
    # のが人なので indent を付ける。書き方を混ぜると差分が全行になる。
    if src.name == "courses.built.json":
        src.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")
        print(f"→ {src} を更新した（採点は触っていないので rescore は不要）")
    else:
        src.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"→ {src} を更新した。続けて `python3 build.py` を流すこと")


if __name__ == "__main__":
    main()
