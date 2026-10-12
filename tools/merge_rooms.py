#!/usr/bin/env python3
"""data/rooms.json の教室を courses.built.json の `room` に足す（2026-10-12）。

    python3 tools/merge_rooms.py
    python3 tools/merge_rooms.py --dry-run

教室は scrape/rooms.py がログイン後の KOAN から取る（公開シラバスには出ない）。
tools/merge_textbook.py と同じく、焼き済みの built に後から足す。
rooms.json に無い科目・教室が空の科目は room を None にする。
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / "web" / "data" / "courses.built.json"
ROOMS = ROOT / "data" / "rooms.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rooms = json.loads(ROOMS.read_text(encoding="utf-8"))
    table = rooms["rooms"]
    doc = json.loads(BUILT.read_text(encoding="utf-8"))
    hit = missing = 0
    for c in doc["courses"]:
        c["room"] = table.get(c["id"])
        hit += c["room"] is not None
        missing += c["id"] not in table
    doc["_meta"]["rooms_fetched"] = rooms["_meta"]["fetched"]
    print(f"built {len(doc['courses'])} 件中 教室あり {hit} 件／rooms.json に無い {missing} 件"
          f"（{rooms['_meta']['fetched']} 取得）")
    if args.dry_run:
        print("dry-run なので書いていない")
        return
    BUILT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                     encoding="utf-8")
    print(f"→ {BUILT} を更新した（採点は触っていないので rescore は不要）")


if __name__ == "__main__":
    main()
