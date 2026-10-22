#!/usr/bin/env python3
"""毎朝の口コミの取り込み（GitHub Actions から呼ぶ）。設計: docs/superpowers/specs/2026-10-21-review-auto-ingest-design.md

    CF_ACCOUNT_ID=… CF_D1_TOKEN=… python3 tools/review_sync.py          # 取り込んで reviews.json を作り直す
    CF_ACCOUNT_ID=… CF_D1_TOKEN=… python3 tools/review_sync.py --dry-run

1. D1 review_inbox の done=0 の行を、ingest_reviews.py の normalize で整えて D1 reviews へ入れ、done=1 にする
   （整える処理は ingest と同じ1つだけ。重複は ingest と同じ鍵＝科目・日付・一言で弾く）
2. D1 reviews の全行から data/reviews.json を作る（hidden=1 の行は publish:false ―― 一言だけ伏せる）
3. 続けて呼ぶ側が `python3 build.py --rescore` を流す（ワークフロー参照）

data/reviews.json は Actions の作業場所にだけ作られ、commit しない（.gitignore のまま・公開しない）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT))
import ingest_reviews as ingest  # noqa: E402

JST = timezone(timedelta(hours=9))


def database_id() -> str:
    m = re.search(r'database_id\s*=\s*"([^"]+)"', (ROOT / "wrangler.toml").read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("wrangler.toml に database_id がありません")
    return m.group(1)


class D1:
    """D1 の HTTP API（/query）。"""

    def __init__(self, account: str, token: str, db: str):
        self.url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{db}/query"
        self.token = token

    def q(self, sql: str, params: list | None = None) -> list[dict]:
        req = urllib.request.Request(
            self.url, method="POST",
            data=json.dumps({"sql": sql, "params": params or []}).encode(),
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as res:
            body = json.loads(res.read())
        if not body.get("success"):
            raise SystemExit(f"D1 のエラー: {body.get('errors')}")
        return body["result"][0].get("results") or []


def payload_to_row(payload: dict, at_ms: int) -> dict:
    """受け箱の1行（サイトのフォームが送った1科目ぶん）→ ingest の normalize が読む形。
    シート（v4 の CSV）と同じ鍵にそろえる ―― 整える判断は normalize に任せる。"""
    sub = payload.get("subject") or {}
    rv = sub.get("review") or {}
    row = {
        "code": str(sub.get("id") or ""),
        "note": rv.get("comment") or "",
        "taken_year": rv.get("yearTaken") or "",
        "date": datetime.fromtimestamp(at_ms / 1000, JST).strftime("%m-%d"),
        "exam_bring": rv.get("exam") or "",
    }
    if rv.get("form_v") == 5:
        items = rv.get("items") or {}
        ok = all(isinstance(items.get(k), int) and 0 <= items[k] <= 5 for k in ingest.V5_COLS)
        row.update({"v": 5, "items": {k: items[k] for k in ingest.V5_COLS} if ok else None})
        return row
    row.update({
        "attendance": rv.get("attendance") or "",
        "in_class": rv.get("assignmentInClass") or "",
        "out_class": rv.get("assignmentOutClass") or "",
        "exam": rv.get("examPresence") or ("あり" if rv.get("exam") else "なし"),
        "exam_hard10": rv.get("examDifficulty") or "",
        "report": rv.get("reportPresence") or "",
        "report_words": rv.get("reportWordCount") or "",
    })
    return row


def dedupe_key(r: dict) -> tuple:
    return (r.get("course_id"), r.get("at"), r.get("note"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    account, token = os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CF_D1_TOKEN")
    if not account or not token:
        raise SystemExit("CF_ACCOUNT_ID と CF_D1_TOKEN が要ります")
    db = D1(account, token, database_id())

    have = {dedupe_key(json.loads(r["row"])) for r in db.q("SELECT row FROM reviews")}
    inbox = db.q("SELECT id, at, payload, hidden FROM review_inbox WHERE done = 0 ORDER BY at")
    added = skipped = 0
    for it in inbox:
        try:
            row = ingest.normalize(payload_to_row(json.loads(it["payload"]), int(it["at"])))
        except Exception as e:  # 1行が壊れていても他の行は進める
            print(f"  ⚠ 受け箱 {it['id']} を整えられません: {e}")
            continue
        if not row.get("course_id"):
            skipped += 1
        elif dedupe_key(row) in have:
            skipped += 1
        else:
            have.add(dedupe_key(row))
            if not args.dry_run:
                db.q("INSERT OR IGNORE INTO reviews (id, row, hidden, src) VALUES (?, ?, ?, ?)",
                     [f"i{it['id']}", json.dumps(row, ensure_ascii=False), int(it["hidden"]), it["id"]])
            added += 1
        if not args.dry_run:
            db.q("UPDATE review_inbox SET done = 1 WHERE id = ?", [it["id"]])
    ingest._report_unknown(write=False)
    print(f"  受け箱 {len(inbox)} 件 → 取り込み {added} 件・重複などで飛ばした {skipped} 件")

    rows = []
    for r in db.q("SELECT row, hidden FROM reviews ORDER BY id"):
        row = json.loads(r["row"])
        if r["hidden"]:
            row["publish"] = False
        rows.append(row)
    print(f"  口コミの正本（D1 reviews） {len(rows)} 件")
    if not rows:
        raise SystemExit("D1 reviews が空です（引っ越しが済んでいない？）。reviews.json を上書きしません")
    if not args.dry_run:
        ingest.OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        ingest._write_agg()


if __name__ == "__main__":
    main()
