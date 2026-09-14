#!/usr/bin/env python3
"""シラバス本文（授業サブタイトル・授業の目的と概要・各回の題目）だけを抜き出す。

    python3 tools/extract_syllabus_text.py

→ `data/syllabus_text.jsonl.gz`（全7,906件で約1.6MB）ができる。Discord に貼れる大きさ。

**所属ごとに分けて保存している場合は `--raw` を並べること。** 既定は
`data/raw/detail` の1か所だけなので、そのまま流すと 1,112件で終わる
（2026-09-04 政岡さんが実際に踏んだ）。

    python3 tools/extract_syllabus_text.py \
        --raw data/raw/detail --raw data/raw/lang/detail \
        --raw data/raw/f00/detail --raw data/raw/f01/detail  # …f10 まで

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

# 🚨 **id はファイル名を使う。ラベルから作らない。**（2026-09-04 政岡さんの指摘）
#
# 当初はラベル「時間割コード」から数字だけを拾っていた（`\d+`）。実データには
#   「138539 (知のジムナスティックス科目)」
# のように科目区分が括弧で付いてくるものがあり、それを落とすためだった。
# ところが **id は数字だけとは限らない**。7,906件のうち324件が `00Z008` 形式で、
# 数字だけ拾うと全部 "00" に潰れ、同じキーに重なって courses.built.json と
# 突き合わなくなる（外国語学部197・文学部53・医学部36・理学部26・医保9・薬3）。
# **件数は出てしまうので、渡された側は「7,600件あるな」で気づけない。**
#
# ファイル名が正しい理由は構造にある:
#   scrape/fetch.py:74   detail/{r['code']}.html として保存する
#   scrape/parse.py:171  "id": idx["code"]  ―― 同じ code を id にしている
# つまりファイル名と courses.built.json の id は同じ出どころ。実データ7,906件で
# 全一致を確認ずみ。ラベル側は表記ゆれに左右されるので、突き合わせて
# **食い違いを数えるだけ**に使う（黙って選ばない）。
LABEL_CODE = re.compile(r"[0-9A-Za-z]+")


def _label_code(raw: str | None) -> str:
    """ラベルの値から科目コードらしい部分。**id には使わない**（照合用）。"""
    m = LABEL_CODE.search(raw or "")
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
        # ファイル名が正本（理由は上の LABEL_CODE のコメント）。
        "id": path.stem,
        # 科目名は built.json にもあるが、人がこのファイルを開いたときに
        # 何の科目か分かるように入れておく（1件30バイト程度）。
        "title": L.get("開講科目名") or "",
        "subtitle": L.get("授業サブタイトル") or "",
        "abstract": L.get("授業の目的と概要") or "",
        "kaiji": " / ".join(v for _, v in kaiji),
        # 照合用。run() が id と突き合わせて食い違いを数えたあと捨てる。
        "_label_code": L.get("時間割コード") or "",
    }


def run(raw_dirs, out: Path) -> int:
    """複数の詳細HTMLディレクトリを全部読んで out に書く。書けた件数を返す。

    **1か所しか見ないと足りない。** 8/25 に全所属を取ったとき、所属ごとに
    分けて保存されている（data/raw/detail 共通教育1,111 / data/raw/lang/detail
    語学1,165 / data/raw/f00〜f10/detail 学部の専門5,630）。既定の1か所だけだと
    1,112件で終わる。scrape/parse.py の --raw と同じ形にしてある。
    """
    if isinstance(raw_dirs, (str, Path)):
        raw_dirs = [raw_dirs]
    out.parent.mkdir(parents=True, exist_ok=True)
    wrote, empty, mismatch, seen = 0, 0, [], set()
    with gzip.open(out, "wt", encoding="utf-8") as f:
        for raw_dir in raw_dirs:
            for path in sorted(Path(raw_dir).glob("*.html")):
                row = extract_one(path)
                if row is None or row["id"] in seen:
                    continue          # 所属をまたいで重複することがある
                seen.add(row["id"])
                if not any((row["subtitle"], row["abstract"], row["kaiji"])):
                    empty += 1
                # ラベル側と食い違ったら黙らずに数える。どちらかが壊れた合図。
                lab = _label_code(row.pop("_label_code", ""))
                if lab and lab != row["id"]:
                    mismatch.append((row["id"], lab))
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                wrote += 1
    run.empty, run.mismatch = empty, mismatch
    return wrote


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", action="append", default=None,
                    help="詳細HTMLのディレクトリ。**複数指定できる**"
                         "（既定: data/raw/detail）。所属ごとに分けて保存して"
                         "ある場合は data/raw/lang/detail などを並べる")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    raw_dirs = [Path(d) for d in (args.raw or [str(RAW)])]
    if not any(d.is_dir() and any(d.glob("*.html")) for d in raw_dirs):
        sys.exit(
            f"詳細HTMLが見つかりません: {', '.join(map(str, raw_dirs))}\n"
            "  data/raw/ は gitignore なので、scrape/fetch.py を流した人の手元にしか\n"
            "  ありません。持っていない場合は\n"
            "      python3 scrape/fetch.py        # 全件・約4.4時間\n"
            "  を流してください（--delay は 2.0 のまま。縮めないこと）。")

    out = Path(args.out)
    wrote = run(raw_dirs, out)
    size = out.stat().st_size / 1024 / 1024
    print(f"→ {out}")
    print(f"   {wrote} 件 / {size:.1f} MB")
    if getattr(run, "mismatch", None):
        # ファイル名とラベルが食い違う＝どちらかが壊れている。id はファイル名を
        # 採っているので結果は正しいはずだが、黙って進まず件数を出す。
        ms = run.mismatch
        print(f"   ⚠ ファイル名とシラバス記載のコードが食い違う科目が {len(ms)} 件"
              f"（例: {ms[0][0]} と {ms[0][1]}）。id はファイル名を採っています")
    if getattr(run, "empty", 0):
        # 本文が1文字も取れない科目は、シラバス側が空か、ラベル名が変わったか。
        # 黙って進むと「AIが判定できない科目」として後段で表れるだけなので、ここで言う。
        print(f"   ⚠ 本文が3つとも空の科目が {run.empty} 件あります"
              "（シラバス側が空か、KOAN のラベル名が変わった可能性）")
    print("\nこのファイルを Discord に貼ってください。git には入れないこと"
          "（シラバス原文なので .gitignore 済み）。")


if __name__ == "__main__":
    main()
