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


# 口コミが採点に効き始める人数（2026-08-21 の方針転換）。
#
# それまでは1件でも入れば数字に反映していた。実データで測ったところ、
# **1人の回答で「力学詳論I」が 78.0 → 41.6（拘束は軽い → やや重め）**まで
# 動いていた。テストの難易度は load に最大44点効くので、証言1本が
# 総合値の半分を左右する。根拠として弱すぎる。
#
# いまの我々に大量の口コミを集める力は無い（8/21 時点で全1,112科目に対し
# 36件、1科目あたり最大3件）。だから採点で薄く効かせるのではなく、
# **数字には触れず「口コミがあります、中身を見て自分で判断してください」と
# 出す**のが正しい。判断を学生に返す。
#
# 3にした理由: 2だと1組の食い違いで平均が真ん中に寄るだけで、
# どちらが実態か分からない。3人そろって初めて「多数」と言える。
# 集まってきたら上げる方向で見直す（下げない）。
MIN_FOR_SCORING = 3

# 人数を数えるときに見る項目。ここが全部同じ回答は「同じ人が送り直した」
# 可能性が高いので1人として数える。1人が3回送っても3人分にはならない。
# ―― 実際 135851 は3件、135581 は2件が1バイト違わず同一だった。
_IDENTITY = ("attendance", "in_class", "out_class",
             "exam", "exam_bring", "exam_hard10",
             "report", "report_words", "note")


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _distinct(rs: list[dict]) -> int:
    """中身の違う回答が何件あるか。門はこちらの数で判定する。"""
    return len({tuple(r.get(k) for k in _IDENTITY) for r in rs})


# 平均を取ると「意見が割れていた」ことが消える。
# 出席「なし」と「毎回」の平均は「たまに」―― 誰も経験していない値が出る。
# 潰した事実を残すために、割れた項目名だけ集計に添える（平均は今まで通り出す）。
#
# しきい値は「隣り合う回答は割れとしない」で引いてある。1段の違いまで
# 割れ扱いにすると、複数件ある科目のほとんどに⚠が付いて意味を失う。
#   3段階（0/1/2）  : 両端が揃ったときだけ。max-min >= 2
#   10段階（難易度）: 半分近く開いたときだけ。max-min >= 4
#   持ち込み可否    : 可と不可が両方あれば即。中間が無い項目なので
_SPREAD = {"attendance": 2, "in_class": 2, "out_class": 2, "exam_hard10": 4}


def _conflicts(rs: list[dict]) -> list[str]:
    """回答が割れている項目名。順序は _SPREAD の定義順で安定させる。"""
    out = []
    for key, span in _SPREAD.items():
        vs = [r.get(key) for r in rs]
        vs = [v for v in vs if v is not None]
        if len(vs) >= 2 and max(vs) - min(vs) >= span:
            out.append(key)
    bring = {r.get("exam_bring") for r in rs} - {None}
    if len(bring) >= 2:
        out.append("exam_bring")
    return out


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
            # 平均が消した「食い違い」の在りか。画面はここに⚠を出し、
            # 詳細は1件ずつ（public_rows）を読ませる。採点には使わない。
            "conflicts": _conflicts(rs),
            # 中身の違う回答の数。表示は n（生の件数）、門はこちらで判定する。
            "n_distinct": _distinct(rs),
            # この口コミを採点に効かせてよいか。False なら score.py は
            # 一切読まない ―― 数字には触れず「確認してください」を出すだけ。
            # 表示（件数・数値・一言）は scored に関係なく全部出す。
            "scored": _distinct(rs) >= MIN_FOR_SCORING,
        }
    return out


# 公開形に出すキー。ここに無いものは出さない。
# `at` は投稿日であって受講時期ではない ―― 並べ替えとインジェストの
# 重複判定にしか使っていないので、画面に出させない（混同されるため）。
# 受講時期は taken_year だけが答える。
_PUBLIC = ["attendance", "in_class", "out_class",
           "exam_hard10", "exam_bring", "report_words"]


def _sort_key(r: dict):
    # 受講年の新しい順。答えていない行は末尾へ（無回答を最新に見せない）。
    y = r.get("taken_year")
    return (0 if y is None else 1, y or 0, r.get("at") or "")


def public_rows(rows: list[dict]) -> dict[str, list[dict]]:
    """科目ID → 1件ずつの口コミ（新しい順）。サイトの詳細パネル用。

    aggregate() が「平均した後の姿」を返すのに対し、こちらは
    「平均する前の姿」を返す。件数が増えたときに読めるのはこちら側で、
    aggregate() はカードに出す要約と採点に使う。

    publish:false は aggregate() と同じ扱い ―― **本文だけ落として行は残す**。
    ここで行ごと捨てると、カードの「口コミ N件」とパネルの行数が食い違う。
    """
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r["course_id"], []).append(r)

    out = {}
    for cid, rs in by.items():
        out[cid] = [
            {**{k: r.get(k) for k in _PUBLIC},
             "taken_year": r.get("taken_year"),
             "taken_year_before": bool(r.get("taken_year_before")),
             "note": r["note"] if (r.get("note") and r.get("publish", True))
                     else None}
            for r in sorted(rs, key=_sort_key, reverse=True)
        ]
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
        # ここから先は採点に効く。持ち込み可否は load を ±25、レポート語数も
        # レポート軸を動かすので、テストの難易度と同じ門をくぐらせる。
        # 門の手前でも a（＝c["reviews"]）には値が入っているので、
        # 詳細パネルには今まで通り全部出る。消えるのは採点への影響だけ。
        if not a.get("scored"):
            continue
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
