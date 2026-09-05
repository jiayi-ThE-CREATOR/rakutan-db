"""配点でしぼる（上限フィルタ）と、小テストを独立させた採点のテスト。ネットワークには出ない。

■ なぜこれが要るか
`scrape/parse.py` は小テストの配点を算出しておきながら、出席へ足し込んで
捨てていた（`buckets["attendance"] += buckets.pop("quiz")`）。
そのため「小テストが成績の30%」という事実が画面に出せず、
チップ「小テストなし」も `weekly_quiz`（本文の正規表現）だけで判定していた。

上限フィルタは**科目を落とす**ので、間違うと「あるはずの科目が消える」。
消えたことは画面からは分からないので、件数を機械に数えさせておく。

  python3 tools/test_haiten_filter.py

設計は docs/plans/2026-09-03-haiten-filter-design.md
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import score as scoring  # noqa: E402
from tools.rebucket import rebucket  # noqa: E402

BUILT = ROOT / "web" / "data" / "courses.built.json"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


# ── ① 小テストは独立したバケツになる ──────────────────────
# 出席へ足し込むと「毎週の小テストがある科目」と「毎週出席を取る科目」が
# 区別できない。学生にとっては別の負担なので、別の軸として出す。
ratio, unclassified = rebucket({"小テスト": 30.0, "期末試験": 70.0})
check(ratio == {"quiz": 30.0, "exam": 70.0},
      f"小テストが quiz として独立していない: {ratio}")
check(unclassified is None, f"振り分けられない項目は無いはず: {unclassified}")

# 出席と小テストが両方ある科目で、混ざらないこと。
ratio, _ = rebucket({"小テスト": 20.0, "出席": 30.0, "レポート": 50.0})
check(ratio == {"quiz": 20.0, "attendance": 30.0, "report": 50.0},
      f"出席と小テストが混ざっている: {ratio}")

# 0% の軸はキーごと落とす（現行どおり。「キーが無い＝0%」）。
ratio, _ = rebucket({"期末試験": 100.0})
check(ratio == {"exam": 100.0}, f"0%の軸がキーとして残っている: {ratio}")

# 合計は分離の前後で変わらない（足す先が変わるだけ）。
ratio, _ = rebucket({"小テスト": 30.0, "出席": 20.0, "期末試験": 50.0})
check(abs(sum(ratio.values()) - 100.0) < 0.01,
      f"分離で合計が変わっている: {sum(ratio.values())}")


# ── ② 上限フィルタ ────────────────────────────────
# caps は {軸キー: 0〜100}。「その配点が cap% 以下の科目だけ通す」。
KNOWN = {"eval_ratio": {"exam": 60.0, "quiz": 20.0, "attendance": 20.0},
         "eval_unclassified": None}
NO_RATIO = {"eval_ratio": None, "eval_unclassified": None}
UNCLASSIFIED = {"eval_ratio": {"exam": 60.0},
                "eval_unclassified": {"その他": 40.0}}
NO_CAP = {"attendance": 100, "exam": 100, "quiz": 100, "report": 100}

# 上限なし（既定）では何も落とさない ―― 配点が読めない科目も含めて。
for name, c in (("配点あり", KNOWN), ("配点なし", NO_RATIO),
                ("未分類あり", UNCLASSIFIED)):
    check(scoring.passes_caps(c, NO_CAP) is True,
          f"上限100%なのに {name} が落ちた")

# 上限を超える軸が1つでもあれば落とす。
check(scoring.passes_caps(KNOWN, {**NO_CAP, "exam": 50}) is False,
      "期末60%の科目が「期末50%以下」を通ってしまった")
check(scoring.passes_caps(KNOWN, {**NO_CAP, "exam": 60}) is True,
      "ちょうど上限（60%≦60%）の科目が落ちた")
check(scoring.passes_caps(KNOWN, {**NO_CAP, "report": 0}) is True,
      "レポート0%の科目が「レポート0%以下」で落ちた（キーが無い＝0%）")
check(scoring.passes_caps(KNOWN, {**NO_CAP, "quiz": 0}) is False,
      "小テスト20%の科目が「小テスト0%」を通ってしまった")

# 上限を1本でも動かしたら、配点が最後まで読めない科目は通さない。
# ズレは必ず「実際より楽に見える」方向に出るので、証明できるものだけ通す
# （score.py の EVAL_TOTAL_MIN と同じ判断）。
for name, c in (("配点なし", NO_RATIO), ("未分類あり", UNCLASSIFIED)):
    check(scoring.passes_caps(c, {**NO_CAP, "attendance": 90}) is False,
          f"上限を動かしたのに {name} の科目が残った")

# 4本の上限の合計が100%を下回ると、成績評価の合計が100%である以上
# 通る科目は原理的に存在しない。これは実装ミスではなく仕様の性質。
check(scoring.caps_impossible({"attendance": 20, "exam": 20,
                               "quiz": 20, "report": 20}) is True,
      "合計80%が「不可能」と判定されていない")
check(scoring.caps_impossible(NO_CAP) is False,
      "上限なしが「不可能」と判定された")
check(scoring.caps_impossible({"attendance": 0, "exam": 100,
                               "quiz": 0, "report": 0}) is False,
      "合計ちょうど100%が「不可能」と判定された")


# ── ③ 小テストは採点の第5軸になる ──────────────────────
check("quiz" in scoring.AXIS_LABEL, "AXIS_LABEL に quiz が無い")
check([k for k, _, _ in scoring.AXES].count("quiz") == 1,
      "AXES に quiz 軸が無い")

# 重みの合計は 1.0 のまま（AXIS_FLOOR×4 + AXIS_SHARE + SCALE_WEIGHT）。
for er in ({"exam": 100.0},
           {"exam": 25.0, "report": 25.0, "attendance": 25.0, "quiz": 25.0},
           {}):
    w = scoring.dynamic_weights({"eval_ratio": er})
    check(abs(sum(w.values()) - 1.0) < 1e-9,
          f"重みの合計が1.0でない（eval_ratio={er}）: {sum(w.values())}")
    check("quiz" in w, f"重みに quiz が無い（eval_ratio={er}）")

# 毎回の小テストの負担は小テスト軸が持つ。出席軸はもう二重に数えない。
_, why = scoring._attendance_load({"eval_ratio": {"attendance": 20.0},
                                   "weekly_quiz": True})
check(not any("小テスト" in s for s in why),
      f"出席軸がまだ小テストを負担として数えている: {why}")
quiz_v, quiz_why = scoring._quiz_load({"eval_ratio": {"quiz": 30.0},
                                       "weekly_quiz": True})
check(quiz_v is not None and quiz_why,
      "小テスト軸が値も根拠も返していない")
# 小テストが無い科目は「負担ゼロ＝満点」であって「不明」ではない。
none_v, _ = scoring._quiz_load({"eval_ratio": {"exam": 100.0},
                                "weekly_quiz": False})
check(none_v == 100.0, f"小テストなしの科目が満点でない: {none_v}")
# 配点そのものが読めない科目は「不明」。満点にしてはいけない。
unknown_v, _ = scoring._quiz_load({"eval_ratio": None, "weekly_quiz": None})
check(unknown_v is None, f"配点不明なのに小テスト軸に値が付いた: {unknown_v}")


# ── ④ 焼き上がりの実データに対する見張り ────────────────
if BUILT.is_file():
    courses = json.loads(BUILT.read_text(encoding="utf-8"))["courses"]

    quiz_courses = [c for c in courses
                    if (c.get("eval_ratio") or {}).get("quiz")]
    check(len(quiz_courses) > 1000,
          f"小テストの配点を持つ科目が少なすぎる: {len(quiz_courses)}件"
          "（eval_raw からの実測では約1,433件）")

    # 上限なしなら全件通る。
    passed = sum(1 for c in courses if scoring.passes_caps(c, NO_CAP))
    check(passed == len(courses),
          f"上限なしなのに {len(courses) - passed} 件落ちた")

    # 上限を動かすと、配点が読めない科目は必ず外れる。
    unknown = [c for c in courses
               if not c.get("eval_ratio") or c.get("eval_unclassified")]
    leaked = [c for c in unknown
              if scoring.passes_caps(c, {**NO_CAP, "attendance": 90})]
    check(not leaked,
          f"配点が読めない科目が上限フィルタを通っている: {len(leaked)}件")

    # ── band が「軽い側」へ膨らんでいないこと ─────────────
    # 軸を1本足すと、その軸が満点になる科目（小テストなしの6,473件）の
    # 総合値が機械的に上がる。band のしきい値は**旧い分布に合わせた定数**
    # なので、そのままだと「新しい根拠は何も無いのに軽い判定が増える」。
    # 実測では 4軸→5軸 で全3,602件が上がり、下がった科目は0件だった。
    # 順位はほぼ動いていない（3群とも中央値で0.6ポイント未満）ので、
    # しきい値のほうを分布に合わせ直す。
    #
    # 参照値は 5軸化の直前（コミット 9669949）の courses.built.json 実測。
    # 判定できた3,605件に占める割合:
    REF = {"軽い": 0.735, "標準": 0.124, "やや重め": 0.107, "重め": 0.034}
    TOL = 0.03
    judged = [c["rakutan"]["overall"] for c in courses
              if c["rakutan"]["overall"] is not None]
    L, N_, H = scoring.LIGHT_MIN, scoring.NORMAL_MIN, scoring.HEAVYISH_MIN
    share = {
        "軽い":     sum(1 for v in judged if v >= L) / len(judged),
        "標準":     sum(1 for v in judged if N_ <= v < L) / len(judged),
        "やや重め": sum(1 for v in judged if H <= v < N_) / len(judged),
        "重め":     sum(1 for v in judged if v < H) / len(judged),
    }
    for name, ref in REF.items():
        check(abs(share[name] - ref) <= TOL,
              f"band「{name}」の割合が 5軸化の前より {abs(share[name]-ref)*100:.1f}"
              f"ポイント動いた（{ref*100:.1f}% → {share[name]*100:.1f}%）"
              " ― band_of のしきい値を分布に合わせ直すこと")

    # しきい値の定数そのものが、上で数えた区切りと一致していること
    # （片方だけ直すと、テストは通るのに画面のラベルがズレる）。
    check(scoring.band_of(L, "high") == "軽め", f"{L} が軽めでない")
    check(scoring.band_of(L - 1, "high") == "標準", f"{L-1} が標準でない")
    check(scoring.band_of(N_, "high") == "標準", f"{N_} が標準でない")
    check(scoring.band_of(N_ - 1, "high") == "やや重め", f"{N_-1} がやや重めでない")
    check(scoring.band_of(H, "high") == "やや重め", f"{H} がやや重めでない")
    check(scoring.band_of(H - 1, "high") == "重め", f"{H-1} が重めでない")

    # 「小テスト0%」で残る件数が、チップ「小テストなし」相当まで増えていること。
    q0 = [c for c in courses if scoring.passes_caps(c, {**NO_CAP, "quiz": 0})]
    check(len(q0) > 5000,
          f"小テスト0%の件数が少なすぎる: {len(q0)}件（実測見込み 5,928件）")
else:
    check(False, "web/data/courses.built.json が無い")


# ── ⑤ 条件チップとスライダーは同じ1つの状態を指す ──────────
# チップ「出席なし」は「出席率スライダーを0%にした状態」と**同義**にする。
# 別々に持つと、片方を押したときにもう片方が食い違う。
# server.py の CONDITIONS と web/assets/app.js の CONDITIONS の両方が
# この対応を守ること（片方だけ直さない）。
import contextlib  # noqa: E402
import io  # noqa: E402

with contextlib.redirect_stdout(io.StringIO()):
    import server  # noqa: E402

if BUILT.is_file():
    CHIP_TO_CAPS = {
        "出席なし":     {"attendance": 0},
        "小テストなし": {"quiz": 0},
        "レポートのみ": {"exam": 0, "attendance": 0, "quiz": 0},
    }
    for chip, caps in CHIP_TO_CAPS.items():
        fn = server.CONDITIONS[chip]
        full = {**NO_CAP, **caps}
        by_chip = {c["id"] for c in courses if fn(c)}
        by_caps = {c["id"] for c in courses if scoring.passes_caps(c, full)}
        check(by_chip == by_caps,
              f"チップ「{chip}」とスライダー {caps} が食い違う: "
              f"チップだけ {len(by_chip - by_caps)}件 / "
              f"スライダーだけ {len(by_caps - by_chip)}件")

    # 「小テストなし」は weekly_quiz（本文の正規表現）ではなく配点で判定する。
    # 本文に「毎回小テスト」と書いてあっても配点が0%なら、成績には効かない。
    q0 = {c["id"] for c in courses if server.CONDITIONS["小テストなし"](c)}
    check(len(q0) > 5000,
          f"チップ「小テストなし」の件数が少なすぎる: {len(q0)}件")


# ── ⑥ 判定できない理由の文言 ────────────────────────
# 内訳そのものが取れていない科目に「口コミが集まれば出ます」と言ってはいけない。
# 足りないのはシラバスの表であって口コミではないので、待っても出ない。
no_breakdown = scoring.match({"overall": None, "eval_captured": None,
                              "axes": {}, "coverage": 0.0})
check("口コミ" not in no_breakdown["reason"],
      f"内訳が無い科目に口コミ待ちと言っている: {no_breakdown['reason']}")
partial = scoring.match({"overall": None, "eval_captured": 100.0,
                         "axes": {}, "coverage": 0.5})
check("口コミ" in partial["reason"],
      f"口コミで埋まる科目に口コミの話が無い: {partial['reason']}")


print(f"{n - len(fails)}/{n} 件が通過")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
