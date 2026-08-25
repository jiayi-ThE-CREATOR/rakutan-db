"""学部規程の別表から「どの科目が必修か」を取り出し、data/senmon_tables.json を作る。

    python3 tools/fetch_senmon.py --offline   # data/raw/kitei/ から作り直す（既定）
    python3 tools/fetch_senmon.py             # 規程集から取り直してから作る

■ なぜ生成物を data/ に置くか
判定を実行時にやるには表が要るが、`data/raw/` は巨大なので git に入れていない
（.gitignore）。`server.py` は `tools.division.divide()` を毎リクエスト呼ぶので、
**HTML が無い環境でも動く形**にしないと本番で区分が消える。
data/faculty_requirements.json と同じ扱いで、生成物だけを追跡する。

■ 学科コードの対応は推測していない
ナンバリング[2:6]（09ELEC の ELEC）と別表の学科・コースの対応は、
**KOAN の科目名がどの別表に載っているかを数えて**決めた（2026-08-26 実測）。
        ELEC → エレクトロニクスコース      41/43件が一致
        MAPH → 物性物理科学コース          24/27
        CHEM → 合成化学コース              52/84   CHEN → 化学工学コース    29/33
        MESC → 機械科学コース              44/45   INSS → 知能システム学    29/35
        BIEN → 生物工学コース              27/32   MASC → 数理科学コース    24/26
        CSSS → 計算機科学／ソフトウェア科学 44/44（両コースで同点。学科は同じ）
        理学部  MATH→数学科50 PHYS→物理学科44 CHEM→化学科56 BISC→生物科学科32/33
        保健    NURS→看護学専攻59/65 MEPE→放射線技術科学42/43 LASC→検査技術科学48/49
字面の似ているコードから当てたのではない。増えたコードは None にすること。

■ 「必修」が学生の属性になる場合は落とす
同じ科目が、あるコースでは必修、別のコースでは選択、という行が実在する
（基礎工の「応用数理C」は機械科学コースだけ選択必修）。**科目の側では割れない**
ので、その科目は必修にしない。件数は build 時に数えて HANDOFF に残す。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.kitei import norm, tables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "kitei"
OUT = ROOT / "data" / "senmon_tables.json"
BASE = "https://www.osaka-u.ac.jp/kitei/reiki_honbun/u035RG{:08d}.html"
DELAY = 2.0
UA = "rakutan-db/0.1 (Osaka Univ. student project; contact via GitHub)"

# tools/fetch_lang_split.py と同じ番号。片方だけ直すと食い違うので、
# 増やすときは両方を見ること。
KITEI_ID = {
    "letters": 151, "human-sci": 156, "law": 164, "economics": 169,
    "science": 174, "medicine": 183, "dentistry": 203, "pharmacy": 213,
    "engr-sci": 230,
}

REQUIRED, ELECTIVE_REQ, ELECTIVE = "必修", "選択必修", "選択"


def _src(key: str, table: str) -> str:
    return f"大阪大学{LABEL[key]}規程 {table} {BASE.format(KITEI_ID[key])}"


LABEL = {
    "letters": "文学部", "human-sci": "人間科学部", "law": "法学部",
    "economics": "経済学部", "science": "理学部", "medicine": "医学部",
    "dentistry": "歯学部", "pharmacy": "薬学部", "engr-sci": "基礎工学部",
}


def _rows(grid: list[list[str]], title_header: str) -> list[tuple[str, list[str]]]:
    """(科目名, その行の全セル) を返す。見出し行は落とす。

    科目名の列は**見出しの文字で引く**。列番号を直接書くと、
    区分の段数が学部ごとに違う（人間科学部は4段、法学部は1段）ぶんだけ外れる。
    """
    if not grid:
        return []
    head = next((r for r in grid if title_header in r), None)
    if head is None:
        return []
    col = len(head) - 1 - head[::-1].index(title_header)   # 同名が続く場合は右端
    out = []
    for row in grid[grid.index(head) + 1:]:
        if len(row) <= col or title_header in row:
            continue
        if row[col]:
            out.append((row[col], row))
    return out


def _sections(key: str):
    """(直前の本文, 表) に「いま何の節か」を足して返す。

    理学部は同じ学科名の表が3回出る（高度教養／専門基礎教育科目／専門教育科目）。
    見出しは節の先頭の表の直前にしか無いので、出てきた節を持ち回る。
    """
    cur = ""
    for before, grid in tables(str(RAW / f"{key}.html")):
        # 1つの本文に複数の節名が出ることがある（「…高度国際性涵養教育科目から
        # 2単位以上…(※2) 専門教育科目 数学科」）。**最後に現れたもの**が
        # その表の節。tuple の順で上書きすると、後ろの節名を先頭の節で潰す。
        seen = [(before.rfind(m), m) for m in
                ("専門教育科目", "専門基礎教育科目", "高度教養教育科目")]
        pos, mark = max(seen)
        if pos >= 0:
            cur = mark
        yield before, grid, cur


# ── 学部ごとの読み方 ───────────────────────────────
# 戻り値は {学科コード: {正規化した科目名: 必修/選択必修/選択}}。
# 学科を持たない学部はコード "" ひとつに入れる。

def _letters() -> dict:
    """文学部だけ規程に別表が無い（履修規程のみ）。

    第3条が名指しするのは「文学部共通概説」と「卒業論文」の2つだけ。
    残りの必修28単位は「所属する専修の講義及び演習」＝**学生の属性**で、
    科目の側では割れない（工学部のコース別◎と同じ理由）。猜わない。
    """
    return {"": {norm("文学部共通概説"): REQUIRED, norm("卒業論文"): REQUIRED}}


def _human_sci() -> dict:
    got = {}
    for before, grid, _ in _sections("human-sci"):
        if "(2) 専門教育科目" not in before:
            continue
        for title, row in _rows(grid, "授業科目名"):
            kind = next((c for c in row if c in ("必修科目", "選択必修科目", "選択科目")), None)
            if kind:
                got[norm(title)] = kind.replace("科目", "")
    return {"": got}


def _law() -> dict:
    """種別欄 ◎＝必修、◇＝選択必修、無印＝選択（別表2―1／2―2 の履修方法）。

    「国際」は高度国際性涵養教育科目を兼ねる印であって必修選択の別ではない。
    別表2―1（法学科）に ◇ は無く、履修方法も ◎ と無印しか説明していない。
    """
    marks = {"◎": REQUIRED, "◇": ELECTIVE_REQ}
    got = {}
    for before, grid, _ in _sections("law"):
        m = re.search(r"別表2―([12])\s*専門教育系科目の授業科目\(([^)]+)\)$", before.strip())
        if not m:
            continue
        code = {"法学科": "LAW_", "国際公共政策学科": "INPP"}[m.group(2)]
        got[code] = {norm(t): marks.get(row[-1], ELECTIVE) for t, row in _rows(grid, "科目名")}
    return got


def _economics() -> dict:
    """区分の列がそのまま必修選択の別。選択必修1／2 はどちらも選択必修。

    「選択科目(教職)」「選択科目(実践講義)」も選択科目の一種。
    """
    got = {}
    for before, grid, _ in _sections("economics"):
        for title, row in _rows(grid, "授業科目"):
            k = row[0]
            if k.startswith("必修"):
                got[norm(title)] = REQUIRED
            elif k.startswith("選択必修"):
                got[norm(title)] = ELECTIVE_REQ
            elif k.startswith("選択科目"):
                got[norm(title)] = ELECTIVE
    return {"": got}


SCIENCE_DEPT = {"数学科": "MATH", "物理学科": "PHYS", "化学科": "CHEM",
                "生物科学科": "BISC"}


def _science() -> dict:
    """別表2の学科別の表。「必修選択の別」の列をそのまま採る。

    同じ学科名の表が3回出るので、節が「専門教育科目」のものだけを見る。
    国際科学特別プログラムと生物科学科の2コースは、ナンバリングでは
    区別できない（どちらも 04BISC）ので同じ学科へ寄せる。
    食い違った科目は下流（tools/senmon.py）が落とす。
    """
    got: dict[str, dict[str, str]] = {}
    for before, grid, section in _sections("science"):
        if section != "専門教育科目":
            continue
        tail = before.strip()
        dept = next((d for d in SCIENCE_DEPT if tail.endswith(d) or f"{d}生" in tail
                     or tail.endswith(f"{d}(国際科学特別プログラム)")), None)
        if dept is None:
            continue
        bucket = got.setdefault(SCIENCE_DEPT[dept], {})
        for title, row in _rows(grid, "授業科目"):
            # 「必修・選択科目」という行が生物科学科生命理学コースに実在する。
            # どちらとも読めるので採らない（猜うと必修が水増しされる）。
            kind = next((c for c in row if c in ("必修科目", "選択必修科目", "選択科目")), None)
            if not kind:
                continue
            v = kind.replace("科目", "")
            if bucket.get(norm(title), v) != v:
                bucket[norm(title)] = "食い違い"
            else:
                bucket[norm(title)] = v
    return got


ENGR_SCI_COURSE = {
    "電子物理科学科(エレクトロニクスコース)": ["ELEC"],
    "電子物理科学科(物性物理科学コース)": ["MAPH"],
    "化学応用科学科(合成化学コース)": ["CHEM"],
    "化学応用科学科(化学工学コース)": ["CHEN"],
    "システム科学科(機械科学コース)": ["MESC"],
    "システム科学科(知能システム学コース)": ["INSS"],
    "システム科学科(生物工学コース)": ["BIEN"],
    "情報科学科(計算機科学コース)": ["CSSS"],
    "情報科学科(ソフトウェア科学コース)": ["CSSS"],
    "情報科学科(数理科学コース)": ["MASC"],
}


def _engr_sci() -> dict:
    """コース別の表。ナンバリングのコードは9種で、コースとほぼ1対1。

    CSSS だけ計算機科学とソフトウェア科学の2コースに同点で乗る（両方とも
    情報科学科）。2つの表で必修選択が食い違う科目は「食い違い」にして落とす。
    """
    got: dict[str, dict[str, str]] = {}
    for before, grid, _ in _sections("engr-sci"):
        tail = before.strip()
        name = next((n for n in ENGR_SCI_COURSE if tail.endswith(n)), None)
        if name is None:
            continue
        for code in ENGR_SCI_COURSE[name]:
            bucket = got.setdefault(code, {})
            for title, row in _rows(grid, "授業科目名"):
                kind = next((c for c in row if c in ("必修科目", "選択必修科目", "選択科目")), None)
                if not kind:
                    continue
                v = kind.replace("科目", "")
                if bucket.get(norm(title), v) != v:
                    bucket[norm(title)] = "食い違い"
                else:
                    bucket[norm(title)] = v
    return got


MEDICINE_DEPT = {"看護学専攻": "NURS", "放射線技術科学専攻": "MEPE",
                 "検査技術科学専攻": "LASC"}


def _medicine() -> dict:
    """医学科（別表2―2）と保健学科3専攻（別表4）。単位数が必修欄か選択欄かで決まる。

    「必修」「選択」の2列があり、その科目の単位数が入っているほうが答え。
    どちらにも入っていない行（見出しの続き）は採らない。
    """
    got: dict[str, dict[str, str]] = {}

    def read(grid, code):
        head = next((r for r in grid if "必修" in r and "選択" in r), None)
        title_head = next((r for r in grid if "授業科目" in r), None)
        if head is None or title_head is None:
            return
        ci_req = len(head) - 1 - head[::-1].index("必修")
        ci_opt = len(head) - 1 - head[::-1].index("選択")
        col = len(title_head) - 1 - title_head[::-1].index("授業科目")
        bucket = got.setdefault(code, {})
        for row in grid[grid.index(head) + 1:]:
            if len(row) <= max(ci_req, ci_opt, col) or "授業科目" in row:
                continue
            t = row[col]
            if not t:
                continue
            if row[ci_req]:
                bucket[norm(t)] = REQUIRED
            elif row[ci_opt]:
                bucket[norm(t)] = ELECTIVE

    for before, grid, _ in _sections("medicine"):
        tail = before.strip()
        if tail.endswith("別表2―2"):
            read(grid, "MEDI")
        else:
            dept = next((d for d in MEDICINE_DEPT if tail.endswith(d)), None)
            if dept:
                read(grid, MEDICINE_DEPT[dept])
    return got


def _dentistry() -> dict:
    """別表第2―2。備考が「(＊)印を付していない専門教育科目はすべて必修である」。

    つまり ＊ が付いていれば選択、付いていなければ必修。印は科目名の**後ろ**に
    付く（「口腔科学演習(＊)」「国際歯科学演習(＊)◇」）。◇ は高度国際性涵養教育科目を
    兼ねる印で、必修選択の別ではない。授業科目の列は4段（基礎科目Ⅰ期＞解剖学）あり、
    右端が科目名。

    括弧を落とす norm() を先に通すと (＊) ごと消えるので、**印の判定は生の字面で**やる。
    """
    got = {}
    for before, grid, _ in _sections("dentistry"):
        if not before.strip().endswith("別表第2―2"):
            continue
        for title, row in _rows(grid, "授業科目"):
            elective = "＊" in title or "*" in title
            t = re.sub(r"[(（][＊*][)）]|◇", "", title).strip()
            if t:
                got[norm(t)] = ELECTIVE if elective else REQUIRED
    return {"": got}


def _pharmacy() -> dict:
    """別表第2。3コース（先進研究／Pharm.D／薬学研究）の指示が ◎○△ で並ぶ。

    ナンバリングは 07PHAM 一種類しか無く、**どのコースの科目かは科目の側から
    分からない**。だから3コースの指示が揃っているものだけを採る:
        ◎◎◎ → 必修（54件）  ○○○ → 選択（11件）  それ以外9件は落とす
    """
    got = {}
    for before, grid, _ in _sections("pharmacy"):
        head = next((r for r in grid if "コース別の指示" in r), None)
        if head is None:
            continue
        start = max(i for i, r in enumerate(grid) if "授業科目" in r) + 1
        for row in grid[start:]:
            if len(row) < 5 or not row[0]:
                continue
            marks = tuple(row[2:5])
            if marks == ("◎", "◎", "◎"):
                got[norm(row[0])] = REQUIRED
            elif marks == ("○", "○", "○"):
                got[norm(row[0])] = ELECTIVE
    return {"": got}


READERS = {
    "letters": (_letters, "履修規程第3条"),
    "human-sci": (_human_sci, "別表3"),
    "law": (_law, "別表2―1・2―2"),
    "economics": (_economics, "別表2"),
    "science": (_science, "別表2"),
    "medicine": (_medicine, "別表2―2・別表4"),
    "dentistry": (_dentistry, "別表第2―2"),
    "pharmacy": (_pharmacy, "別表第2"),
    "engr-sci": (_engr_sci, "別表2"),
}


def fetch() -> None:
    import requests
    RAW.mkdir(parents=True, exist_ok=True)
    for key, num in KITEI_ID.items():
        url = BASE.format(num)
        r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
        (RAW / f"{key}.html").write_text(r.text, encoding="utf-8")
        print(f"  取得 {key}  {len(r.text):,}文字")
        time.sleep(DELAY)


def build() -> dict:
    out = {
        "_meta": {
            "source": "大阪大学 学部規程（規程集）の別表",
            "base_url": "https://www.osaka-u.ac.jp/kitei/",
            "generated": time.strftime("%Y-%m-%d"),
            "note": "値は 必修／選択必修／選択／食い違い。"
                    "「食い違い」は同じ科目が学科・コースで別扱いになっているもので、"
                    "科目の側では割れない（区分を付けない）。",
        },
        "faculties": {},
    }
    for key, (reader, table) in READERS.items():
        got = reader()
        out["faculties"][key] = {
            "label": LABEL[key],
            "source": _src(key, table),
            "courses": got,
        }
        n = sum(len(v) for v in got.values())
        bad = sum(1 for v in got.values() for x in v.values() if x == "食い違い")
        print(f"  {LABEL[key]:8s} {len(got)}区分 {n:4d}行"
              + (f"（うち食い違い {bad}）" if bad else ""))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", default=True)
    ap.add_argument("--fetch", dest="offline", action="store_false")
    a = ap.parse_args()
    if not a.offline:
        fetch()
    doc = build()
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"→ {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
