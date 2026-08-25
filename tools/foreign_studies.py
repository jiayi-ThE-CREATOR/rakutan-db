"""外国語学部（所属10）の科目を、学部チェックシートの行へ割り当てる。

■ なぜ division.py と分けたか
division.py が扱うのは共通教育（所属13）とマルチリンガル（所属14）＝
**全11学部に共通の CELAS 区分**。こちらは1学部だけの専門科目で、出所も
CELAS ではなく学部が出している「単位修得状況チェックシート」。同じ表に
混ぜると、どの規則がどの学部に効くのかが読めなくなる。
他学部を足すときも `tools/<学部>.py` を1枚足して division.py から呼ぶ。

■ 出所
外国語学部「単位修得状況チェックシート（2025年度以降入学者用）」
https://www.sfs.osaka-u.ac.jp/guide/
第1外国語の内訳（総合英語4・実践英語2）で fetch_lang_split.py が既に
使っているものと同じ紙。CELAS の卒業要件表と食い違う項目は、
**この学部についてはチェックシートを採る**（2026-08-25 に確認）。
食い違いは2つで、CELAS 側が専門基礎教育科目を「0」、グローバル理解を
「－」としているのに対し、チェックシートには両方とも行がある。

■ 判定の材料は2つだけ
① 科目名の接頭マーカー ―― KOAN の科目名に元から付いている。
   【専攻科目】／（学共-方法論）／（学共-地域系）／（学共-特設）／
   （高度教養）／＜兼修＞／＜兼修（高度）＞
② ナンバリング（10FOST + 2桁 + 3桁）の後ろ3桁。
   末尾2桁 00＝専攻語実習、01＝研究外国語、03＝教職（〜語科教育法）、
   4B002＝卒業論文。
①が当たれば②は見ない（division.py と同じ順序）。

■ 専攻語の3行は、独立した2つの信号が一致している
チェックシートは専攻語科目を 1年実習／2年実習／演習 の3行に割る。
科目名の数え方がそのまま対応していて、eligible_years と 594/594 で
一致した（2026-08-25 実測）:
    〇〇語1〜5     162件 → 履修可能学年がすべて [1]
    〇〇語11〜15   161件 → すべて [2,3,4]
    〇〇語Ia〜Xb   271件 → [3,4] 257 ／ [4] 8 ／ [3] 6
出所の違う2つが例外なく一致したので、この3分割は規則にしてよいと判断した。

■ 判定しないもの
【専攻科目】のうち、名前に講義とも演習とも書いていない21件
（「ハンガリー研究入門」「書道」「日本語教育実習」など）は None にする。
「入門なら講義だろう」は見ていない値のための規則で、必ず外れる
（division.py の 1V と同じ判断）。画面では「その他」に入る。

■ チェックシートにあって、ここで区分にしていない行
- 国際交流科目 …… 7,877件のどこにも該当科目が無い（KOAN の課網に出ない）
- 選択科目（他大学科目・他学部科目）…… 「本学部以外の全部」であって
  科目の側の属性ではない。区分にしても絞り込みの役に立たない
- 兼修語学の【同一言語で修得】と【上記以外で修得】…… どちらになるかは
  学生がどう選んだかで決まる。division.py が第2外国語と選択外国語について
  書いているのと同じ理由で、科目の側では割れない
"""
from __future__ import annotations

import re

# この学部の科目を見分ける入口。2026-08-25 時点で 2,016件すべてがこの接頭辞を
# 持ち、他学部の科目には1件も現れない（実測）。category は使わない
# ―― KOAN が検索フォームを返した科目で「年度」に化けている実例がある。
NUMBERING_PREFIX = "10FOST"

# 科目名の接頭マーカー → 区分。上から順に見る。
TITLE_MARKS = (
    ("＜兼修（高度）＞",  "fs_kenshu_kokusai"),
    ("＜兼修＞",         "fs_kenshu"),
    ("（学共-方法論）",   "fs_kyotsu_hoho"),
    ("（学共-地域系）",   "fs_kyotsu_chiiki"),
    ("（学共-特設）",     "fs_kyotsu_tokusetsu"),
    ("（高度教養）",      "kodo_kyoyo"),        # 共通教育と同じ区分。既存キーを使う
)

SENKO_MARK = "【専攻科目】"
# 【専攻科目】を講義と演習へ割る語。名前に書いていないものは割らない。
SENKO_ENSHU_WORDS = ("演習",)
SENKO_KOGI_WORDS = ("講義", "概説", "概論", "講読")

# 専攻語実習の科目名。〇〇語1〜5（1年）／〇〇語11〜15（2年）／〇〇語Ia〜Xb（演習）。
# 言語名にローマ数字の文字（I・V・X）は現れないので、そこまでを言語名として飛ばす。
_ARABIC = re.compile(r"^[^0-9IVX]+?(\d+)")
_ROMAN = re.compile(r"^[^0-9IVX]+?[IVX]+[ab]?(?:[(（].*)?$")


def divide_foreign_studies(title: str, numbering: str) -> tuple[str | None, str | None]:
    """(区分, 出所) を返す。判定できなければ (None, None)。

    出所は division.py と同じ "title" / "numbering"。
    """
    for mark, key in TITLE_MARKS:
        if title.startswith(mark):
            return key, "title"

    if title.startswith(SENKO_MARK):
        body = title[len(SENKO_MARK):]
        if any(w in body for w in SENKO_ENSHU_WORDS):
            return "fs_senko_enshu", "title"
        if any(w in body for w in SENKO_KOGI_WORDS):
            return "fs_senko_kogi", "title"
        return None, None            # 講義とも演習とも書いていない21件は猜わない

    seg, tail = numbering[6:8], numbering[8:11]
    if seg == "4B" and tail == "002":
        return "fs_sotsuron", "numbering"
    if tail[1:] == "03":
        return "fs_kyoshoku", "numbering"
    if tail == "001":
        return "fs_kenkyu_gaikokugo", "numbering"
    if tail[1:] == "00":
        m = _ARABIC.match(title)
        if m:
            return ("fs_senkogo_1" if int(m.group(1)) < 10 else "fs_senkogo_2"), "title"
        if _ROMAN.match(title):
            return "fs_senkogo_enshu", "title"

    return None, None


# ── 要件表へ合流させるもの ──────────────────────
# fetch_requirements.py が作る data/faculty_requirements.json は CELAS の
# スクレイプ結果そのもので、流し直すと上書きされる。チェックシート由来の
# ここの定義は build.py が公開側へ写すときに合流させる（正本は2つに割らない）。

FACULTY = "foreign-s"
SOURCE = ("外国語学部 単位修得状況チェックシート（2025年度以降入学者用） "
          "https://www.sfs.osaka-u.ac.jp/guide/")

# only が付いた区分は、その学部を選んでいるときだけ chip になる。
# 並びはチェックシートの上から順。学生が紙と見比べて追えるようにしている。
DIVISIONS = [
    {"key": "fs_senkogo_1",       "label": "専攻語 1年実習",  "group": "専攻語科目"},
    {"key": "fs_senkogo_2",       "label": "専攻語 2年実習",  "group": "専攻語科目"},
    {"key": "fs_senkogo_enshu",   "label": "専攻語 演習",     "group": "専攻語科目"},
    {"key": "fs_senko_kogi",      "label": "専攻科目 講義",   "group": "専攻科目"},
    {"key": "fs_senko_enshu",     "label": "専攻科目 演習",   "group": "専攻科目"},
    {"key": "fs_kyotsu_hoho",     "label": "学部共通 方法論", "group": "学部共通科目"},
    {"key": "fs_kyotsu_chiiki",   "label": "学部共通 地域系", "group": "学部共通科目"},
    {"key": "fs_kyotsu_tokusetsu", "label": "学部共通 特設",  "group": "学部共通科目"},
    {"key": "fs_kenshu",          "label": "兼修語学",        "group": "兼修語学"},
    {"key": "fs_kenshu_kokusai",  "label": "兼修語学（高度国際性）", "group": "兼修語学"},
    {"key": "fs_kenkyu_gaikokugo", "label": "研究外国語",     "group": "外国語学部"},
    {"key": "fs_sotsuron",        "label": "卒業論文",        "group": "外国語学部"},
    # 教職課程。チェックシートに行が無い＝卒業要件ではないので、要件行は作らない。
    # 画面では「卒業要件外の区分」の折りたたみ側に入る。
    {"key": "fs_kyoshoku",        "label": "教職（〜語科教育法）", "group": "外国語学部"},
]

# 「○」＝チェックシートに行はあるが、単位数の数字がその紙に無いもの。
# 数字を猜いて出すと卒業要件の数字を捏造することになるので、行の有無だけを持つ。
IN_SHEET = "○"

# チェックシートに行があるのに CELAS 側が要件外にしていた2つを上書きする。
OVERRIDE = {"senmon_kiso": IN_SHEET, "global": IN_SHEET}

NOTES = [
    "専攻語科目 1年実習は上限10単位（ロシア語は12単位）。",
    "兼修語学の【同一言語で修得】と【上記以外で修得】は、どちらになるかが"
    "学生の選び方で決まるため、科目の側では分けていません。",
    "国際交流科目と選択科目（他大学・他学部）は、科目の属性ではないので"
    "区分にしていません。",
]


def apply_to_requirements(req: dict) -> dict:
    """要件表（CELAS スクレイプ）へチェックシート由来の区分を合流させる。

    build.py が公開側へ写すときに1回だけ呼ぶ。冪等。
    """
    have = {d["key"] for d in req.get("divisions", [])}
    for d in DIVISIONS:
        if d["key"] not in have:
            req.setdefault("divisions", []).append({**d, "only": [FACULTY]})

    fac = next((f for f in req.get("faculties", []) if f["key"] == FACULTY), None)
    if fac is None:                      # 要件表に外国語学部が無い＝スクレイプが古い
        return req

    n = len(fac.get("departments") or []) or 1
    listed = {k for r in fac["requirements"] for k in r["divisions"]}
    for d in DIVISIONS:
        if d["key"] == "fs_kyoshoku" or d["key"] in listed:
            continue
        fac["requirements"].append({
            "divisions": [d["key"]], "values": [IN_SHEET] * n, "source": SOURCE,
        })

    for r in fac["requirements"]:
        for k in r["divisions"]:
            if k in OVERRIDE and len(r["divisions"]) == 1:
                r["values"] = [OVERRIDE[k]] * len(r["values"])
                r["source"] = SOURCE
                r["note"] = ("CELAS の卒業要件表は要件外としているが、"
                             "学部チェックシートには行がある。紙を採った。")

    for t in NOTES:
        if t not in fac.setdefault("notes", []):
            fac["notes"].append(t)
    return req
