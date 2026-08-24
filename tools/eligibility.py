"""シラバス詳細ページの「履修対象／Eligibility」を読む。

■ なぜ要るか
「学部・学科で絞れない」という要望（しゅんやさんの指摘②・2026-08-24）。
詳細ページには項目があるのに、いまのパーサが拾っていない。

■ どういう値が入っているか（2026-08-24 に16件を実測）
    全学部                        11件
    工（地1〜60）                  1件
    工（電1～95）                  1件
    工（理）下3ケタ001～108          1件
    工（然）                       1件
    （空）                        1件

3割ほどに学部の制限があり、しかも基礎解析学・化学基礎論・図学講義・
統計学といった「取れるかどうかが一番効く」科目に集中している。

■ 何を返し、何を返さないか
値は3層になっている。
    工（地1〜60）
    ↑   ↑  ↑
    学部 学科 学籍番号の範囲

学部までは機械的に取れる。**学科の略称（地／電／然／理…）は
対照表が要るが、まだ全学部ぶんの略称を見ていない**ので、
ここでは対照表を作らない。見ていない値のために規則を書くと必ず外れる。

学籍番号の範囲は**絞り込みに使わない**。学籍番号を尋ねるのは
「登録・ログイン不要」という前提に反するし、個人情報でもある。
だから raw をそのまま画面に出して、学生に自分で確かめてもらう。

■ 使い方
    from tools.eligibility import parse_eligibility
    parse_eligibility(detail_html)
      → {"raw": "工（地1〜60）", "all_faculties": False, "faculty": "工"}
      → {"raw": "全学部",        "all_faculties": True,  "faculty": None}
      → None（欄そのものが無い場合）
"""
from __future__ import annotations

import html
import re

# 全角・半角のゆれを吸収してから判定する。
_WS = re.compile(r"\s+")
_TAG = re.compile(r"<[^>]+>")
_CELL = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.S | re.I)

# 「全学部」と同じ意味で使われている表記。実測で出たものだけを入れる。
_ALL = ("全学部", "全学生", "全学")


def _cells(page: str) -> list[str]:
    """表のセルを、タグを落とした文字列にして順番に返す。"""
    return [_WS.sub(" ", html.unescape(_TAG.sub(" ", c))).strip()
            for c in _CELL.findall(page)]


def extract_raw(page: str) -> str | None:
    """「履修対象／Eligibility」の値をそのまま返す。欄が無ければ None。

    ラベルと値が別のセルに入っている場合と、
    同じセルに続けて入っている場合の両方がある。
    """
    cells = _cells(page)
    for i, c in enumerate(cells):
        if "履修対象" not in c and "Eligibility" not in c:
            continue
        inline = re.sub(r".*Eligibility", "", c).strip()
        if inline:
            return inline
        return cells[i + 1].strip() if i + 1 < len(cells) else ""
    return None


def parse_eligibility(page: str) -> dict | None:
    """詳細ページから履修対象を読み、絞り込みに使える形にして返す。

    faculty は「（」の前だけ。学科の略称は展開しない（対照表が未確定）。
    """
    raw = extract_raw(page)
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return {"raw": "", "all_faculties": None, "faculty": None}
    if any(a in raw for a in _ALL):
        return {"raw": raw, "all_faculties": True, "faculty": None}
    # 「工（地1〜60）」→ 学部は「工」。全角・半角どちらの括弧も来る。
    m = re.match(r"\s*([^\s（(]+)", raw)
    return {"raw": raw, "all_faculties": False,
            "faculty": m.group(1) if m else None}
