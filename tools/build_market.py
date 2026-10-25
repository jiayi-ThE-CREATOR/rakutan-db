"""教科書マーケット（試作）の棚データを作る。

courses.built.json の textbooks を「本」ごとに束ねて web/data/market.json に書く。
同じ本を何コマもの授業が使う（『データ・AI利活用のための情報リテラシー入門』は45コマ）ので、
棚には1冊1枚で出し、使う授業をその下に並べる。

まとめ方は書名だけ（全角・半角の空白をつめて NFKC）。版の違い（三訂版／四訂版）は
書名に入っているので別の本になる。ISBN は built に無いので data/textbooks.json から引く。

⚠ 試作用。在庫・価格はここでは作らない（market.js がデモ用に作る）。

    python3 tools/build_market.py
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / "web" / "data" / "courses.built.json"
RAW = ROOT / "data" / "textbooks.json"
OUT = ROOT / "web" / "data" / "market.json"


def key(title: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", title or ""))


def main() -> None:
    built = json.loads(BUILT.read_text(encoding="utf-8"))["courses"]
    isbn = {}
    for books in json.loads(RAW.read_text(encoding="utf-8")).values():
        for b in books if isinstance(books, list) else []:
            if isinstance(b, dict) and b.get("isbn") and b.get("title"):
                isbn.setdefault(key(b["title"]), re.sub(r"[^0-9X]", "", b["isbn"]))

    shelf: dict[str, dict] = {}
    for c in built:
        for b in c.get("textbooks") or []:
            k = key(b.get("title"))
            if not k:
                continue
            e = shelf.setdefault(k, {
                "k": k, "title": b["title"].strip(), "author": b.get("author") or "",
                "publisher": b.get("publisher") or "", "year": b.get("year") or "",
                "isbn": isbn.get(k, ""), "courses": [],
            })
            if any(x["id"] == c["id"] for x in e["courses"]):
                continue
            e["courses"].append({
                "id": c["id"], "title": c["title"], "dp": c.get("day_period") or "",
                "term": c.get("term_group") or "", "ins": (c.get("instructor") or "").split(",")[0].strip(),
            })

    books = sorted(shelf.values(), key=lambda e: (-len(e["courses"]), e["title"]))
    OUT.write_text(json.dumps({"books": books}, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")
    print(f"→ {OUT}  {len(books)}冊（ISBNあり {sum(1 for b in books if b['isbn'])}）")


if __name__ == "__main__":
    main()
