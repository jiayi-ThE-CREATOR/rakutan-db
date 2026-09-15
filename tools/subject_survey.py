#!/usr/bin/env python3
"""授業内容タグの品質ゲート。**画面に繋ぐ前に必ずここを通す。**

    python3 tools/subject_survey.py

3つの表を出す。数分で終わる。合格するまで UI には繋がない。

  ① 頻度       … 50件未満＝死にタグ（消すか統合）／3,000件超＝広すぎ（分ける）
  ② 共起       … レンズタグ（歴史・文化・地域…）が他のタグに乗れているか。
                  `歴史 ∩ ことば・語学` が数件しか無いなら AI が付け惜しんでいる
  ③ 学部集中度 … **1つの学部に90%以上偏ったタグは偽タグ。**
                  ナンバリング由来の分類を却下したのと同じ失敗の再発

■ ③ をとくに見る理由
最初はナンバリングの学科コード（08MEEN→機械）から分野を作ろうとした。実測すると
そうやって作ったラベルの **77% が「1学部で90%以上」** ―― `category`（学部）が
既に持っている情報の言い換えでしかなく、学部フィルタと重複するだけだった。
内容タグでも同じことが起きうるので、機械に見張らせる。

設計は docs/plans/2026-09-03-naiyou-tag-design.md
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.subjects import LENS, VOCAB, merge  # noqa: E402

BUILT = ROOT / "web" / "data" / "courses.built.json"
AI = ROOT / "data" / "subjects.ai.tsv"
MANUAL = ROOT / "data" / "subjects.manual.tsv"

# 合格の線。docs/plans/2026-09-03-naiyou-tag-design.md の4章。
DEAD_MAX = 50          # これ未満は死にタグ
BROAD_MIN = 3000       # これ超えは広すぎ
FACULTY_MAX = 0.90     # 1学部がこれ以上を占めたら偽タグ


def read_tsv(path: Path) -> dict[str, list[str]]:
    if not path.is_file():
        return {}
    out = {}
    with path.open(encoding="utf-8", newline="") as f:
        for row in csv.reader(f, delimiter="\t"):
            if len(row) >= 3:
                out[row[0]] = [t for t in row[2].split(",") if t]
    return out


def frequency(tags_by_id: dict[str, list[str]]) -> collections.Counter:
    c = collections.Counter()
    for tags in tags_by_id.values():
        c.update(tags)
    return c


def cooccurrence(tags_by_id: dict[str, list[str]]) -> dict[tuple[str, str], int]:
    """タグ2つの同時出現件数。キーは語彙の定義順に並べた組。"""
    order = list(VOCAB)
    pairs: collections.Counter = collections.Counter()
    for tags in tags_by_id.values():
        s = sorted(set(tags), key=order.index)
        for i, a in enumerate(s):
            for b in s[i + 1:]:
                pairs[(a, b)] += 1
    return pairs


def faculty_share(tags_by_id: dict[str, list[str]],
                  courses: dict) -> dict[str, tuple[str, float, int]]:
    """タグごとに「最も多い学部」とその割合。偽タグの検出に使う。"""
    per: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for cid, tags in tags_by_id.items():
        cat = (courses.get(cid) or {}).get("category")
        if not cat:
            continue
        for t in tags:
            per[t][cat] += 1
    out = {}
    for t, cnt in per.items():
        total = sum(cnt.values())
        cat, n = cnt.most_common(1)[0]
        out[t] = (cat, n / total, total)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ai", default=str(AI))
    ap.add_argument("--manual", default=str(MANUAL))
    args = ap.parse_args()

    ai, manual = read_tsv(Path(args.ai)), read_tsv(Path(args.manual))
    if not ai and not manual:
        sys.exit(f"{args.ai} がありません。先に tools/subject_tag.py を流してください。")

    courses = {}
    if BUILT.is_file():
        courses = {c["id"]: c
                   for c in json.loads(BUILT.read_text(encoding="utf-8"))["courses"]}

    # 出所の優先順位は tools/subjects.py が正本（人の指定が AI に勝つ）。
    tags_by_id = {}
    for cid in set(ai) | set(manual):
        title = ((courses.get(cid) or {}).get("title") or "")
        from tools.subjects import from_title
        merged, _ = merge(manual=manual.get(cid), title=from_title(title),
                          ai=ai.get(cid))
        tags_by_id[cid] = merged

    n = len(tags_by_id)
    tagged = sum(1 for t in tags_by_id.values() if t)
    print(f"対象 {n} 件 / タグが付いた科目 {tagged} 件 "
          f"({tagged / n * 100:.1f}%) / 語彙 {len(VOCAB)}語\n")

    freq = frequency(tags_by_id)
    fac = faculty_share(tags_by_id, courses)
    ng = []

    # ── ① 頻度 ──────────────────────────────────
    print("① 頻度（件数の多い順）")
    for key, label in VOCAB.items():
        c = freq.get(key, 0)
        flag = ""
        if c < DEAD_MAX:
            flag, _ = "  ← 死にタグ（消すか統合）", ng.append(f"{label}: {c}件")
        elif c > BROAD_MIN:
            flag, _ = "  ← 広すぎ（分ける）", ng.append(f"{label}: {c}件")
        print(f"   {label:16} {c:5d}{flag}")

    # ── ② 共起 ──────────────────────────────────
    # レンズタグは単独で成立する授業が少なく、ほぼ常に他のタグに乗る。
    # ここが薄いと「日本語の歴史」を掘り当てる、という設計が成立しない。
    print("\n② 共起（レンズタグが何に乗っているか・上位5組）")
    pairs = cooccurrence(tags_by_id)
    for lens in LENS:
        rows = sorted(((v, k) for k, v in pairs.items() if lens in k), reverse=True)[:5]
        alone = freq.get(lens, 0) - sum(v for v, _ in rows)
        shown = " / ".join(f"{VOCAB[k[0] if k[1] == lens else k[1]]} {v}"
                           for v, k in rows) or "（乗っていない）"
        print(f"   {VOCAB[lens]:12} {shown}")
        if not rows:
            ng.append(f"{VOCAB[lens]}: 他のタグに乗っていない（AIが付け惜しんでいる）")
        _ = alone

    # ── ③ 学部集中度 ────────────────────────────
    print(f"\n③ 学部集中度（{FACULTY_MAX * 100:.0f}%以上は偽タグ）")
    bad = [(t, v) for t, v in fac.items() if v[1] >= FACULTY_MAX]
    for t, (cat, share, total) in sorted(bad, key=lambda x: -x[1][1]):
        print(f"   {VOCAB[t]:16} {cat} が {share * 100:.0f}%（{total}件）  ← 偽タグ")
        ng.append(f"{VOCAB[t]}: {cat} に {share * 100:.0f}% 偏っている")
    if not bad:
        print("   偏りすぎているタグはありません")

    print()
    if ng:
        print(f"✗ {len(ng)} 件ひっかかりました。語彙かプロンプトを直してから画面へ。")
        for m in ng:
            print("   -", m)
        sys.exit(1)
    print("✓ 3つとも合格。画面に繋いでよい。")


if __name__ == "__main__":
    main()
