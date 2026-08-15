#!/usr/bin/env python3
"""静的サイト用のデータを書き出す（Cloudflare Pages 用）。

    python3 build.py            # web/data/courses.built.json を作る
    python3 build.py --full     # シラバス原文も含めて出す（既定は出さない）

なぜ必要か
──────────
Cloudflare Pages は静的ホスティングなので server.py は動かない。
一方で採点ロジック(score.py)は Python で、これを JS に移植すると
「点数の正本が2つ」になり、片方だけ直した瞬間にサイトとLINEで
違う点数が出る。よって採点は Python のままビルド時に1回だけ実行し、
結果を静的JSONに焼く。ブラウザ側に残るのは match()（重み×軸スコアの
内積）だけで、これは判断を含まない算術。

SLIM（既定）
────────────
リポジトリは public なので、シラバス本文をそのまま置くと
原文の大量転載が git 履歴に永久に残り、検索にも載る。
表示に必要な事実は残し、本文は解析済みの値に置き換える。
--full は手元で中身を確認したいときだけ。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import score as scoring

ROOT = Path(__file__).parent
SRC = ROOT / "data" / "courses.json"
OUT = ROOT / "web" / "data" / "courses.built.json"

# シラバス本文に出てくる出席要件を、数えられる形に落とす。
# 「全授業回数のうち3分の2以上出席」→ "2/3以上" だけ残して本文は捨てる。
_FRAC = re.compile(r"([0-9０-９]+)\s*分の\s*([0-9０-９]+)")
_RATIO = re.compile(r"([0-9０-９]+)\s*[／/]\s*([0-9０-９]+)")
_ABSENT = re.compile(r"([0-9０-９]+)\s*回以上(?:の)?欠席")
_Z2H = str.maketrans("０１２３４５６７８９", "0123456789")


def attendance_req(text: str | None) -> str | None:
    """出席要件を短い派生値にする。原文は返さない。"""
    if not text:
        return None
    t = text.translate(_Z2H)
    m = _FRAC.search(t)                       # 「3分の2」= 分母が先
    if m:
        return f"{m.group(2)}/{m.group(1)}以上の出席が必要"
    m = _RATIO.search(t)
    if m:
        return f"{m.group(1)}/{m.group(2)}以上の出席が必要"
    m = _ABSENT.search(t)
    if m:
        return f"{m.group(1)}回欠席で不可"
    if "毎回" in t and "出席" in t:
        return "毎回の出席が前提"
    return None


# 静的JSONに残すフィールド。ここに無いものは出さない（原文系は全部落ちる）。
KEEP = ["id", "title", "title_en", "category", "term", "day_period", "campus",
        "capacity", "class_format", "credits", "instructor", "numbering",
        "eval_ratio", "eval_raw", "exam_type", "report_count", "report_words",
        "out_of_class_hours", "weekly_quiz", "tags", "source"]


def slim(course: dict) -> dict:
    out = {k: course.get(k) for k in KEEP}
    out["attendance_req"] = attendance_req(course.get("attendance_rule"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true",
                    help="シラバス原文も含める（公開リポジトリには置かないこと）")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    raw = json.loads(SRC.read_text(encoding="utf-8"))
    courses = raw["courses"]

    built = []
    for c in courses:
        base = dict(c) if args.full else slim(c)
        base["rakutan"] = scoring.score(c)      # 採点は必ず元データに対して行う
        built.append(base)

    # プリセット4つ分の順位を焼いておくと、LINE側は採点ロジックを持たずに済む。
    presets = {}
    for name, weights in scoring.PRESETS.items():
        ranked = sorted(
            (c for c in built if c["rakutan"]["overall"] is not None),
            key=lambda c: scoring.match(c["rakutan"], weights)["fit"],
            reverse=True)
        presets[name] = [c["id"] for c in ranked[:100]]

    judged = sum(1 for c in built if c["rakutan"]["overall"] is not None)
    payload = {
        "_meta": {
            **raw.get("_meta", {}),
            "built_count": len(built),
            "judged": judged,
            "unjudged": len(built) - judged,
            "slim": not args.full,
            "weights": scoring.WEIGHTS,
            "axis_label": scoring.AXIS_LABEL,
            "presets": scoring.PRESETS,
            "note": "採点は build.py（score.py）で確定済み。"
                    "ブラウザ側は重み×軸スコアの内積のみ行う。",
        },
        "preset_top": presets,
        "courses": built,
    }

    dest = Path(args.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(payload, ensure_ascii=False,
                               separators=(",", ":")), encoding="utf-8")

    kb = dest.stat().st_size / 1024
    print(f"→ {dest}  {kb:,.0f} KB  ({'SLIM' if not args.full else 'FULL'})")
    print(f"  科目 {len(built)} 件 ／ 判定できた {judged} 件 "
          f"／ 情報不足 {len(built) - judged} 件")
    if not args.full:
        print("  シラバス原文は含めていません（出席要件だけ派生値で保持）")


if __name__ == "__main__":
    main()
