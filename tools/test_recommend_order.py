"""おすすめ順の第1キーが「検証ずみ」であることを固定する。

    python3 tools/test_recommend_order.py

守りたいのは1つ。**一番目立つ場所に「誰も難しさを確かめていない科目」を出さない。**
2026-08-26 まで、おすすめ上位371件は全部 needs_review（＝成績に試験があるのに
難しさの口コミが門を通っていない）だった。検証していないから薦めている状態で、
ROADMAP 5章の公開基準②「おすすめ上位100件が検証ずみ」が 0% だった。

順序の正本は build.py の preset_key()。同じ順序を server.py の search() と
web/assets/app.js の byFit も持っている（片方だけ直すと API モードと
静的モードで並びがズレる）ので、ここでは3つとも見張る。
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


built = json.loads((ROOT / "web/data/courses.built.json").read_text(encoding="utf-8"))
courses = {c["id"]: c for c in built["courses"]}


# ── 1. 焼いてある preset_top（LINE が読む順位）─────────────
for grade, presets in built["preset_top"].items():
    for name, ids in presets.items():
        seen_unverified = False
        for i in ids:
            unverified = bool((courses[i].get("rakutan") or {}).get("needs_review"))
            if unverified:
                seen_unverified = True
            elif seen_unverified:
                check(False, f"{grade}年 {name}: 検証ずみが未検証より後ろに出ている（{i}）")
                break

# ── 2. いまのロジックで組み直したら同じになるか ──────────
# （古いロジックで焼かれた built が混ざると、サイトと LINE で並びがズレる）
fresh = build.rank_presets(built["courses"])
for grade, presets in fresh.items():
    for name, ids in presets.items():
        check(built["preset_top"].get(grade, {}).get(name) == ids,
              f"{grade}年 {name}: 焼いてある preset_top が今のロジックと違う"
              "（python3 build.py --represet で組み直す）")

# ── 3. 3か所が同じ第1キーを持っているか ────────────────
server = (ROOT / "server.py").read_text(encoding="utf-8")
check(re.search(r'if sort == "fit":.*?needs_review', server, re.S),
      'server.py の sort=="fit" が needs_review を第1キーにしていない')

app = (ROOT / "web/assets/app.js").read_text(encoding="utf-8")
check("needs_review" in app.split("const byFit")[0].rsplit("const unverified", 1)[-1]
      or "unverified(a) - unverified(b)" in app,
      "app.js の byFit が needs_review を第1キーにしていない")

src = pathlib.Path(build.__file__).read_text(encoding="utf-8")
check("needs_review" in src.split("def preset_key")[1].split("def ")[0],
      "build.py の preset_key() が needs_review を見ていない")

print(f"NG {len(fails)}/{n}\n- " + "\n- ".join(fails) if fails else f"OK {n}件")
sys.exit(1 if fails else 0)
