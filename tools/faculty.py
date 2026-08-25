"""科目を「どの学部の学生に出すか」へ割り当てる。

口コミ投稿の時間割（web/kuchikomi.html）が使う。学部を選んだ人に
「共通教育＋その学部の専門科目」だけを出すための1本の判断。

■ なぜ category をそのまま信じないか
HANDOFF 2026-08-25 の罠のとおり、`category` は KOAN が検索フォームを
返した12件で表のラベル「年度」に化けている（実体は全部共通教育）。
`category` だけで振ると、この12件がどの学部にも属さず画面から消える。

ナンバリングの頭2桁（＝所属コード）は 7,877件すべてで category と一致し、
壊れている12件も `13`（全学教育推進機構）を正しく持っている。だから
**共通教育の判定はナンバリングを先に見る**。

■ なぜ学部の判定は category を見るか
教職課程（ナンバリング `63`）が21件あり、開講しているのは各学部。
ナンバリングで振ると全部「63」という存在しない学部に落ちる。
`category` は開講学部を正しく持っているので、ここは category を採る。
ナンバリングが無い5件（理2・工3）も category で拾える。

■ 「共通」は学部ではない
所属13（全学教育推進機構）と所属14（マルチリンガル教育センター）は
全11学部の学生が履修する。学部の側に寄せず COMMON を返し、
画面はどの学部を選んでも必ずこれを混ぜる。
"""
from __future__ import annotations

# 全学部の学生に出す科目。学部キーと衝突しない語にしてある。
COMMON = "common"

# 所属コード（ナンバリングの頭2桁）。ここに入るものは学部を持たない。
COMMON_SHOZOKU = ("13", "14")

# category（＝KOAN の所属名）→ 学部キー。
# キーは web/data/requirements.json の faculties[].key に合わせる。
# **ラベル（表示名）はここに持たない** ―― 正本は requirements.json 側で、
# 2つ持つと必ず片方が古くなる。
CATEGORY_TO_FACULTY = {
    "文学部":               "letters",
    "人間科学部":           "human-sci",
    "法学部":               "law",
    "経済学部":             "economics",
    "外国語学部外国語学科": "foreign-s",
    "理学部":               "science",
    # 医学科と保健学科は KOAN 上は別所属だが、卒業要件表（CELAS）は
    # 「医学部」1つで、その中を departments で分けている。要件表に合わせる。
    "医学部医学科":         "medicine",
    "医学部保健学科":       "medicine",
    "歯学部":               "dentistry",
    "薬学部":               "pharmacy",
    "工学部":               "engineering",
    "基礎工学部":           "engr-sci",
}


def faculty_of(course: dict) -> str | None:
    """科目1件 → COMMON か学部キー。判定できなければ None。

    None を返したものは時間割に出ない。黙って「その他の学部」へ倒すと、
    どの学部の学生にも関係ない科目が全員の時間割に混ざる。
    """
    numbering = str(course.get("numbering") or "")
    if numbering[:2] in COMMON_SHOZOKU:
        return COMMON
    return CATEGORY_TO_FACULTY.get((course.get("category") or "").strip())
