#!/usr/bin/env python3
"""data/raw/ のHTMLから data/courses.json を作る。KOAN は一切叩かない。

    python3 scrape/parse.py

最後に「評価割合(%)の充足率」を出す。これが 8/16 Go/NoGo の判定材料。

注意: KOAN の「評価方法」は固定語彙ではなく自由記述。実際に
「態度（積極性や協調性等）」「Class debate」「理解」なども出てくる。
そこでキーワードで振り分け、**振り分けられなかったものは最後に一覧で出す**。
未知の名前が出たら METHOD_RULES に足す ―― そこが引き継ぎポイント。

注意: これを流し直すと courses.json が作り直されるので、
履修できる学年（eligible_years）が消える。実行後は必ず
  python3 scrape/years.py
も流すこと。
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "courses.json"

# 上から順に見て最初に当たったバケツに入れる。順番が意味を持つ
# （「小テスト」は「テスト」より先に判定しないと試験に化ける）。
METHOD_RULES: list[tuple[str, str]] = [
    (r"小テスト|小test|クイズ|quiz", "quiz"),
    (r"試験|テスト|筆記|期末|中間|口頭試問|exam", "exam"),
    (r"レポート|論文|課題|作品|提出|essay|report|assignment|paper", "report"),
    (r"発表|プレゼン|presentation|leading", "report"),
    (r"参加|出席|平常点|態度|理解|実技|実演|討論|debate|discussion|participation", "attendance"),

    # ── ここから下は 2026-08-20 追加（政岡さんのデータ品質チェック 8/20分）。
    # 振り分けられなかった項目は「消える」のではなく、その軸の負担が
    # **ゼロとして満点になる**。ズレは必ず「実際より楽に見える」方向にだけ出る。
    # 実データ 1,112件で 61種類・延べ74箇所が未分類のまま落ちており、
    # そのうち21件は点数まで出ていた（うち11件はおすすめに掲載）。
    #
    # **必ず既存ルールの「後ろ」に置くこと。** bucket_of は最初に当たった
    # ルールで確定するので、末尾に足す限り既存の分類は1件も動かない。
    # 先頭に入れると「小テスト→試験」のような既存の順序依存を壊す。
    (
        # 毎回提出させる系。提出そのものが毎週の出席拘束なので attendance。
        r"コメント|リアクション|レスポンス|リフレクション|振り?返り|まとめ|感想"
        r"|ワークシート|受講カード|練習問題|ノート"
        # 授業内でやらせる活動系。
        r"|授業内|グループワーク|ディスカッション|演習|輪読"
        # 姿勢・相互評価系（「態度」は既存ルールで拾えている）。
        r"|積極性|取組|姿勢|相互評価|self-?feedback",
        "attendance",
    ),
    (
        # 成果物として提出させる系。本数・分量が分からないと重さは測れないので、
        # report に入れた結果 score.py が「情報不足」に落とすのは正しい挙動。
        r"プロジェクト|project|成果物|制作|計画書|エッセイ|essay|翻訳|模擬授業"
        r"|作問|解説|紹介|プログラミング|競技会|アイディア|homework",
        "report",
    ),
]


def bucket_of(name: str) -> str | None:
    for pat, b in METHOD_RULES:
        if re.search(pat, name, re.I):
            return b
    return None


def labeled(soup: BeautifulSoup) -> dict[str, str]:
    """「ラベル／English | 値」の2セル行を辞書にする。"""
    out = {}
    for tr in soup.find_all("tr"):
        cs = tr.find_all(["th", "td"])
        if len(cs) != 2:
            continue
        k = cs[0].get_text(" ", strip=True).split("／")[0].strip()
        v = cs[1].get_text(" ", strip=True)
        if k and k not in out:
            out[k] = v
    return out


def grading(soup: BeautifulSoup) -> dict[str, float]:
    """成績評価テーブル → {評価方法名: 割合%}。

    見出しが必ず1行目にあるとは限らない（学習目標の行が先に来る表もある）。
    そこで行の位置ではなく、1セル目の文言で見出し行と割合行を探す。
    最初にこれを index 決め打ちで書いて、充足率が 10% しか出ずに気づいた。
    """
    for tb in soup.find_all("table"):
        # 入れ子の外側テーブルは中身を全部含んでしまうので、
        # 「これ以上テーブルを含まない」一番内側だけを見る。
        if tb.find("table") is not None:
            continue
        t = tb.get_text(" ", strip=True)
        if "評価割合" not in t or "評価方法" not in t:
            continue
        heads, vals = None, None
        for tr in tb.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            first = cells[0].get_text(strip=True)
            if heads is None and "評価方法" in first:
                heads = [c.get_text(strip=True) for c in cells[1:]]
            elif "評価割合" in first:
                vals = [c.get_text(strip=True) for c in cells[1:]]
            if heads is not None and vals is not None:
                break
        if not heads or not vals:
            continue
        out = {}
        for name, v in zip(heads, vals):
            m = re.search(r"(\d+(?:\.\d+)?)\s*%", v or "")
            if name and m:
                out[name] = float(m.group(1))
        if out:
            return out
    return {}


def one(path: Path, idx: dict) -> tuple[dict, list[str]]:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    L = labeled(soup)
    body = soup.get_text(" ", strip=True)
    raw = grading(soup)

    # 評価方法 → 4バケツ
    buckets = {"exam": 0.0, "report": 0.0, "attendance": 0.0, "quiz": 0.0}
    unknown = []
    unclassified = {}          # 落とした項目を「落とした」と記録する（下記）
    for name, pct in raw.items():
        b = bucket_of(name)
        if b:
            buckets[b] += pct
        else:
            unknown.append(name)
            unclassified[name] = pct

    # 小テストは独立した軸として残す（2026-09-03）。
    # 以前はここで `buckets["attendance"] += buckets.pop("quiz")` として
    # 出席へ足し込んでいた。算出できている事実を捨てていたので、
    # 「小テストが成績の30%」を画面に出せず、チップ「小テストなし」も
    # weekly_quiz（本文の正規表現）だけで判定するしかなかった。
    # 学生にとって「毎週の小テスト」と「毎週の出席」は別の負担である。
    weekly_quiz = buckets["quiz"] > 0 or bool(re.search(r"毎回.{0,12}(小テスト|リアクション)", body))
    eval_ratio = {k: v for k, v in buckets.items() if v > 0} or None

    exam_type = None
    if re.search(r"持ち?込み?可", body):
        exam_type = "持込可"
    elif re.search(r"持ち?込み?不可", body):
        exam_type = "持込不可"

    m = re.search(r"授業時間外学習[^。]{0,40}?(\d+)\s*時間", body)
    out_hours = int(m.group(1)) if m else None

    dp = (L.get("曜日・時間") or idx.get("day_period_raw") or "").strip()
    dp = None if dp in ("", "-", "－") else dp

    return {
        "id": idx["code"],
        "title": L.get("開講科目名") or idx.get("title"),
        "title_en": L.get("開講科目名(英)"),
        "category": idx.get("shozoku"),
        # KOAN公式シラバスへの直リンク（j_s_cd=…&j_cd=…）に使う所属コード。
        # referW('2026','13','138531','ja_JP') の第2引数がこれで、科目ごとに違う
        # （全学教育推進機構は '13' だが、他学部は別の値）。固定値 '13' を
        # 全科目に使っていたため、他学部の科目でリンクが無効になっていた
        # （2026-08-26 wangさん報告）。
        "shozoku_cd": idx.get("shozoku_cd"),
        "term": L.get("開講区分(開講学期)") or idx.get("kaiko_kbn"),
        "day_period": dp,
        "campus": None,                      # KOANの詳細には無い。時間割コード等から後日補う
        "capacity": None,                    # 同上（KOANは定員を公開していない）
        "class_format": L.get("授業形態"),
        "credits": L.get("単位数"),
        "instructor": L.get("担当教員") or idx.get("instructor"),
        "numbering": L.get("ナンバリング"),
        "eval_ratio": eval_ratio,
        "eval_raw": raw or None,             # 元の内訳。丸めた結果しか残さないと検証できない
        # 振り分けられなかった項目を捨てずに残す。ここが None でないということは
        # eval_ratio の合計が 100% に届いていないということ。**黙って消すと
        # その軸は「負担ゼロ＝満点」になる**（2026-08-20 政岡さんの品質チェックで
        # 21件発覚）。合計が score.py の EVAL_TOTAL_MIN を割れば総合値は出ない。
        # 割らない場合でも、ここに名前が残るので METHOD_RULES に足せる。
        "eval_unclassified": unclassified or None,
        "exam_type": exam_type,
        "report_count": None,                # KOANからは取れない → 口コミで聞く
        "report_words": None,                # 同上
        "out_of_class_hours": out_hours,
        "weekly_quiz": weekly_quiz,
        "attendance_rule": (L.get("出欠席及び受講に関するルール") or "")[:300] or None,
        "tags": [],
        "source": "koan",
    }, unknown


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", action="append", default=None,
                    help="取得先ディレクトリ。複数指定できる（既定: data/raw）")
    args = ap.parse_args()
    raw_dirs = [Path(d) for d in (args.raw or [str(RAW)])]

    index = {}
    for d in raw_dirs:
        idx_path = d / "index.json"
        if not idx_path.exists():
            sys.exit(f"{idx_path} が無い。先に scrape/fetch.py を実行")
        for r in json.loads(idx_path.read_text(encoding="utf-8")):
            r["_dir"] = str(d)          # どのディレクトリの detail を見るか
            index[r["code"]] = r
        print(f"一覧を読み込み: {d}")

    courses, unknown, missing = [], Counter(), 0
    for code, idx in index.items():
        f = Path(idx["_dir"]) / "detail" / f"{code}.html"
        if not f.exists():
            missing += 1
            continue
        c, unk = one(f, idx)
        courses.append(c)
        unknown.update(unk)

    n = len(courses)
    filled = sum(1 for c in courses if c["eval_ratio"])
    OUT.write_text(json.dumps({
        "_meta": {"source": "KOAN 外部公開シラバス", "count": n,
                  "eval_ratio_fill_rate": round(filled / n * 100, 1) if n else 0},
        "courses": courses,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"科目 {n} 件 → {OUT}")
    if missing:
        print(f"詳細HTMLが無い: {missing} 件（fetch.py を再実行すれば埋まる）")
    print(f"\n■ 評価割合(%)の充足率: {filled}/{n} = {filled/n*100:.1f}%"
          if n else "\n■ 充足率: 対象なし")
    print("   ← これが 8/16 Go/NoGo の判定材料。50%未満ならスコアを前面から下げる")

    for k, label in [("day_period", "曜日・時限"), ("class_format", "授業形態"),
                     ("out_of_class_hours", "時間外学習の時間"), ("exam_type", "持込可否")]:
        got = sum(1 for c in courses if c.get(k) is not None)
        print(f"   {label}: {got}/{n}")

    if unknown:
        print("\n■ 振り分けられなかった評価方法（METHOD_RULES に足す）")
        for name, cnt in unknown.most_common(20):
            print(f"   {cnt:3d}  {name}")


if __name__ == "__main__":
    main()
