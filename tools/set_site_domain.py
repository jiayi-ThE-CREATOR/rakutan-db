#!/usr/bin/env python3
"""本番ホスト名をリポジトリ全体で差し替える。

workers.dev のサブドメインを変えた（あるいは独自ドメインに移した）ときに使う。
OGP の og:url / og:image は**絶対URLでなければ効かない**ので、ホスト名が
ハードコードされている箇所が必ず残る。手で直すと必ず1つ取りこぼすため、
ここを唯一の入口にする。

使い方:
    python3 tools/set_site_domain.py --to rakutan-db.guild.workers.dev --dry-run
    python3 tools/set_site_domain.py --to rakutan-db.guild.workers.dev

このスクリプトが**直さないもの**（人がやる）:
    1. LINE Developers の Webhook URL
    2. Cloudflare Web Analytics のサイト登録（ホスト名ごと）
    3. 宣伝実行マニュアル PDF の中の /l/ リンク
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURRENT = "rakutan-db.wjy20050815.workers.dev"

# 走査対象。data/ と .git は触らない（口コミ本文に URL が入っていても書き換えない）
TARGETS = [
    "web/index.html", "web/about.html", "web/partners.html",
    "README.md", "ROADMAP.md", "line/README.md", "wrangler.toml",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True, help="新しいホスト名（スキーム無し）")
    ap.add_argument("--from", dest="frm", default=CURRENT, help="今のホスト名")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if re.match(r"^https?://", a.to):
        print("エラー: --to はホスト名だけ（https:// を付けない）", file=sys.stderr)
        return 2

    total = 0
    for rel in TARGETS:
        p = ROOT / rel
        if not p.exists():
            print(f"  skip {rel}（無い）")
            continue
        t = p.read_text(encoding="utf-8")
        n = t.count(a.frm)
        if not n:
            continue
        total += n
        print(f"  {rel}: {n}箇所")
        if not a.dry_run:
            p.write_text(t.replace(a.frm, a.to), encoding="utf-8")

    print(f"\n合計 {total}箇所" + ("（dry-run。書いていない）" if a.dry_run else " を書き換えた"))
    if total and not a.dry_run:
        print(f"""
まだ残っている作業（このスクリプトでは直せない）:
  1. LINE Developers の Webhook を https://{a.to}/line/webhook に変更 →「検証」を押す
  2. Cloudflare Web Analytics に {a.to} をサイト登録し、token を web/*.html の
     __TOKEN__ に貼る（旧ホスト名で登録すると数字が入らない）
  3. 宣伝実行マニュアルの /l/ リンク14本と /partners の URL
  4. デプロイして https://{a.to}/l/kasai が開くことを確認
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
