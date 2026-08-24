"""CELAS「卒業要件単位数」ページの表を読む。ネットワークには出ない。

■ なぜ機械で読むか
「人文科学系／社会科学系／自然科学系／総合型」の4行が rowspan="4" で
1つのセルに結合されていることがある。これは「人文6・他は要件なし」ではなく
**「基盤教養教育科目から合計6単位」**の意味。工学部・医学部では
アドヴァンスト・セミナーまで巻き込んだ rowspan="5" になる。

2026-08-24 に LLM へこの HTML を読ませたところ、外国語学部でここを読み違え、
「人文6・社会/自然/総合は表記なし」と出した。卒業要件の数字を外すのは
単位事故なので、**目視転記も LLM 読みも禁止**。この関数だけを正本にする。

■ 返す形
    parse_page(page) -> [{"department": "数学科" | None,
                          "groups": [{"divisions": ["kiban_jinbun", ...],
                                      "value": "6"}, ...]}]
    parse_notes(page) -> ["＊アドヴァンスト・セミナーの…", "注１：…"]

値（"2" / "－" / "＊" / "＊6"）は**生の文字列のまま返す**。数値へ丸めない
―― 「＊（便覧参照）」「－（要件なし）」「0」は違う事実で、潰すと画面で嘘になる。
"""
from __future__ import annotations

import html as _html
import re
import unicodedata

# 区分マスタ。key は API・画面・絞り込みで使う識別子。並びは要件表の上から順。
DIVISIONS = [
    {"key": "tobira",        "label": "学問への扉",              "group": "教養教育系科目"},
    {"key": "adv_seminar",   "label": "アドヴァンスト・セミナー",  "group": "教養教育系科目"},
    {"key": "kiban_jinbun",  "label": "人文科学系",              "group": "基盤教養教育科目"},
    {"key": "kiban_shakai",  "label": "社会科学系",              "group": "基盤教養教育科目"},
    {"key": "kiban_shizen",  "label": "自然科学系",              "group": "基盤教養教育科目"},
    {"key": "kiban_sogo",    "label": "総合型",                 "group": "基盤教養教育科目"},
    {"key": "kodo_kyoyo",    "label": "高度教養教育科目",         "group": "教養教育系科目"},
    {"key": "joho",          "label": "情報教育科目",            "group": "教養教育系科目"},
    {"key": "health_sports", "label": "健康・スポーツ教育科目",    "group": "教養教育系科目"},
    {"key": "senmon_kiso",   "label": "専門基礎教育科目",         "group": "専門教育系科目"},
    # 第1外国語そのものはチップにしない（chip=False）。内訳の総合英語・実践英語が
    # 実在する科目区分で、親の「第1外国語」に直接ぶら下がる科目は無いため、
    # チップにすると必ず0件になって「壊れている」と読まれる。
    # 要件表の行としては CELAS 由来の合計値を持ち続ける（内訳の検算に使う）。
    {"key": "lang1",         "label": "第1外国語",              "group": "マルチリンガル教育科目",
     "chip": False},
    # 第1外国語の内訳。CELAS の表は「第1外国語」1行だが、各学部規程は
    # 総合英語・実践英語に分けて単位数を定めている（2026-08-25 に11学部で確認）。
    # 課網にも「総合英語」「実践英語」という科目が実在する（所属14・593件）ので、
    # 学生が絞り込む単位として意味がある。tools/fetch_lang_split.py が値を入れる。
    {"key": "lang1_sogo",    "label": "総合英語",               "group": "マルチリンガル教育科目",
     "celas": False},
    {"key": "lang1_jissen",  "label": "実践英語",               "group": "マルチリンガル教育科目",
     "celas": False},
    {"key": "lang2",         "label": "第2外国語",              "group": "マルチリンガル教育科目"},
    {"key": "lang_opt",      "label": "選択外国語",             "group": "マルチリンガル教育科目"},
    {"key": "global",        "label": "グローバル理解",          "group": "国際性涵養教育系科目"},
]

_TAG = re.compile(r"<[^>]+>")
_TABLE = re.compile(r"<table.*?</table>", re.S | re.I)
_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<(t[hd])([^>]*)>(.*?)</\1>", re.S | re.I)
_SPAN = re.compile(r'(rowspan|colspan)="(\d+)"', re.I)
_LABEL = re.compile(r"<label[^>]*>(.*?)</label>", re.S | re.I)
_PARA = re.compile(r"<p[^>]*>(.*?)</p>", re.S | re.I)
# 注記の先頭に立つ文字。実測で出たものだけ入れる。
_NOTE_HEADS = "＊*※注"


def _text(fragment: str) -> str:
    """タグを落として空白を1つに畳む。&nbsp; も普通の空白になる。"""
    s = _html.unescape(_TAG.sub("", fragment)).replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def _norm(label: str) -> str:
    """見出しのゆれを吸収する。

    「第１外国語」（全角）→「第1外国語」、
    「基盤教養教育科目（注１）」→「基盤教養教育科目」。
    """
    s = unicodedata.normalize("NFKC", label)
    s = re.sub(r"[（(].*?[）)]", "", s)
    return s.replace(" ", "").strip()


_KEY_BY_LABEL = {_norm(d["label"]): d["key"] for d in DIVISIONS}

# CELAS の「卒業要件単位数」表に行として現れる区分。
# celas=False の区分（総合英語・実践英語）は各学部規程が出所で、
# fetch_lang_split.py があとから入れる。取り込み時の欠落検査から外す。
CELAS_DIVISIONS = [d for d in DIVISIONS if d.get("celas", True)]


def parse_table(table_html: str) -> list[dict]:
    """表1つを「結合セル1つ＝1グループ」の並びにする。

    行を上から見て、値のセル（td）が出たら新しいグループを開く。
    rowspan=N なら、そのセルは続く N 行を覆う ―― その間に出てくる
    区分は全部そのグループに入る（＝「合わせて何単位」）。
    """
    groups: list[dict] = []
    open_group: dict | None = None   # いま開いているグループ（rowspan の残り行つき）

    for row in _ROW.findall(table_html):
        heads: list[str] = []
        value: tuple[str, int] | None = None
        for tag, attrs, body in _CELL.findall(row):
            span = {k.lower(): int(v) for k, v in _SPAN.findall(attrs)}
            if tag.lower() == "th":
                heads.append(_text(body))
            else:
                value = (_text(body), span.get("rowspan", 1))

        if value is not None:
            open_group = {"divisions": [], "value": value[0], "rows_left": value[1]}
            groups.append(open_group)
        if open_group is None:
            continue          # 値のセルより前にある見出し行

        # 一番内側の th が区分名。外側は「教養教育系科目」などの括りなので見ない。
        if heads:
            key = _KEY_BY_LABEL.get(_norm(heads[-1]))
            if key:
                open_group["divisions"].append(key)

        open_group["rows_left"] -= 1
        if open_group["rows_left"] <= 0:
            open_group = None

    return [{"divisions": g["divisions"], "value": g["value"]}
            for g in groups if g["divisions"]]


def parse_page(page: str) -> list[dict]:
    """ページ内の表を、学科名つきで上から順に返す。

    学科名は表の手前の <label>（アコーディオンの見出し）から取る。
    学科の無い学部（文学部など）は先頭の検索欄の空 label しか無いので None になる。
    """
    tables = _TABLE.findall(page)
    departments = [d for d in (_text(x) for x in _LABEL.findall(page)) if d]
    if len(departments) != len(tables):
        departments = [None] * len(tables)
    return [{"department": departments[i], "groups": parse_table(t)}
            for i, t in enumerate(tables)]


def parse_notes(page: str) -> list[str]:
    """表の下の但し書き（＊ と 注）を、出た順で重複なく返す。"""
    seen: set[str] = set()
    out: list[str] = []
    for para in _PARA.findall(page):
        t = _text(para)
        if t and t[0] in _NOTE_HEADS and t not in seen:
            seen.add(t)
            out.append(t)
    return out
