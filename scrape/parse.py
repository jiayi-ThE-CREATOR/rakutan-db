#!/usr/bin/env python3
"""data/raw/ のHTMLから data/courses.json を作る。KOAN は一切叩かない。

    python3 scrape/parse.py

最後に「評価割合(%)の充足率」を出す。これが 8/16 Go/NoGo の判定材料。

注意: KOAN の「評価方法」は固定語彙ではなく自由記述。実際に
「態度（積極性や協調性等）」「Class debate」「理解」なども出てくる。
そこでキーワードで振り分け、**振り分けられなかったものは最後に一覧で出す**。
未知の名前が出たら METHOD_RULES に足す ―― そこが引き継ぎポイント。
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
    for name, pct in raw.items():
        b = bucket_of(name)
        if b:
            buckets[b] += pct
        else:
            unknown.append(name)

    # 小テストは「毎回の拘束」なので出席側に寄せ、weekly_quiz を立てる
    weekly_quiz = buckets["quiz"] > 0 or bool(re.search(r"毎回.{0,12}(小テスト|リアクション)", body))
    buckets["attendance"] += buckets.pop("quiz")
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
    idx_path = RAW / "index.json"
    if not idx_path.exists():
        sys.exit("data/raw/index.json が無い。先に scrape/fetch.py を実行")
    index = {r["code"]: r for r in json.loads(idx_path.read_text(encoding="utf-8"))}

    courses, unknown, missing = [], Counter(), 0
    for code, idx in index.items():
        f = RAW / "detail" / f"{code}.html"
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
