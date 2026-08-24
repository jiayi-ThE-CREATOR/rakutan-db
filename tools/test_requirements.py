"""要件表パーサのテスト。ネットワークには出ない。

実測（2026-08-24）で出た表の形を最小の HTML に写して確かめる。
一番大事なのは「rowspan の結合＝合計単位数」を取り違えないこと。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.requirements_parse import DIVISIONS, parse_notes, parse_page, parse_table

# 文学部・理学部の形：基盤教養の4区分が rowspan="4" で1セル（＝4つ合わせて6単位）
MERGE4 = """<table><tbody>
<tr><th rowspan="9">教養教育系科目</th><th colspan="2">学問への扉</th><td>2</td></tr>
<tr><th colspan="2">アドヴァンスト・セミナー</th><td>＊</td></tr>
<tr><th rowspan="4">基盤教養教育科目（注１）</th><th>人文科学系</th><td rowspan="4">6</td></tr>
<tr><th>社会科学系</th></tr>
<tr><th>自然科学系</th></tr>
<tr><th>総合型</th></tr>
<tr><th colspan="2">高度教養教育科目</th><td>＊</td></tr>
<tr><th colspan="2">情報教育科目</th><td>2</td></tr>
<tr><th colspan="2">健康・スポーツ教育科目</th><td>2</td></tr>
<tr><th>専門教育系科目</th><th colspan="2">専門基礎教育科目</th><td>25</td></tr>
<tr><th rowspan="4">国際性涵養教育系科目</th><th rowspan="4">マルチリンガル教育科目</th>
    <th>第１外国語</th><td>8</td></tr>
<tr><th>第２外国語</th><td>3</td></tr>
<tr><th>選択外国語</th><td>－</td></tr>
<tr><th>グローバル理解</th><td>2</td></tr>
</tbody></table>"""

# 工学部・医学部の形：アドヴァンスト・セミナーまで巻き込んだ rowspan="5"。
# 医学部は値が <span class="strong">＊</span>6 のようにタグ入りで来る。
MERGE5 = MERGE4.replace(
    '<tr><th colspan="2">アドヴァンスト・セミナー</th><td>＊</td></tr>',
    '<tr><th colspan="2">アドヴァンスト・セミナー</th>'
    '<td rowspan="5"><span class="strong">＊</span>6</td></tr>'
).replace('<th>人文科学系</th><td rowspan="4">6</td>', '<th>人文科学系</th>')


def test_merge4_is_one_group():
    groups = parse_table(MERGE4)
    by = {tuple(g["divisions"]): g["value"] for g in groups}
    assert by[("tobira",)] == "2"
    # ★ ここが本丸：4区分で1グループ、値は6。「人文6・他は要件なし」ではない
    assert by[("kiban_jinbun", "kiban_shakai", "kiban_shizen", "kiban_sogo")] == "6"
    assert by[("senmon_kiso",)] == "25"
    assert by[("lang_opt",)] == "－"          # 要件なしはそのまま残す
    assert by[("adv_seminar",)] == "＊"       # 便覧参照もそのまま残す


def test_all_14_divisions_are_found():
    got = {k for g in parse_table(MERGE4) for k in g["divisions"]}
    assert got == {d["key"] for d in DIVISIONS}, sorted(got)


def test_fullwidth_numbers_are_normalized():
    # 表の見出しは「第１外国語」（全角）。key は lang1 に落ちること
    got = {k for g in parse_table(MERGE4) for k in g["divisions"]}
    assert "lang1" in got and "lang2" in got


def test_merge5_swallows_adv_seminar():
    by = {tuple(g["divisions"]): g["value"] for g in parse_table(MERGE5)}
    assert by[("adv_seminar", "kiban_jinbun", "kiban_shakai",
               "kiban_shizen", "kiban_sogo")] == "＊6"


def test_departments_come_from_labels():
    # 理学部の形：学科ごとに表が分かれ、専門基礎だけ数字が違う（25 と 24）
    page = ('<label for="f1">数学科</label>' + MERGE4 +
            '<label for="f2">生物科学科</label>'
            + MERGE4.replace("<td>25</td>", "<td>24</td>"))
    tables = parse_page(page)
    assert [t["department"] for t in tables] == ["数学科", "生物科学科"]

    def senmon(t):
        return next(g["value"] for g in t["groups"] if g["divisions"] == ["senmon_kiso"])

    assert senmon(tables[0]) == "25"
    assert senmon(tables[1]) == "24"


def test_single_table_page_has_no_department():
    tables = parse_page('<label for="s"></label>' + MERGE4)
    assert [t["department"] for t in tables] == [None]


def test_notes_keep_order_without_duplicates():
    page = (MERGE4 +
            "<p>＊アドヴァンスト・セミナーの修得単位の取り扱いは、"
            "各学部発行の便覧等にて確認してください。</p>"
            "<p>ふつうの段落。これは注記ではない。</p>"
            "<p>注１：「自然科学系」科目は、卒業要件外とする</p>"
            "<p>注１：「自然科学系」科目は、卒業要件外とする</p>")
    notes = parse_notes(page)
    assert len(notes) == 2
    assert notes[0].startswith("＊アドヴァンスト")
    assert notes[1] == "注１：「自然科学系」科目は、卒業要件外とする"


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("要件表パーサ: すべて通過")


if __name__ == "__main__":
    main()
