"""CELAS の「卒業要件単位数」11ページから data/faculty_requirements.json を作る。

    python3 tools/fetch_requirements.py            # 取得して書き出す
    python3 tools/fetch_requirements.py --offline  # data/raw/prerequisite/ から作り直す

■ 大学のサーバを叩くときの約束
1リクエストごとに2秒あける（scrape/fetch.py と同じ）。11ページで約22秒。
**ここを短くしない。** 22秒を惜しんで失うもの（大学からの停止要請）の方が大きい。

■ 前提が崩れたら止まる
この計画は「学科が違っても必要な区分の集合は同じ」という実測（2026-08-24）に
乗っている。CELAS が表を作り替えてこれが崩れたら、黙って変な JSON を書くより
**止まって知らせる**ほうがいい。build_faculty() の2つの検査がそれ。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

import requests   # scrape/koan.py と同じ。標準の urllib は python.org 版 Python だと
                  # 証明書を持たず SSL 検証に失敗する（2026-08-24 実測）

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.requirements_parse import (CELAS_DIVISIONS, DIVISIONS,
                                      parse_notes, parse_page)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "faculty_requirements.json"
RAW = ROOT / "data" / "raw" / "prerequisite"
BASE = "https://www.celas.osaka-u.ac.jp/education/prerequisite/"
DELAY = 2.0
UA = "rakutan-db/0.1 (Osaka Univ. student project; contact via GitHub)"

# CELAS のスラッグと学部名。並びは大学の学部の並びに合わせてある。
FACULTIES = [
    ("letters", "文学部"),
    ("human-sci", "人間科学部"),
    ("law", "法学部"),
    ("economics", "経済学部"),
    ("foreign-s", "外国語学部"),
    ("science", "理学部"),
    ("medicine", "医学部"),
    ("dentistry", "歯学部"),
    ("pharmacy", "薬学部"),
    ("engineering", "工学部"),
    ("engr-sci", "基礎工学部"),
]


def fetch(slug: str) -> str:
    r = requests.get(BASE + slug + "/", headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def build_faculty(slug: str, label: str, page: str) -> dict:
    tables = parse_page(page)
    if not tables:
        raise SystemExit(f"中止: {slug} に表が1つも無い。ページ構造が変わった可能性がある")

    # 前提①：学科が違っても区分の並びは同じ（2026-08-24 実測）
    shapes = [tuple(tuple(g["divisions"]) for g in t["groups"]) for t in tables]
    if len(set(shapes)) != 1:
        raise SystemExit(
            f"中止: {slug} は学科ごとに区分の並びが違う。\n"
            f"      「学部→区分の2段でよい」という設計の前提が崩れている。\n"
            f"      docs/plans/2026-08-24-faculty-division-filter-design.md の1章②を"
            f"読み直すこと。")

    requirements = [
        {"divisions": list(g["divisions"]),
         "values": [t["groups"][i]["value"] for t in tables]}
        for i, g in enumerate(tables[0]["groups"])
    ]

    # 前提②：14区分すべてが表にある
    covered = {k for r in requirements for k in r["divisions"]}
    missing = [d["key"] for d in CELAS_DIVISIONS if d["key"] not in covered]
    if missing:
        raise SystemExit(f"中止: {slug} の表に無い区分がある {missing}")

    return {
        "key": slug,
        "label": label,
        "departments": [t["department"] for t in tables if t["department"]],
        "requirements": requirements,
        "notes": parse_notes(page),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true",
                    help="取得せず data/raw/prerequisite/ の保存ずみ HTML から作り直す")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    faculties = []
    for i, (slug, label) in enumerate(FACULTIES):
        cache = RAW / f"{slug}.html"
        if args.offline:
            if not cache.exists():
                raise SystemExit(f"中止: {cache} が無い。--offline を外して取得すること")
            page = cache.read_text(encoding="utf-8")
        else:
            if i:
                time.sleep(DELAY)      # 大学のサーバに連続で当てない
            page = fetch(slug)
            cache.write_text(page, encoding="utf-8")
        faculties.append(build_faculty(slug, label, page))
        n = len(faculties[-1]["departments"]) or 1
        print(f"  {label:8s} 学科{n:2d}  区分グループ{len(faculties[-1]['requirements']):2d}"
              f"  注記{len(faculties[-1]['notes'])}")

    payload = {
        "_meta": {
            "source": "CELAS 卒業要件単位数",
            "base_url": BASE,
            "fetched": date.today().isoformat(),
            "note": "値は生の文字列。＊は便覧参照、－は要件なし。数値へ丸めていない。",
        },
        "divisions": DIVISIONS,
        "faculties": faculties,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {OUT}  学部{len(faculties)}件")


if __name__ == "__main__":
    main()
