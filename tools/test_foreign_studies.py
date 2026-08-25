"""外国語学部→チェックシートの行の割り当てのテスト。ネットワークには出ない。

規則ごとの最小ケースに加えて、web/data/courses.built.json があるときは
**2,016件の件数を検算**し、専攻語の3行を eligible_years と突き合わせる。
件数が動いたときに気付けないと、区分が静かに壊れる（test_division.py と同じ）。
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.division import divide
from tools.foreign_studies import apply_to_requirements, divide_foreign_studies

ROOT = Path(__file__).resolve().parent.parent


def fs(title, numbering="10FOST2BL00"):
    return divide_foreign_studies(title, numbering)


def test_title_marks():
    assert fs("＜兼修＞アラビア語初級a") == ("fs_kenshu", "title")
    assert fs("＜兼修（高度）＞アラビア語中級IIb") == ("fs_kenshu_kokusai", "title")
    assert fs("（学共-方法論）言語学概論(F)") == ("fs_kyotsu_hoho", "title")
    assert fs("（学共-地域系）ドイツ語圏文化概論a(B)") == ("fs_kyotsu_chiiki", "title")
    assert fs("（学共-特設）バルカン学(A)") == ("fs_kyotsu_tokusetsu", "title")
    assert fs("（高度教養）東南アジア社会文化演習IIb(B)") == ("kodo_kyoyo", "title")


def test_kenshu_kodo_is_checked_before_kenshu():
    # ＜兼修＞ は ＜兼修（高度）＞ の前方一致ではないが、順番が逆になると壊れる
    assert fs("＜兼修（高度）＞イタリア語中級b(A)")[0] == "fs_kenshu_kokusai"


def test_marks_beat_numbering():
    """接頭マーカーはナンバリングより強い（division.py と同じ順序）。

    「（高度教養）チュルク諸語b」は研究外国語のナンバリング 001 を持つが、
    紙の上では高度教養教育科目。マーカーを採る。
    """
    assert fs("（高度教養）チュルク諸語b", "10FOST2B001") == ("kodo_kyoyo", "title")


def test_senko_split():
    assert fs("【専攻科目】アフリカ地域文化演習a", "10FOST3B402") \
        == ("fs_senko_enshu", "title")
    assert fs("【専攻科目】アフリカ地域特別演習IIIa", "10FOST3B402") \
        == ("fs_senko_enshu", "title")
    assert fs("【専攻科目】アメリカ史講義a", "10FOST3BL02") == ("fs_senko_kogi", "title")
    assert fs("【専攻科目】イスラーム世界概論", "10FOST3BB02") == ("fs_senko_kogi", "title")


def test_senko_unknown_stays_none():
    """★ 講義とも演習とも名前に書いていないものは猜わない。

    「入門なら講義だろう」は見ていない値のための規則。画面では「その他」。
    """
    assert fs("【専攻科目】ハンガリー研究入門IIa", "10FOST3BG02") == (None, None)
    assert fs("【専攻科目】書道a", "10FOST3B102") == (None, None)
    assert fs("【専攻科目】日本語教育実習", "10FOST3BR02") == (None, None)


def test_senkogo_three_rows():
    # 1年実習＝〇〇語1〜5、2年実習＝〇〇語11〜15、演習＝ローマ数字
    assert fs("英語1(A)（豊中開講）", "10FOST2BL00") == ("fs_senkogo_1", "title")
    assert fs("中国語5", "10FOST2B100") == ("fs_senkogo_1", "title")
    assert fs("英語11(A)", "10FOST2BL00") == ("fs_senkogo_2", "title")
    assert fs("スペイン語15(A)", "10FOST2BP00") == ("fs_senkogo_2", "title")
    assert fs("アラビア語IIa", "10FOST2BB00") == ("fs_senkogo_enshu", "title")
    assert fs("スウェーデン語VIIIb", "10FOST2BJ00") == ("fs_senkogo_enshu", "title")
    assert fs("中国語XIV", "10FOST2B100") == ("fs_senkogo_enshu", "title")
    assert fs("ロシア語Xa", "10FOST2BF00") == ("fs_senkogo_enshu", "title")


def test_numbering_rules():
    assert fs("アイヌ語", "10FOST2B001") == ("fs_kenkyu_gaikokugo", "numbering")
    assert fs("サンスクリット語a", "10FOST2B001") == ("fs_kenkyu_gaikokugo", "numbering")
    assert fs("英語科教育法V(A)", "10FOST2BL03,63TECS1U000") \
        == ("fs_kyoshoku", "numbering")
    assert fs("卒業論文（アラビア語)", "10FOST4B002") == ("fs_sotsuron", "numbering")


def test_rules_do_not_leak_outside_the_faculty():
    # 10FOST で始まらない科目に外国語学部の規則が当たってはいけない
    assert divide({"title": "＜兼修＞何か", "numbering": "13LASC1Z100"})[0] == "tobira"
    assert divide({"title": "英語11", "numbering": "14CMLE1BLB3"})[0] != "fs_senkogo_2"


def test_dispatch_from_divide():
    got = divide({"title": "【専攻科目】アフリカ地域文化演習a",
                  "numbering": "10FOST3B402"})
    assert got == ("fs_senko_enshu", "title"), got


def test_apply_to_requirements_is_idempotent():
    req = {
        "divisions": [{"key": "global", "label": "グローバル理解"},
                      {"key": "senmon_kiso", "label": "専門基礎教育科目"}],
        "faculties": [{"key": "foreign-s", "label": "外国語学部", "departments": [],
                       "requirements": [
                           {"divisions": ["global"], "values": ["－"]},
                           {"divisions": ["senmon_kiso"], "values": ["0"]}],
                       "notes": []}],
    }
    once = apply_to_requirements(json.loads(json.dumps(req)))
    twice = apply_to_requirements(json.loads(json.dumps(once)))
    assert once == twice, "2回流すと増える"

    fac = once["faculties"][0]
    # チェックシートを採る＝CELAS が要件外にしていた2つが要件内になる
    vals = {r["divisions"][0]: r["values"][0] for r in fac["requirements"]}
    assert vals["global"] == "○" and vals["senmon_kiso"] == "○", vals
    # 教職は卒業要件ではないので要件行を作らない（画面では折りたたみ側）
    assert "fs_kyoshoku" not in vals
    assert vals["fs_senkogo_1"] == "○" and vals["fs_sotsuron"] == "○"
    # 区分は only 付きで足される
    added = {d["key"]: d for d in once["divisions"] if d.get("only")}
    assert added["fs_senkogo_1"]["only"] == ["foreign-s"]
    assert "fs_kyoshoku" in added


def test_counts_match_the_check_sheet():
    """外国語学部 2,016件の内訳が、チェックシートと突き合わせた実測と一致すること。"""
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_counts_match_the_check_sheet（courses.built.json が無い）")
        return
    all_courses = json.loads(built.read_text(encoding="utf-8"))["courses"]
    courses = [c for c in all_courses
               if str(c.get("numbering") or "").startswith("10FOST")]
    got = Counter(divide(x)[0] for x in courses)
    expect = {"fs_senko_enshu": 427, "fs_senko_kogi": 299, "fs_senkogo_enshu": 271,
              "fs_senkogo_1": 162, "fs_senkogo_2": 161, "fs_kenshu": 157,
              "fs_kyotsu_chiiki": 121, "fs_kenshu_kokusai": 84, "kodo_kyoyo": 75,
              "fs_kyotsu_hoho": 71, "fs_sotsuron": 50, "fs_kenkyu_gaikokugo": 49,
              "fs_kyoshoku": 49, "fs_kyotsu_tokusetsu": 19, None: 21}
    assert dict(got) == expect, f"件数がずれた: {dict(got)}"
    assert sum(got.values()) == len(courses) == 2016


def test_senkogo_agrees_with_eligible_years():
    """★ 専攻語の3分割を、出所の違う eligible_years で検算する。

    科目名の数え方（1〜5／11〜15／ローマ数字）と履修可能学年は別々の出所。
    2026-08-25 の実測では594件すべてで一致した。ここがずれたら、
    どちらかの取得が壊れている。
    """
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_senkogo_agrees_with_eligible_years")
        return
    courses = [c for c in json.loads(built.read_text(encoding="utf-8"))["courses"]
               if str(c.get("numbering") or "").startswith("10FOST")]
    allowed = {"fs_senkogo_1": {(1,)},
               "fs_senkogo_2": {(2, 3, 4)},
               "fs_senkogo_enshu": {(3, 4), (4,), (3,)}}
    for c in courses:
        key = divide(c)[0]
        if key in allowed:
            years = tuple(c.get("eligible_years") or [])
            assert years in allowed[key], f"{c['title']} {key} {years}"


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("外国語学部→区分: すべて通過")


if __name__ == "__main__":
    main()
