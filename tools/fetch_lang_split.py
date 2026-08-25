"""各学部規程から「第1外国語」の内訳（総合英語・実践英語）を取り、要件表へ合流させる。

    python3 tools/fetch_lang_split.py            # 取得して合流
    python3 tools/fetch_lang_split.py --offline  # data/raw/kitei/ から作り直す

■ なぜ要るか
CELAS の卒業要件表は「第1外国語」を1行でしか出さない（例：8単位）。
一方、課網には「総合英語」589件・「実践英語」4件が別々の科目として実在する
（所属14 マルチリンガル教育センター）。学生が絞り込むのはこの粒度なので、
各学部規程が定めている内訳をここで補う。

■ 出所
大阪大学の規程集（https://www.osaka-u.ac.jp/kitei/）の学部規程。
CELAS とは独立した公式文書なので、突き合わせが検算になる。

例外が2つある。どちらも規程集から取れないので出所を明記して直接持つ：
  - 工学部  … 規程は「合計8単位以上」としか書かず内訳が無い。
               履修案内（令和8年度）の表が 総合英語6・実践英語2 を示す
  - 外国語学部 … 規程集に学部規程が無い。学部公式の
               「単位修得状況チェックシート（2025年度以降入学者用）」が
               総合英語4・実践英語2 を示す（この学部だけ計6単位）

■ 壊れたら止まる
総合英語＋実践英語が CELAS の「第1外国語」と一致しない学部があれば中止する。
卒業要件の数字なので、黙って食い違ったまま書かない。
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "data" / "faculty_requirements.json"
RAW = ROOT / "data" / "raw" / "kitei"
BASE = "https://www.osaka-u.ac.jp/kitei/reiki_honbun/u035RG{:08d}.html"
DELAY = 2.0
UA = "rakutan-db/0.1 (Osaka Univ. student project; contact via GitHub)"

# 学部キー → 規程集の条例番号
KITEI_ID = {
    "letters": 151, "human-sci": 156, "law": 164, "economics": 169,
    "science": 174, "medicine": 183, "dentistry": 203, "pharmacy": 213,
    "engr-sci": 230,
}

# 規程集から取れない2学部。値と出所を明示して持つ（上の docstring 参照）。
MANUAL = {
    "engineering": {
        "sogo": 6, "jissen": 2,
        "source": "工学部 履修案内（令和8年度）教育課程表 "
                  "https://www.eng.osaka-u.ac.jp/wp-content/uploads/pdf/"
                  "student/ug_curriculum/2026_1_bc_curriculum.pdf",
        "note": "規程は「合計8単位以上」までで内訳が無い。履修案内の表から。",
    },
    "foreign-s": {
        "sogo": 4, "jissen": 2,
        "source": "外国語学部 単位修得状況チェックシート（2025年度以降入学者用） "
                  "https://www.sfs.osaka-u.ac.jp/guide/",
        "note": "規程集に学部規程が無い。この学部だけ第1外国語は計6単位。",
    },
}

_TAG = re.compile(r"<[^>]+>")


def page_text(raw: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", raw)))


def _num_after(text: str, word: str, window: int = 220) -> int | None:
    """word の直後 window 文字以内で最初に出る「N単位」の N を返す。"""
    i = text.find(word)
    if i < 0:
        return None
    seg = unicodedata.normalize("NFKC", text[i + len(word): i + len(word) + window])
    m = re.search(r"(\d+)\s*単位", seg)
    return int(m.group(1)) if m else None


def parse_split(text: str) -> tuple[int | None, int | None]:
    """(総合英語, 実践英語) の単位数。書き方は学部ごとに違うが、
    「総合英語…N単位」「実践英語…N単位」という並びは共通している。"""
    return _num_after(text, "総合英語"), _num_after(text, "実践英語")


def fetch(kid: int) -> str:
    r = requests.get(BASE.format(kid), headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()

    doc = json.loads(REQ.read_text(encoding="utf-8"))
    RAW.mkdir(parents=True, exist_ok=True)

    splits: dict[str, dict] = {}
    for i, (key, kid) in enumerate(KITEI_ID.items()):
        cache = RAW / f"{key}.html"
        if args.offline:
            if not cache.exists():
                raise SystemExit(f"中止: {cache} が無い。--offline を外すこと")
            raw = cache.read_text(encoding="utf-8")
        else:
            if i:
                time.sleep(DELAY)
            raw = fetch(kid)
            cache.write_text(raw, encoding="utf-8")
        sogo, jissen = parse_split(page_text(raw))
        if sogo is None or jissen is None:
            raise SystemExit(f"中止: {key} の規程から内訳を読めなかった "
                             f"(総合英語={sogo} 実践英語={jissen})")
        splits[key] = {"sogo": sogo, "jissen": jissen,
                       "source": f"大阪大学学部規程 {BASE.format(kid)}", "note": ""}
    splits.update(MANUAL)

    changed = 0
    for fac in doc["faculties"]:
        sp = splits.get(fac["key"])
        if not sp:
            raise SystemExit(f"中止: {fac['label']} の内訳が無い")
        target = next((r for r in fac["requirements"] if r["divisions"] == ["lang1"]), None)
        if target is None:
            raise SystemExit(f"中止: {fac['label']} に第1外国語の行が無い")

        # 検算：内訳の合計が CELAS の「第1外国語」と一致すること
        total = unicodedata.normalize("NFKC", target["values"][0])
        m = re.search(r"\d+", total)
        if not m or int(m.group(0)) != sp["sogo"] + sp["jissen"]:
            raise SystemExit(
                f"中止: {fac['label']} で内訳が合わない。\n"
                f"      CELAS の第1外国語 = {target['values'][0]} / "
                f"規程の内訳 = 総合英語{sp['sogo']} + 実践英語{sp['jissen']}\n"
                f"      どちらかの出所が変わっている。目視で確かめること。")

        n = len(target["values"])
        idx = fac["requirements"].index(target)
        fac["requirements"][idx + 1:idx + 1] = [
            {"divisions": ["lang1_sogo"], "values": [str(sp["sogo"])] * n,
             "source": sp["source"], "note": sp["note"]},
            {"divisions": ["lang1_jissen"], "values": [str(sp["jissen"])] * n,
             "source": sp["source"], "note": sp["note"]},
        ]
        changed += 1
        print(f"  {fac['label']:8s} 第1外国語 {target['values'][0]:>3s} = "
              f"総合英語 {sp['sogo']} + 実践英語 {sp['jissen']}")

    from tools.requirements_parse import DIVISIONS
    doc["divisions"] = DIVISIONS
    doc["_meta"]["lang1_split_source"] = "大阪大学 学部規程（例外2件は MANUAL 参照）"
    REQ.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {REQ}  {changed} 学部に内訳を入れた")


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    main()
