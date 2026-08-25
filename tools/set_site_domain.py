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
# いま人に配っているホスト名。独自ドメインへ移ったらここも変える。
CURRENT = "rakuhan.nocode-sol.co.jp"

# 走査する場所。**ファイルを1つずつ並べないこと。**
# 2026-09-22 実測: ファイルを並べていた頃のリストは7本で、実際に
# ホスト名が入っている12本のうち5本（kuchikomi.html / mypage.html /
# sitemap.xml / robots.txt / analytics.js）を取りこぼしていた。
# 「手で直すと必ず1つ取りこぼす」から作った道具が、同じ理由で外していた。
SCAN_DIRS = ["web", "line", "worker", "templates", "tools"]
SCAN_FILES = ["README.md", "ROADMAP.md", "wrangler.toml"]

# 触らない場所。
#   data/     … 口コミ本文に URL が入っていても書き換えない
#   docs/ と HANDOFF.md … 過去の記録。当時のホスト名のままが正しい
#   node_modules/ .worktrees/ .git/ … 自分のものではない
SKIP_PARTS = {".git", "node_modules", ".worktrees", "data", "docs", "__pycache__"}
# 中身がテキストでないものは見ない（画像・PDF・フォント）。
SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".zip"}


def walk():
    """書き換える対象のファイルを出す。"""
    for d in SCAN_DIRS:
        base = ROOT / d
        if not base.is_dir():
            continue
        for f in sorted(base.rglob("*")):
            if not f.is_file() or f.suffix.lower() in SKIP_SUFFIX:
                continue
            if SKIP_PARTS & set(f.relative_to(ROOT).parts):
                continue
            yield f.relative_to(ROOT)
    for rel in SCAN_FILES:
        if (ROOT / rel).is_file():
            yield Path(rel)


def outside_scan(host: str, scanned: set[str]) -> list[str]:
    """**走査の外**にホスト名が残っているファイルを挙げる。

    「手で直すと必ず1つ取りこぼす」を防ぐのがこの道具の目的なので、
    走査そのものが取りこぼしていないかを毎回ここで見せる。dry-run でも効く
    （書いたかどうかではなく、走査範囲に入っているかを見ているため）。"""
    out = []
    for f in sorted(ROOT.rglob("*")):
        if not f.is_file() or f.suffix.lower() in SKIP_SUFFIX:
            continue
        rel = f.relative_to(ROOT)
        if {".git", "node_modules", ".worktrees", "__pycache__"} & set(rel.parts):
            continue
        if str(rel) in scanned:
            continue
        try:
            if host in f.read_text(encoding="utf-8", errors="strict"):
                out.append(str(rel))
        except (UnicodeDecodeError, OSError):
            continue
    return out


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
    scanned = set()
    for rel in walk():
        scanned.add(str(rel))
        p = ROOT / rel
        try:
            t = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        n = t.count(a.frm)
        if not n:
            continue
        total += n
        print(f"  {rel}: {n}箇所")
        if not a.dry_run:
            p.write_text(t.replace(a.frm, a.to), encoding="utf-8")

    print(f"\n合計 {total}箇所" + ("（dry-run。書いていない）" if a.dry_run else " を書き換えた"))

    # 走査の外にホスト名が残っていないか、リポジトリ全体を見る。
    rest = outside_scan(a.frm, scanned)
    if rest:
        print(f"\n⚠ 走査の外に {a.frm} が残っている:")
        for r in rest:
            print(f"    {r}")
        print("  docs/ と HANDOFF.md は過去の記録なので、そのままで正しい。"
              "\n  それ以外がここに出たら、SCAN_DIRS / SCAN_FILES に足すこと。")
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
