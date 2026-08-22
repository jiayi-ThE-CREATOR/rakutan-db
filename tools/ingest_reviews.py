"""口コミフォームの書き出し（TSV）を data/reviews.json に取り込む。

フォーム: https://magnificent-scone-0d2071.netlify.app/
設問と列の対応（フォーム側を変えたらここも直す）:

    attendance    2 出席は取られた？          毎回 / たまに / なし / その他
    in_class      3 授業中の課題はあった？      重い / ふつう / 軽い / なかった
    out_class     4 授業外の課題はあった？      重い / ふつう / 軽い / なかった
    exam          5 テストはあった？           あり / なし
    exam_bring      ↳ 持ち込みは？             可 / 不可
    exam_hard10     ↳ 難易度は？               1（簡単）〜 10（難しい）
    report        6 レポートはあった？          あり / なし
    report_words    ↳ 語数
    note            一言（任意）

  python3 tools/ingest_reviews.py <export.tsv>            # 追記して書き込む
  python3 tools/ingest_reviews.py <export.tsv> --dry-run  # 確認だけ
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES = ROOT / "data" / "courses.json"
OUT = ROOT / "data" / "reviews.json"

# 表記ゆれ。フォームの選択肢が増えたらここに足す。
ATTEND = {"毎回": 2, "たまに": 1, "なし": 0}
LEVEL = {"重い": 2, "ふつう": 1, "軽い": 0, "なかった": None}


def _int(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"\d+", str(s).replace(",", ""))
    return int(m.group()) if m else None


def _yes(s: str | None) -> bool:
    return (s or "").strip() == "あり"


def normalize(row: dict) -> dict:
    """1行 → 保存する形。判断はここに寄せ、集計側では素直に平均するだけにする。"""
    att = (row.get("attendance") or "").strip()
    return {
        "course_id": (row.get("code") or "").strip(),
        # 「その他（小テストを通じて）」は毎回出席と同等の拘束として扱う
        "attendance": ATTEND.get(att, 2 if att.startswith("その他") else None),
        "attendance_raw": att,
        "in_class": LEVEL.get((row.get("in_class") or "").strip()),
        "out_class": LEVEL.get((row.get("out_class") or "").strip()),
        "exam": _yes(row.get("exam")),
        "exam_bring": (row.get("exam_bring") or "").strip() or None,
        # フォームは 1（簡単）〜10（難しい）
        "exam_hard10": _int(row.get("exam_hard10")),
        "report": _yes(row.get("report")),
        "report_words": _int(row.get("report_words")),
        "note": (row.get("note") or "").strip() or None,
        # 受講年。フォームに「いつ受けた？」の列が出来たらここに入る。
        # 無ければ None のまま ―― 埋めない。詳細パネルは None を
        # 「受講年 未回答」として末尾に置く（推測で年を書かない）。
        "taken_year": _int(row.get("taken_year")),
        "at": (row.get("date") or "").strip() or None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tsv")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--replace", action="store_true",
                    help="既存の reviews.json を捨てて入れ替える")
    args = ap.parse_args()

    known = {c["id"] for c in json.loads(COURSES.read_text())["courses"]}
    with open(args.tsv, encoding="utf-8") as f:
        rows = [normalize(r) for r in csv.DictReader(f, delimiter="\t")]

    hit = [r for r in rows if r["course_id"] in known]
    miss = [r for r in rows if r["course_id"] not in known]

    print(f"  読み込み {len(rows)} 件")
    print(f"    DBに在る科目  {len(hit):3} 件 / {len({r['course_id'] for r in hit})} 科目")
    print(f"    DBに無い科目  {len(miss):3} 件 / {len({r['course_id'] for r in miss})} 科目")
    if miss:
        print("      → 語学科目など、共通教育（所属 0:13）に入っていないもの。")
        print("        科目を取得しない限り採点には反映されない。")
    hard = [r["exam_hard10"] for r in hit if r["exam_hard10"] is not None]
    if hard:
        print(f"    テスト難易度が入った  {len(hard)} 件（平均 {sum(hard)/len(hard):.1f} / 10）")

    if args.dry_run:
        print("\n  --dry-run のため書き込んでいない")
        return

    # DBに無い科目も捨てない。科目を取得したら後から効くようにしておく。
    prev = []
    if OUT.exists() and not args.replace:
        try:
            prev = [r for r in json.loads(OUT.read_text()) if r.get("course_id") != "S001"]
        except json.JSONDecodeError:
            prev = []
    seen = {(r.get("course_id"), r.get("at"), r.get("note")) for r in prev}
    added = [r for r in rows if (r["course_id"], r["at"], r["note"]) not in seen]
    OUT.write_text(json.dumps(prev + added, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"\n  → {OUT}  既存 {len(prev)} 件 ＋ 新規 {len(added)} 件")

    # 集約ずみも一緒に書く。生データは gitignore なので、これが無いと
    # 取り込んだ本人以外は同じ数字を出せない。
    import reviews as reviews_mod
    agg = reviews_mod.aggregate(reviews_mod.load())
    print(f"  → {reviews_mod.dump_agg(agg)}  {len(agg)} 科目（これはコミットする）")


if __name__ == "__main__":
    main()
