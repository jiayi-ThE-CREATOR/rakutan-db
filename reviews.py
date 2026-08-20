"""口コミを科目に合流させる。

data/reviews.json は1件1行の生データ。採点が見るのは科目ごとに畳んだ形なので、
その変換をここに閉じ込める。score.py は口コミの生の形を知らなくてよい。

重要: シラバスに書いてある事実は口コミで上書きしない。
口コミが埋めるのは「シラバスに載っていないもの」だけ。
  ・テストの難しさ  ―― KOAN は形しか書かない（一番効くのはここ）
  ・レポートの語数  ―― KOAN に無い
  ・持ち込み可否    ―― シラバスにあれば、そちらを優先する
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "data" / "reviews.json"


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def load(path: Path | None = None) -> list[dict]:
    p = path or SRC
    if not p.exists():
        return []
    try:
        rows = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    # ダミー行（サンプルデータの S001）は採点に混ぜない
    return [r for r in rows if isinstance(r, dict) and r.get("course_id")
            and r["course_id"] != "S001"]


def aggregate(rows: list[dict]) -> dict[str, dict]:
    """科目ID → 畳んだ口コミ。"""
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r["course_id"], []).append(r)

    out = {}
    for cid, rs in by.items():
        # フォームは 1（簡単）〜10（難しい）。score.py の exam_hard は 0〜2。
        h10 = _mean([r.get("exam_hard10") for r in rs])
        words = _mean([r.get("report_words") for r in rs if r.get("report")])
        bring = [r.get("exam_bring") for r in rs if r.get("exam_bring")]
        out[cid] = {
            "n": len(rs),
            "exam_hard": None if h10 is None else round((h10 - 1) / 9 * 2, 3),
            "exam_hard10": None if h10 is None else round(h10, 1),
            "report_words": None if words is None else int(round(words)),
            "exam_bring": max(set(bring), key=bring.count) if bring else None,
            "attendance": _mean([r.get("attendance") for r in rs]),
            "in_class": _mean([r.get("in_class") for r in rs]),
            "out_class": _mean([r.get("out_class") for r in rs]),
            "notes": [r["note"] for r in rs if r.get("note")],
        }
    return out


def apply(courses: list[dict], agg: dict[str, dict]) -> int:
    """科目リストに口コミを載せる。載った科目数を返す。"""
    n = 0
    for c in courses:
        a = agg.get(c["id"])
        if not a:
            continue
        c["reviews"] = a
        n += 1
        # シラバスに無いものだけ埋める（上書きはしない）
        if c.get("report_words") is None and a["report_words"]:
            c["report_words"] = a["report_words"]
        if c.get("exam_type") is None and a["exam_bring"]:
            c["exam_type"] = "持込可" if a["exam_bring"] == "可" else "持込不可"
    return n
