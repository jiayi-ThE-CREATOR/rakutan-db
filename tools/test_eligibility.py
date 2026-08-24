"""履修対象の抽出を確かめる。

ネットワークに出ない。詳細ページの HTML そのものではなく、
実測で出た値（2026-08-24・16件）を最小の表に埋めて確かめる。
本物の HTML を使う分は data/raw/detail/ があるときだけ動く
（.gitignore なので、手元に無い人はその部分を飛ばす）。
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from tools.eligibility import extract_raw, parse_eligibility  # noqa: E402

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


def page(label_cell: str, value_cell: str | None = None) -> str:
    """詳細ページの該当部分だけを最小の表で再現する。"""
    if value_cell is None:
        return f"<table><tr><td>{label_cell}</td></tr></table>"
    return (f"<table><tr><td>{label_cell}</td>"
            f"<td>{value_cell}</td></tr></table>")


LABEL = "履修対象／Eligibility"

# ── 実測で出た値（2026-08-24・16件のサンプル）─────────────
cases = [
    ("全学部",                    True,  None),
    ("工（地1〜60）",              False, "工"),
    ("工（電1～95）",              False, "工"),   # 波ダッシュが半角チルダの回
    ("工（理）下3ケタ001～108",     False, "工"),
    ("工（然）",                   False, "工"),
]
for raw, is_all, faculty in cases:
    got = parse_eligibility(page(LABEL, raw))
    check(got is not None, f"{raw}: None が返った")
    if got:
        check(got["raw"] == raw, f"{raw}: raw が {got['raw']!r}")
        check(got["all_faculties"] is is_all,
              f"{raw}: all_faculties が {got['all_faculties']}（期待 {is_all}）")
        check(got["faculty"] == faculty,
              f"{raw}: faculty が {got['faculty']!r}（期待 {faculty!r}）")

# ── 空欄。値はあるが中身が無い ────────────────────────
got = parse_eligibility(page(LABEL, ""))
check(got == {"raw": "", "all_faculties": None, "faculty": None},
      f"空欄の扱いが {got}")

# ── 欄そのものが無い ────────────────────────────────
check(parse_eligibility(page("授業の目的と概要", "…")) is None,
      "欄が無いとき None を返していない")

# ── ラベルと値が同じセルに入っている形 ────────────────
check(extract_raw(page(f"{LABEL} 全学部")) == "全学部",
      "同一セル形式を読めていない")

# ── 学籍番号の範囲を faculty に混ぜていないこと ──────────
got = parse_eligibility(page(LABEL, "工（理）下3ケタ001～108"))
check(got["faculty"] == "工", "学科・学籍番号が faculty に混ざっている")
check("下3ケタ" in got["raw"], "raw から学籍番号の範囲が落ちている")

# ── 本物の HTML（あるときだけ）────────────────────────
detail = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "detail"
real = sorted(detail.glob("*.html")) if detail.is_dir() else []
for f in real:
    got = parse_eligibility(f.read_text(errors="replace"))
    check(got is not None, f"{f.name}: 実ページから欄を見つけられない")
    if got:
        check(got["raw"] != "", f"{f.name}: 値が空で返った")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {n} 件（実ページ {len(real)} 件を含む）")
print("OK")
