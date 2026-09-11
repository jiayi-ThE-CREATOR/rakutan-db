"""レポート軸のテスト。ネットワークには出ない。

    python3 tools/test_report_axis.py

設計は docs/superpowers/specs/2026-09-11-report-axis-ratio-design.md
"""
import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import score as scoring  # noqa: E402

BUILT = ROOT / "web" / "data" / "courses.built.json"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


# ── ① 割合だけでも値が出る ────────────────────────────
# 本数・分量が無いときに軸ごと None を返していたため、全7,906件の98%で
# レポート軸が動かず、科目ごと「情報不足」に落ちていた（4,121件）。
v, _ = scoring._report_load({"eval_ratio": {"report": 80.0, "exam": 20.0}})
check(v is not None, "割合だけの科目でレポート軸が None のまま")
check(v is not None and abs(v - 64.0) < 0.01,
      f"レポートが成績の80%なら 100-80*0.45=64 のはず: {v}")

# ── ② 割合が増えるほど軽さは単調に下がる ──────────────
seq = [scoring._report_load({"eval_ratio": {"report": r}})[0]
       for r in (0, 20, 50, 80, 100)]
check(all(a > b for a, b in zip(seq, seq[1:])),
      f"割合が増えても軽さが下がっていない: {seq}")

# ── ③ 内訳そのものが読めない科目は None のまま ────────
# 勝手に満点にすると「重い科目を軽いと言う」方向にだけ外れる。
v, _ = scoring._report_load({})
check(v is None, "内訳が無い科目に点が付いている")

# ── ④ report キーが無いのは「0%」であって「不明」ではない ──
# 出席軸・小テスト軸と同じ扱い。内訳は読めていて、そこにレポートが
# 無いのだから、レポートの負担はゼロだと読み取れている。
v, _ = scoring._report_load({"eval_ratio": {"exam": 100.0}})
check(v == 100.0, f"レポートが内訳に無い科目は満点のはず: {v}")

# ── ⑤ 量が取れている科目では従来の加算が効く（回帰防止）──
# 詳細ページを全件取得した日に、式を書き換えずに精度が上がるようにしておく。
base, _ = scoring._report_load({"eval_ratio": {"report": 50.0}})
withc, _ = scoring._report_load({"eval_ratio": {"report": 50.0},
                                 "report_count": 3})
check(withc < base, f"report_count が効いていない: {base} → {withc}")
withw, _ = scoring._report_load({"eval_ratio": {"report": 50.0},
                                 "report_words": 8000})
check(withw < base, f"report_words が効いていない: {base} → {withw}")
withh, _ = scoring._report_load({"eval_ratio": {"report": 50.0},
                                 "out_of_class_hours": 4})
check(withh < base, f"out_of_class_hours が効いていない: {base} → {withh}")

# ── ⑥ 形しか測っていないことを evidence に書く ────────
# 「レポート40%」が1本2,000字なのか5本1万字なのかは区別できない。
_, why = scoring._report_load({"eval_ratio": {"report": 60.0}})
check(any("形" in w for w in why),
      f"形だけで判定していることが evidence に無い: {why}")

# ── ⑦ 実データで「情報不足」が解消していること ────────
if BUILT.exists():
    raw = json.loads(BUILT.read_text(encoding="utf-8"))
    rows = raw["courses"] if isinstance(raw, dict) else raw
    b = collections.Counter(scoring.score(c)["band"] for c in rows)
    judged = sum(v for k, v in b.items() if k not in ("情報不足", "判定不可"))
    check(b["情報不足"] < 500,
          f"情報不足が多すぎる（4,121件の状態に戻った疑い）: {b['情報不足']}")
    check(judged > 7000, f"判定できた件数が少なすぎる: {judged}")

    # ── ⑧ 1つの band に偏っていないこと ──────────────
    # 改修前は判定できた 3,638 件の 72% が「拘束は軽い」だった。点数が
    # 出ていても、全部が同じ札なら科目を分別できていない。
    biggest = max(v for k, v in b.items()
                  if k not in ("情報不足", "判定不可"))
    check(biggest / judged < 0.35,
          f"1つの band に偏っている: {b.most_common()}")

print(f"{n - len(fails)}/{n} 件が通過")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
