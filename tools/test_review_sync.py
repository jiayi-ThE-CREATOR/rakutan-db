#!/usr/bin/env python3
"""毎朝の口コミの取り込み（tools/review_sync.py）。D1 は SQLite（db/schema.sql）で代わりにする。

    python3 tools/test_review_sync.py

守りたいこと:
  ・受け箱の1行（新しい質問・古い質問のどちらも）が、シートからの取り込みと同じ形に整う
  ・取り込んだら done=1。同じ口コミ（科目・日付・一言が同じ）は2回入れない
  ・hidden=1 の行は reviews.json で publish:false（一言だけ伏せる。行は残す）
  ・D1 の reviews が空なら reviews.json を上書きしない
"""
from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import review_sync as rs  # noqa: E402

ok = 0
fail: list[str] = []


def eq(got, want, what):
    global ok
    if got == want:
        ok += 1
    else:
        fail.append(f"{what}\n      期待 {want!r}\n      実際 {got!r}")


class FakeD1:
    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))

    def q(self, sql, params=None):
        cur = self.db.execute(sql, params or [])
        self.db.commit()
        return [dict(r) for r in cur.fetchall()]


AT = 1792800000000  # 2026-10-23 JST あたり
v5 = {"grade": "1年", "subject": {"id": "135337", "name": "数理科学 I", "review": {
      "form_v": 5, "yearTaken": "2026年度", "exam": "可", "comment": "簡単",
      "items": {"exam": 2, "report": 0, "attendance": 0, "quiz": 1, "presentation": 0}}}}
old = {"subject": {"id": "81001", "review": {
       "yearTaken": "2025年度", "attendance": "毎回", "assignmentInClass": "軽い", "assignmentOutClass": "なかった",
       "examPresence": "あり", "exam": "不可", "examDifficulty": "7", "reportPresence": "なし", "comment": ""}}}

r5 = rs.ingest.normalize(rs.payload_to_row(v5, AT))
eq((r5["v"], r5["course_id"], r5["items"]["exam"], r5["exam_bring"], r5["note"], r5["taken_year"]),
   (5, "135337", 2, "可", "簡単", 2026), "新しい質問の行が整わない")
ro = rs.ingest.normalize(rs.payload_to_row(old, AT))
eq((ro["course_id"], ro["attendance"], ro["in_class"], ro["exam"], ro["exam_hard10"], ro["taken_year"]),
   ("081001", 2, 0, True, 7, 2025), "古い質問の行が整わない（科目コードの先頭の0も戻す）")
eq(rs.payload_to_row(v5, AT)["date"], rs.datetime.fromtimestamp(AT / 1000, rs.JST).strftime("%m-%d"), "日付が JST でない")

# ── main() を SQLite で通す ──
fake = FakeD1()
fake.q("INSERT INTO reviews (id, row, hidden, src) VALUES ('j1', ?, 0, NULL)",
       [json.dumps({"course_id": "135001", "at": "09-01", "note": "旧", "attendance": 1})])
fake.q("INSERT INTO review_inbox (id, at, course_id, payload) VALUES ('a1', ?, '135337', ?)", [AT, json.dumps(v5)])
fake.q("INSERT INTO review_inbox (id, at, course_id, payload) VALUES ('a2', ?, '135337', ?)", [AT, json.dumps(v5)])  # 同じ口コミ
fake.q("INSERT INTO review_inbox (id, at, course_id, payload, hidden) VALUES ('a3', ?, '081001', ?, 1)", [AT, json.dumps(old)])

tmp = Path(tempfile.mkdtemp())
rs.ingest.OUT = tmp / "reviews.json"
rs.ingest.AGG_WRITE = None
written_agg = []
rs.ingest._write_agg = lambda: written_agg.append(True)
rs.D1 = lambda *a, **k: fake
rs.database_id = lambda: "x"
import os
os.environ.update({"CF_ACCOUNT_ID": "a", "CF_D1_TOKEN": "t"})
sys.argv = ["review_sync.py"]
rs.main()

rows = {r["id"]: r for r in fake.q("SELECT id, row, hidden, src FROM reviews")}
eq(sorted(rows), ["ia1", "ia3", "j1"], "取り込まれた行が違う（同じ口コミを2回入れた／入れなかった）")
eq([r["done"] for r in fake.q("SELECT done FROM review_inbox ORDER BY id")], [1, 1, 1], "受け箱が done にならない")
out = json.loads(rs.ingest.OUT.read_text(encoding="utf-8"))
eq(len(out), 3, "reviews.json の行数")
hid = [r for r in out if r.get("course_id") == "081001"]
eq((len(hid), hid[0].get("publish")), (1, False), "不公開の行が publish:false にならない（行は残す）")
eq(written_agg, [True], "集計（reviews.agg.json）を書き直していない")

# 2回目：新しいものが無ければ何も足さない
rs.main()
eq(len(fake.q("SELECT id FROM reviews")), 3, "2回目の取り込みで行が増えた")

# 空なら上書きしない
empty = FakeD1()
rs.D1 = lambda *a, **k: empty
try:
    rs.main()
    eq("上書きした", "止まる", "D1 reviews が空なのに reviews.json を上書きした")
except SystemExit as e:
    eq("空です" in str(e), True, "空のときの止まり方")

if fail:
    print("NG")
    for f in fail:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {ok} 件")
print("OK")
