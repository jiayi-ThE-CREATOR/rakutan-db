"""条件チップ（出席なし・レポートのみ…）の判定のテスト。ネットワークには出ない。

■ なぜこれが要るか
2026-08-26 まで「出席なし」「レポートのみ」「集中講義」の3つが、
**全7,877件に対して常に0件**だった。押せるのに1件も出ない状態が、
誰にも気付かれずに本番へ出ていた。件数を機械に数えさせておけば、
同じことが二度起きても落ちる。

  python3 tools/test_conditions.py
"""
import contextlib
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# server.py は読み込むだけで科目データを開き、ダミーなら警告を出す。
# ここで欲しいのは CONDITIONS だけなので、その出力は飲み込む。
with contextlib.redirect_stdout(io.StringIO()):
    import server

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / "web" / "data" / "courses.built.json"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


check(BUILT.is_file(), "web/data/courses.built.json が無い")
if BUILT.is_file():
    courses = json.loads(BUILT.read_text(encoding="utf-8"))["courses"]
    C = server.CONDITIONS
    hit = {name: [c for c in courses if f(c)] for name, f in C.items()}

    # ① どのチップも「押せるのに1件も出ない」になっていないこと。
    #    口コミあり だけは、口コミが0件の環境では 0 になりうるので別扱い。
    for name, rows in hit.items():
        if name == "口コミあり":
            continue
        check(len(rows) > 0, f"「{name}」が0件（押せるのに1件も出ない）")

    # ② 件数。データを焼き直して動いたら、意図した変化か確かめる。
    expect = {"出席なし": 1536, "レポートのみ": 482, "集中講義": 193,
              "持ち込み可": 17, "1限以外": 6979, "小テストなし": 6453}
    for name, want in expect.items():
        got = len(hit[name])
        check(got == want, f"「{name}」の件数が {want} → {got} に変わった")

    # ③ 「レポートのみ」は、毎回小テストが無ければ必ず「出席なし」でもある
    #    （成績の内訳に出席が入っていないため）。
    #    例外は**毎回小テストがある科目だけ**。成績には効かないが毎週の拘束は
    #    あるので「出席なし」からは外している。いま該当するのは
    #    083119 海事政策論 の1件（レポート100%＋毎回小テスト）。
    #    片方だけ直すと崩れる関係なので、機械に持たせておく。
    stray = [c["id"] for c in hit["レポートのみ"]
             if not server.CONDITIONS["出席なし"](c) and not c.get("weekly_quiz")]
    check(not stray,
          f"「レポートのみ」なのに「出席なし」でない（毎回小テストも無い）: {stray[:5]}")

    # ④ 内訳が最後まで分かっていない科目を、この2つに含めないこと。
    #    未分類の残りに出席や試験が隠れている可能性がある。
    for name in ("出席なし", "レポートのみ"):
        bad = [c["id"] for c in hit[name]
               if not c.get("eval_ratio") or c.get("eval_unclassified")]
        check(not bad, f"「{name}」に内訳の不完全な科目が入っている: {bad[:5]}")

    # ⑤ 0% はキーを落とす形で表れる（scrape/parse.py:152）。
    #    もし将来 0 を持つようになったら、判定を書き直す合図。
    zero = [c["id"] for c in courses
            for k in ("attendance", "exam", "report")
            if (c.get("eval_ratio") or {}).get(k) == 0]
    check(not zero,
          f"eval_ratio に 0% のキーが現れた（判定の前提が変わった）: {zero[:5]}")

    # ⑥ 「集中講義」は開講区分（term）で見る。class_format には該当値が無い。
    check(not any(c.get("class_format") == "集中講義" for c in courses),
          "class_format に '集中講義' が現れた（判定を見直すこと）")

print(f"  通過 {n - len(fails)} 件 / {n} 件")
for f in fails:
    print(f"  NG  {f}")
print("OK" if not fails else "NG")
sys.exit(1 if fails else 0)
