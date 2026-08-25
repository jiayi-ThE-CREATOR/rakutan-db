# 学部から科目区分でしぼる 実装計画

> **エージェント向け：** 必須サブスキル ―― `superpowers:subagent-driven-development`
> または `superpowers:executing-plans` でタスク単位に実行すること。
> 各ステップは `- [ ]` のチェックボックスで進捗を管理する。

**ゴール：** 学生が自分の学部を選ぶと、自分の卒業要件にある科目区分
（人文科学系・情報教育科目・専門基礎教育科目…）で科目をしぼり込めるようにする。

**方針：** 要件表（学部→区分→単位数）は CELAS の11ページを**機械的にパースして**
`data/faculty_requirements.json` を生成する。科目側の区分は科目名の接頭辞とナンバリングから
**推定**し、判定できないものは `null` のまま残す。画面のセクションは `app.js` が
自分で差し込み、`index.html` と `app.css`（松下さん担当）には一切触らない。

**技術スタック：** 素の HTML / CSS / JavaScript（ビルドなし）、
Python 3 標準ライブラリ（`re` / `json` / `unicodedata`）＋
取得スクリプトだけ `requests`（`scrape/koan.py` が既に使っている）。**新しい依存は入れない。**

**設計（スペック）：** `docs/plans/2026-08-24-faculty-division-filter-design.md`。
**この計画とスペックの両方を読むこと。** 数字の根拠と「なぜそうしないか」は全部あちらにある。

---

## Global Constraints

これは全タスクの要件。各タスクの中で繰り返さない。

- **ブランチは `feat/wang-division-filter`（`main` から分岐ずみ）。`main` には触らない。**
- **`web/index.html` と `web/assets/app.css` を編集しない。** 松下さんの担当ファイルで、
  `feat/matsushita-kuchikomi-panel` が同じ場所を触っている。新しい CSS クラスも作らない
  ―― 既存の `.chips` `.chip` `.chip .n` `section h2` `.sub` `.toggle` `.railNote` を使い回す。
- **新しい依存を入れない。** `requirements.txt` を変えない。
  パーサとテストは**標準ライブラリのみ**（ネットワークに出ないので依存が要らない）。
  取得スクリプトだけ `requests` を使う ―― `scrape/koan.py` が既に使っているもので、
  新規依存ではない。標準の `urllib` は python.org 版 Python だと証明書を持たず
  SSL 検証に失敗する（2026-08-24 実測）。
- **区分の識別子（key）は14個で固定**：`tobira` `adv_seminar` `kiban_jinbun` `kiban_shakai`
  `kiban_shizen` `kiban_sogo` `kodo_kyoyo` `joho` `health_sports` `senmon_kiso`
  `lang1` `lang2` `lang_opt` `global`。`other` は**画面だけの値**でデータには書かない。
- **判定できない科目は `division: null`。** 「その他」はラベルであって区分ではない。
- **要件表の数字を手で書かない。** 生成物だけを信じる。
- Python は `python3`。テストは `PYTHONIOENCODING=utf-8 python3 tools/test_*.py` で走る
  （既存の `tools/test_*.py` と同じく `unittest` ではなく素の `assert` ＋ `main()`）。
- 大学のサーバへ連続アクセスするときは **1リクエストごとに2秒あける**
  （`scrape/fetch.py` と同じ。ここを削らない）。

---

## ファイル構成

| ファイル | 責任 |
|---|---|
| `tools/requirements_parse.py` | **新規。** CELAS ページの HTML を読む純関数だけ。ネットワークに出ない |
| `tools/fetch_requirements.py` | **新規。** 11ページを取得し、パーサに渡し、JSON を書く |
| `tools/test_requirements.py` | **新規。** パーサのテスト。ネットワークに出ない |
| `tools/division.py` | **新規。** 科目1件 → 区分1つ の純関数だけ |
| `tools/test_division.py` | **新規。** 推定規則のテスト＋全件の件数検算 |
| `tools/division_survey.py` | **新規。** 「その他」の一覧を出す（政岡さんへ渡す用） |
| `data/faculty_requirements.json` | **新規（生成物）。** 要件表の正本 |
| `build.py` | 変更。`division` / `division_source` を焼き、要件表を `web/data/` へ写す |
| `server.py` | 変更。`/api/meta` に区分、`/api/requirements` を追加、`division=` で絞る |
| `web/assets/app.js` | 変更。セクションの生成・状態・絞り込み |

パーサを `fetch` から分けているのは、**テストをネットワークから切り離すため**
（`tools/eligibility.py` と `tools/eligibility_survey.py` の分け方に合わせた）。

---

## Task 1: 要件表のパーサ

表の `rowspan` を展開して「結合セル1つ＝1グループ」に組み直す。
**ここが計画全体で一番壊れやすい。** 先にテストを書く。

**Files:**
- Create: `tools/requirements_parse.py`
- Test: `tools/test_requirements.py`

**Interfaces:**
- Produces:
  - `DIVISIONS: list[dict]` ―― `{"key","label","group"}` が14件、要件表の並び順
  - `parse_table(table_html: str) -> list[dict]` ―― `[{"divisions": [key,...], "value": str}]`
  - `parse_page(page: str) -> list[dict]` ―― `[{"department": str|None, "groups": [...]}]`
  - `parse_notes(page: str) -> list[str]`

- [ ] **Step 1: テストを書く（先に失敗させる）**

`tools/test_requirements.py`:

```python
"""要件表パーサのテスト。ネットワークには出ない。

実測（2026-08-24）で出た表の形を最小の HTML に写して確かめる。
一番大事なのは「rowspan の結合＝合計単位数」を取り違えないこと。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.requirements_parse import DIVISIONS, parse_notes, parse_page, parse_table

# 文学部・理学部の形：基盤教養の4区分が rowspan="4" で1セル（＝4つ合わせて6単位）
MERGE4 = """<table><tbody>
<tr><th rowspan="9">教養教育系科目</th><th colspan="2">学問への扉</th><td>2</td></tr>
<tr><th colspan="2">アドヴァンスト・セミナー</th><td>＊</td></tr>
<tr><th rowspan="4">基盤教養教育科目（注１）</th><th>人文科学系</th><td rowspan="4">6</td></tr>
<tr><th>社会科学系</th></tr>
<tr><th>自然科学系</th></tr>
<tr><th>総合型</th></tr>
<tr><th colspan="2">高度教養教育科目</th><td>＊</td></tr>
<tr><th colspan="2">情報教育科目</th><td>2</td></tr>
<tr><th colspan="2">健康・スポーツ教育科目</th><td>2</td></tr>
<tr><th>専門教育系科目</th><th colspan="2">専門基礎教育科目</th><td>25</td></tr>
<tr><th rowspan="4">国際性涵養教育系科目</th><th rowspan="4">マルチリンガル教育科目</th>
    <th>第１外国語</th><td>8</td></tr>
<tr><th>第２外国語</th><td>3</td></tr>
<tr><th>選択外国語</th><td>－</td></tr>
<tr><th>グローバル理解</th><td>2</td></tr>
</tbody></table>"""

# 工学部・医学部の形：アドヴァンスト・セミナーまで巻き込んだ rowspan="5"。
# 医学部は値が <span class="strong">＊</span>6 のようにタグ入りで来る。
MERGE5 = MERGE4.replace(
    '<tr><th colspan="2">アドヴァンスト・セミナー</th><td>＊</td></tr>',
    '<tr><th colspan="2">アドヴァンスト・セミナー</th>'
    '<td rowspan="5"><span class="strong">＊</span>6</td></tr>'
).replace('<th>人文科学系</th><td rowspan="4">6</td>', '<th>人文科学系</th>')


def test_merge4_is_one_group():
    groups = parse_table(MERGE4)
    by = {tuple(g["divisions"]): g["value"] for g in groups}
    assert by[("tobira",)] == "2"
    # ★ ここが本丸：4区分で1グループ、値は6。「人文6・他は要件なし」ではない
    assert by[("kiban_jinbun", "kiban_shakai", "kiban_shizen", "kiban_sogo")] == "6"
    assert by[("senmon_kiso",)] == "25"
    assert by[("lang_opt",)] == "－"          # 要件なしはそのまま残す
    assert by[("adv_seminar",)] == "＊"       # 便覧参照もそのまま残す


def test_all_14_divisions_are_found():
    got = {k for g in parse_table(MERGE4) for k in g["divisions"]}
    assert got == {d["key"] for d in DIVISIONS}, sorted(got)


def test_fullwidth_numbers_are_normalized():
    # 表の見出しは「第１外国語」（全角）。key は lang1 に落ちること
    got = {k for g in parse_table(MERGE4) for k in g["divisions"]}
    assert "lang1" in got and "lang2" in got


def test_merge5_swallows_adv_seminar():
    by = {tuple(g["divisions"]): g["value"] for g in parse_table(MERGE5)}
    assert by[("adv_seminar", "kiban_jinbun", "kiban_shakai",
               "kiban_shizen", "kiban_sogo")] == "＊6"


def test_departments_come_from_labels():
    # 理学部の形：学科ごとに表が分かれ、専門基礎だけ数字が違う（25 と 24）
    page = ('<label for="f1">数学科</label>' + MERGE4 +
            '<label for="f2">生物科学科</label>'
            + MERGE4.replace("<td>25</td>", "<td>24</td>"))
    tables = parse_page(page)
    assert [t["department"] for t in tables] == ["数学科", "生物科学科"]

    def senmon(t):
        return next(g["value"] for g in t["groups"] if g["divisions"] == ["senmon_kiso"])

    assert senmon(tables[0]) == "25"
    assert senmon(tables[1]) == "24"


def test_single_table_page_has_no_department():
    tables = parse_page('<label for="s"></label>' + MERGE4)
    assert [t["department"] for t in tables] == [None]


def test_notes_keep_order_without_duplicates():
    page = (MERGE4 +
            "<p>＊アドヴァンスト・セミナーの修得単位の取り扱いは、"
            "各学部発行の便覧等にて確認してください。</p>"
            "<p>ふつうの段落。これは注記ではない。</p>"
            "<p>注１：「自然科学系」科目は、卒業要件外とする</p>"
            "<p>注１：「自然科学系」科目は、卒業要件外とする</p>")
    notes = parse_notes(page)
    assert len(notes) == 2
    assert notes[0].startswith("＊アドヴァンスト")
    assert notes[1] == "注１：「自然科学系」科目は、卒業要件外とする"


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("要件表パーサ: すべて通過")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `cd ~/Developer/rakutan-db && PYTHONIOENCODING=utf-8 python3 tools/test_requirements.py`
Expected: `ModuleNotFoundError: No module named 'tools.requirements_parse'`

- [ ] **Step 3: パーサを書く**

`tools/requirements_parse.py`:

```python
"""CELAS「卒業要件単位数」ページの表を読む。ネットワークには出ない。

■ なぜ機械で読むか
「人文科学系／社会科学系／自然科学系／総合型」の4行が rowspan="4" で
1つのセルに結合されていることがある。これは「人文6・他は要件なし」ではなく
**「基盤教養教育科目から合計6単位」**の意味。工学部・医学部では
アドヴァンスト・セミナーまで巻き込んだ rowspan="5" になる。

2026-08-24 に LLM へこの HTML を読ませたところ、外国語学部でここを読み違え、
「人文6・社会/自然/総合は表記なし」と出した。卒業要件の数字を外すのは
単位事故なので、**目視転記も LLM 読みも禁止**。この関数だけを正本にする。

■ 返す形
    parse_page(page) -> [{"department": "数学科" | None,
                          "groups": [{"divisions": ["kiban_jinbun", ...],
                                      "value": "6"}, ...]}]
    parse_notes(page) -> ["＊アドヴァンスト・セミナーの…", "注１：…"]

値（"2" / "－" / "＊" / "＊6"）は**生の文字列のまま返す**。数値へ丸めない
―― 「＊（便覧参照）」「－（要件なし）」「0」は違う事実で、潰すと画面で嘘になる。
"""
from __future__ import annotations

import html as _html
import re
import unicodedata

# 区分マスタ。key は API・画面・絞り込みで使う識別子。並びは要件表の上から順。
DIVISIONS = [
    {"key": "tobira",        "label": "学問への扉",              "group": "教養教育系科目"},
    {"key": "adv_seminar",   "label": "アドヴァンスト・セミナー",  "group": "教養教育系科目"},
    {"key": "kiban_jinbun",  "label": "人文科学系",              "group": "基盤教養教育科目"},
    {"key": "kiban_shakai",  "label": "社会科学系",              "group": "基盤教養教育科目"},
    {"key": "kiban_shizen",  "label": "自然科学系",              "group": "基盤教養教育科目"},
    {"key": "kiban_sogo",    "label": "総合型",                 "group": "基盤教養教育科目"},
    {"key": "kodo_kyoyo",    "label": "高度教養教育科目",         "group": "教養教育系科目"},
    {"key": "joho",          "label": "情報教育科目",            "group": "教養教育系科目"},
    {"key": "health_sports", "label": "健康・スポーツ教育科目",    "group": "教養教育系科目"},
    {"key": "senmon_kiso",   "label": "専門基礎教育科目",         "group": "専門教育系科目"},
    {"key": "lang1",         "label": "第1外国語",              "group": "マルチリンガル教育科目"},
    {"key": "lang2",         "label": "第2外国語",              "group": "マルチリンガル教育科目"},
    {"key": "lang_opt",      "label": "選択外国語",             "group": "マルチリンガル教育科目"},
    {"key": "global",        "label": "グローバル理解",          "group": "国際性涵養教育系科目"},
]

_TAG = re.compile(r"<[^>]+>")
_TABLE = re.compile(r"<table.*?</table>", re.S | re.I)
_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<(t[hd])([^>]*)>(.*?)</\1>", re.S | re.I)
_SPAN = re.compile(r'(rowspan|colspan)="(\d+)"', re.I)
_LABEL = re.compile(r"<label[^>]*>(.*?)</label>", re.S | re.I)
_PARA = re.compile(r"<p[^>]*>(.*?)</p>", re.S | re.I)
# 注記の先頭に立つ文字。実測で出たものだけ入れる。
_NOTE_HEADS = "＊*※注"


def _text(fragment: str) -> str:
    """タグを落として空白を1つに畳む。&nbsp; も普通の空白になる。"""
    s = _html.unescape(_TAG.sub("", fragment)).replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def _norm(label: str) -> str:
    """見出しのゆれを吸収する。

    「第１外国語」（全角）→「第1外国語」、
    「基盤教養教育科目（注１）」→「基盤教養教育科目」。
    """
    s = unicodedata.normalize("NFKC", label)
    s = re.sub(r"[（(].*?[）)]", "", s)
    return s.replace(" ", "").strip()


_KEY_BY_LABEL = {_norm(d["label"]): d["key"] for d in DIVISIONS}


def parse_table(table_html: str) -> list[dict]:
    """表1つを「結合セル1つ＝1グループ」の並びにする。

    行を上から見て、値のセル（td）が出たら新しいグループを開く。
    rowspan=N なら、そのセルは続く N 行を覆う ―― その間に出てくる
    区分は全部そのグループに入る（＝「合わせて何単位」）。
    """
    groups: list[dict] = []
    open_group: dict | None = None   # いま開いているグループ（rowspan の残り行つき）

    for row in _ROW.findall(table_html):
        heads: list[str] = []
        value: tuple[str, int] | None = None
        for tag, attrs, body in _CELL.findall(row):
            span = {k.lower(): int(v) for k, v in _SPAN.findall(attrs)}
            if tag.lower() == "th":
                heads.append(_text(body))
            else:
                value = (_text(body), span.get("rowspan", 1))

        if value is not None:
            open_group = {"divisions": [], "value": value[0], "rows_left": value[1]}
            groups.append(open_group)
        if open_group is None:
            continue          # 値のセルより前にある見出し行

        # 一番内側の th が区分名。外側は「教養教育系科目」などの括りなので見ない。
        if heads:
            key = _KEY_BY_LABEL.get(_norm(heads[-1]))
            if key:
                open_group["divisions"].append(key)

        open_group["rows_left"] -= 1
        if open_group["rows_left"] <= 0:
            open_group = None

    return [{"divisions": g["divisions"], "value": g["value"]}
            for g in groups if g["divisions"]]


def parse_page(page: str) -> list[dict]:
    """ページ内の表を、学科名つきで上から順に返す。

    学科名は表の手前の <label>（アコーディオンの見出し）から取る。
    学科の無い学部（文学部など）は先頭の検索欄の空 label しか無いので None になる。
    """
    tables = _TABLE.findall(page)
    departments = [d for d in (_text(x) for x in _LABEL.findall(page)) if d]
    if len(departments) != len(tables):
        departments = [None] * len(tables)
    return [{"department": departments[i], "groups": parse_table(t)}
            for i, t in enumerate(tables)]


def parse_notes(page: str) -> list[str]:
    """表の下の但し書き（＊ と 注）を、出た順で重複なく返す。"""
    seen: set[str] = set()
    out: list[str] = []
    for para in _PARA.findall(page):
        t = _text(para)
        if t and t[0] in _NOTE_HEADS and t not in seen:
            seen.add(t)
            out.append(t)
    return out
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `PYTHONIOENCODING=utf-8 python3 tools/test_requirements.py`
Expected: 7件すべて `OK`、最後に `要件表パーサ: すべて通過`

- [ ] **Step 5: コミット**

```bash
git add tools/requirements_parse.py tools/test_requirements.py
git commit -m "feat: 卒業要件表のパーサ（rowspan の結合＝合計単位数として読む）"
```

---

## Task 2: 要件表を取り込んで JSON にする

**Files:**
- Create: `tools/fetch_requirements.py`
- Create（生成物）: `data/faculty_requirements.json`, `data/raw/prerequisite/*.html`

**Interfaces:**
- Consumes: `tools.requirements_parse` の `DIVISIONS` / `parse_page` / `parse_notes`
- Produces: `data/faculty_requirements.json`
  ―― `{"_meta": {...}, "divisions": [...], "faculties": [{"key","label","departments","requirements","notes"}]}`
  各 `requirements` 要素は `{"divisions": [key,...], "values": [str,...]}` で、
  `values` は `departments` と同じ長さ（`departments` が空なら長さ1）。

- [ ] **Step 1: 取り込みスクリプトを書く**

`tools/fetch_requirements.py`:

```python
"""CELAS の「卒業要件単位数」11ページから data/faculty_requirements.json を作る。

    python3 tools/fetch_requirements.py            # 取得して書き出す
    python3 tools/fetch_requirements.py --offline  # data/raw/prerequisite/ から作り直す

■ 大学のサーバを叩くときの約束
1リクエストごとに2秒あける（scrape/fetch.py と同じ）。11ページで約22秒。
**ここを短くしない。** 22秒を惜しんで失うもの（大学からの停止要請）の方が大きい。

■ 前提が崩れたら止まる
この計画は「学科が違っても必要な区分の集合は同じ」という実測（2026-08-24）に
乗っている。CELAS が表を作り替えてこれが崩れたら、黙って変な JSON を書くより
**止まって知らせる**ほうがいい。build_faculty() の2つの検査がそれ。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.requirements_parse import DIVISIONS, parse_notes, parse_page

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "faculty_requirements.json"
RAW = ROOT / "data" / "raw" / "prerequisite"
BASE = "https://www.celas.osaka-u.ac.jp/education/prerequisite/"
DELAY = 2.0
UA = "rakutan-db/0.1 (Osaka Univ. student project; contact via GitHub)"

# CELAS のスラッグと学部名。並びは KOAN の学部の並びに合わせてある。
FACULTIES = [
    ("letters", "文学部"),
    ("human-sci", "人間科学部"),
    ("law", "法学部"),
    ("economics", "経済学部"),
    ("foreign-s", "外国語学部"),
    ("science", "理学部"),
    ("medicine", "医学部"),
    ("dentistry", "歯学部"),
    ("pharmacy", "薬学部"),
    ("engineering", "工学部"),
    ("engr-sci", "基礎工学部"),
]


def fetch(slug: str) -> str:
    req = urllib.request.Request(BASE + slug + "/", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def build_faculty(slug: str, label: str, page: str) -> dict:
    tables = parse_page(page)
    if not tables:
        raise SystemExit(f"中止: {slug} に表が1つも無い。ページ構造が変わった可能性がある")

    # 前提①：学科が違っても区分の並びは同じ（2026-08-24 実測）
    shapes = [tuple(tuple(g["divisions"]) for g in t["groups"]) for t in tables]
    if len(set(shapes)) != 1:
        raise SystemExit(
            f"中止: {slug} は学科ごとに区分の並びが違う。\n"
            f"      「学部→区分の2段でよい」という設計の前提が崩れている。\n"
            f"      docs/plans/2026-08-24-faculty-division-filter-design.md の1章②を読み直すこと。")

    requirements = [
        {"divisions": list(g["divisions"]),
         "values": [t["groups"][i]["value"] for t in tables]}
        for i, g in enumerate(tables[0]["groups"])
    ]

    # 前提②：14区分すべてが表にある
    covered = {k for r in requirements for k in r["divisions"]}
    missing = [d["key"] for d in DIVISIONS if d["key"] not in covered]
    if missing:
        raise SystemExit(f"中止: {slug} の表に無い区分がある {missing}")

    return {
        "key": slug,
        "label": label,
        "departments": [t["department"] for t in tables if t["department"]],
        "requirements": requirements,
        "notes": parse_notes(page),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true",
                    help="取得せず data/raw/prerequisite/ の保存ずみ HTML から作り直す")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    faculties = []
    for i, (slug, label) in enumerate(FACULTIES):
        cache = RAW / f"{slug}.html"
        if args.offline:
            if not cache.exists():
                raise SystemExit(f"中止: {cache} が無い。--offline を外して取得すること")
            page = cache.read_text(encoding="utf-8")
        else:
            if i:
                time.sleep(DELAY)      # 大学のサーバに連続で当てない
            page = fetch(slug)
            cache.write_text(page, encoding="utf-8")
        faculties.append(build_faculty(slug, label, page))
        n = len(faculties[-1]["departments"]) or 1
        print(f"  {label:8s} 学科{n:2d}  区分グループ{len(faculties[-1]['requirements']):2d}"
              f"  注記{len(faculties[-1]['notes'])}")

    payload = {
        "_meta": {
            "source": "CELAS 卒業要件単位数",
            "base_url": BASE,
            "fetched": date.today().isoformat(),
            "note": "値は生の文字列。＊は便覧参照、－は要件なし。数値へ丸めていない。",
        },
        "divisions": DIVISIONS,
        "faculties": faculties,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {OUT}  学部{len(faculties)}件")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 走らせて11学部ぶん取り込む**

Run: `cd ~/Developer/rakutan-db && python3 tools/fetch_requirements.py`
Expected: 11行が出て、`学科` の数が 文学部1 / 理学部4 / 医学部4 / 工学部5 / 基礎工学部4。
`区分グループ` はどの学部も 10〜11。最後に `→ .../faculty_requirements.json 学部11件`。

- [ ] **Step 3: 生成物を目で1点だけ検算する**

Run:
```bash
python3 -c "
import json
d=json.load(open('data/faculty_requirements.json'))
s=[f for f in d['faculties'] if f['key']=='science'][0]
print('学科:', s['departments'])
for r in s['requirements']:
    print(' ', r['divisions'], r['values'])
print('注記:', s['notes'])"
```
Expected: 学科が `['数学科','物理学科','化学科','生物科学科']`、
`['kiban_jinbun','kiban_shakai','kiban_shizen','kiban_sogo']` の値が `['6','6','6','6']`、
`['senmon_kiso']` の値が `['25','25','25','24']`、
注記に `注１：「自然科学系」科目は、卒業要件外とする` が入っていること。

- [ ] **Step 4: 保存ずみ HTML を git に入れない**

`data/raw/` が `.gitignore` に入っていることを確かめる。入っていなければ追記する。

Run: `git check-ignore -v data/raw/prerequisite/science.html`
Expected: `.gitignore` の行が表示される（何も出なければ `.gitignore` に `data/raw/` を足す）

- [ ] **Step 5: コミット**

```bash
git add tools/fetch_requirements.py data/faculty_requirements.json
git commit -m "feat: CELAS から11学部の卒業要件表を取り込む"
```

---

## Task 3: 科目 → 区分 の推定

**Files:**
- Create: `tools/division.py`
- Test: `tools/test_division.py`

**Interfaces:**
- Produces: `divide(course: dict) -> tuple[str | None, str | None]`
  ―― `("kiban_jinbun", "title")` のように `(区分, 出所)`。判定できなければ `(None, None)`

- [ ] **Step 1: テストを書く**

`tools/test_division.py`:

```python
"""科目→区分の推定のテスト。ネットワークには出ない。

規則ごとの最小ケースに加えて、web/data/courses.built.json があるときは
**全1,112件の件数を検算**する。設計（design.md の3章）の表と1件でもずれたら落ちる。
件数が動いたときに気付けないと、区分が静かに壊れる。
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.division import SPORTS_WORDS, divide

ROOT = Path(__file__).resolve().parent.parent


def c(title="", numbering="", **kw):
    return {"title": title, "numbering": numbering, **kw}


def test_title_prefix_wins():
    assert divide(c("【人文】ことばの学問入門", "13LASC1B002")) == ("kiban_jinbun", "title")
    assert divide(c("【社会】法と社会", "13LASC1E100")) == ("kiban_shakai", "title")
    assert divide(c("【自然】認知脳科学への誘い", "13LASC1M300")) == ("kiban_shizen", "title")
    assert divide(c("【総合】阪大SDGs学入門", "13LASC1Z100")) == ("kiban_sogo", "title")


def test_prefix_beats_numbering():
    # 1Z は学問への扉だが、【総合】が付いていればそちらが勝つ
    assert divide(c("【総合】阪大SDGs学入門", "13LASC1Z100"))[0] == "kiban_sogo"
    # 1M は情報教育科目だが、【自然】が付いていればそちら
    assert divide(c("【自然】認知脳科学への誘い", "13LASC1M300"))[0] == "kiban_shizen"


def test_numbering_rules():
    assert divide(c("学問への扉（がん研究入門）", "13LASC1Z101")) == ("tobira", "numbering")
    assert divide(c("情報科学基礎", "13LASC1M100")) == ("joho", "numbering")
    for seg in ("1F", "1G", "1K", "1H"):
        assert divide(c("基礎解析学・同演義", f"13LASC{seg}200"))[0] == "senmon_kiso", seg


def test_1v_needs_a_sports_word():
    assert divide(c("スマート・スポーツリテラシー（卓球）", "13LASC1V501")) \
        == ("health_sports", "numbering")
    assert divide(c("健康科学", "13LASC1V100")) == ("health_sports", "numbering")
    # ★ 体育ではない 1V は倒さない。倒すと卒業要件の計算に混ざる
    assert divide(c("キャリアデザインと公共哲学", "13LASC1V300")) == (None, None)
    assert divide(c("アカデミック・リテラシー入門", "13LASC1V300")) == (None, None)


def test_scrape_field_wins_over_everything():
    got = divide(c("【人文】ことばの学問入門", "13LASC1B002", division_scraped="kodo_kyoyo"))
    assert got == ("kodo_kyoyo", "scrape")


def test_unknown_is_none_not_a_guess():
    assert divide(c("動物の行動学", "13LASC1D400")) == (None, None)
    assert divide(c("", "")) == (None, None)
    assert divide({}) == (None, None)


def test_sports_words_are_all_used():
    for w in SPORTS_WORDS:
        assert divide(c(f"テスト{w}講座", "13LASC1V000"))[0] == "health_sports", w


def test_counts_match_the_design_doc():
    """全件の件数が design.md 3章・4章の表と一致すること。"""
    built = ROOT / "web" / "data" / "courses.built.json"
    if not built.exists():
        print("  SKIP test_counts_match_the_design_doc（courses.built.json が無い）")
        return
    courses = json.loads(built.read_text(encoding="utf-8"))["courses"]
    got = Counter(divide(x)[0] for x in courses)
    expect = {"tobira": 250, "senmon_kiso": 302, "health_sports": 144,
              "kiban_jinbun": 92, "kiban_sogo": 82, "kiban_shakai": 78,
              "joho": 76, "kiban_shizen": 39, None: 49}
    assert dict(got) == expect, f"件数がずれた: {dict(got)}"
    assert sum(got.values()) == len(courses) == 1112


def main():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  OK  {name}")
    print("科目→区分: すべて通過")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `PYTHONIOENCODING=utf-8 python3 tools/test_division.py`
Expected: `ModuleNotFoundError: No module named 'tools.division'`

- [ ] **Step 3: 実装する**

`tools/division.py`:

```python
"""科目を科目区分（人文科学系・情報教育科目…）へ割り当てる。

■ 判定の順番
    政岡さんの取得フィールド > 科目名の接頭辞【人文】等 > ナンバリング
上位が値を持てば下位は見ない。**取得が入れば推定は自動的に効かなくなる**ので、
規則を消す作業は要らない。

■ 判定できないものは None にする（「その他」は画面のラベルであって区分ではない）
ナンバリング 1V の接頭辞なし179件のうち35件は
「キャリアデザインと公共哲学」「オン・キャンパス・インターンシップ」
「アカデミック・リテラシー入門」のように、どう見ても体育の科目ではない
（高度教養教育科目の可能性が高い）。ナンバリングだけで一律に倒すと、
この35件が「健康・スポーツ教育科目」として学生の卒業要件計算に混ざる。

だからスポーツ・健康系の語を含むものだけを採り、残りは None に落とす。
**見ていない値のために規則を書くと必ず外れる**（tools/eligibility.py と同じ判断。
scrape/parse.py の METHOD_RULES で「未分類が満点に化けていた」のと同じクラスの話）。

■ ナンバリングのどこを見るか
「13LASC1B002」の7〜8文字目（0起点で [6:8]）が区分に効く。
    1Z 学問への扉 ／ 1M 情報教育科目 ／ 1F・1G・1K・1H 専門基礎（数学・化学・生物・図学）
    1V 健康・スポーツ枠（ただし上記のとおり素直には信じない）
"""
from __future__ import annotations

import re

# 科目名の接頭辞。KOAN の科目名に元から付いている（例：【人文】ことばの学問入門）。
PREFIX = {
    "人文": "kiban_jinbun",
    "社会": "kiban_shakai",
    "自然": "kiban_shizen",
    "総合": "kiban_sogo",
}

# ナンバリング [6:8] → 区分。実測で偏りが十分はっきりしたものだけ。
NUMBERING = {
    "1Z": "tobira",
    "1M": "joho",
    "1F": "senmon_kiso",
    "1G": "senmon_kiso",
    "1K": "senmon_kiso",
    "1H": "senmon_kiso",
}

# 1V を「健康・スポーツ教育科目」と見なすために科目名へ要求する語。
SPORTS_WORDS = ("スポーツ", "健康", "ヘルス", "運動", "体育", "フィットネス")

_PREFIX_RE = re.compile(r"^【([^】]+)】")


def divide(course: dict) -> tuple[str | None, str | None]:
    """(区分, 出所) を返す。判定できなければ (None, None)。

    出所は "scrape" / "title" / "numbering"。画面で「推定」と断るのと、
    取得が入ったときに何件が上書きされたかを数えるのに使う。
    """
    scraped = course.get("division_scraped")
    if scraped:
        return scraped, "scrape"

    title = course.get("title") or ""
    m = _PREFIX_RE.match(title)
    if m and m.group(1) in PREFIX:
        return PREFIX[m.group(1)], "title"

    seg = (course.get("numbering") or "")[6:8]
    if seg in NUMBERING:
        return NUMBERING[seg], "numbering"
    if seg == "1V" and any(w in title for w in SPORTS_WORDS):
        return "health_sports", "numbering"

    return None, None
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `PYTHONIOENCODING=utf-8 python3 tools/test_division.py`
Expected: 8件すべて `OK`。とくに `test_counts_match_the_design_doc` が通ること
（`courses.built.json` が無ければ SKIP と出る ―― その場合は先に `python3 build.py` を流す）

- [ ] **Step 5: コミット**

```bash
git add tools/division.py tools/test_division.py
git commit -m "feat: 科目名の接頭辞とナンバリングから科目区分を推定する"
```

---

## Task 4: `build.py` に焼き込む

**Files:**
- Modify: `build.py` ―― `KEEP` の近く、`slim()`（102行目付近）、`main()` の科目ループ（194行目付近）、書き出し（289行目付近）

**Interfaces:**
- Consumes: `tools.division.divide`
- Produces: `web/data/courses.built.json` の各科目に `division` / `division_source`、
  および `web/data/requirements.json`（`data/faculty_requirements.json` の写し）

- [ ] **Step 1: import と科目ループに足す**

`build.py` の import 群（`import scoring` などの並び）へ足す：

```python
from tools.division import divide
```

`main()` の科目ループ（`base = dict(c) if args.full else slim(c)` の直後）へ足す：

```python
    built = []
    for c in courses:
        base = dict(c) if args.full else slim(c)
        base["rakutan"] = scoring.score(c)      # 採点は必ず元データに対して行う
        # 科目区分。政岡さんの取得が入るまでは科目名とナンバリングからの推定で、
        # 出所を一緒に持たせる（画面で「推定」と断るため）。判定できないものは
        # null のまま ―― 画面では「その他」に集まる。
        base["division"], base["division_source"] = divide(c)
        built.append(base)
```

- [ ] **Step 2: 要件表を `web/data/` へ写す**

`main()` の末尾、`courses.built.json` を書いたあと（289行目の `print(f"→ {dest} …")` の直後）へ：

```python
    # 要件表を公開側へ写す。courses.built.json には入れない
    # ―― あちらは絞り込みのたびに読む1.7MB で、要件表は学部を選んだときだけ要る。
    req_src = ROOT / "data" / "faculty_requirements.json"
    if req_src.exists():
        req_dest = ROOT / "web" / "data" / "requirements.json"
        req_dest.write_text(req_src.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"→ {req_dest}")
    else:
        print("※ data/faculty_requirements.json が無いので学部の絞り込みは出ません。"
              "  python3 tools/fetch_requirements.py を流してください。")
```

- [ ] **Step 3: 走らせて確かめる**

Run:
```bash
cd ~/Developer/rakutan-db && python3 build.py && python3 -c "
import json
from collections import Counter
d=json.load(open('web/data/courses.built.json'))['courses']
print(Counter(c['division'] for c in d).most_common())
print(Counter(c['division_source'] for c in d))
print('要件表:', json.load(open('web/data/requirements.json'))['_meta'])"
```
Expected: 件数が Task 3 の期待値と一致（`tobira` 250 / `None` 49 など）、
出所が `{'numbering': 772, 'title': 291, None: 49}`、要件表の `_meta` が出ること。

- [ ] **Step 4: 既存のテストを壊していないことを確かめる**

Run:
```bash
PYTHONIOENCODING=utf-8 python3 tools/test_scoring_gate.py
PYTHONIOENCODING=utf-8 python3 tools/test_web_split.py
PYTHONIOENCODING=utf-8 python3 tools/test_layout.py
```
Expected: すべて通過

- [ ] **Step 5: コミット**

```bash
git add build.py web/data/courses.built.json web/data/requirements.json
git commit -m "feat: build に科目区分と要件表を通す"
```

---

## Task 5: `server.py` を合わせる

画面は静的モード（`courses.built.json` 直読み）でも API モードでも同じに動く必要がある。
**API 側を先に合わせる。**

**Files:**
- Modify: `server.py` ―― `search()`（97〜160行目付近）、`/api/meta`（404行目付近）、`do_GET`

**Interfaces:**
- Consumes: `data/faculty_requirements.json`
- Produces: `/api/courses` が `division`（繰り返し可）で絞れる／レスポンスに
  `division_facets: {key: 件数}` を含む。`/api/meta` に `divisions`。`/api/requirements` を新設。

- [ ] **Step 0: 起動時に区分を焼く（実装中に判明。これを忘れると全件が「その他」になる）**

`server.py` は `build.py` を通さず `data/courses.json` を直接読むので、
**`division` は API 側には自動では入らない**。`COURSES: list[dict] = _raw["courses"]`
（57行目付近）の直後へ：

```python
# 科目区分を起動時に1回だけ焼く。build.py（静的配信）とまったく同じ関数を使う
# ―― ここを別実装にすると、API モードと静的モードで違う区分が出る。
# scoring.enrich() は dict(course) のコピーなので、ここで入れれば API まで届く。
for _c in COURSES:
    _c["division"], _c["division_source"] = divide(_c)
```

import 群（`import score as scoring` の隣）へ `from tools.division import divide`。

- [ ] **Step 1: `search()` に区分の絞り込みと件数を足す**

`search()` の `conds = [...]` の次へ：

```python
    # 区分（複数可・OR）。data には無い "other" は「まだ判定していない」科目のこと。
    divisions = [d for d in (params.get("division") or []) if d]
```

`base` を作るループの**あと**、`slots` を数える**前**へ：

```python
    # 区分チップの件数は、区分フィルタを掛ける「前」の集合で数える。
    # そうしないと1つ選んだ瞬間に他が全部0件になり、次の一手が打てない
    # ―― 空きコマグリッドを曜限フィルタ前で数えているのと同じ理由。
    division_facets: dict[str, int] = {}
    for e in base:
        k = e.get("division") or "other"
        division_facets[k] = division_facets.get(k, 0) + 1

    if divisions:
        base = [e for e in base if (e.get("division") or "other") in divisions]
```

戻り値の辞書に `"division_facets": division_facets` を足す
（`facets` を返している箇所と同じ場所）。

- [ ] **Step 2: `/api/meta` と `/api/requirements`**

`/api/meta` のレスポンス辞書へ足す：

```python
                "divisions": requirements_doc().get("divisions", []),
```

`do_GET` の `/api/reviews` の分岐の隣へ：

```python
        if path == "/api/requirements":
            return self._send_json(requirements_doc())
```

`search()` の手前あたりへ、読み込みを1回で済ませる小さな関数：

```python
_REQUIREMENTS: dict | None = None


def requirements_doc() -> dict:
    """卒業要件表。無ければ空で返す（学部の絞り込みが出ないだけで、他は動く）。"""
    global _REQUIREMENTS
    if _REQUIREMENTS is None:
        f = ROOT / "data" / "faculty_requirements.json"
        _REQUIREMENTS = (json.loads(f.read_text(encoding="utf-8"))
                         if f.exists() else {"divisions": [], "faculties": []})
    return _REQUIREMENTS
```

- [ ] **Step 3: `openapi()` に `division` を足す**

`openapi()` の `parameters`（218行目付近の `{"name": "category", ...}` の並び）へ：

```python
                        {"name": "division", "in": "query",
                         "schema": {"type": "array", "items": {"type": "string"}},
                         "description": "科目区分。複数指定で OR。other は未判定"},
```

- [ ] **Step 4: 手で叩いて確かめる**

Run:
```bash
cd ~/Developer/rakutan-db && python3 server.py &
sleep 2
curl -s "http://localhost:8000/api/meta" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['divisions']),'区分')"
curl -s "http://localhost:8000/api/requirements" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['faculties']),'学部')"
curl -s "http://localhost:8000/api/courses?year=all&sem=all&division=joho" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['count'],'件'); print(sorted(d['division_facets'].items(), key=lambda x:-x[1])[:4])"
kill %1
```
Expected: `14 区分` / `11 学部` / `76 件`。`division_facets` は
**区分を1つ選んでいても他の区分の件数が0になっていない**こと（ここが Step 1 の狙い）。

- [ ] **Step 5: コミット**

```bash
git add server.py
git commit -m "feat: API を区分で絞れるようにする（件数は絞り込み前で数える）"
```

---

## Task 6: 画面（`app.js`）

**Files:**
- Modify: `web/assets/app.js` ―― `state`（19行目）、`qs()`（37行目）、`buildYears()` の下、
  `queryLocal()`（377行目付近）、`boot()`（326行目付近）、`load()`（546行目付近）、起動ブロック（623行目付近）

**Interfaces:**
- Consumes: `/api/requirements` または `data/requirements.json`、
  `d.division_facets`（API）／`queryLocal()` の返り値
- Produces: `#facSec` セクション（`app.js` が生成）、`state.faculty` / `state.division`

**`web/index.html` は触らない。** セクションは JS が作って `.rail` に差し込む。

- [ ] **Step 1: 状態とクエリ**

19行目の `state` を差し替える：

```js
const state = { q:"", year:"1", sem:"aki", day:"", period:"", cond:new Set(), sort:"fit",
                preset:"とにかく軽い", weights:null,
                /* 学部は絞り込みそのものには効かない ―― 効くのは区分だけ。
                   学部は「どの区分が自分に必要か」を並べ替えるためだけに持つ。 */
                faculty:"", division:new Set() };
```

`qs()` の `state.cond.forEach(...)` の隣へ：

```js
  if (state.faculty) p.set("faculty", state.faculty);
  state.division.forEach(d => p.append("division", d));
```

- [ ] **Step 2: 要件表を読み込む**

`boot()` の中、API モードの分岐で `META = await …` の次の行へ：

```js
      REQ = await (await fetch("/api/requirements")).json();
```

静的モードの `DATA.courses = d.courses;` の次へ：

```js
    // 要件表が無くても他は全部動く。学部のセクションが出ないだけ。
    try { REQ = await (await fetch("data/requirements.json")).json(); }
    catch (e) { REQ = null; }
```

`let META = null;`（26行目付近）の隣へ：

```js
let REQ = null;   // 卒業要件表（学部→区分→単位数）。data/requirements.json
```

- [ ] **Step 3: セクションを作る**

`buildYears()` の直後（97行目付近）へ丸ごと足す：

```js
/* ── 学部から区分でしぼる ─────────────────
   セクションごと app.js が作って rail に差し込む。index.html には1行も足さない
   ―― あちらは松下さん担当で、同時に触ると必ず衝突する。
   CSS も既存の .chips / .chip / .toggle / .railNote を使い回す。

   学部は絞り込みに効かない。効くのは区分だけ。
   学部が決めるのは「どの区分が自分の卒業要件にあるか」の並べ替えと単位数の表示。
   区分の顔ぶれは全11学部で同じ14個なので、学部で出し分けるものは無い
   （設計 1章① を読むこと）。 */

const DIV_OTHER = "other";   // 「まだ判定していない」科目の置き場。データには書かない

function divisionsOf(){ return (REQ && REQ.divisions) || []; }
function facultyOf(key){ return ((REQ && REQ.faculties) || []).find(f => f.key === key); }

/* 要件表の生文字列（"2" / "－" / "＊" / "＊6"）を画面の言葉にする。
   学科で数字がばらつく学部（理学部の専門基礎 25/25/25/24）は幅で出す。
   要件外（－ と空）は null を返し、呼び出し側が折りたたみへ送る。 */
function unitBadge(values, groupSize){
  const uniq = [...new Set(values)];
  if (uniq.every(v => v === "－" || v === "-" || v === "")) return null;
  const nums = uniq.map(v => (v.match(/\d+/) || [])[0]).filter(Boolean).map(Number);
  if (!nums.length) return "便覧で確認";
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const n = lo === hi ? `${lo}単位` : `${lo}〜${hi}単位`;
  return (groupSize > 1 ? "計" : "") + n;
}

/* 学部を選んでいないときは全区分を「必要」の側に並べる（要件の情報が無いので
   優劣を付けられない）。選んでいれば、要件表のグループから
   区分ごとのバッジと、要件外かどうかを引く。 */
function divisionPlan(){
  const all = divisionsOf();
  const fac = facultyOf(state.faculty);
  if (!fac) return { need: all.map(d => ({ ...d, badge:null, title:"" })), off: [], notes: [] };

  const badge = {}, title = {}, off = new Set(all.map(d => d.key));
  for (const r of fac.requirements){
    const b = unitBadge(r.values, r.divisions.length);
    const labels = r.divisions.map(k => (all.find(d => d.key === k) || {}).label || k);
    for (const k of r.divisions){
      if (b === null) continue;              // 要件外のまま
      off.delete(k);
      badge[k] = b;
      title[k] = r.divisions.length > 1
        ? `${labels.join("・")} の合計で ${b.replace(/^計/, "")}`
        : "";
    }
  }
  return {
    need: all.filter(d => !off.has(d.key)).map(d => ({ ...d, badge:badge[d.key], title:title[d.key] })),
    off:  all.filter(d =>  off.has(d.key)).map(d => ({ ...d, badge:null, title:"" })),
    notes: fac.notes || [],
  };
}

function divisionChip(d, facets){
  const n = facets?.[d.key] ?? 0;
  const on = state.division.has(d.key);
  // <small> はブラウザ既定で一段小さく出る。新しい CSS クラスを増やさないため
  // （app.css は松下さん担当）、素のタグで済ませている。
  const badge = d.badge ? ` <small>${esc(d.badge)}</small>` : "";
  // 0件は押せない。押せると「壊れている」と読まれる。理由を title で添える。
  const dis = n === 0 ? ' disabled title="この区分の科目はまだ取れていません"'
                      : (d.title ? ` title="${esc(d.title)}"` : "");
  return `<button class="chip${on ? " on" : ""}"${dis} data-d="${esc(d.key)}">`
       + `${esc(d.label)}${badge}<span class="n">${n}</span></button>`;
}

function buildFaculty(facets){
  if (!REQ || !divisionsOf().length) return;   // 要件表が無い環境では出さない

  let sec = $("#facSec");
  if (!sec){
    sec = document.createElement("section");
    sec.id = "facSec";
    sec.innerHTML =
      `<h2>学部からさがす <span class="sub">選ぶと卒業要件にある区分が上に出ます</span></h2>
       <select id="facSel"></select>
       <div class="chips" id="divs"></div>
       <button class="toggle" id="divTog" hidden></button>
       <div class="chips" id="divsOff" hidden></div>
       <p class="railNote" id="facNotes"></p>`;
    const years = $("#years").closest("section");
    years.parentNode.insertBefore(sec, years.nextSibling);

    $("#facSel").innerHTML = `<option value="">学部を選ぶ</option>`
      + ((REQ.faculties || []).map(f =>
          `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join(""));
    $("#facSel").onchange = e => { state.faculty = e.target.value; load(); };
    $("#divTog").onclick = () => {
      const box = $("#divsOff");
      box.hidden = !box.hidden;
      $("#divTog").textContent = box.hidden
        ? `卒業要件外の区分も表示する (${box.dataset.n})`
        : "卒業要件外の区分を隠す";
    };
  }
  $("#facSel").value = state.faculty;

  const plan = divisionPlan();
  const other = { key:DIV_OTHER, label:"その他", badge:null,
                  title:"区分がまだ分かっていない科目" };
  $("#divs").innerHTML = plan.need.concat([other])
    .map(d => divisionChip(d, facets)).join("");

  const tog = $("#divTog"), box = $("#divsOff");
  tog.hidden = plan.off.length === 0;
  box.dataset.n = plan.off.length;
  if (plan.off.length){
    box.innerHTML = plan.off.map(d => divisionChip(d, facets)).join("");
    if (box.hidden) tog.textContent = `卒業要件外の区分も表示する (${plan.off.length})`;
  } else {
    box.innerHTML = ""; box.hidden = true;
  }

  $("#facNotes").innerHTML = plan.notes.map(t => esc(t)).join("<br>");

  sec.querySelectorAll(".chips button").forEach(b => b.onclick = () => {
    const k = b.dataset.d;
    state.division.has(k) ? state.division.delete(k) : state.division.add(k);
    load();
  });
}
```

- [ ] **Step 4: 静的モードの絞り込み**

`queryLocal()`（377行目付近）の `base` を作るループの**あと**へ。
`const slots = {}` の**手前**に差し込む：

```js
  // 区分チップの件数は区分フィルタを掛ける「前」で数える（server.py と同じ理由）。
  const divisionFacets = {};
  for (const e of base){
    const k = e.division || "other";
    divisionFacets[k] = (divisionFacets[k] || 0) + 1;
  }
  if (state.division.size){
    for (let i = base.length - 1; i >= 0; i--){
      if (!state.division.has(base[i].division || "other")) base.splice(i, 1);
    }
  }
```

`return { count: …, weights: w };` に `divisionFacets` を足す：

```js
  return { count: results.length, results, slots, facets, weights: w,
           division_facets: divisionFacets };
```

- [ ] **Step 5: `load()` と起動から呼ぶ**

`load()` の `buildGrid(d.slots); buildConds(d.facets);` を：

```js
  buildGrid(d.slots); buildConds(d.facets); buildFaculty(d.division_facets);
```

起動ブロック（627行目）の `buildSems(); buildYears(); …` は**そのまま**。
`buildFaculty()` は件数が要るので `load()` からだけ呼ぶ。

- [ ] **Step 6: 実機で確かめる**

Run: `cd ~/Developer/rakutan-db && python3 -m http.server 8123 --directory web`
ブラウザで `http://localhost:8123/` を開き、次を順に確かめる：

1. 「学部からさがす」が**学年の下**に出ている
2. 学部未選択で区分チップが15個（14区分＋その他）並び、件数が入っている
3. **理学部**を選ぶ → `専門基礎教育科目 24〜25単位`、
   `人文科学系 計6単位`（マウスを乗せると「人文科学系・社会科学系・自然科学系・総合型 の合計で6単位」）、
   注記に「注１：「自然科学系」科目は、卒業要件外とする」
4. `第1外国語` `第2外国語` `アドヴァンスト・セミナー` `高度教養教育科目` は
   件数0で**押せない**（マウスを乗せると理由が出る）
5. `情報教育科目` を押す → 76件に絞られ、**他の区分の件数が0になっていない**
6. `人文科学系` も押す → 168件（76＋92）に増える（OR）
7. 「卒業要件外の区分も表示する」を開くと `選択外国語` が出る
8. 学部を「学部を選ぶ」へ戻す → 単位数バッジが消え、区分は全部出たまま
9. **スマホ幅（390px）**で崩れていないこと。PC 幅（1280px）でも確かめる

- [ ] **Step 7: 既存のテストを流す**

Run:
```bash
PYTHONIOENCODING=utf-8 python3 tools/test_layout.py
PYTHONIOENCODING=utf-8 python3 tools/test_web_split.py
PYTHONIOENCODING=utf-8 python3 tools/test_tokens.py
```
Expected: すべて通過（`index.html` も `app.css` も触っていないので落ちないはず。
落ちたら**触ってはいけないファイルを触っている**）

- [ ] **Step 8: コミット**

```bash
git add web/assets/app.js
git commit -m "feat: 学部を選ぶと卒業要件にある区分で科目をしぼれるようにする"
```

---

## Task 7: 「その他」の一覧を政岡さんへ渡す＋引き継ぎ

**Files:**
- Create: `tools/division_survey.py`
- Modify: `HANDOFF.md`（先頭・ルールの直下）

- [ ] **Step 1: 調査スクリプトを書く**

`tools/division_survey.py`:

```python
"""区分が判定できていない科目（画面の「その他」）を一覧にする。

    python3 tools/division_survey.py

政岡さんに「どこから取ればいいか」を渡すための道具。
推定規則を増やすための材料でもあるが、**この出力を見て規則を書き足す前に
必ず実データで件数を確かめること**（tools/test_division.py が検算する）。
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.division import divide

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    f = ROOT / "web" / "data" / "courses.built.json"
    if not f.exists():
        raise SystemExit("先に python3 build.py を流してください")
    courses = json.loads(f.read_text(encoding="utf-8"))["courses"]

    unknown = [c for c in courses if divide(c)[0] is None]
    print(f"判定できていない科目: {len(unknown)} / {len(courses)}\n")

    by_seg = Counter((c.get("numbering") or "")[6:8] for c in unknown)
    print("ナンバリング別:")
    for seg, n in by_seg.most_common():
        print(f"  {seg or '(なし)':6s} {n:4d}")

    print("\n科目名:")
    for c in sorted(unknown, key=lambda x: (x.get("numbering") or "", x["title"])):
        print(f"  {(c.get('numbering') or '―'):14s} {c['title']}")

    got = Counter(divide(c)[0] for c in courses if divide(c)[0])
    print("\n判定できている区分:")
    for k, n in got.most_common():
        print(f"  {k:16s} {n:4d}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 走らせて出力を保存する**

Run: `cd ~/Developer/rakutan-db && python3 tools/division_survey.py | tee /tmp/division_survey.txt`
Expected: `判定できていない科目: 49 / 1112`、ナンバリング別に `1A` `1D` `1E` `1P` `1B` `1V` が並ぶ

- [ ] **Step 3: コミット**

```bash
git add tools/division_survey.py
git commit -m "feat: 区分が判定できていない科目を一覧にする道具"
```

- [ ] **Step 4: 引き継ぎ4項目を `HANDOFF.md` の先頭へ書く**

`CLAUDE.md` の「最重要」の通り、①何が動く状態か ②何をしていないか
③次の人が最初に打つコマンド ④踏んだ罠 の4項目を、ルールの直下へ追記する。
**④には必ず次の2つを書く：**

- CELAS の要件表は `rowspan` の結合が「合計単位数」の意味で、
  LLM に HTML を読ませると外す（外国語学部で実際に外した）。
  `tools/requirements_parse.py` を通すこと。目視転記も禁止
- ナンバリング `1V` を一律で健康・スポーツに倒すと、
  キャリアデザイン／インターンシップ系の35件が卒業要件の計算に混ざる

同じ内容を Discord に貼れるテキストとしてユーザーへ渡す。

- [ ] **Step 5: コミット**

```bash
git add HANDOFF.md
git commit -m "docs: 引き継ぎ（学部から区分でしぼる）"
```

---

## 完了の判定

すべて満たしてはじめて「できた」と言う。

- [ ] `PYTHONIOENCODING=utf-8 python3 tools/test_requirements.py` が通る
- [ ] `PYTHONIOENCODING=utf-8 python3 tools/test_division.py` が通る（SKIP されていない）
- [ ] `tools/test_layout.py` `test_web_split.py` `test_tokens.py` `test_scoring_gate.py` が通る
- [ ] `git diff main --stat` に `web/index.html` と `web/assets/app.css` が**出てこない**
- [ ] Task 6 Step 6 の9項目を実機で確認ずみ（スマホ幅とPC幅の両方）
- [ ] `HANDOFF.md` の先頭に4項目がある

## ロールバック

作業は `feat/wang-division-filter` だけ。`main` は無傷。

```bash
git checkout main && git branch -D feat/wang-division-filter
```

`division` / `division_source` は追加フィールドで、既存の項目には触っていない。
`data/faculty_requirements.json` が無くても `build.py` は動き、
`web/data/requirements.json` が無くても画面は学部セクションが出ないだけで動く。
