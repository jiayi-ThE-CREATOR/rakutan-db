"""科目→区分の推定のテスト。ネットワークには出ない。

規則ごとの最小ケースに加えて、web/data/courses.built.json があるときは
**全1,112件の件数を検算**する。設計（design.md の3章）の表と1件でもずれたら落ちる。
件数が動いたときに気付けないと、区分が静かに壊れる。
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.division import SPORTS_WORDS, divide

ROOT = Path(__file__).resolve().parent.parent


def c(title="", numbering="", **kw):
    return {"title": title, "numbering": numbering, **kw}


def test_title_prefix_wins():
    assert divide(c("【人文】ことばの学問入門", "13LASC1B002")) == ("kiban_jinbun", "title")
    assert divide(c("【社会】法と社会", "13LASC1E100")) == ("kiban_shakai", "title")
    assert divide(c("【自然】認知脳科学への誘い", "13LASC1M300")) == ("kiban_shizen", "title")
    assert divide(c("【総合】阪大SDGs学入門", "13LASC1Z100")) == ("kiban_sogo", "title")


def test_prefix_beats_numbering():
    # 1Z は学問への扉だが、【総合】が付いていればそちらが勝つ
    assert divide(c("【総合】阪大SDGs学入門", "13LASC1Z100"))[0] == "kiban_sogo"
    # 1M は情報教育科目だが、【自然】が付いていればそちら
    assert divide(c("【自然】認知脳科学への誘い", "13LASC1M300"))[0] == "kiban_shizen"


def test_numbering_rules():
    assert divide(c("学問への扉（がん研究入門）", "13LASC1Z101")) == ("tobira", "numbering")
    assert divide(c("情報科学基礎", "13LASC1M100")) == ("joho", "numbering")
    for seg in ("1F", "1G", "1K", "1H"):
        assert divide(c("基礎解析学・同演義", f"13LASC{seg}200"))[0] == "senmon_kiso", seg


def test_1v_needs_a_sports_word():
    assert divide(c("スマート・スポーツリテラシー（卓球）", "13LASC1V501")) \
        == ("health_sports", "numbering")
    assert divide(c("健康科学", "13LASC1V100")) == ("health_sports", "numbering")
    # ★ 体育ではない 1V は倒さない。倒すと卒業要件の計算に混ざる
    assert divide(c("キャリアデザインと公共哲学", "13LASC1V300")) == (None, None)
    assert divide(c("アカデミック・リテラシー入門", "13LASC1V300")) == (None, None)


def test_scrape_field_wins_over_everything():
    got = divide(c("【人文】ことばの学問入門", "13LASC1B002", division_scraped="kodo_kyoyo"))
    assert got == ("kodo_kyoyo", "scrape")


def test_unknown_is_none_not_a_guess():
    assert divide(c("動物の行動学", "13LASC1D400")) == (None, None)
    assert divide(c("", "")) == (None, None)
    assert divide({}) == (None, None)


def test_sports_words_are_all_used():
    for w in SPORTS_WORDS:
        assert divide(c(f"テスト{w}講座", "13LASC1V000"))[0] == "health_sports", w


def test_counts_match_the_design_doc():
    """全件の件数が design.md 3章・4章の表と一致すること。"""
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_counts_match_the_design_doc（courses.built.json が無い）")
        return
    courses = json.loads(built.read_text(encoding="utf-8"))["courses"]
    got = Counter(divide(x)[0] for x in courses)
    expect = {"tobira": 250, "senmon_kiso": 302, "health_sports": 144,
              "kiban_jinbun": 92, "kiban_sogo": 82, "kiban_shakai": 78,
              "joho": 76, "kiban_shizen": 39, None: 49}
    assert dict(got) == expect, f"件数がずれた: {dict(got)}"
    assert sum(got.values()) == len(courses) == 1112


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("科目→区分: すべて通過")


if __name__ == "__main__":
    main()
