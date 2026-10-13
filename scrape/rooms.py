#!/usr/bin/env python3
"""KOAN の「教室／Room」を、ログインした本人のセッションで取って data/rooms.json に貯める（2026-10-12）。

外部公開シラバス（fetch.py が使う SYW4201600-flow）は教室を伏せている。
ログイン後のシラバス参照（SYW0001000-flow）の詳細ページにだけ出る。
ログインした cookie でも公開側のフローを開くと伏せられたまま（実測）。

    python3 scrape/rooms.py --limit 5        # まず5件で動作確認
    python3 scrape/rooms.py                  # 全件（7,906件・2秒間隔で約4時間半）
    python3 scrape/rooms.py                  # 中断・cookie 切れのあとは再実行で続きから

cookie は Safari の Web インスペクタで KOAN のリクエストを「cURL としてコピー」したものを
`~/.rakuhan_koan_list.curl` に置く（--curl で変えられる）。**cookie はリポジトリに入れない。**

ログイン後のページには本人の名前などが載るので、HTML は保存しない。教室の文字列だけを残す。
教室は曜限ごとに分かれていない（例: 木1,金1 に「U3-211(ネク),GSE情A,GSE情B」）ので、
KOAN の文字列をそのまま1つ持つ。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shlex
import sys
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent))
import koan  # noqa: E402
from parse import labeled  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / "web" / "data" / "courses.built.json"
OUT = ROOT / "data" / "rooms.json"
LOGIN_FLOW = "SYW0001000-flow"


class LoggedOut(RuntimeError):
    pass


def cookies_of(curl_file: Path) -> dict[str, str]:
    """「cURL としてコピー」の Cookie ヘッダだけを読む。"""
    args = shlex.split(curl_file.read_text(encoding="utf-8").replace("\\\n", " "))
    for i, a in enumerate(args):
        if a in ("-H", "--header") and args[i + 1].lower().startswith("cookie:"):
            pairs = args[i + 1].split(":", 1)[1].split(";")
            return dict(p.strip().split("=", 1) for p in pairs if "=" in p)
    raise SystemExit(f"{curl_file} に Cookie ヘッダが無い。Safari で「cURL としてコピー」し直す")


class LoginKoan(koan.Koan):
    """ログイン後のシラバス参照フローを使う Koan。"""

    def refresh(self) -> str:
        self._wait()
        r = self.s.get(koan.BASE, params={"_flowId": LOGIN_FLOW, "locale": "ja_JP"},
                       timeout=self.timeout)
        r.raise_for_status()
        self.key = self._key_of(r.text)
        if not self.key:
            raise LoggedOut("ログインが切れている（フローが開けない）")
        return r.text


def room_of(html: str) -> str | None:
    """詳細ページの「教室」。公開側のページが返ってきたら止める（「教室なし」と記録しない）。

    ログイン後でも教室の欄そのものが無い科目がある（曜限「他」の 05A011 など）ので、
    欄の有無ではなく公開側の注記で見分ける。ログイン切れは koan.detail の
    張り直し（refresh）で LoggedOut になる。"""
    if "外部公開用に" in html:
        raise LoggedOut("公開側のページが返ってきた（ログインが切れた可能性）")
    return labeled(BeautifulSoup(html, "html.parser")).get("教室") or None


def save(rooms: dict[str, str | None]) -> None:
    doc = {"_meta": {"source": "KOAN シラバス参照（ログイン後）の「教室／Room」",
                     "fetched": dt.date.today().isoformat(),
                     "count": len(rooms)},
           "rooms": dict(sorted(rooms.items()))}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--curl", default=str(Path.home() / ".rakuhan_koan_list.curl"))
    ap.add_argument("--nendo", default="2026")
    ap.add_argument("--limit", type=int, default=0, help="0で全件")
    ap.add_argument("--delay", type=float, default=2.0, help="リクエスト間隔（秒）。短くしない")
    args = ap.parse_args()
    if args.delay < 2.0:
        raise SystemExit("--delay は2秒より短くしない（CLAUDE.md）")

    courses = json.loads(BUILT.read_text(encoding="utf-8"))["courses"]
    rooms = (json.loads(OUT.read_text(encoding="utf-8"))["rooms"] if OUT.exists() else {})
    todo = [c for c in courses if c["id"] not in rooms]
    if args.limit:
        todo = todo[: args.limit]
    print(f"全 {len(courses)} 件・取得済み {len(rooms)} 件・今回 {len(todo)} 件")

    k = LoginKoan(delay=args.delay)
    k.s.cookies.update(cookies_of(Path(args.curl)))
    k.refresh()
    k.search(args.nendo)

    got = 0
    try:
        for i, c in enumerate(todo, 1):
            try:
                html = k.detail(args.nendo, c.get("shozoku_cd") or "13", c["id"])
            except RuntimeError as e:
                if isinstance(e, LoggedOut):
                    raise
                print(f"  !! {c['id']} {c['title'][:20]}: {e}")
                continue
            rooms[c["id"]] = room_of(html)
            got += 1
            if i % 20 == 0 or i == len(todo):
                save(rooms)
                print(f"  {i}/{len(todo)}  教室あり {sum(1 for v in rooms.values() if v)}")
    except LoggedOut as e:
        save(rooms)
        raise SystemExit(f"\n止めた: {e}\n取得済み {len(rooms)} 件は保存した。"
                         "Safari で KOAN にログインし直して cURL を取り直し、もう一度流す")
    save(rooms)
    print(f"\n完了: 今回 {got} 件 → {OUT}")
    print("次は  python3 tools/merge_rooms.py")


if __name__ == "__main__":
    main()
