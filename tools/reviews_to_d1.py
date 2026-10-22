#!/usr/bin/env python3
"""手元の data/reviews.json を D1 の reviews 表へ移す SQL を作る（取り込みの自動化への引っ越し・1回だけ）。

    python3 tools/reviews_to_d1.py > /tmp/reviews.sql
    npx wrangler d1 execute rakutan-favorites --remote --file=/tmp/reviews.sql

    CF_ACCOUNT_ID=… CF_D1_TOKEN=… python3 tools/reviews_to_d1.py --push   # D1 の HTTP API で直接入れる
（2026-10-22：wrangler の --file（/import）が OAuth のログインで認証エラーになったので --push を足した。
  トークンは毎朝の取り込み（GitHub Actions）と同じ「D1 の読み書きだけ」のもの）

id は行の中身から作るので、何度流しても同じ行は増えない（INSERT OR IGNORE）。
publish:false の行は hidden=1 にする（一言だけ伏せる、今と同じ扱い）。
設計: docs/superpowers/specs/2026-10-21-review-auto-ingest-design.md
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def row_id(r: dict) -> str:
    return "j" + hashlib.sha1(json.dumps(r, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    push = "--push" in sys.argv
    src = Path(args[0]) if args else ROOT / "data" / "reviews.json"
    rows = json.loads(src.read_text(encoding="utf-8"))
    if push:
        import os
        sys.path.insert(0, str(ROOT / "tools"))
        from review_sync import D1, database_id
        db = D1(os.environ["CF_ACCOUNT_ID"], os.environ["CF_D1_TOKEN"], database_id())
        n = 0
        for r in rows:
            if not isinstance(r, dict) or not r.get("course_id"):
                continue
            db.q("INSERT OR IGNORE INTO reviews (id, row, hidden, src) VALUES (?, ?, ?, NULL)",
                 [row_id(r), json.dumps(r, ensure_ascii=False), 0 if r.get("publish", True) else 1])
            n += 1
        total = db.q("SELECT COUNT(*) AS n FROM reviews")[0]["n"]
        print(f"  送った {n} 行 ／ D1 reviews は今 {total} 行（同じ行は増えない）")
        return
    out = []
    for r in rows:
        if not isinstance(r, dict) or not r.get("course_id"):
            continue
        hidden = 0 if r.get("publish", True) else 1
        out.append("INSERT OR IGNORE INTO reviews (id, row, hidden, src) VALUES "
                   f"({sql_str(row_id(r))}, {sql_str(json.dumps(r, ensure_ascii=False))}, {hidden}, NULL);")
    print("\n".join(out))
    print(f"-- {len(out)} 行", file=sys.stderr)


if __name__ == "__main__":
    main()
