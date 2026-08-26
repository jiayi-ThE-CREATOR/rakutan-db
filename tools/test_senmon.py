"""9学部の区分（必修／選択必修／専攻）と学科セレクタのテスト。ネットワークには出ない。

ここで守りたいのは2つだけ:
  ① **必修を水増ししていないこと**。学科・コースで扱いが変わる科目、
     複数学科にまたがる科目、紙に名前が無い科目は必修にしない
  ② その学部の科目が「その他」へ落ちないこと。所属コードが学部を指している
     時点で学部の専門科目であることは確定している
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import senmon
from tools.division import divide, track
from tools.kitei import grid, norm

ROOT = Path(__file__).resolve().parent.parent


def test_grid_expands_rowspan_and_colspan():
    """結合セルを覆っているマスへ複製する。ここが1つずれると必修が科目名の後ろに来る。"""
    html = ("<table>"
            "<tr><td rowspan='2'>必修科目</td><td>人間科学概論</td><td>2</td></tr>"
            "<tr><td>社会学概論</td><td>2</td></tr>"
            "<tr><td colspan='2'>選択科目</td><td>2</td></tr></table>")
    assert grid(html) == [["必修科目", "人間科学概論", "2"],
                          ["必修科目", "社会学概論", "2"],
                          ["選択科目", "選択科目", "2"]]


def test_norm_absorbs_only_notation():
    assert norm("統計学Ｂ―Ⅰ") == norm("統計学B-Ⅰ")
    assert norm("隣接臨床医学（小児科学）") == norm("隣接臨床医学")
    # ローマ数字と算用数字は別物のまま。潰すと別の科目が同じ名前になる
    assert norm("上級マクロ経済1") != norm("上級マクロ経済Ⅰ")


def test_law_marks_follow_the_legend():
    """法学部の種別欄 ◎＝必修、◇＝選択必修、無印＝選択（別表の履修方法）。"""
    law = senmon.TABLES["law"]["courses"]
    assert law["LAW_"][norm("演習1a")] == "必修"
    assert law["INPP"][norm("法学の基礎")] == "必修"
    assert law["INPP"][norm("計量経済学Ⅰ")] == "選択必修"
    # 「国際」は高度国際性涵養を兼ねる印であって、必修選択の別ではない
    assert law["LAW_"][norm("国際関係論Ⅰ")] == "選択"


def test_dentistry_star_is_the_only_elective():
    """歯学部は「(＊)印を付していない専門教育科目はすべて必修」。"""
    dent = senmon.TABLES["dentistry"]["courses"][""]
    assert dent[norm("歯学序説Ⅰ")] == "必修"
    # 印は科目名の後ろに付く（「口腔科学演習(＊)」）。4件だけが選択
    assert dent[norm("口腔科学演習")] == "選択"
    assert Counter(dent.values()) == Counter({"必修": 41, "選択": 4})


def test_letters_has_only_the_two_named_courses():
    """文学部の必修は規程本文が名指しする2つだけ。専修ごとの28単位は猜わない。"""
    assert senmon.TABLES["letters"]["courses"] == {
        "": {norm("文学部共通概説"): "必修", norm("卒業論文"): "必修"}}


def test_course_split_between_departments_is_not_required():
    """コースで扱いが変わる科目は必修にしない（基礎工「応用数理Ｃ」は7学科ぶん）。"""
    numbering = ("09CSSS3F206,09MASC3F206,09MESC3F206,09BIEN3F206,"
                 "09INSS3F206,09ELEC3F206,09MAPH3F206")
    assert divide({"title": "応用数理Ｃ", "numbering": numbering}) \
        == ("engr_sci_senko", "kitei")
    # 学科もまたがるので、学科では絞れない
    assert track({"numbering": numbering}) is None
    # 1学科だけの科目はその学科になる
    assert track({"numbering": "09ELEC2H001"}) == "engrsci_dept:denshi"


def test_track_is_namespaced_per_faculty():
    """軸名を前に付ける。学科コードは学部をまたいで同じ字面が出る（CHEM は理学部と基礎工）。"""
    assert track({"numbering": "04CHEM3G001"}) == "science_dept:chem"
    assert track({"numbering": "09CHEM2F001"}) == "engrsci_dept:kagaku"
    assert track({"numbering": "13LASC1Z100"}) is None


def test_faculty_courses_never_fall_to_other():
    """9学部の科目は必ずどれかの区分に入る（所属コードが学部を指しているため）。"""
    for numbering, expect in [("00HUMA3A001", "letters_senko"),
                              ("01HUSC3D001", "human_sci_senko"),
                              ("03ECBM4E001", "economics_senko"),
                              ("05MEDI2Q001", "medicine_senko"),
                              ("0ANURS2R001", "medicine_senko"),
                              ("07PHAM3T001", "pharmacy_senko")]:
        assert divide({"title": "紙に載っていない新設科目", "numbering": numbering}) \
            == (expect, "kitei")
    # 学部の所属でないものは付けない（教職 63TECS・他学部科目 98OTHS）
    assert divide({"title": "国語科教育法Ⅲ", "numbering": "63TECS1U000"}) == (None, None)
    assert divide({"title": "博物館学", "numbering": "98OTHS2Z000"}) == (None, None)


def test_sentaku_hisshu_chip_only_where_the_paper_has_it():
    """選択必修の chip は、別表に選択必修の段がある学部にだけ出す。"""
    have = {f for f in senmon.TABLES
            if any(d["key"].endswith("_senhitsu") for d in senmon.divisions_for(f))}
    assert have == {"law", "economics", "human-sci", "science", "engr-sci"}, have


def test_apply_to_requirements_is_idempotent():
    req = {"divisions": [],
           "faculties": [{"key": "science", "label": "理学部",
                          "departments": ["数", "物", "化", "生"],
                          "requirements": [], "notes": []},
                         {"key": "letters", "label": "文学部",
                          "departments": [], "requirements": [], "notes": []}]}
    once = senmon.apply_to_requirements(json.loads(json.dumps(req)))
    twice = senmon.apply_to_requirements(json.loads(json.dumps(once)))
    assert once == twice, "2回流すと増える"
    sci = once["faculties"][0]
    assert [t["label"] for t in sci["tracks"]] == ["数学科", "物理学科", "化学科", "生物科学科"]
    row = next(r for r in sci["requirements"] if r["divisions"] == ["science_hisshu"])
    assert len(row["values"]) == 4, row       # 学科の数と揃える
    # 文学部は学科セレクタを持たない
    assert "tracks" not in once["faculties"][1]
    assert len(next(r for r in once["faculties"][1]["requirements"]
                    if r["divisions"] == ["letters_hisshu"])["values"]) == 1


def test_counts_stay_where_the_paper_put_them():
    """実データの内訳。動いたら、紙の読み方か科目データのどちらかが変わっている。"""
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_counts_stay_where_the_paper_put_them")
        return
    courses = json.loads(built.read_text(encoding="utf-8"))["courses"]
    got = Counter(divide(c)[0] for c in courses)
    expect = {
        "letters_hisshu": 1, "letters_senko": 476,
        "human_sci_hisshu": 92, "human_sci_senhitsu": 4, "human_sci_senko": 235,
        "law_hisshu": 165, "law_senhitsu": 1, "law_senko": 293,
        "economics_hisshu": 45, "economics_senhitsu": 12, "economics_senko": 50,
        "science_hisshu": 323, "science_senhitsu": 68, "science_senko": 272,
        "medicine_hisshu": 195, "medicine_senko": 20,
        "dentistry_hisshu": 35, "dentistry_senko": 7,
        "pharmacy_hisshu": 124, "pharmacy_senko": 39,
        "engr_sci_hisshu": 152, "engr_sci_senhitsu": 48, "engr_sci_senko": 199,
    }
    for key, n in expect.items():
        assert got[key] == n, f"{key}: {got[key]} ≠ {n}"


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("9学部→区分・学科: すべて通過")


if __name__ == "__main__":
    main()
