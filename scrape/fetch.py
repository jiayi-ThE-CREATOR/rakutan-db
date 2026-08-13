#!/usr/bin/env python3
"""KOAN の一覧と詳細HTMLをダウンロードして data/raw/ に保存する。

parse.py と分けてあるのは、抽出ロジックを直すたびに KOAN を
叩き直さずに済むようにするため。HTMLさえ手元にあれば、
parse は何百回でも無料でやり直せる。

使い方:
    python3 scrape/fetch.py --limit 10      # まず10件で動作確認
    python3 scrape/fetch.py                 # 全件（1,112件・約45分）
    python3 scrape/fetch.py                 # 中断しても再実行で続きから

既に保存済みの詳細は飛ばすので、何度実行しても安全。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import koan  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nendo", default="2026")
    ap.add_argument("--limit", type=int, default=0, help="0で全件")
    ap.add_argument("--delay", type=float, default=2.0, help="リクエスト間隔（秒）。短くしない")
    ap.add_argument("--out", default=str(RAW))
    args = ap.parse_args()

    out = Path(args.out)
    (out / "detail").mkdir(parents=True, exist_ok=True)

    k = koan.Koan(delay=args.delay)
    print("フローを開始…")
    html = k.search(args.nendo)
    total = koan.total_count(html)
    print(f"検索ヒット: {total} 件")

    # ── 一覧を全ページ集める ────────────────────
    rows, page = koan.list_rows(html), 1
    pages = -(-total // 100) if total else 1
    while page < pages:
        page += 1
        print(f"  一覧 {page}/{pages} ページ目")
        rows += koan.list_rows(k.page(page))
        if args.limit and len(rows) >= args.limit:
            break

    # 同じ時間割コードが複数回出ることがあるので潰す
    uniq, seen = [], set()
    for r in rows:
        if r["code"] not in seen:
            seen.add(r["code"])
            uniq.append(r)
    if args.limit:
        uniq = uniq[: args.limit]
    (out / "index.json").write_text(
        json.dumps(uniq, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"一覧を保存: {len(uniq)} 件 → {out/'index.json'}")

    # ── 詳細を1件ずつ ──────────────────────────
    done = skipped = failed = 0
    for i, r in enumerate(uniq, 1):
        f = out / "detail" / f"{r['code']}.html"
        if f.exists() and f.stat().st_size > 5000:
            skipped += 1
            continue
        try:
            f.write_text(k.detail(r["nendo"], r["shozoku_cd"], r["code"]), encoding="utf-8")
            done += 1
        except Exception as e:                                    # noqa: BLE001
            failed += 1
            print(f"  !! {r['code']} {r['title'][:20]}: {e}")
        if i % 10 == 0 or i == len(uniq):
            print(f"  詳細 {i}/{len(uniq)}  取得{done} 既存{skipped} 失敗{failed}")

    print(f"\n完了: 取得 {done} / 既存 {skipped} / 失敗 {failed}")
    print(f"次は  python3 scrape/parse.py")


if __name__ == "__main__":
    main()
