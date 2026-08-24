"""履修対象にどんな値が入っているかを数える。

■ これは何のためか
学部・学科の絞り込みを作るには、学科の略称（地／電／然／理…）を
正式名に直す対照表が要る。だが**その略称の一覧を誰も見たことがない**。
2026-08-24 時点で見えているのは16件ぶんだけで、そこに出たのは工学部だけ。

見ていない値のために規則を書くと必ず外れる。
だから取得が終わったらまずこれを流して、**実際に出た値だけ**を材料に
対照表を作る。

■ 使い方
    python3 tools/eligibility_survey.py                 # data/raw/detail/ を見る
    python3 tools/eligibility_survey.py --dir <パス>
    python3 tools/eligibility_survey.py --csv out.csv   # 対照表づくり用に書き出す

■ 出るもの
  1. 「全学部」とそれ以外の件数
  2. 学部（括弧の前）ごとの件数
  3. 括弧の中に出た略称の一覧 ← これが対照表の材料
  4. どの略称にも当てはまらなかった生の値
"""
from __future__ import annotations

import argparse
import collections
import csv
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from tools.eligibility import parse_eligibility  # noqa: E402

# 括弧の中身。全角・半角の両方が来る。
_PAREN = re.compile(r"[（(]([^）)]*)[）)]")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="data/raw/detail",
                    help="詳細ページの HTML が入っているディレクトリ")
    ap.add_argument("--csv", help="科目ごとの値を書き出す先")
    args = ap.parse_args()

    d = pathlib.Path(args.dir)
    if not d.is_dir():
        print(f"{d} がありません。取得が終わってから流してください。")
        sys.exit(1)

    files = sorted(d.glob("*.html"))
    rows, missing = [], 0
    for f in files:
        g = parse_eligibility(f.read_text(errors="replace"))
        if g is None:
            missing += 1
            continue
        rows.append((f.stem, g))

    print(f"詳細ページ {len(files)} 件 ／ 欄が見つからなかったもの {missing} 件\n")

    kinds = collections.Counter(
        "全学部" if g["all_faculties"] else ("（空）" if not g["raw"] else "学部の指定あり")
        for _, g in rows)
    print("=== 大きな内訳 ===")
    for k, n in kinds.most_common():
        print(f"  {n:5d}  {k}")

    limited = [(i, g) for i, g in rows if g["all_faculties"] is False and g["raw"]]
    print(f"\n=== 学部ごと（指定ありの {len(limited)} 件）===")
    for fac, n in collections.Counter(g["faculty"] for _, g in limited).most_common():
        print(f"  {n:5d}  {fac}")

    print("\n=== 括弧の中に出た略称 ← 対照表の材料 ===")
    abbr = collections.Counter()
    for _, g in limited:
        for inner in _PAREN.findall(g["raw"]):
            # 「地1〜60」「理」「電1～95」→ 先頭の非数字だけを略称とみなす
            m = re.match(r"([^\d０-９]+)", inner.strip())
            if m:
                abbr[(g["faculty"], m.group(1).strip())] += 1
    if abbr:
        for (fac, a), n in abbr.most_common():
            print(f"  {n:5d}  {fac} （{a}）")
    else:
        print("  （なし）")

    print("\n=== 生の値（そのまま画面に出す想定）===")
    for raw, n in collections.Counter(g["raw"] for _, g in limited).most_common(30):
        print(f"  {n:5d}  {raw}")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["id", "raw", "all_faculties", "faculty"])
            for i, g in rows:
                w.writerow([i, g["raw"], g["all_faculties"], g["faculty"]])
        print(f"\n→ {args.csv} に書き出しました")


if __name__ == "__main__":
    main()
