#!/usr/bin/env python3
"""シラバス本文（授業サブタイトル・授業の目的と概要・各回の題目）だけを抜き出す。

    python3 tools/extract_syllabus_text.py

→ `data/syllabus_text.jsonl.gz`（全7,906件で約3MB）ができる。Discord に貼れる大きさ。

■ 何のために要るか
「授業内容でしぼる」機能のため。科目名だけでは足りない。実例:

    開講科目名        【人文】ことばの学問入門
    授業サブタイトル   ことばの歴史                 ← 科目名には出てこない
    各回題目          動物のコミュニケーション／最初の語族／文字／言語の系統

科目名だけを AI に渡すと「ことば・語学」しか付かない。「歴史」を付けるには
本文が要る ―― ユーザーインタビューで言われた「科目名からは分からないのに
中身が面白い授業」そのもの。

■ なぜ HTML そのものを渡さないのか
`data/raw/detail/` は1件あたり約118KB、全件で **約0.9GB**（gzip しても63MB）ある。
本文3つだけなら **約11MB（gzip 3MB）** で、Discord にそのまま貼れる。
`data/raw/` は gitignore なので取得した人の手元にしか無く、渡す手間を
できるだけ小さくしたい。

■ 誰が流すのか
**`data/raw/` を持っている人**（＝ scrape/fetch.py を流した人）。
持っていない人が流すと 0 件で止まる。取り直しは `--delay 2.0` で約4.4時間かかる
（**`--delay` を縮めるのは禁止事項**。README「踏んではいけない線」）。

■ 出力を git に入れないこと
中身はシラバス原文なので `data/courses.json` と同じ扱い。`.gitignore` 済み。

設計は docs/plans/2026-09-03-naiyou-tag-design.md
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# ラベル→値の辞書化は scrape/parse.py が正本。同じ抽出を2つ持たない。
from scrape.parse import labeled  # noqa: E402

RAW = ROOT / "data" / "raw" / "detail"
OUT = ROOT / "data" / "syllabus_text.jsonl.gz"

# 「第1回」「第15回」…。回数はシラバスによって違う（15回・16回・それ以外）ので
# 決め打ちの範囲で回さず、あるものを順番に拾う。
KAIJI = re.compile(r"^第(\d+)回$")

# 時間割コードは数字だけとは限らない。実データに
#   「138539 (知のジムナスティックス科目)」
# のように科目区分が括弧で付いてくるものがある（手元10件中5件）。
# そのまま id にすると courses.built.json の id（"138539"）と突き合わない。
CODE = re.compile(r"\d+")


def _code(raw: str | None) -> str:
    """「138539 (知のジムナスティックス科目)」→「138539」。"""
    m = CODE.search(raw or "")
    return m.group(0) if m else ""


def extract_one(path: Path) -> dict | None:
    """詳細HTML 1枚 → {id, title, subtitle, abstract, kaiji}。"""
    try:
        soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="ignore"),
                             "html.parser")
    except OSError:
        return None
    L = labeled(soup)

    # 各回の題目は回数の順に並べる（辞書の挿入順に頼らない ―― シラバスによって
    # 行の並びが違い、第10回が第2回より前に来ることがある）。
    kaiji = []
    for k, v in L.items():
        m = KAIJI.match(k)
        if m and v:
            kaiji.append((int(m.group(1)), v))
    kaiji.sort()

    return {
        # 時間割コード。courses.built.json の id と突き合わせるための鍵なので、
        # 括弧付きの区分（上記 CODE のコメント）を落として数字だけにする。
        # ラベルが読めないときはファイル名（fetch.py がコードで保存している）。
        "id": _code(L.get("時間割コード")) or path.stem,
        # 科目名は built.json にもあるが、人がこのファイルを開いたときに
        # 何の科目か分かるように入れておく（1件30バイト程度）。
        "title": L.get("開講科目名") or "",
        "subtitle": L.get("授業サブタイトル") or "",
        "abstract": L.get("授業の目的と概要") or "",
        "kaiji": " / ".join(v for _, v in kaiji),
    }


def run(raw_dir: Path, out: Path) -> int:
    """raw_dir の詳細HTMLを全部読んで out に書く。書けた件数を返す。"""
    pages = sorted(raw_dir.glob("*.html"))
    out.parent.mkdir(parents=True, exist_ok=True)
    wrote, empty = 0, 0
    with gzip.open(out, "wt", encoding="utf-8") as f:
        for path in pages:
            row = extract_one(path)
            if row is None:
                continue
            if not any((row["subtitle"], row["abstract"], row["kaiji"])):
                empty += 1
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            wrote += 1
    run.empty = empty          # 呼び出し側が知りたいので属性で返す（戻り値は件数）
    return wrote


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(RAW), help="詳細HTMLのディレクトリ")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    raw_dir = Path(args.raw)
    if not raw_dir.is_dir() or not any(raw_dir.glob("*.html")):
        sys.exit(
            f"詳細HTMLが見つかりません: {raw_dir}\n"
            "  data/raw/ は gitignore なので、scrape/fetch.py を流した人の手元にしか\n"
            "  ありません。持っていない場合は\n"
            "      python3 scrape/fetch.py        # 全件・約4.4時間\n"
            "  を流してください（--delay は 2.0 のまま。縮めないこと）。")

    out = Path(args.out)
    wrote = run(raw_dir, out)
    size = out.stat().st_size / 1024 / 1024
    print(f"→ {out}")
    print(f"   {wrote} 件 / {size:.1f} MB")
    if getattr(run, "empty", 0):
        # 本文が1文字も取れない科目は、シラバス側が空か、ラベル名が変わったか。
        # 黙って進むと「AIが判定できない科目」として後段で表れるだけなので、ここで言う。
        print(f"   ⚠ 本文が3つとも空の科目が {run.empty} 件あります"
              "（シラバス側が空か、KOAN のラベル名が変わった可能性）")
    print("\nこのファイルを Discord に貼ってください。git には入れないこと"
          "（シラバス原文なので .gitignore 済み）。")


if __name__ == "__main__":
    main()
