"""工学部の学科（トラック）と区分のテスト。ネットワークには出ない。

工学部は外国語学部と違って**区分が1つしか無い**のが正しい状態。
必修／選択はコースごとに変わる（同じ科目が別コースでは履修不可）ので
科目の側では割れない ―― tools/engineering.py の docstring を読むこと。
ここが増えていたら、たぶん割ってはいけないものを割っている。
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import engineering
from tools.division import divide, track

ROOT = Path(__file__).resolve().parent.parent


def test_track_of():
    assert engineering.track_of("08ELIE2H001") == "denshi"
    assert engineering.track_of("08MEEN2J000") == "riko"
    assert engineering.track_of("08APCH2G000") == "shizen"
    assert engineering.track_of("08AREN3J002") == "chikyu"
    assert engineering.track_of("08SEEE3N000") == "kanene"
    # 教職は学科に紐づかない（実データでは 63TECS で、08 の入口にも来ない）
    assert engineering.track_of("63TECS1U000") is None


def test_division_is_only_senmon():
    assert divide({"title": "コンパイラ", "numbering": "08ELIE3H001"}) \
        == ("eng_senmon", "numbering")
    # 教職は 63TECS。工学部の科目だが 08 の入口に来ないので区分は付かない
    assert divide({"title": "工業科教育法Ⅰ", "numbering": "63TECS1U000"}) == (None, None)
    # 知らないコードは専門教育科目だと決めつけない
    assert divide({"title": "新設科目", "numbering": "08ZZZZ1A000"}) == (None, None)


def test_track_is_namespaced():
    """トラックは軸名付きで返す。外国語学部の "L"（英語）と衝突させないため。"""
    assert track({"numbering": "08ELIE2H001"}) == "eng_dept:denshi"
    # 外国語学部は科目名も見る（マーカーで専攻限定かどうかが決まる）。
    assert track({"numbering": "10FOST2BL00", "title": "英語1"}) == "fs_lang:L"
    assert track({"numbering": "10FOST3BL02",
                  "title": "（学共-地域系）アメリカ史概論a"}) is None
    assert track({"numbering": "13LASC1Z100"}) is None


def test_apply_to_requirements_is_idempotent():
    req = {"divisions": [],
           "faculties": [{"key": "engineering", "label": "工学部",
                          "departments": ["A", "B", "C", "D", "E"],
                          "requirements": [], "notes": []}]}
    once = engineering.apply_to_requirements(json.loads(json.dumps(req)))
    twice = engineering.apply_to_requirements(json.loads(json.dumps(once)))
    assert once == twice, "2回流すと増える"
    fac = once["faculties"][0]
    assert len(fac["tracks"]) == 5
    assert fac["tracks_label"] == "学科を選ぶ"
    # 学科ごとに単位数の列があるので、値の数は学科の数と揃える
    row = next(r for r in fac["requirements"] if r["divisions"] == ["eng_senmon"])
    assert len(row["values"]) == 5, row


def test_counts_match_the_curriculum_pdf():
    """工学部711件の学科の内訳が、履修案内と突き合わせた実測と一致すること。"""
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_counts_match_the_curriculum_pdf")
        return
    courses = [c for c in json.loads(built.read_text(encoding="utf-8"))["courses"]
               if str(c.get("numbering") or "").startswith("08")]
    got = Counter(track(c) for c in courses)
    expect = {"eng_dept:shizen": 201, "eng_dept:riko": 156, "eng_dept:denshi": 129,
              "eng_dept:chikyu": 138, "eng_dept:kanene": 76}
    assert dict(got) == expect, f"件数がずれた: {dict(got)}"
    # 08 で始まるのは700件。工学部所属の残り11件（教職8＝63TECS、
    # ナンバリングが空3）はここに来ず、画面では「その他」に入る。
    assert sum(got.values()) == len(courses) == 700
    assert all(divide(c)[0] == "eng_senmon" for c in courses)


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("工学部→学科・区分: すべて通過")


if __name__ == "__main__":
    main()
