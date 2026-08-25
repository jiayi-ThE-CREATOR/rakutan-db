#!/usr/bin/env python3
"""reviews.py の集計と公開形の検査。

    python3 tools/test_reviews.py

pytest は入れていない（依存を増やさない方針）。stdlib だけで動く。
ここで守りたいのは2つ:
  ・平均が消してしまう「意見の食い違い」を conflicts が拾えていること
  ・publish:false が本文だけを落とし、件数と数値は残すこと
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import reviews  # noqa: E402

ok = 0
fail: list[str] = []


def eq(got, want, what: str) -> None:
    global ok
    if got == want:
        ok += 1
    else:
        fail.append(f"{what}\n      期待 {want!r}\n      実際 {got!r}")


def rv(cid="X", **kw) -> dict:
    base = {"course_id": cid, "attendance": None, "in_class": None,
            "out_class": None, "exam_hard10": None, "exam_bring": None,
            "report_words": None, "report": False, "note": None, "at": "08-18"}
    return {**base, **kw}


# ── conflicts ────────────────────────────────────────────
# 「出席なし」と「毎回」の平均は「たまに」。誰も経験していない値が出る。
# 潰したことが分かるように、割れた項目名を集計に残す。
a = reviews.aggregate([rv(attendance=0), rv(attendance=2)])["X"]
eq(a["conflicts"], ["attendance"], "0 と 2 は割れとして拾う")
eq(round(a["attendance"], 3), 1.0, "平均そのものは今まで通り出す")

# 隣り合う回答は割れではない。ここを割れ扱いにすると全科目に⚠が付く。
a = reviews.aggregate([rv(attendance=1), rv(attendance=2)])["X"]
eq(a["conflicts"], [], "1 と 2 は割れとしない")

# 10段階は幅で見る。2 と 7 は明らかに別の授業の話をしている。
a = reviews.aggregate([rv(exam_hard10=2), rv(exam_hard10=7)])["X"]
eq(a["conflicts"], ["exam_hard10"], "難易度の開き 5 は割れ")
a = reviews.aggregate([rv(exam_hard10=5), rv(exam_hard10=7)])["X"]
eq(a["conflicts"], [], "難易度の開き 2 は割れとしない")

# 持ち込みは可否が割れたら即。年度で変わったか、どちらかの記憶違い。
a = reviews.aggregate([rv(exam_bring="可"), rv(exam_bring="不可")])["X"]
eq(a["conflicts"], ["exam_bring"], "持ち込みの可否が違えば割れ")
a = reviews.aggregate([rv(exam_bring="可"), rv(exam_bring=None)])["X"]
eq(a["conflicts"], [], "無回答は割れに数えない")

# 1件しかなければ割れようがない
a = reviews.aggregate([rv(attendance=0)])["X"]
eq(a["conflicts"], [], "1件なら割れなし")

# 複数項目が割れたら全部出す（順序は安定させる）
a = reviews.aggregate([rv(attendance=0, out_class=2),
                       rv(attendance=2, out_class=0)])["X"]
eq(a["conflicts"], ["attendance", "out_class"], "割れた項目を全部返す")


# ── publish:false ────────────────────────────────────────
# 落とすのは本文だけ。件数と数値は採点に効かせ続ける。
rows = [rv(attendance=2, exam_hard10=8, note="出せない話", publish=False)]
a = reviews.aggregate(rows)["X"]
eq(a["n"], 1, "publish:false でも件数は減らない")
eq(a["notes"], [], "publish:false の本文は集計から消える")
eq(a["exam_hard10"], 8.0, "publish:false でも数値は残る")

p = reviews.public_rows(rows)["X"]
eq(len(p), 1, "publish:false でも行は残る")
eq(p[0]["note"], None, "publish:false の本文は公開形でも消える")
eq(p[0]["exam_hard10"], 8, "publish:false でも数値は公開形に出る")


# ── public_rows の形と並び ───────────────────────────────
p = reviews.public_rows([
    rv(taken_year=2024, note="古い"),
    rv(taken_year=2026, note="新しい"),
    rv(taken_year=2025, note="中間"),
])["X"]
eq([r["note"] for r in p], ["新しい", "中間", "古い"], "受講年の新しい順に並ぶ")

# 受講年を答えていない行は最後。無回答を最新に見せない。
p = reviews.public_rows([rv(taken_year=None, note="不明"),
                         rv(taken_year=2024, note="2024")])["X"]
eq([r["note"] for r in p], ["2024", "不明"], "受講年なしは末尾")

# at は投稿日であって受講時期ではない。混同されるので公開形には出さない。
p = reviews.public_rows([rv(taken_year=2026)])["X"]
eq("at" in p[0], False, "at は公開形に含めない")
# 公開形に足すということは、公開リポジトリの reviews.built.json に
# その値が載るということ。増やすときは必ずここも直す（＝一度立ち止まる）。
# grade（書いた人のいまの学年）は 2026-08-26 に追加。
eq(sorted(p[0]), sorted(["taken_year", "taken_year_before", "attendance",
                         "in_class", "out_class", "exam_hard10", "exam_bring",
                         "report_words", "note", "grade"]), "公開形のキーは固定")

# 「それ以前」を選んだ行。境界の年と、それ以前であることを別々に持つ。
p = reviews.public_rows([rv(taken_year=2023, taken_year_before=True)])["X"]
eq(p[0]["taken_year_before"], True, "それ以前フラグが立つ")
p = reviews.public_rows([rv(taken_year=2026)])["X"]
eq(p[0]["taken_year_before"], False, "既定は False（キーは必ずある）")

eq(reviews.public_rows([]), {}, "口コミが0件なら空")


# ── 完全重複の掃除（load の中で畳む） ────────────────────
# 取り込みの事故で1バイト違わず同一の行が入る。二重に効く場所が3つ
# あるので、生データを読む唯一の入口である load() で畳む。
import json as _json  # noqa: E402

_dup = rv(attendance=2, note="同じ")
eq(len(reviews._drop_exact_dups([_dup, dict(_dup), dict(_dup)])), 1,
   "全項目が同一の行は1件に畳む")
eq(reviews._drop_exact_dups([_dup, dict(_dup)])[0], _dup,
   "残すのは最初に出てきた行")

# at が違えば「同じ人が別の日に送り直した」。ここでは落とさない
# ―― 落とすかどうかは _IDENTITY（scored の門）の担当。
eq(len(reviews._drop_exact_dups([rv(attendance=2, note="同じ", at="08-18"),
                                 rv(attendance=2, note="同じ", at="08-19")])), 2,
   "at が違う行は畳まない")

# 二重計上が平均を歪めていた件。重複を残すと 2 が2票入って 1.5 になる。
_tmp = Path(__file__).resolve().parent.parent / "data" / "_test_dup.json"
_tmp.write_text(_json.dumps([rv(attendance=2, note="A"), rv(attendance=2, note="A"),
                             rv(attendance=0, note="B")], ensure_ascii=False),
                encoding="utf-8")
try:
    _a = reviews.aggregate(reviews.load(_tmp))["X"]
    eq(_a["n"], 2, "重複を畳んでから数えるので件数は2")
    eq(round(_a["attendance"], 3), 1.0, "重複した回答が平均に2票入らない")
    eq(len(reviews.public_rows(reviews.load(_tmp))["X"]), 2,
       "パネルにも同じ吹き出しを2つ出さない")
finally:
    _tmp.unlink(missing_ok=True)


# ── 実データ ─────────────────────────────────────────────
real = reviews.load()
if real:
    eq(len(reviews._drop_exact_dups(real)), len(real),
       "load を通した後の実データに完全重複は残っていない")
    pub = reviews.public_rows(real)
    agg = reviews.aggregate(real)
    eq(sorted(pub), sorted(agg), "公開形と集計は同じ科目集合を返す")
    eq([len(v) for v in pub.values()], [agg[k]["n"] for k in pub],
       "公開形の行数と集計の件数が一致する")
    missing = [k for k, v in pub.items()
               for r in v if r["taken_year"] is None]
    eq(missing, [], "実データの受講年が全件埋まっている")


# ── 書いた人の「いまの学年」（2026-08-26 追加）─────────────
# 画面に出すためだけの値。採点には一切効かないこと、
# 無い行を壊さないこと、知らない値を公開しないことを守る。
_g = reviews.public_rows([
    {"course_id": "G", "grade": "3年", "taken_year": 2024, "attendance": 2},
    {"course_id": "G", "taken_year": 2023, "attendance": 0},        # 古い行（列が無い）
])["G"]
eq([r["grade"] for r in _g], ["3年", None],
   "grade は在れば通し、無ければ None（古い行を壊さない）")

_agg = reviews.aggregate([
    {"course_id": "G", "grade": "3年", "attendance": 2, "in_class": 0, "out_class": 0},
    {"course_id": "G", "grade": "1年", "attendance": 2, "in_class": 0, "out_class": 0},
])
eq("grade" in _agg["G"], False, "grade は集計（採点側）に混ざらない")

# 取り込み側の白名単。公開リポジトリに自由記述を出さないための門。
_spec = importlib.util.spec_from_file_location(
    "ing", Path(__file__).resolve().parent / "ingest_reviews.py")
_ing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_ing)
eq([_ing.normalize({"code": "1", "grade": g})["grade"]
    for g in ("3年", "修士", "ふつう", "")],
   ["3年", "修士", None, None],
   "取り込みは選択肢どおりの値だけ通す")
eq(_ing.normalize({"code": "1"})["grade"], None, "列そのものが無くても落ちない")


print(f"  通過 {ok} 件")
for f in fail:
    print(f"  ✗ {f}")
print("NG" if fail else "OK")
sys.exit(1 if fail else 0)
