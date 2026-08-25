"""外国語学部・工学部を除く9学部の専門科目を、学部規程の別表の行へ割り当てる。

■ なぜ1学部1ファイルにしなかったか
tools/foreign_studies.py・tools/engineering.py は**判定の規則そのものが学部ごとに違う**
（科目名の【専攻科目】印／ナンバリングの学科コード）ので分けている。
こちらの9学部は判定が1つしか無い ―― **学部規程の別表に載っている科目名を引く**だけ。
違うのは「紙の形」で、それは tools/fetch_senmon.py が吸収して
data/senmon_tables.json という同じ形に均してある。ここはその表を引く1本だけ。

■ 区分は3つ。学部の紙が持っている行に合わせる
    <学部>_hisshu    必修科目      別表で必修と読めるもの
    <学部>_senhitsu  選択必修科目  別表に選択必修の段がある学部だけ（法INPP・経済・人科・理・基礎工）
    <学部>_senko     専攻科目      残り全部（別表で選択、または別表に名前が無い科目）

「専攻科目」に別表で選択の科目と未収載の科目を一緒に入れているのは、**分けると
その他へ流れる**ため。所属コードがその学部である時点で学部の専門科目であることは
確定していて（教職は 63TECS、文学部の他学部科目は 98OTHS と所属が別）、
分かっていないのは「その学部の紙のどの行か」だけ。区分の名前で嘘はついていない。

■ 必修にしないもの
- 学科・コースで扱いが変わる科目（基礎工「応用数理C」は機械科学コースだけ選択必修）。
  fetch_senmon.py が「食い違い」として落としてある。**科目の側では割れない**
  ―― tools/engineering.py と tools/division.py の第2外国語がやっているのと同じ判断
- 文学部の「所属する専修の講義及び演習28単位」。専修は学生の属性で、
  ナンバリングにも科目名にも出てこない
- 薬学部で3コースの指示が揃っていない9件

■ ナンバリングは1件とは限らない
`09CSSS3F206,09MASC3F206,09MESC3F206,…` のように**カンマ区切りで複数**入っている
科目がある（「応用数理Ｃ」は7学科ぶん）。2026-08-26 時点で 9学部の 217件、
全体では 551件。先頭だけ見ると、7学科に開いている科目が1学科の科目に化ける。
だから**全部のコードを見て、答えが割れたら付けない**:
    区分 …… どのコードの表でも同じ扱いのときだけ採る（表に無いコードは黙って飛ばす。
             載っていないことは「選択だ」という主張ではない）
    学科 …… すべてのコードが同じ学科を指すときだけ。またがる科目は学科で絞れない
"""
from __future__ import annotations

import json
from pathlib import Path

from tools.kitei import norm

TABLES_PATH = Path(__file__).resolve().parent.parent / "data" / "senmon_tables.json"

# 所属コード（ナンバリングの頭2桁）→ 学部キー。
# 08（工学部）と 10（外国語学部）は専用ファイルが持つのでここには無い。
SHOZOKU = {
    "00": "letters", "01": "human-sci", "02": "law", "03": "economics",
    "04": "science", "05": "medicine", "0A": "medicine", "06": "dentistry",
    "07": "pharmacy", "09": "engr-sci",
}

# 学科セレクタ。コードはナンバリング[2:6]で、対応は
# tools/fetch_senmon.py の docstring のとおり実測で決めた。
# ラベルは requirements.json の departments と同じ字面にしてある
# （法学部だけ departments が空なので、学科名は規程の別表の見出しから）。
TRACKS = {
    "science": ("science_dept", {
        "MATH": ("math", "数学科"), "PHYS": ("phys", "物理学科"),
        "CHEM": ("chem", "化学科"), "BISC": ("bisc", "生物科学科"),
    }),
    "engr-sci": ("engrsci_dept", {
        "ELEC": ("denshi", "電子物理科学科"), "MAPH": ("denshi", "電子物理科学科"),
        "CHEM": ("kagaku", "化学応用科学科"), "CHEN": ("kagaku", "化学応用科学科"),
        "MESC": ("system", "システム科学科"), "INSS": ("system", "システム科学科"),
        "BIEN": ("system", "システム科学科"),
        "CSSS": ("joho", "情報科学科"), "MASC": ("joho", "情報科学科"),
    }),
    "law": ("law_dept", {
        "LAW_": ("law", "法学科"), "INPP": ("inpp", "国際公共政策学科"),
    }),
    "medicine": ("medicine_dept", {
        "MEDI": ("medi", "医学科"), "NURS": ("nurs", "保健学科看護学専攻"),
        "MEPE": ("mepe", "保健学科放射線技術科学専攻"),
        "LASC": ("lasc", "保健学科検査技術科学専攻"),
    }),
}

TRACK_LABEL = {"science": "学科を選ぶ", "engr-sci": "学科を選ぶ",
               "law": "学科を選ぶ", "medicine": "学科・専攻を選ぶ"}

# 画面に出す注記。学部ごとに「何を必修にしていないか」が違うので、そこだけ書く。
NOTES = {
    "letters": "文学部の規程には科目の別表がありません。必修は本文が名指しする"
               "「文学部共通概説」「卒業論文」だけです。所属する専修ごとの必修28単位は、"
               "どの専修に入るかで変わるため科目の側では分けていません。",
    "pharmacy": "3つのコース（先進研究・Pharm.D・薬学研究）で指示が揃っている科目だけを"
                "必修にしています。コースによって扱いが変わる科目は専攻科目に入れています。",
}
NOTE_COMMON = ("必修かどうかの出所は学部規程の別表です。"
               "学科・コースによって扱いが変わる科目は必修にしていません。"
               "履修案内で確認してください。")

_SUFFIX = {"必修": "hisshu", "選択必修": "senhitsu"}


def _load() -> dict:
    if not TABLES_PATH.exists():      # 生成物が無い環境では黙って何もしない
        return {}
    return json.loads(TABLES_PATH.read_text(encoding="utf-8")).get("faculties", {})


TABLES = _load()


def _slug(faculty: str) -> str:
    return faculty.replace("-", "_")


def codes(numbering: str) -> list[str]:
    """ナンバリングを1件ずつに割る。カンマ区切りで複数入ることがある。"""
    return [c.strip() for c in (numbering or "").split(",") if c.strip()]


def _buckets(faculty: str, numbering: str) -> list[dict]:
    """その科目を出している学科の表を、コードの数だけ返す。

    学科を持たない学部（文学部・経済学部など）は表が1つしか無いので、
    コードが何本あっても同じ表を1つ見る。
    """
    courses = TABLES.get(faculty, {}).get("courses", {})
    if "" in courses:
        return [courses[""]]
    return [courses[c[2:6]] for c in codes(numbering) if c[2:6] in courses]


def divide_senmon(title: str, numbering: str) -> tuple[str | None, str | None]:
    """(区分, 出所) を返す。この9学部の科目でなければ (None, None)。"""
    faculty = SHOZOKU.get(numbering[:2])
    if faculty is None or faculty not in TABLES:
        return None, None
    key = norm(title)
    kinds = {b[key] for b in _buckets(faculty, numbering) if key in b}
    kind = kinds.pop() if len(kinds) == 1 else None
    return f"{_slug(faculty)}_{_SUFFIX.get(kind, 'senko')}", "kitei"


def track_of(numbering: str) -> str | None:
    """学科のキーを返す。学科セレクタを持たない学部と、複数学科にまたがる科目は None。"""
    faculty = SHOZOKU.get(numbering[:2])
    if faculty not in TRACKS:
        return None
    table = TRACKS[faculty][1]
    got = {table[c[2:6]][0] for c in codes(numbering) if c[2:6] in table}
    return got.pop() if len(got) == 1 else None


def track_key(faculty: str) -> str | None:
    return TRACKS[faculty][0] if faculty in TRACKS else None


def divisions_for(faculty: str) -> list[dict]:
    """その学部に実際に行がある区分だけを返す。

    選択必修の chip は、別表に選択必修の段がある学部にしか出さない
    （法学部の法学科の紙には ◇ が無い、など紙ごとに違う）。
    """
    label = TABLES[faculty]["label"]
    kinds = {v for bucket in TABLES[faculty]["courses"].values() for v in bucket.values()}
    out = []
    if "必修" in kinds:
        out.append({"key": f"{_slug(faculty)}_hisshu", "label": "必修科目", "group": label})
    if "選択必修" in kinds:
        out.append({"key": f"{_slug(faculty)}_senhitsu", "label": "選択必修科目", "group": label})
    out.append({"key": f"{_slug(faculty)}_senko", "label": "専攻科目", "group": label})
    return out


IN_SHEET = "○"


def apply_to_requirements(req: dict) -> dict:
    """9学部ぶんの区分と学科セレクタを要件表へ載せる。冪等。

    単位数は入れない。別表は科目1件ずつの単位数しか持たず、区分ごとの必要単位は
    学部・学科ごとに本文へ散っている（法学科は必修4単位、国際公共政策学科は16単位）。
    数字を猜うと卒業要件の捏造になるので「○」＝行はある、で止める。
    """
    for faculty in TABLES:
        fac = next((f for f in req.get("faculties", []) if f["key"] == faculty), None)
        if fac is None:
            continue
        divs = divisions_for(faculty)
        have = {d["key"] for d in req.get("divisions", [])}
        for d in divs:
            if d["key"] not in have:
                req.setdefault("divisions", []).append({**d, "only": [faculty]})
        listed = {k for r in fac["requirements"] for k in r["divisions"]}
        n = len(fac.get("departments") or []) or 1
        for d in divs:
            if d["key"] not in listed:
                fac["requirements"].append({
                    "divisions": [d["key"]], "values": [IN_SHEET] * n,
                    "source": TABLES[faculty]["source"]})
        if faculty in TRACKS:
            key, codes = TRACKS[faculty]
            seen: dict[str, str] = {}
            for track, label in codes.values():
                seen.setdefault(track, label)
            fac["tracks"] = [{"key": f"{key}:{t}", "label": l} for t, l in seen.items()]
            fac["tracks_label"] = TRACK_LABEL[faculty]
            fac["tracks_source"] = TABLES[faculty]["source"]
        for note in (NOTES.get(faculty), NOTE_COMMON):
            if note and note not in fac.setdefault("notes", []):
                fac["notes"].append(note)
    return req
