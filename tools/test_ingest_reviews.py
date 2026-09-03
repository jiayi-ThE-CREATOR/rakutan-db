#!/usr/bin/env python3
"""ingest_reviews.py が読める入力の形を固定する。

    python3 tools/test_ingest_reviews.py

フォームは 2026-08 にサイト内（/kuchikomi）へ移り、書き出しの形が変わった。
**旧フォームの書き出しも読めたまま**、新しい形も読めることを守る。
ここを落とすと、口コミが1件も点数に反映されないまま静かに止まる。
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ingest", ROOT / "tools" / "ingest_reviews.py")
ingest = importlib.util.module_from_spec(spec)
sys.modules["ingest"] = ingest
spec.loader.exec_module(ingest)

ok = 0
fail: list[str] = []


def eq(got, want, what: str) -> None:
    global ok
    if got == want:
        ok += 1
    else:
        fail.append(f"{what}\n      期待 {want!r}\n      実際 {got!r}")


def read(text: str, suffix: str) -> list[dict]:
    with tempfile.NamedTemporaryFile("w", suffix=suffix, encoding="utf-8", delete=False) as f:
        f.write(text)
        p = f.name
    return [ingest.normalize(r) for r in ingest.read_rows(p)]


# ── 新フォーム（v4・CSV・日本語ヘッダ） ─────────────────
V4 = """タイムスタンプ,学年,学期,学部,学科,科目コード,科目名,教員名,曜日,時限,受講年度,出欠,授業中の課題,授業外の課題,テスト,レポート有無,レポート字数,一言コメント
2026/08/29,1年,spring,工学部,応用理工学科,135425,スポーツ,藤田,月,2,2026年度,毎回,軽い,なかった,不可,あり,500,重かった
2026/08/31,1年,spring,sci,sci-all,135115,行動学の話題,坂口,水,1,2026年度,なし,ふつう,重い,,なし,,
"""

rows = read(V4, ".csv")
eq(len(rows), 2, "v4: 行数")

a = rows[0]
eq(a["course_id"], "135425", "v4: 科目コード → course_id")
eq(a["attendance"], 2, "v4: 出欠「毎回」→ 2")
eq(a["attendance_raw"], "毎回", "v4: 出欠の原文を残す")
eq(a["in_class"], 0, "v4: 授業中の課題「軽い」→ 0")
eq(a["out_class"], None, "v4: 授業外の課題「なかった」→ None（0 ではない）")
eq(a["exam"], True, "v4: テスト列が埋まっている＝テストあり")
eq(a["exam_bring"], "不可", "v4: テスト列は持ち込み可否として読む")
eq(a["exam_bring_raw"], "不可", "v4: 持ち込みの原文を残す")
eq(a["exam_hard10"], None, "v4: 難易度の列はシートに無い（埋めない）")
eq(a["report"], True, "v4: レポート有無「あり」→ True")
eq(a["report_words"], 500, "v4: レポート字数")
eq(a["note"], "重かった", "v4: 一言コメント → note")
eq(a["taken_year"], 2026, "v4: 受講年度「2026年度」→ 2026")
eq(a["at"], "08-29", "v4: タイムスタンプ → at（MM-DD）")

b = rows[1]
eq(b["exam"], False, "v4: テスト列が空＝テストなし")
eq(b["exam_bring"], None, "v4: テストなしなら持ち込みも無い")
eq(b["report"], False, "v4: レポート「なし」→ False")
eq(b["report_words"], None, "v4: 字数が空なら None")
eq(b["out_class"], 2, "v4: 授業外の課題「重い」→ 2")

# ── 列が増えた将来の v4（難易度・テスト有無が付いた形） ──
# しゅんやさんがシートに列を足したら、スクリプトを直さずに拾えること。
V4_NEXT = """タイムスタンプ,学年,学期,学部,学科,科目コード,科目名,教員名,曜日,時限,受講年度,出欠,授業中の課題,授業外の課題,テスト有無,テスト,テスト難易度,レポート有無,レポート字数,一言コメント
2026/09/05,1年,autumn,工学部,応用理工学科,135425,スポーツ,藤田,月,2,2026年度,毎回,軽い,なかった,あり,不可,7,なし,,
2026/09/05,1年,autumn,工学部,応用理工学科,135426,別の科目,鈴木,月,3,2026年度,毎回,軽い,なかった,なし,,,なし,,
"""
nxt = read(V4_NEXT, ".csv")
eq(nxt[0]["exam_hard10"], 7, "列が増えたら難易度を拾う（スクリプト修正なしで）")
eq(nxt[0]["exam"], True, "テスト有無の列があればそちらを優先する")
eq(nxt[1]["exam"], False, "テスト有無「なし」→ False")
eq(nxt[1]["exam_hard10"], None, "テストなしなら難易度は空のまま")

# ── 旧フォーム（Netlify・TSV・英語ヘッダ）も読めたまま ──
LEGACY = (
    "code\tattendance\tin_class\tout_class\texam\texam_bring\texam_hard10"
    "\treport\treport_words\tnote\ttaken_year\tdate\n"
    "135761\tなし\tなかった\t軽い\tあり\t不可\t1\tなし\t\tテストはほぼ宿題\t2026\t08-18\n"
)
old = read(LEGACY, ".tsv")
eq(len(old), 1, "旧: 行数")
eq(old[0]["course_id"], "135761", "旧: course_id")
eq(old[0]["exam"], True, "旧: exam 列は あり/なし のまま")
eq(old[0]["exam_bring"], "不可", "旧: 持ち込み")
eq(old[0]["exam_hard10"], 1, "旧: 難易度は残っている")
eq(old[0]["at"], "08-18", "旧: date → at")

if fail:
    print("NG")
    for f in fail:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {ok} 件")
print("OK")
