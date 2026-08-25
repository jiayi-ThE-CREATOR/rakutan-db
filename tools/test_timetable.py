"""口コミ投稿の時間割が読む web/data/timetable.json の検算。ネットワークには出ない。

■ ここが守るもの
timetable.json は courses.built.json から build.py が焼く投影。
片方だけ焼き直すと、時間割にだけ古い科目が残る（しかも画面は正常に見える）。
**同じ元データから作り直して1バイト単位で一致するか**を毎回確かめる。

  python3 tools/test_timetable.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / "web" / "data" / "courses.built.json"
TT = ROOT / "web" / "data" / "timetable.json"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


check(TT.is_file(), "web/data/timetable.json が無い（python3 build.py を流す）")

if TT.is_file() and BUILT.is_file():
    rows = json.loads(TT.read_text(encoding="utf-8"))
    courses = json.loads(BUILT.read_text(encoding="utf-8"))["courses"]

    # ① courses.built.json から作り直して一致すること
    rebuilt = build.timetable_rows(courses)
    check(rows == rebuilt,
          "timetable.json が courses.built.json と食い違っている"
          f"（{len(rows)} 件 vs 作り直し {len(rebuilt)} 件）。python3 build.py を流す")

    # ② 曜限が入っているなら必ず月〜金の1〜6限（グリッドに置ける形）
    bad = [r["id"] for r in rows
           if any(s[0] not in "月火水木金" or s[1] not in "123456" for s in r["slots"])]
    check(not bad, f"グリッドに置けない曜限が slots に入っている: {bad[:5]}")

    # ③ 全科目が入っていること。マス無し（集中講義・土曜）を落とすと、
    #    その科目は永久に口コミが付けられなくなる（理学部は667件中443件がこちら）
    check(len(rows) == len(courses),
          f"科目が落ちている: 投影 {len(rows)} 件 / 元 {len(courses)} 件")
    slotless = [r for r in rows if not r["slots"]]
    check(all(r["day_period"] for r in slotless),
          "マス無しの科目に day_period の原文が入っていない（画面が理由を出せない）")
    check(len(slotless) == 1069,
          f"マス無しの件数が変わった: {len(slotless)} 件（前回 1,069 件）")

    # ④ 学部が空の科目は画面に出ない。1件でもあれば穴
    check(all(r["faculty"] for r in rows),
          "faculty が None の科目がある（tools/faculty.py の割り当て漏れ）")

    # ⑤ 学部キーは要件表と1対1（画面の学部セレクトは要件表から作る）
    req = ROOT / "web" / "data" / "requirements.json"
    if req.exists():
        known = {f["key"] for f in json.loads(req.read_text(encoding="utf-8"))["faculties"]}
        used = {r["faculty"] for r in rows} - {"common"}
        check(used <= known, f"要件表に無い学部キー: {sorted(used - known)}")

    # ⑥ 学期は app.js と同じ4値。ここが増えると画面の絞り込みが素通りする
    check({r["term_group"] for r in rows} <= {"haru", "aki", "full", "unknown"},
          "term_group に知らない値がある")

    # ⑦ 投影に点数・口コミを混ぜない（混ぜた瞬間に正本が2つになる）
    extra = {k for r in rows[:200] for k in r} - {
        "id", "title", "instructor", "slots", "day_period",
        "term_group", "faculty", "eligible_years", "track"}
    check(not extra, f"投影に余計なフィールドがある: {sorted(extra)}")

print(f"  通過 {n - len(fails)} 件 / {n} 件")
for f in fails:
    print(f"  NG  {f}")
print("OK" if not fails else "NG")
sys.exit(1 if fails else 0)
