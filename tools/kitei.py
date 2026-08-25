"""学部規程（大阪大学 規程集）の HTML から別表を取り出す。

■ 何のためのファイルか
外国語学部は科目名に【専攻科目】等の印が付いていたので科目名だけで区分へ割れた。
他の学部の科目名には印が一切無い（2026-08-26 実測。経済学部の「【旧→選必２】」1件のみ）。
必修か選択かの出所は**学部規程の別表**にしか無いので、まずそれを機械可読にする。

    https://www.osaka-u.ac.jp/kitei/  →  data/raw/kitei/<学部キー>.html
    （tools/fetch_lang_split.py が第1外国語の内訳のために取得ずみ）

■ 規程集の HTML のクセ
- **別表は本文と同じページの <table> に入っている**。ただし 附則（改正の経緯）にも
  「次表の左欄…」という小さな表が大量にあり、こちらは科目の区分ではない。
  数が多い（理学部は62枚のうち46枚が附則）ので、行数と列の形で落とす。
- **rowspan / colspan が縦横に効く**。「必修科目」が4行ぶんの rowspan で、
  かつ 区分の列が4段のうち2段ぶん colspan、という行が普通にある。
  展開しないと「必修」が科目名の後ろに来たりして列が揃わない。
- 表の見出し（どの学科の表か）は <table> の中ではなく**直前の本文**にある
  （「別表2 電子物理科学科(エレクトロニクスコース)」）。だから表単体では読めない。
"""
from __future__ import annotations

import html
import re
import unicodedata


def _text(x: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", x))).strip()


def grid(table_html: str) -> list[list[str]]:
    """<table> を rowspan/colspan 展開ずみの2次元配列にする。

    展開する（結合セルの値を、覆っている全マスへ複製する）のは、
    列の位置で意味を引くため。「必修選択の別」は列の位置でしか見分けられない。
    """
    rows = re.findall(r"<tr.*?</tr>", table_html, flags=re.S | re.I)
    out: list[list[str]] = []
    carry: dict[tuple[int, int], str] = {}
    for ri, tr in enumerate(rows):
        row: list[str] = []
        ci = 0
        for _, attr, body in re.findall(r"<(t[dh])([^>]*)>(.*?)</\1>", tr, flags=re.S | re.I):
            while (ri, ci) in carry:
                row.append(carry.pop((ri, ci)))
                ci += 1
            # 引用符は " ' 無し のどれもありうる。規程集は " だが、
            # 属性の書き方に判定を預けない
            rs = int((re.search(r'rowspan\s*=\s*["\']?(\d+)', attr, re.I) or [0, 1])[1])
            cs = int((re.search(r'colspan\s*=\s*["\']?(\d+)', attr, re.I) or [0, 1])[1])
            v = _text(body)
            base = ci
            for c in range(cs):
                row.append(v)
                for r in range(1, rs):
                    carry[(ri + r, base + c)] = v
            ci = base + cs
        while (ri, ci) in carry:
            row.append(carry.pop((ri, ci)))
            ci += 1
        out.append(row)
    return out


def tables(path: str) -> list[tuple[str, list[list[str]]]]:
    """(表の直前の本文, 展開ずみの表) を出現順に返す。"""
    raw = open(path, encoding="utf-8", errors="replace").read()
    parts = re.split(r"(<table.*?</table>)", raw, flags=re.S | re.I)
    out = []
    for i, part in enumerate(parts):
        if part.lower().startswith("<table"):
            out.append((_text(parts[i - 1]) if i else "", grid(part)))
    return out


def norm(title: str) -> str:
    """科目名を突き合わせ用に正規化する。

    KOAN と規程で表記がずれるのは実測で次の4種類だけ（2026-08-26）:
      全角/半角（Ⅰ と I、Ａ と A、空白）／ダッシュの字体（―－‐）／
      括弧内の注記（「隣接臨床医学（小児科学）」）／KOAN 側の連番サフィックス。
    括弧を落とすと別科目まで同名になる例は出なかった（実測で確認）。
    ローマ数字は NFKC が I/II/III へ展開するので、算用数字とは別物のまま残る
    ―― 経済学部の「上級マクロ経済1」と「上級マクロ経済Ⅰ」は**別の表記**で、
    ここでは一致しない。学部ごとの規則で吸収する（tools/senmon.py）。
    """
    s = unicodedata.normalize("NFKC", title or "").replace("\xa0", "")
    s = re.sub(r"[\s　]", "", s)
    s = s.replace("―", "-").replace("－", "-").replace("‐", "-").replace("—", "-")
    s = re.sub(r"[（(][^（()）]*[)）]", "", s)
    return s.strip()
