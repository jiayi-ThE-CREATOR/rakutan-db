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
