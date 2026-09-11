"""授業内容タグの語彙とルール（tools/subjects.py）のテスト。ネットワークには出ない。

■ この層が守っていること
語彙は**人が固定する**。AI は「選ぶ」だけで「作らない」。
自由記述を許すと必ず数千語のロングテールが生えて、タグの重なりが消える
――「日本語の歴史」を `ことば・語学 ∩ 歴史` で掘り当てる、という設計の前提が壊れる。

だからここでは「知らないキーは弾く」「1科目3個まで」を機械に守らせる。

  python3 tools/test_subjects.py

設計は docs/plans/2026-09-03-naiyou-tag-design.md
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import subjects  # noqa: E402

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


# ── ① 語彙そのもの ────────────────────────────────
V = subjects.VOCAB
check(len(V) >= 25, f"語彙が少なすぎる: {len(V)}語")
check(len(V) <= 40,
      f"語彙が多すぎる: {len(V)}語 ―― 増やすほど1タグあたりの科目が減り、"
      "組み合わせで掘れなくなる")
check(len(set(V.values())) == len(V), "表示名が重複している")
for key in V:
    check(key.isascii() and key.islower() and key.replace("_", "").isalnum(),
          f"キーが ASCII の小文字スラッグでない: {key!r}")

# 「レンズ」タグ。単独で成立する授業は少なく、ほぼ常に他のタグに乗る。
# 組み合わせ検索が成立するのはこれがあるから ――「歴史学という学部は無い」を
# 理由に落とすと、この設計の中心が消える。消されていないことを固定しておく。
for lens in subjects.LENS:
    check(lens in V, f"レンズタグ {lens} が語彙から消えている")
check(len(subjects.LENS) >= 4, "レンズタグが少なすぎる")

# ── ② 知らないキーは弾く（AI が語彙を作るのを防ぐ最後の門） ──
check(subjects.clean(["rekishi", "kotoba"]) == ["kotoba", "rekishi"],
      "既知のキーが通らない（並びは語彙の定義順）")
check(subjects.clean(["rekishi", "にほんごのれきし"]) == ["rekishi"],
      "語彙に無いキーが弾かれていない")
check(subjects.clean([]) == [], "空は空のまま")
check(subjects.clean(None) == [], "None を空として扱えていない")
check(subjects.clean(["rekishi", "rekishi"]) == ["rekishi"], "重複が落ちていない")
# 1科目3個まで。増やすと「とりあえず全部付ける」に寄って、
# タグが絞り込みの役に立たなくなる。
check(len(subjects.clean(list(V)[:8])) == 3, "3個を超えて付いている")

# ── ③ 科目名ルール（語学） ────────────────────────
# 実データで科目名に言語名を含むのは 2,479件。ここは AI を呼ばずに確定させる。
for title in ("ドイツ語初級I", "総合英語（Academic Skills）",
              "国際コミュニケーション演習（中国語）", "日本語Ⅱa"):
    check("kotoba" in subjects.from_title(title),
          f"語学の科目名にタグが付かない: {title}")

# 🚨 「外国語学部だから語学」と倒さないこと。実データでは外国語学部2,040件のうち
# 822件が言語名を含まない地域研究の科目で、これらは 文化・地域／国際 側に寄る。
# ナンバリング由来の分類を却下したのと同じ誤りなので、テストで固定する。
for title in ("【専攻科目】アフリカ地域文化演習a", "【専攻科目】アジア地域論概説a"):
    check("kotoba" not in subjects.from_title(title),
          f"地域研究の科目に語学タグが付いている: {title}")

# ── ④ 出所の優先順位 ―― 人が書いた行が AI に勝つ ──────────
merged, src = subjects.merge(manual=["rekishi"], title=["kotoba"], ai=["butsuri"])
check(merged == ["rekishi"] and src == "manual",
      f"人の指定が最優先になっていない: {merged} / {src}")
merged, src = subjects.merge(manual=None, title=["kotoba"], ai=["rekishi"])
check(merged == ["kotoba", "rekishi"] and src == "ai",
      f"科目名ルールと AI が合流していない: {merged} / {src}")
merged, src = subjects.merge(manual=None, title=["kotoba"], ai=None)
check(merged == ["kotoba"] and src == "title",
      f"科目名ルールだけのときの出所が違う: {merged} / {src}")
merged, src = subjects.merge(manual=None, title=[], ai=[])
check(merged == [] and src is None,
      f"何も付かないときは出所も None: {merged} / {src}")
# 合流しても3個を超えない。
merged, _ = subjects.merge(manual=None, title=["kotoba"],
                           ai=["rekishi", "bunka", "kokusai"])
check(len(merged) == 3, f"合流で3個を超えている: {merged}")

# ── ⑤ AI に渡すプロンプトが語彙と食い違わない ────────────
prompt = subjects.vocab_prompt()
for key, label in V.items():
    check(key in prompt, f"プロンプトに {key} が載っていない")
    check(label in prompt, f"プロンプトに表示名 {label} が載っていない")
check("3" in prompt, "個数の上限がプロンプトに書かれていない")

print(f"{n - len(fails)}/{n} 件が通過（語彙 {len(V)}語）")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
