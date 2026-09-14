"""シラバス本文の抽出（tools/extract_syllabus_text.py）のテスト。ネットワークには出ない。

■ なぜこれが要るか
「授業内容でしぼる」には、科目名だけでは足りない。
実例（`data/raw/detail/135063.html`）:

    開講科目名        【人文】ことばの学問入門
    授業サブタイトル   ことばの歴史                 ← 科目名には出てこない
    各回題目          動物のコミュニケーション／最初の語族／文字／言語の系統

科目名だけを AI に渡すと「ことば・語学」しか付かない。「歴史」を付けるには
サブタイトルと各回題目が要る ―― ユーザーインタビューで言われた
「科目名からは分からないのに中身が面白い授業」そのもの。

■ 実行
    python3 tools/test_syllabus_text.py

`data/raw/` は gitignore なので、HTML を持っていない環境では
「実ページ 0 件」で通る（tools/test_eligibility.py と同じ扱い）。

設計は docs/plans/2026-09-03-naiyou-tag-design.md
"""
import gzip
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.extract_syllabus_text import extract_one, run  # noqa: E402

RAW = ROOT / "data" / "raw" / "detail"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


pages = sorted(RAW.glob("*.html")) if RAW.is_dir() else []

# ── ① 3つのフィールドが取れること ──────────────────────
for path in pages:
    row = extract_one(path)
    check(row is not None, f"{path.name} から何も取れなかった")
    if row is None:
        continue
    check(row["id"] == path.stem,
          f"{path.name}: id が時間割コードと違う（{row['id']}）")
    check(isinstance(row["subtitle"], str), f"{path.name}: subtitle が文字列でない")
    check(isinstance(row["abstract"], str), f"{path.name}: abstract が文字列でない")
    check(isinstance(row["kaiji"], str), f"{path.name}: kaiji が文字列でない")
    # 本文を1文字も取れない科目があるなら、抽出のラベル名がズレている疑い。
    check(any((row["subtitle"], row["abstract"], row["kaiji"])),
          f"{path.name}: 本文3つがすべて空（ラベル名がズレていないか）")

# ── ② この機能が存在する理由そのもののケース ──────────────
target = RAW / "135063.html"
if target.is_file():
    row = extract_one(target)
    check(row["subtitle"] == "ことばの歴史",
          f"サブタイトルが取れていない: {row['subtitle']!r}")
    check("歴史" in row["abstract"],
          "「授業の目的と概要」から歴史の語が取れていない")
    check("言語の系統" in row["kaiji"],
          f"各回の題目が取れていない: {row['kaiji'][:60]!r}")
    # 科目名だけでは「歴史」に届かないことを、テストとして固定しておく。
    # ここが崩れたら、本文を集める理由そのものが変わったということ。
    check("歴史" not in "【人文】ことばの学問入門",
          "前提が変わっている（科目名に歴史が入っている）")

# ── ③ 書き出しは gzip した JSONL。1行1科目 ────────────────
if pages:
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "syllabus_text.jsonl.gz"
        wrote = run([RAW], out)
        check(wrote == len(pages), f"書き出した件数が違う: {wrote} / {len(pages)}")
        check(out.is_file(), "出力ファイルが無い")
        with gzip.open(out, "rt", encoding="utf-8") as f:
            rows = [json.loads(line) for line in f]
        check(len(rows) == len(pages), f"読み戻した件数が違う: {len(rows)}")
        check({r["id"] for r in rows} == {p.stem for p in pages},
              "読み戻した id の集合が入力と違う")
        # 全科目ぶんでも Discord に貼れる大きさに収まること（実測 gzip 3MB）。
        per = out.stat().st_size / len(rows)
        check(per * 7906 < 20 * 1024 * 1024,
              f"7,906件に換算すると {per * 7906 / 1024 / 1024:.1f}MB で大きすぎる")

# ── ③.5 英字を含む科目コード（2026-09-04 政岡さんの指摘） ──────
# 🚨 実データの id 7,906件のうち **324件は数字だけではない**（00Z008 等）。
# 数字だけを拾うと "00" に潰れ、324件が同じキーに重なって courses.built.json と
# 突き合わなくなる。外国語学部197・文学部53・医学部36・理学部26・医保9・薬3。
# **件数は7,600件などと出るので、渡された側は気づけない。**
#
# 正解はファイル名。fetch.py:74 が detail/{code}.html として保存し、
# parse.py:171 が同じ code を id にしている ―― 構造上ここが一致する。
with tempfile.TemporaryDirectory() as d:
    fake = Path(d) / "00Z008.html"
    fake.write_text(
        "<table>"
        "<tr><th>時間割コード</th><td>00Z008 (専攻科目)</td></tr>"
        "<tr><th>開講科目名</th><td>アラビア語学講義</td></tr>"
        "<tr><th>授業サブタイトル</th><td>語のかたち</td></tr>"
        "<tr><th>第2回</th><td>題目:形態論</td></tr>"
        "<tr><th>第10回</th><td>題目:統語論</td></tr>"
        "</table>", encoding="utf-8")
    row = extract_one(fake)
    check(row["id"] == "00Z008",
          f"英字を含む科目コードが切り詰められた: {row['id']!r}")
    check(row["title"] == "アラビア語学講義", "科目名が取れていない")
    # 各回の題目は回数の順（辞書の並び順ではない）。
    check(row["kaiji"] == "題目:形態論 / 題目:統語論",
          f"各回が回数順になっていない: {row['kaiji']!r}")

# ── ③.6 取得先ディレクトリは複数指定できる ────────────────
# 8/25 に全所属を取ったとき、所属ごとに分けて保存されている:
#   data/raw/detail（共通教育1,111）/ data/raw/lang/detail（語学1,165）
#   data/raw/f00〜f10/detail（学部の専門5,630）
# 1か所しか見ないと 1,112件で終わる。scrape/parse.py と同じ --raw の形にする。
with tempfile.TemporaryDirectory() as d:
    a, b = Path(d) / "a" / "detail", Path(d) / "b" / "detail"
    for i, dd in ((1, a), (2, b)):
        dd.mkdir(parents=True)
        (dd / f"0000{i}.html").write_text(
            f"<table><tr><th>開講科目名</th><td>科目{i}</td></tr>"
            f"<tr><th>授業の目的と概要</th><td>概要{i}</td></tr></table>",
            encoding="utf-8")
    out = Path(d) / "out.jsonl.gz"
    wrote = run([a, b], out)
    check(wrote == 2, f"2ディレクトリぶん書けていない: {wrote}")
    with gzip.open(out, "rt", encoding="utf-8") as f:
        got = {json.loads(line)["id"] for line in f}
    check(got == {"00001", "00002"}, f"読み戻した id が違う: {got}")


# ── ④ 出力は公開リポジトリに入れない ─────────────────────
# シラバス原文なので data/courses.json と同じ扱い。追跡すると
# 「公開できないデータ」の線を越える（.gitignore の先頭コメント参照）。
ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
check("data/syllabus_text.jsonl.gz" in ignore,
      "data/syllabus_text.jsonl.gz が .gitignore に入っていない")

print(f"{n - len(fails)}/{n} 件が通過（実ページ {len(pages)} 件）")
for m in fails:
    print("  ✗", m)
sys.exit(1 if fails else 0)
