#!/usr/bin/env python3
"""生HTMLから「教科書・指定教材」を拾い、本ごとに分けた `textbooks` を courses.built.json に足す（2026-10-02）。

    python3 tools/merge_textbook.py --raw data/raw            # 焼き済みの built へ
    python3 tools/merge_textbook.py --raw data/raw --dry-run

tools/merge_eval_note.py と同じ理由で parse.py を流し直さない
（流すと eligible_years が消える）。判定は scrape.parse.textbook_of を
import して使う（正本は1つ）。--raw の下の `**/detail/*.html` を全部見る。
本ごとの 著者／書名／出版社／出版年 は data/textbooks.json（tools/extract_textbooks.py が作る）
から引く。原文そのもの（textbook）は built に載せない。本が無い科目は textbooks を消す（None）。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bs4 import BeautifulSoup                    # noqa: E402
from scrape.parse import labeled, textbook_of    # noqa: E402
from tools.extract_textbooks import OUT as BOOKS, key_of  # noqa: E402

BUILT = ROOT / "web" / "data" / "courses.built.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", action="append", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    table = json.loads(BOOKS.read_text(encoding="utf-8"))
    books, seen, unknown = {}, set(), 0
    for d in args.raw:
        for f in sorted(Path(d).glob("**/detail/*.html")):
            seen.add(f.stem)
            t = textbook_of(labeled(BeautifulSoup(f.read_text(encoding="utf-8"), "html.parser")))
            if not t:
                continue
            if key_of(t) not in table:
                unknown += 1                # extract_textbooks.py をまだ流していない文章
                continue
            bs = [{k: b[k] for k in ("author", "title", "publisher", "year", "year_ref") if b.get(k)}
                  for b in table[key_of(t)]]
            if bs:
                books[f.stem] = bs
    print(f"HTML {len(seen)} 件 → 本に分けられた {len(books)} 件／未抽出の文章 {unknown} 件")

    doc = json.loads(BUILT.read_text(encoding="utf-8"))
    hit = nohtml = 0
    for c in doc["courses"]:
        if c["id"] not in seen:
            nohtml += 1
            continue
        c.pop("textbook", None)
        c["textbooks"] = books.get(c["id"])
        hit += c["textbooks"] is not None
    print(f"  built {len(doc['courses'])} 件中 教科書あり {hit} 件／HTML が無い {nohtml} 件")
    if args.dry_run:
        print("dry-run なので書いていない")
        return
    BUILT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
                     encoding="utf-8")
    print(f"→ {BUILT} を更新した（採点は触っていないので rescore は不要）")


if __name__ == "__main__":
    main()
