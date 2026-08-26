"""工学部（所属08）の科目を学科へ割り当てる。

■ 外国語学部とは構造が違う ―― 区分は作らない
外国語学部のチェックシートは1行＝1つの「科目の種類」（実習・演習・講義…）で、
科目の側の属性だった。工学部の教育課程表は列がコースになっていて、

    配当学年｜授業形態｜授業科目｜単位数｜授業科目の区分｜コース別指示    ｜開講区分
                                                    ｜電気工学 量子情報…｜
                                                    ｜◎必修 A〜G選択 ―不可｜

**同じ科目が、電気工学コースでは ◎必修、通信工学コースでは ―（履修不可）**
になる。つまり必修か選択かは科目の属性ではなく学生の属性で、
第2外国語と選択外国語について division.py が書いているのと同じ理由で割れない。

「授業形態（講義／演習／実験）」で割ることも検討したが、やめた。
あれは課程表の行を読みやすくするための grouping であって卒業要件の単位ではなく、
711件中543件（76%）が講義科目で絞り込みとしても効かない。
科目が重いかどうかは4軸の点数がすでに答えている。

■ だから工学部に効くのは「学科」だけ
学科が決まると専門科目の顔ぶれが決まる。これは chip ではなく学部の下の
セレクタに置く（外国語学部の専攻語と同じ位置づけ）。

■ コードの出所
ナンバリング3〜6文字目の4文字が学科目（コース）を指す。
学科への対応は履修案内（令和8年度）の「学科目分属」章と、各学科の課程表ページに
KOAN の科目名が載っているかを1件ずつ突き合わせて確認した（2026-08-25、
708/711件が一致）。字面の略称から推測したものではない。

    https://www.eng.osaka-u.ac.jp/wp-content/uploads/pdf/student/ug_curriculum/2026_1_bc_curriculum.pdf

なお応用自然科学科の PRST と APPH は、課程表では4コースが同じページに
列で並ぶため、どちらが物理工学でどちらが応用物理学かまでは確定できなかった。
**学科はどちらも応用自然科学科なので、学科の単位では影響しない。**
コース単位まで割るならそこを先に確かめること。
"""
from __future__ import annotations

NUMBERING_PREFIX = "08"

TRACK_KEY = "eng_dept"
TRACKS = {
    "shizen": "応用自然科学科",
    "riko": "応用理工学科",
    "denshi": "電子情報工学科",
    "kanene": "環境・エネルギー工学科",
    "chikyu": "地球総合工学科",
}

# ナンバリング [2:6] → 学科。教職（TECS）と、ナンバリングが空の3件は学科に付けない。
CODE_TO_TRACK = {
    "APCH": "shizen", "BIOT": "shizen", "PRST": "shizen",
    "APPH": "shizen", "ENPH": "shizen",
    "MEEN": "riko", "MAMS": "riko",
    "ELIE": "denshi",
    "SEEE": "kanene",
    "NAOE": "chikyu", "CIEN": "chikyu", "AREN": "chikyu",
}


def track_of(numbering: str, title: str = "") -> str | None:
    """学科のキーを返す。学科に紐づかない科目（教職など）は None。

    title は division.track() が全学部へ同じ形で渡すため受けるだけで、
    ここでは見ない ―― 工学部の学科はナンバリングだけで一意に定まる
    （外国語学部は専攻限定かどうかが科目名のマーカーでしか割れないので見る）。

    ナンバリングは `08MEEN…,08ELIE…` のようにカンマ区切りで複数入ることがある
    （工学部711件のうち151件。うち44件は学科をまたぐ）。**先頭だけ見ると、
    5学科に開いている科目が1学科の科目に化ける**ので、全部を見て一致したときだけ返す。
    2026-08-26 に修正 ―― それまでは先頭のコードだけを見ていた。
    """
    got = {CODE_TO_TRACK.get(c.strip()[2:6]) for c in (numbering or "").split(",")
           if c.strip()}
    return got.pop() if len(got) == 1 else None


def divide_engineering(title: str, numbering: str) -> tuple[str | None, str | None]:
    """(区分, 出所) を返す。

    工学部の区分は1つだけ ―― 課程表の「授業科目の区分」列にある
    「専門教育科目」。◎必修／A〜G選択の区別はコースごとに違うので付けない
    （上の docstring 参照）。どの学科の専門科目かはトラックが持つ。

    区分を1つでも付けるのは、付けないと工学部の700件が画面上「その他」に
    まとめて入り、学科を選んでも「その他 129件」としか出ないため。

    なお工学部の教職科目8件は 08 ではなく 63TECS で始まるので、そもそも
    ここへ来ない（division.py の入口で外れる）。ナンバリングが空の3件も同じ。
    知らないコードが増えたときは None にする ―― 専門教育科目だと決めつけない。
    """
    if track_of(numbering) is None and not any(
            CODE_TO_TRACK.get(c.strip()[2:6]) for c in (numbering or "").split(",")):
        return None, None
    return "eng_senmon", "numbering"


DIVISIONS = [
    {"key": "eng_senmon", "label": "専門教育科目", "group": "工学部"},
]
IN_SHEET = "○"


FACULTY = "engineering"
SOURCE = ("工学部 履修案内（令和8年度）学科別履修指針 https://www.eng.osaka-u.ac.jp/"
          "wp-content/uploads/pdf/student/ug_curriculum/2026_1_bc_curriculum.pdf")


def tracks_for_requirements() -> list[dict]:
    return [{"key": f"{TRACK_KEY}:{k}", "label": v} for k, v in TRACKS.items()]


def apply_to_requirements(req: dict) -> dict:
    """学科セレクタを要件表へ載せる。区分は足さない（上の docstring 参照）。冪等。"""
    fac = next((f for f in req.get("faculties", []) if f["key"] == FACULTY), None)
    if fac is None:
        return req
    have = {d["key"] for d in req.get("divisions", [])}
    for d in DIVISIONS:
        if d["key"] not in have:
            req.setdefault("divisions", []).append({**d, "only": [FACULTY]})
    listed = {k for r in fac["requirements"] for k in r["divisions"]}
    for d in DIVISIONS:
        if d["key"] not in listed:
            n = len(fac.get("departments") or []) or 1
            fac["requirements"].append({
                "divisions": [d["key"]], "values": [IN_SHEET] * n, "source": SOURCE})

    fac["tracks"] = tracks_for_requirements()
    fac["tracks_label"] = "学科を選ぶ"
    fac["tracks_source"] = SOURCE
    note = ("学科を選ぶと、その学科の専門科目だけになります。"
            "必修か選択かはコースごとに違う（同じ科目が別のコースでは履修できない）ため、"
            "科目の側では分けていません。履修案内で確認してください。")
    if note not in fac.setdefault("notes", []):
        fac["notes"].append(note)
    return req
