"""科目→学部の割り当てのテスト。ネットワークには出ない。

規則ごとの最小ケースに加えて、web/data/courses.built.json があるときは
**全7,877件の内訳を検算**する。1件でもずれたら落ちる。
時間割から科目が静かに消えるのを防ぐのがここの仕事。
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.faculty import COMMON, CATEGORY_TO_FACULTY, faculty_of

ROOT = Path(__file__).resolve().parent.parent


def c(numbering="", category=""):
    return {"numbering": numbering, "category": category}


def test_shozoku_13_14_are_common():
    assert faculty_of(c("13LASC1B002", "全学教育推進機構")) == COMMON
    assert faculty_of(c("14MLED2A100", "マルチリンガル教育センター")) == COMMON


def test_broken_category_still_lands_in_common():
    """KOAN が検索フォームを返した12件。category が「年度」に化けている。

    ナンバリングを先に見ていないと、この12件がどの学部にも属さなくなる。
    """
    assert faculty_of(c("13LASC1Z101", "年度")) == COMMON


def test_faculty_comes_from_category():
    assert faculty_of(c("10FOST2BB03", "外国語学部外国語学科")) == "foreign-s"
    assert faculty_of(c("08ENGR2C100", "工学部")) == "engineering"


def test_teaching_course_goes_to_the_faculty_that_offers_it():
    """教職課程（ナンバリング 63）は開講学部へ。63 という学部は無い。"""
    assert faculty_of(c("63TECS1U000", "工学部")) == "engineering"
    assert faculty_of(c("63TECS1U000", "文学部")) == "letters"


def test_no_numbering_falls_back_to_category():
    assert faculty_of(c("", "理学部")) == "science"


def test_medicine_is_one_faculty():
    """CELAS の卒業要件表は「医学部」1つ。KOAN の2所属をそこへ寄せる。"""
    assert faculty_of(c("05MEDI1A100", "医学部医学科")) == "medicine"
    assert faculty_of(c("0AHLTH1A100", "医学部保健学科")) == "medicine"


def test_unknown_category_is_none():
    """判定できないものは None。黙ってどこかの学部へ倒さない。"""
    assert faculty_of(c("99XXXX1A100", "存在しない学部")) is None


def test_keys_exist_in_the_requirements_table():
    """学部キーは requirements.json の faculties[].key と1対1であること。

    向こうが正本。ここのキーが古くなると、時間割の学部選択が
    どの科目にも当たらない「押せるが0件」の選択肢になる。
    """
    req = ROOT / "web" / "data" / "requirements.json"
    if not req.exists():
        print("  SKIP test_keys_exist_in_the_requirements_table（requirements.json が無い）")
        return
    known = {f["key"] for f in json.loads(req.read_text(encoding="utf-8"))["faculties"]}
    mine = set(CATEGORY_TO_FACULTY.values())
    assert mine <= known, f"requirements.json に無いキー: {sorted(mine - known)}"
    assert known <= mine, f"割り当て先の無い学部: {sorted(known - mine)}"


def test_counts_match_the_built_json():
    """全7,877件の内訳。None が1件でも出たら落ちる（＝時間割から消える科目）。"""
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_counts_match_the_built_json（courses.built.json が無い）")
        return
    courses = json.loads(built.read_text(encoding="utf-8"))["courses"]
    got = Counter(faculty_of(x) for x in courses)
    expect = {
        COMMON: 2272,          # 共通教育 1,112 ＋ 語学 1,160
        "foreign-s": 2016, "engineering": 711, "science": 667,
        "letters": 490, "law": 459, "engr-sci": 402, "human-sci": 333,
        "medicine": 215,       # 医学科 48 ＋ 保健学科 167
        "pharmacy": 163, "economics": 107, "dentistry": 42,
    }
    assert dict(got) == expect, f"内訳がずれた: {dict(got)}"
    assert sum(got.values()) == len(courses) == 7877
    assert None not in got, "どの学部にも割り当てられない科目がある"


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("科目→学部: すべて通過")


if __name__ == "__main__":
    main()
