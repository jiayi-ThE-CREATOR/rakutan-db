"""科目ごとの静的ページ（web/c/<時間割コード>.html）の中身を確かめる。

    python3 tools/test_course_pages.py

見ているもの（決めごとの正本は pages.py の頭）:
  1. 焼き忘れ・消し忘れが無い（courses.built.json の id と web/c/ が1対1）
  2. title が全件で一意 ―― 「総合英語」204コマが同じ title にならない
     （曜限・教員、重なれば学期・時間割コードで分ける）
  3. 事実だけを載せる ―― 相性度・band・口コミの本文が入っていない
  4. 焼き直しても差分が出ない（lastmod などで毎回全ファイルが変わらない）
URL まわり（canonical・robots.txt・sitemap の件数）は test_index_gate.mjs の担当。
"""
import collections
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import pages  # noqa: E402

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


courses = json.loads(pages.BUILT.read_text(encoding="utf-8"))["courses"]
ids = {c["id"] for c in courses}
files = {p.stem: p for p in pages.OUT_DIR.glob("*.html")}

# 1. 1対1
check(set(files) == ids,
      f"web/c/ と built.json がずれている（焼き忘れ {len(ids - set(files))}／消し忘れ {len(set(files) - ids)}）"
      " ―― python3 pages.py を流す")

# 2. title の一意
titles = collections.Counter()
for cid, p in files.items():
    m = re.search(r"<title>(.*?)</title>", p.read_text(encoding="utf-8"))
    titles[m.group(1) if m else ""] += 1
dups = [t for t, k in titles.items() if k > 1]
check(not dups, f"title が重なっている {len(dups)} 組（例：{html.unescape(dups[0]) if dups else ''}）")

by_id = {c["id"]: c for c in courses}
for cid in list(files)[:1] + [c["id"] for c in courses if c["title"].startswith("総合英語")][:3]:
    c = by_id.get(cid)
    if not c:
        continue
    s = files[cid].read_text(encoding="utf-8")
    t = html.unescape(re.search(r"<title>(.*?)</title>", s).group(1))
    check(t.startswith(c["title"]), f"{cid}: title が科目名から始まっていない（{t}）")
    if pages.instructors(c):
        check(pages.instructors(c)[0] in t, f"{cid}: title に教員名が無い（{t}）")
    check(pages.slot_label(c) in t, f"{cid}: title に曜限が無い（{t}）")

# 3. 事実だけ
notes = {nt for c in courses for nt in ((c.get("reviews") or {}).get("notes") or []) if len(nt) >= 4}
leaked_score, leaked_note = [], []
for cid, p in files.items():
    s = p.read_text(encoding="utf-8")
    if "相性度" in s or "rakutan" in s:
        leaked_score.append(cid)
    rv = by_id.get(cid, {}).get("reviews") or {}
    if any(html.escape(nt) in s for nt in (rv.get("notes") or []) if len(nt) >= 4):
        leaked_note.append(cid)
check(not leaked_score, f"相性度が載っているページ {len(leaked_score)} 件（例 {leaked_score[:3]}）")
check(not leaked_note, f"口コミの本文が載っているページ {len(leaked_note)} 件（未登録には伏せる約束 #168）")
check(len(notes) > 0, "口コミの一言が1件も無い ―― 3 の検査が素通りしている")

# 4. 焼き直しで差分が出ない
before = {cid: p.read_bytes() for cid, p in files.items()}
sm_before = pages.SITEMAP.read_bytes()
pages.build_pages()
changed = [cid for cid, b in before.items() if (pages.OUT_DIR / f"{cid}.html").read_bytes() != b]
check(not changed, f"焼き直しただけで {len(changed)} ページが変わった（{changed[:3]}）")
check(pages.SITEMAP.read_bytes() == sm_before, "焼き直しただけで sitemap-courses.xml が変わった")

if fails:
    print(f"FAIL {len(fails)}/{n}")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"OK {n} checks（{len(files)} ページ）")
