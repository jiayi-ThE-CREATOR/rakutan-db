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
from tools.division import DAI2_LANGS, SPORTS_WORDS, divide

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


# ── マルチリンガル教育センター（所属14）────────────────
# 2026-08-25 に KOAN の一覧から実測した題名を使う。ナンバリングの既定は
# 総合英語の 14CMLE1BLB3。区分コード（末尾2文字）で分かれる規則を見るときは
# 第2引数で実物のナンバリングを渡す。
def ml(title, numbering="14CMLE1BLB3"):
    return divide({"title": title, "numbering": numbering})


def test_multilingual_english_split():
    assert ml("総合英語III") == ("lang1_sogo", "title")
    assert ml("実践英語（e-learning入門）") == ("lang1_jissen", "title")


def test_multilingual_second_language():
    for lang in DAI2_LANGS:
        assert ml(f"{lang}上級")[0] == "lang2", lang


def test_multilingual_global_understanding():
    # 歯学部規程・人間科学部規程が「グローバル理解」として名指ししている科目
    assert ml("国際コミュニケーション演習（ドイツ語）")[0] == "global"
    assert ml("地域言語文化演習（イタリア語）")[0] == "global"
    assert ml("多文化コミュニケーション（日本語）")[0] == "global"


def test_multilingual_optional_language():
    assert ml("英語選択")[0] == "lang_opt"
    for lang in ("スペイン語中級", "イタリア語初級I", "朝鮮語中級",
                 "ギリシャ語初級I選択", "ラテン語初級"):
        assert ml(lang)[0] == "lang_opt", lang


def test_special_foreign_language_is_global_by_numbering():
    """特別外国語演習はナンバリング末尾 A7＝グローバル理解で拾う。

    2026-08-25 まで None にしていた（どの学部規程にも名前が出ないので
    猜わない、という判断）。1,160件の実測で A7 の193件が例外なく global
    だと分かったので、題名ではなく区分コードを出所にして拾う。
    """
    assert ml("特別外国語演習（インドネシア語）I", "14CMLE1B4A7") == ("global", "numbering")
    assert ml("特別外国語演習（広東語）I", "14CMLE1BUA7") == ("global", "numbering")


def test_japanese_for_international_students_is_lang2():
    """留学生向けの日本語科目は CELAS どおり第2外国語に置く。

    日本人学生は履修できないが、それは区分ではなくタグで断る
    （build.py が「日本人履修不可」を付ける）。区分を割ると chip が増えて
    卒業要件の表と1対1で対応しなくなる。
    """
    assert ml("専門日本語", "14CMLE1BYB4") == ("lang2", "title")
    assert ml("総合日本語", "14CMLE1BYB4") == ("lang2", "title")


def test_multilingual_unknown_stays_none():
    # 区分コードにも題名の規則にも当たらないものは、いまでも猜わない
    assert ml("何かの新設科目", "14CMLE1BZZ9") == (None, None)


def test_multilingual_rules_do_not_leak_into_shozoku13():
    # 所属13 の科目に 14CMLE の規則が当たってはいけない
    assert divide({"title": "総合英語III", "numbering": "13LASC1B002"})[0] == "kiban_jinbun" \
        or divide({"title": "総合英語III", "numbering": "13LASC1Z100"})[0] == "tobira"
    # 「中国語」で始まる 所属13 の科目が lang2 に化けないこと
    got = divide({"title": "中国語圏の文学A", "numbering": "13LASC1A000"})
    assert got[0] != "lang2", got


def test_counts_match_the_design_doc():
    """共通教育（所属13）の件数が design.md 3章・4章の表と一致すること。

    design.md の表は共通教育科目だけを数えたもの。2026-08-25 に語学（所属14）と
    学部の専門（5,605件）が入って courses.built.json が 7,877件になったので、
    numbering の頭2桁で所属13に絞ってから数える。全件で数えると、この表と
    比べようがない数字（None が5,666件）になって、区分判定の回帰を検出できない。
    """
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_counts_match_the_design_doc（courses.built.json が無い）")
        return
    all_courses = json.loads(built.read_text(encoding="utf-8"))["courses"]
    courses = [c for c in all_courses
               if str(c.get("numbering") or "").startswith("13")]
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
