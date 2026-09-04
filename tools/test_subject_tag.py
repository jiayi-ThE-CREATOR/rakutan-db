"""AI へのバッチ投げ（tools/subject_tag.py）のうち、ネットワークに出ない部分のテスト。

■ ここで守っていること
7,906件を1件ずつ投げると止まったとき最初からになる。**途中で止めて再開できること**、
**返事が壊れていても他の科目を巻き添えにしないこと**、この2つが本体。
モデルの賢さはここでは測らない（それは tools/subject_survey.py の3表の仕事）。

  python3 tools/test_subject_tag.py

設計は docs/plans/2026-09-03-naiyou-tag-design.md
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import subject_tag as T  # noqa: E402

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


ROW = {"id": "135063", "title": "【人文】ことばの学問入門",
       "subtitle": "ことばの歴史",
       "abstract": "ことばの発達の経緯を概観する。" * 40,
       "kaiji": "動物のコミュニケーション / 最初の語族 / 文字 / 言語の系統"}

# ── ① 1件ぶんの投げる文 ────────────────────────────
one = T.course_block(ROW, {"category": "全学教育推進機構", "numbering": "13LASC1B002"})
check("135063" in one, "id が入っていない")
check("ことばの学問入門" in one, "科目名が入っていない")
check("ことばの歴史" in one, "サブタイトルが入っていない")
check("言語の系統" in one, "各回の題目が入っていない")
# 学部・ナンバリングは**文脈として渡す**（出力ラベルにはしない）。
# 「設計製図」がどの分野の設計かを判断するのに要る。
check("全学教育推進機構" in one, "学部が文脈として入っていない")
# 本文が長い科目でトークンを食い切らないよう、投げる前に切る。
check(len(one) < 2000, f"1件ぶんが長すぎる: {len(one)}文字")

# ── ② バッチ ────────────────────────────────────
rows = [dict(ROW, id=f"{i:06d}") for i in range(45)]
batches = list(T.batches(rows, size=20))
check([len(b) for b in batches] == [20, 20, 5], f"分け方が違う: {[len(b) for b in batches]}")

# ── ③ 返事の読み取り ──────────────────────────────
# 期待する形は「id<TAB>キー,キー」の行。行が壊れていても他を巻き添えにしない。
text = "\n".join([
    "135063\tkotoba,rekishi",
    "  138531 \t joho , kankyo ",          # 余白があっても読む
    "138537\t",                             # 空＝判定できなかった
    "こわれた行",                            # 区切りが無い
    "138545\tkotoba,にほんごのれきし",       # 語彙に無いキーが混ざる
    "138547\tkotoba,kotoba,rekishi,bunka,shakai",   # 重複と上限超え
])
got = T.parse_reply(text)
check(got.get("135063") == ["kotoba", "rekishi"], f"素直な行が読めない: {got.get('135063')}")
# 並びは語彙の定義順（subjects.clean の保証）。返ってきた順ではない。
check(got.get("138531") == ["kankyo", "joho"], f"余白が落とせていない: {got.get('138531')}")
check(got.get("138537") == [], "空の行が空リストになっていない")
check("こわれた行" not in got, "壊れた行が混ざっている")
check(got.get("138545") == ["kotoba"],
      f"語彙に無いキーが落ちていない: {got.get('138545')}")
check(len(got.get("138547", [])) == 3,
      f"上限3個で切れていない: {got.get('138547')}")
# 壊れた行があっても、他の5件は取れていること（巻き添えにしない）。
check(len(got) == 5, f"読めた件数が違う: {len(got)}")

# ── ④ 途中から再開できる ────────────────────────────
with tempfile.TemporaryDirectory() as d:
    tsv = Path(d) / "subjects.ai.tsv"
    T.append_rows(tsv, [("135063", "ことばの学問入門", ["kotoba", "rekishi"]),
                        ("138531", "GIS入門", [])])
    done = T.already_done(tsv)
    check(done == {"135063", "138531"}, f"済みの id が読めない: {done}")
    # 判定できなかった科目（タグ0個）も「済み」に数える。数えないと
    # 実行のたびに同じ科目へ投げ続けることになる。
    check("138531" in done, "タグ0個の科目が毎回やり直しになる")

    # 追記であって上書きではない（止めて再開しても前の結果が残る）。
    T.append_rows(tsv, [("138537", "神経科学", ["nou"])])
    check(T.already_done(tsv) == {"135063", "138531", "138537"},
          "追記のはずが上書きになっている")

    rows2 = [{"id": i, "title": ""} for i in ("135063", "138999")]
    check([r["id"] for r in T.remaining(rows2, done)] == ["138999"],
          "済みの科目を除外できていない")

    check(T.already_done(Path(d) / "ない.tsv") == set(),
          "TSV が無いときに空集合を返せていない")

print(f"{n - len(fails)}/{n} 件が通過")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
