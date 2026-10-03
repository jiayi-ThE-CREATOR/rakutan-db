#!/usr/bin/env python3
"""シラバスの「教科書・指定教材」の文章を、本ごとの 著者／書名／出版社／出版年 に分ける（2026-10-02）。

    python3 tools/extract_textbooks.py --raw ../rakutan-db/data/raw      # 抽出（未処理の文章だけ）
    python3 tools/extract_textbooks.py --openbd                          # 出版年を ISBN で補う

結果は data/textbooks.json（commit する）。キーは文章の sha1 先頭12桁、値は本のリスト。
同じ文章は複数科目で共有されるので、2,714科目でも文章は約1,500種類しかない。

なぜ AI か
──────────
KOAN の欄は自由記述。「著者／書名／出版社／ISBN」の書式は約2割で、残りは『』・「著」・
「授業時に配布」などが混ざる。正規表現では切れないので claude -p（サブスク枠・API 課金なし）
で分ける。**サイトは AI を呼ばない** ―― ここで1回作った JSON を merge_textbook.py が焼くだけ。

AI に字を足させない
──────────────────
著者・書名・出版社・出版年・ISBN は、**原文に（空白と記号を除いて）そのまま出てくる文字列**で
なければ捨てる（verify）。AI が書名を補ったり、出版社を推測したりしても画面には出ない。

出版年の補い（--openbd）
────────────────────────
原文に年が無く ISBN がある本だけ、openBD（ISBN で引ける無料の書誌 API）で出版年を引く。
引いた年は `year_ref: true` を付け、画面では「（参考）」を添える ―― 指定の版と違う版の年の
ことがあるため（本人判断・2026-10-02）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import subprocess
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bs4 import BeautifulSoup                    # noqa: E402
from scrape.parse import labeled, textbook_of    # noqa: E402

OUT = ROOT / "data" / "textbooks.json"
MODEL = "claude-sonnet-5-5"
BATCH = 30

SYSTEM = """あなたは大学シラバスの「教科書・指定教材」欄を書誌に分ける係です。
入力は id と text の配列。各 text について、名指しされている本を1冊ずつ取り出してください。

規則:
- author / title / publisher / year / isbn は、text に**書かれている文字列をそのまま**写す。言い換え・補完・翻訳・推測は禁止。書かれていなければ null
- title は書名だけ（『』「」の括弧は外す。版表記「第3版」などは書名に含めてよい）
- author は「編」「著」「監修」などの役割語を含めてよい。複数著者は原文の区切りのまま
- year は西暦4桁の数字だけ（例 2021）。原文に年が無ければ null
- isbn は数字と X とハイフンだけ。無ければ null
- 「授業時に配布」「プリント」「CLE にアップロード」など本でないものは出さない
- 「参考書」「参考文献」として挙がっている本は出さない（教科書・指定教材だけ）
- 本が1冊も無ければ books は空配列
"""

SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "books": {"type": "array", "items": {
                "type": "object",
                "properties": {k: {"type": ["string", "null"]} for k in
                               ("author", "title", "publisher", "year", "isbn")},
                "required": ["author", "title", "publisher", "year", "isbn"],
                "additionalProperties": False}},
        },
        "required": ["id", "books"], "additionalProperties": False}}},
    "required": ["items"], "additionalProperties": False,
}


def key_of(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def norm(s: str) -> str:
    """照合用：NFKC・空白と記号を落とす（『』や／、ハイフンの違いを吸収）。"""
    s = unicodedata.normalize("NFKC", s)
    return "".join(ch for ch in s if not ch.isspace() and unicodedata.category(ch)[0] not in "PS")


def verify(book: dict, text: str) -> dict | None:
    """原文に無い文字列は捨てる。書名が残らなければ本ごと捨てる。"""
    src = norm(text)
    out = {}
    for k in ("author", "title", "publisher", "isbn"):
        v = (book.get(k) or "").strip()
        out[k] = v if v and norm(v) and norm(v) in src else None
    y = (book.get("year") or "").strip()
    out["year"] = y if re.fullmatch(r"(19|20)\d\d", y) and y in unicodedata.normalize("NFKC", text) else None
    if out["isbn"] and len(re.sub(r"[^0-9Xx]", "", out["isbn"])) not in (10, 13):
        out["isbn"] = None
    return out if out["title"] else None


def texts_from(raw_dirs: list[str]) -> dict[str, str]:
    """生HTML → {key: 文章}。textbook_of を通ったもの（＝本が名指しされている）だけ。
    textbook_of は300字で切るので、ここは切る前の全文を渡す。"""
    out = {}
    for d in raw_dirs:
        for f in sorted(Path(d).glob("**/detail/*.html")):
            L = labeled(BeautifulSoup(f.read_text(encoding="utf-8"), "html.parser"))
            t = textbook_of(L)
            if t:
                full = (L.get("教科書・指定教材") or "").strip()
                out[key_of(t)] = full
    return out


def claude_call(items: list[dict]) -> list[dict]:
    cmd = ["claude", "-p", "--model", MODEL, "--system-prompt", SYSTEM, "--tools", "",
           "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands",
           "--no-session-persistence", "--output-format", "json",
           "--json-schema", json.dumps(SCHEMA, ensure_ascii=False)]
    user = json.dumps(items, ensure_ascii=False)
    for attempt in range(4):
        p = subprocess.run(cmd, input=user, capture_output=True, text=True, timeout=600, cwd="/tmp")
        try:
            d = json.loads(p.stdout)
        except json.JSONDecodeError:
            d = {"is_error": True, "result": p.stdout[:200] + p.stderr[:200]}
        if not d.get("is_error") and d.get("structured_output"):
            return d["structured_output"]["items"]
        print(f"  retry {attempt + 1}: {str(d.get('result'))[:120]}", file=sys.stderr)
        time.sleep(10 * 2 ** attempt * random.uniform(0.5, 1.5))
    raise RuntimeError("claude -p が4回失敗")


def extract(raw_dirs: list[str], workers: int) -> None:
    texts = texts_from(raw_dirs)
    done = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = [k for k in texts if k not in done]
    print(f"文章 {len(texts)} 種類／処理済み {len(texts) - len(todo)}／これから {len(todo)}")
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]

    def run(keys: list[str]) -> dict:
        got = claude_call([{"id": k, "text": texts[k]} for k in keys])
        res = {}
        for it in got:
            if it["id"] in keys:
                res[it["id"]] = [b for b in (verify(b, texts[it["id"]]) for b in it["books"]) if b]
        return res

    with ThreadPoolExecutor(workers) as ex:
        for i, res in enumerate(ex.map(run, batches), 1):
            done |= res
            OUT.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  {i}/{len(batches)} バッチ（累計 {len(done)}）")


def _ssl_ctx():
    """python.org 版の Python は証明書を持たず https が通らない（2026-10-02 実測）。certifi があれば使う。"""
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def openbd() -> None:
    """原文に年が無く ISBN がある本に、openBD の出版年を year_ref 付きで足す。"""
    done = json.loads(OUT.read_text(encoding="utf-8"))
    want = {}
    for books in done.values():
        for b in books:
            if b["isbn"] and not b["year"]:
                want.setdefault(re.sub(r"[^0-9Xx]", "", b["isbn"]), []).append(b)
    isbns = list(want)
    print(f"出版年を引く ISBN {len(isbns)} 件")
    hit = 0
    for i in range(0, len(isbns), 500):
        chunk = isbns[i:i + 500]
        req = urllib.request.Request("https://api.openbd.jp/v1/get",
                                     data=("isbn=" + ",".join(chunk)).encode(),
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        res = json.loads(urllib.request.urlopen(req, timeout=60, context=_ssl_ctx()).read())
        for isbn, r in zip(chunk, res):
            m = re.match(r"(19|20)\d\d", ((r or {}).get("summary") or {}).get("pubdate") or "")
            if m:
                hit += 1
                for b in want[isbn]:
                    b["year"], b["year_ref"] = m.group(0), True
        time.sleep(1)
    OUT.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  openBD で年が分かった ISBN {hit} 件")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", action="append")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--openbd", action="store_true")
    args = ap.parse_args()
    if args.raw:
        extract(args.raw, args.workers)
    if args.openbd:
        openbd()


if __name__ == "__main__":
    main()
