"""履修できる学年を取る。

シラバス詳細には「年次／Student Year」があるが、1,112件ぶんの詳細を
取り直すと 2秒間隔で 37分かかる。
一方 KOAN の検索には学年（nenji）の絞り込みがあるので、
学年ごとに一覧を引いて「その学年の一覧に出てくるか」で判定すれば
6学年 × 約11ページ = 約66リクエスト（2分半）で済む。

  python3 scrape/years.py            # courses.json に eligible_years を書き足す
  python3 scrape/years.py --dry-run  # 件数だけ見る
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import koan as K
from koan import Koan, list_rows, total_count

ROOT = Path(__file__).resolve().parent.parent
COURSES = ROOT / "data" / "courses.json"
YEARS = ("1", "2", "3", "4", "5", "6")


def ids_for_year(k: Koan, year: str, nendo: str = "2026") -> set[str]:
    """その学年が履修できる科目の時間割コード一覧。"""
    k.refresh()
    data = {
        "s_no": "0", "_flowExecutionKey": k.key, "_eventId": "search",
        "nendo": nendo, "categoryFlg": "2",
        "jShozokuCodeMajor": "00", "jShozokucdSubjects": K.SHOZOKU_KYOTSU,
        "kaikokbncd": "", "yobi": "", "jigen": "", "nenji": year, "bunyacd": "",
        "kaikoKamokunm": "", "kyokannm": "", "kyokankn": "",
        "freeword": "", "freewordCondition": "0",
    }
    k._wait()
    r = k.s.post(K.BASE, data=data, timeout=k.timeout)
    r.raise_for_status()
    k.key = k._key_of(r.text) or k.key

    total = total_count(r.text) or 0
    ids = {row["code"] for row in list_rows(r.text)}
    for n in range(2, (total // 100) + 2):
        ids |= {row["code"] for row in list_rows(k.page(n))}
    if len(ids) != total:
        print(f"  ! {year}年: 総数 {total} に対して {len(ids)} 件しか拾えていない")
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--delay", type=float, default=2.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    k = Koan(delay=args.delay)
    per_year: dict[str, set[str]] = {}
    for y in YEARS:
        per_year[y] = ids_for_year(k, y)
        print(f"  {y}年が履修できる  {len(per_year[y]):5} 件")

    doc = json.loads(COURSES.read_text())
    cs = doc["courses"]
    miss = 0
    for c in cs:
        ys = [int(y) for y in YEARS if c["id"] in per_year[y]]
        c["eligible_years"] = ys
        if not ys:
            miss += 1
    print(f"\n  1年生が履修できる  {sum(1 for c in cs if 1 in c['eligible_years'])} / {len(cs)}")
    if miss:
        print(f"  ! どの学年の一覧にも出てこない科目 {miss} 件")

    if args.dry_run:
        print("\n  --dry-run のため書き込んでいない")
        return
    COURSES.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print(f"\n  → {COURSES} に eligible_years を書き込んだ")


if __name__ == "__main__":
    main()
