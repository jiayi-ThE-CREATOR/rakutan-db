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
# 集約ずみ（科目ごとに畳んだ形）。こちらは追跡する。
# 生データ（SRC）は gitignore なので、持っていない人は build.py を流すと
# 口コミが黙って消えた built.json を作ってしまう。それを防ぐための控え。
# 中身は built.json に載せているものと同じなので、追加で公開されるものは無い。
AGG = ROOT / "data" / "reviews.agg.json"


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
            # `"publish": false` の一言は本文だけ落とす（既定は載せる）。
            # 公開サイトに出せない内容（学則に触れる指南など）を人の判断で
            # 止めるための唯一の入口。**行ごと捨てないこと** ―― 出席や
            # テスト難易度といった数値は正しい情報で、採点には効かせ続ける。
            "notes": [r["note"] for r in rs
                      if r.get("note") and r.get("publish", True)],
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


def dump_agg(agg: dict[str, dict], path: Path | None = None) -> Path:
    """集約結果を保存する。生データを持っていない人でも同じ数字が出せるように。"""
    p = path or AGG
    # 科目IDだけ並べ替える。キーの順は aggregate() が作った順のまま残す
    # ―― sort_keys を使うとキー順が変わり、生データから作った built.json と
    # 集約から作った built.json が「中身は同じなのに差分が出る」状態になる。
    ordered = {cid: agg[cid] for cid in sorted(agg)}
    p.write_text(json.dumps(ordered, ensure_ascii=False, indent=1),
                 encoding="utf-8")
    return p


def load_agg(path: Path | None = None) -> dict[str, dict]:
    p = path or AGG
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def resolve() -> tuple[dict[str, dict], str]:
    """採点に使う口コミを決める。生データがあればそちら、無ければ集約ずみ。

    生データを持っている人（取り込みをした人）と、持っていない人とで
    同じ数字が出ることを保証する。戻り値の2つ目は出どころ。
    """
    rows = load()
    if rows:
        return aggregate(rows), "raw"
    agg = load_agg()
    return agg, ("agg" if agg else "none")
