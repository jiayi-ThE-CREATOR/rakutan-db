"""口コミフォームの書き出しを data/reviews.json に取り込む。

**2つの書き出し形に対応している**（ヘッダを見て自動で切り替える）:

  v4  サイト内フォーム `/kuchikomi` → しゅんやさんのスプレッドシート（CSV・日本語ヘッダ）
      1列目が「タイムスタンプ」ならこちら。2026-08 以降の投稿はすべてこの形。
      旧フォームとの違いは2つあり、どちらも黙って埋めない:
        ・「テスト」1列に **持ち込み可否** が入る（旧は 有無 と 持ち込みの2列）。
          空欄は「テストなし」として読む ―― フォームは「なし」を選ぶと
          持ち込みを聞かないため。原文は exam_bring_raw に残るのでやり直せる
        ・**テスト難易度（1〜10）の列が無い** → exam_hard10 は埋まらない。
          サイトのフォームは聞いているので、シート側に列が増えたらここも直す

  旧  Netlify のフォーム（TSV・英語ヘッダ）。2026-08 より前の144件がこの形。

旧フォーム: https://magnificent-scone-0d2071.netlify.app/
設問と列の対応（フォーム側を変えたらここも直す）:

    attendance    2 出席は取られた？          毎回 / たまに / なし / その他
    in_class      3 授業中の課題はあった？      重い / ふつう / 軽い / なかった
    out_class     4 授業外の課題はあった？      重い / ふつう / 軽い / なかった
    exam          5 テストはあった？           あり / なし
    exam_bring      ↳ 持ち込みは？             可 / 不可
    exam_hard10     ↳ 難易度は？               1（簡単）〜 10（難しい）
    report        6 レポートはあった？          あり / なし
    report_words    ↳ 語数
    note            一言（任意）

  python3 tools/ingest_reviews.py <export.tsv>            # 追記して書き込む
  python3 tools/ingest_reviews.py <export.tsv> --dry-run  # 確認だけ
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES = ROOT / "data" / "courses.json"
OUT = ROOT / "data" / "reviews.json"

# 表記ゆれ。フォームの選択肢が増えたらここに足す。
ATTEND = {"毎回": 2, "たまに": 1, "なし": 0}
LEVEL = {"重い": 2, "ふつう": 1, "軽い": 0, "なかった": None}

# 「その他（…）」の台帳。**選択肢ではなく自由記述なので、書かれた中身で判断する。**
#
# 以前は出席の「その他」を一律で 2（毎回）に寄せていた。実データで
# 「その他（分からない）」が来て、**未回答が最大の拘束として数えられた**。
# 逆に持ち込みは「可」以外を全部 持込不可 にしていたので、
# 「その他（持ち帰り形式）」―― 持込可より緩い ―― が 持込不可 になっていた。
# どちらも既定値で潰していたのが原因なので、1件ずつ人が判断して台帳に残す。
#
# 台帳に無い言い回しが来たら、その回の取り込みでは **未回答（None）** として扱い、
# 原文を value:null で data/sonota.json に追記する。判断を書き足したあと
# `--renorm` を流すと、取り込みずみの行にも遡って効く。
# 原文は attendance_raw / exam_bring_raw に必ず残るので、後から何度でもやり直せる。
SONOTA = ROOT / "data" / "sonota.json"


def _sonota_load() -> dict:
    if SONOTA.exists():
        return json.loads(SONOTA.read_text(encoding="utf-8"))
    return {"attendance": {}, "exam_bring": {}}


_LEDGER = _sonota_load()
_UNKNOWN: dict[str, set[str]] = {"attendance": set(), "exam_bring": set()}


def _lookup(field: str, raw: str):
    """台帳を引く。未登録なら未回答（None）を返し、原文を控えておく。"""
    entry = _LEDGER.get(field, {}).get(raw)
    if entry is None:
        _UNKNOWN[field].add(raw)
        return None
    return entry.get("value")


def _sonota_record() -> int:
    """未登録の言い回しを value:null で台帳に書き足す。人が判断を入れる場所。"""
    n = 0
    for field, raws in _UNKNOWN.items():
        for raw in sorted(raws):
            _LEDGER.setdefault(field, {})[raw] = {"value": None, "why": ""}
            n += 1
    if n:
        SONOTA.write_text(json.dumps(_LEDGER, ensure_ascii=False, indent=1) + "\n",
                          encoding="utf-8")
    return n


def _int(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"\d+", str(s).replace(",", ""))
    return int(m.group()) if m else None


def _yes(s: str | None) -> bool:
    return (s or "").strip() == "あり"


# ── 入力の形 ──────────────────────────────────────
# v4（サイト内フォーム）の列名 → このスクリプトの内部キー。
# 内部キーは旧フォームの英語ヘッダに合わせてある（normalize を1つに保つため）。
V4_MARK = "タイムスタンプ"
V4_COLS = {
    "code": "科目コード",
    "attendance": "出欠",
    "in_class": "授業中の課題",
    "out_class": "授業外の課題",
    "report": "レポート有無",
    "report_words": "レポート字数",
    "note": "一言コメント",
    "taken_year": "受講年度",
}


def _v4_date(raw: str | None) -> str | None:
    """「2026/08/29 18:03:12」→「08-29」。旧フォームの date 列と形を揃える。"""
    m = re.search(r"\d{4}/(\d{1,2})/(\d{1,2})", raw or "")
    return f"{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else None


def _v4_find(r: dict, *needles: str) -> str | None:
    """列名にゆらぎがあっても拾う。シート側に列が増えたとき、こちらを
    直さなくても効くようにしておく（列名は人が手で付けるため）。"""
    for k in r:
        if k and any(n in k for n in needles):
            return (r.get(k) or "").strip() or None
    return None


def _v4_row(r: dict) -> dict:
    row = {k: r.get(v) for k, v in V4_COLS.items()}
    bring = (r.get("テスト") or "").strip()
    # 「テスト」1列に持ち込み可否が入る。空欄＝テストなし（フォームは「なし」を
    # 選ぶと持ち込みを聞かない）。ただし「テスト有無」列がシートに増えたら、
    # 推測より本人の回答を優先する。
    presence = _v4_find(r, "テスト有無", "テストの有無")
    row["exam"] = presence if presence else ("あり" if bring else "なし")
    row["exam_bring"] = bring
    # 難易度（1〜10）。**サイトのフォームは聞いて送っているのに、v4 の
    # スプレッドシートには列が無い**（外部サイトから統合したときの取りこぼし。
    # 2026-09-03 に判明）。列が増えたらここが勝手に拾う。
    row["exam_hard10"] = _v4_find(r, "難易度")
    row["date"] = _v4_date(r.get(V4_MARK))
    return row


def read_rows(path: str) -> list[dict]:
    """書き出しを読んで、内部キーの dict にして返す。形はヘッダで見分ける。"""
    text = Path(path).read_text(encoding="utf-8-sig")
    head = text.splitlines()[0] if text else ""
    if V4_MARK in head:
        delim = "," if head.count(",") >= head.count("\t") else "\t"
        rows = [_v4_row(r) for r in csv.DictReader(io.StringIO(text), delimiter=delim)]
        # 黙って欠けさせない。ここが無警告だったせいで、難易度が1週間ぶん
        # 失われていることに誰も気づかなかった（2026-09-03）。
        if "難易度" not in head:
            print("  ⚠ シートに「難易度」の列がありません。"
                  "サイトのフォームは聞いて送っているので、"
                  "テストの重さの主な入力が丸ごと欠けます。")
            print("    → スプレッドシート側に列を足すと、ここは自動で拾います"
                  "（このスクリプトの修正は不要）。")
        else:
            # 列を足しただけでは埋まらない ―― GAS が書かなければ空のまま。
            # 「列があるから安心」で警告が消えるのが一番たちが悪いので、
            # 中身が1件も入っていないときも同じ強さで知らせる。
            withexam = [r for r in rows if (r.get("exam") or "") != "なし"]
            if withexam and not any(r.get("exam_hard10") for r in withexam):
                print(f"  ⚠ 「難易度」の列はありますが、テストありの {len(withexam)} 件に"
                      "1つも値が入っていません。")
                print("    → 列を足しただけで、GAS 側が書き込んでいない可能性があります"
                      "（review.examDifficulty）。")
        return rows
    return list(csv.DictReader(io.StringIO(text), delimiter="\t"))


# 科目コードは KOAN で6桁ちょうど。うち 3,423件（全7,906件の43%）が
# 「0」で始まる。スプレッドシートがその列を数値として扱うと先頭の0が落ち、
# 081001 が 81001 になって **どの科目にも当たらないまま黙って捨てられる**。
# 2026-09-04 に実際に1件出て、政岡さんが手で直した。
# 手で直し続ける類のものではないので、ここで揃える。
# （00Z008 のように英字を含むコードは数値化されないので影響を受けない）
def _course_id(raw: str | None) -> str:
    code = (raw or "").strip()
    return code.zfill(6) if code.isdigit() and len(code) < 6 else code


def normalize(row: dict) -> dict:
    """1行 → 保存する形。判断はここに寄せ、集計側では素直に平均するだけにする。"""
    att = (row.get("attendance") or "").strip()
    bring = (row.get("exam_bring") or "").strip() or None
    return {
        "course_id": _course_id(row.get("code")),
        # 選択肢どおりでない答えは台帳（data/sonota.json）で1件ずつ判断する
        "attendance": ATTEND[att] if att in ATTEND
                      else _lookup("attendance", att) if att else None,
        "attendance_raw": att,
        "in_class": LEVEL.get((row.get("in_class") or "").strip()),
        "out_class": LEVEL.get((row.get("out_class") or "").strip()),
        "exam": _yes(row.get("exam")),
        # 採点と exam_type の判定が見るのは正規化した 可 / 不可 のほう。
        # 書かれた原文は exam_bring_raw に残す（判断をやり直せるように）。
        "exam_bring": bring if bring in ("可", "不可")
                      else _lookup("exam_bring", bring) if bring else None,
        "exam_bring_raw": bring,
        # フォームは 1（簡単）〜10（難しい）
        "exam_hard10": _int(row.get("exam_hard10")),
        "report": _yes(row.get("report")),
        "report_words": _int(row.get("report_words")),
        "note": (row.get("note") or "").strip() or None,
        # 受講年。フォームに「いつ受けた？」の列が出来たらここに入る。
        # 無ければ None のまま ―― 埋めない。詳細パネルは None を
        # 「受講年 未回答」として末尾に置く（推測で年を書かない）。
        "taken_year": _int(row.get("taken_year")),
        "at": (row.get("date") or "").strip() or None,
    }


def _report_unknown(write: bool) -> None:
    """台帳に無い「その他（…）」を知らせる。黙って既定値に寄せない。"""
    total = sum(len(v) for v in _UNKNOWN.values())
    if not total:
        return
    print(f"\n  ⚠ 台帳に無い「その他」が {total} 種類ありました"
          f"（この回は未回答として扱っています）")
    for field, raws in _UNKNOWN.items():
        for raw in sorted(raws):
            print(f"      {field}: {raw}")
    if write:
        _sonota_record()
        print(f"    → {SONOTA} に value:null で追記しました。")
        print("      判断（value と why）を書いてから "
              "`python3 tools/ingest_reviews.py x --renorm` を流すと、"
              "取り込みずみの行にも遡って効きます。")


def renorm() -> None:
    """台帳の判断を、取り込みずみの reviews.json に当て直す。

    原文（attendance_raw / exam_bring_raw）から数値をもう一度作るだけなので、
    何度流しても結果は同じ。行は増えも減りもしない。
    判断を後から変えられるのは、原文を捨てずに持っているからこの形にできる。
    """
    rows = json.loads(OUT.read_text(encoding="utf-8"))
    changed = 0
    for r in rows:
        # 取り込みずみの古い行には exam_bring_raw が無い（原文が exam_bring に
        # 入っていた頃のもの）。初回だけここで移し替える。
        if "exam_bring_raw" not in r:
            r["exam_bring_raw"] = r.get("exam_bring")
        att, bring = r.get("attendance_raw") or "", r.get("exam_bring_raw")
        before = (r.get("attendance"), r.get("exam_bring"))
        r["attendance"] = (ATTEND[att] if att in ATTEND
                           else _lookup("attendance", att) if att else None)
        r["exam_bring"] = (bring if bring in ("可", "不可")
                           else _lookup("exam_bring", bring) if bring else None)
        if before != (r["attendance"], r["exam_bring"]):
            changed += 1
            print(f"    {r['course_id']}  {before} → "
                  f"{(r['attendance'], r['exam_bring'])}  ({att or bring})")
    print(f"  当て直した {changed} 件 / 全 {len(rows)} 件")
    _report_unknown(write=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  → {OUT}")
    _write_agg()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tsv")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--replace", action="store_true",
                    help="既存の reviews.json を捨てて入れ替える")
    ap.add_argument("--renorm", action="store_true",
                    help="取り込みずみの行に data/sonota.json の判断を遡って当て直す"
                         "（TSV は読まない。ダミーのパスを渡してよい）")
    args = ap.parse_args()

    if args.renorm:
        renorm()
        return

    known = {c["id"] for c in json.loads(COURSES.read_text(encoding="utf-8"))["courses"]}
    rows = [normalize(r) for r in read_rows(args.tsv)]

    hit = [r for r in rows if r["course_id"] in known]
    miss = [r for r in rows if r["course_id"] not in known]

    print(f"  読み込み {len(rows)} 件")
    print(f"    DBに在る科目  {len(hit):3} 件 / {len({r['course_id'] for r in hit})} 科目")
    print(f"    DBに無い科目  {len(miss):3} 件 / {len({r['course_id'] for r in miss})} 科目")
    if miss:
        # 2026-08-26: 口コミ投稿がサイト内へ移り、全所属7,877件から選べるように
        # なった。それまでこの行に来るのは「まだ取得していない科目」だけだったが、
        # いまは **流している人の courses.json が全所属ぶんではない** ほうが
        # 起きやすい。原因が2つあるので、どちらなのかを言い分ける。
        print(f"      いまの {COURSES.name} は {len(known)} 件です。")
        if len(known) < 7000:
            print("      → 全所属（7,877件）の courses.json ではありません。"
                  "学部の専門科目・語学の口コミがここに落ちます。")
            print("        全所属ぶんを持っている人が取り込み直すと拾えます"
                  "（行は捨てないので、あとから効きます）。")
        else:
            print("      → まだ取得していない科目です。")
            print("        科目を取得しない限り採点には反映されない。")
    hard = [r["exam_hard10"] for r in hit if r["exam_hard10"] is not None]
    if hard:
        print(f"    テスト難易度が入った  {len(hard)} 件（平均 {sum(hard)/len(hard):.1f} / 10）")

    _report_unknown(write=not args.dry_run)

    if args.dry_run:
        print("\n  --dry-run のため書き込んでいない")
        return

    # DBに無い科目も捨てない。科目を取得したら後から効くようにしておく。
    prev = []
    if OUT.exists() and not args.replace:
        try:
            prev = [r for r in json.loads(OUT.read_text(encoding="utf-8")) if r.get("course_id") != "S001"]
        except json.JSONDecodeError:
            prev = []
    # 突き合わせは「既存の行」だけでなく「このバッチで既に採った行」とも
    # 行う。片方だけだと、同じ回答が1つの CSV に2行あったときに2行とも
    # 入る ―― 実際 2026-08-24 時点で6科目・9行がこれで二重になっていた
    # （135581 135587 135685 135851 135889 137717）。
    #
    # キーに note を含めているので、一言なしの回答どうしは
    # (course_id, at, None) で衝突する。同じ日に同じ科目へ一言なしの
    # 回答が2件来たら片方が落ちる。落とすほうを選んだのは、二重計上が
    # 「口コミ N件」と平均の両方を静かに歪めるのに対し、取りこぼしは
    # 次のバッチで気づけるため。
    seen = {(r.get("course_id"), r.get("at"), r.get("note")) for r in prev}
    added = []
    for r in rows:
        k = (r["course_id"], r["at"], r["note"])
        if k in seen:
            continue
        seen.add(k)
        added.append(r)
    OUT.write_text(json.dumps(prev + added, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"\n  → {OUT}  既存 {len(prev)} 件 ＋ 新規 {len(added)} 件")

    _write_agg()


def _write_agg() -> None:
    """集約ずみも一緒に書く。生データは gitignore なので、これが無いと
    取り込んだ本人以外は同じ数字を出せない。

    `python3 tools/ingest_reviews.py` で起動すると sys.path の先頭は tools/ に
    なるので、リポジトリ直下の reviews.py が import できない。**生データを
    書いた後にここで落ちる**ので、「失敗した」と思って流し直すと二重取り込みに
    見える（実際は重複判定が効くので増えないが、agg だけ古いまま残る）。
    """
    sys.path.insert(0, str(ROOT))
    import reviews as reviews_mod
    agg = reviews_mod.aggregate(reviews_mod.load())
    print(f"  → {reviews_mod.dump_agg(agg)}  {len(agg)} 科目（これはコミットする）")


if __name__ == "__main__":
    main()
