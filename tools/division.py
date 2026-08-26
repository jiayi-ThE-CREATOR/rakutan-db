"""科目を科目区分（人文科学系・情報教育科目…）へ割り当てる。

■ 判定の順番
    政岡さんの取得フィールド > 学部ごとの規則 > 科目名の接頭辞【人文】等 > ナンバリング
上位が値を持てば下位は見ない。**取得が入れば推定は自動的に効かなくなる**ので、
規則を消す作業は要らない。

■ 学部ごとの規則は別ファイル
ここが扱うのは共通教育（所属13）とマルチリンガル（所属14）＝全11学部に共通の
CELAS 区分。学部の専門科目は出所が学部のチェックシート・学部規程で系統が違うので、
別ファイルに分けてナンバリングの所属コードで振り分ける。
    tools/foreign_studies.py … 外国語学部（10FOST）。科目名の【専攻科目】等の印で割る
    tools/engineering.py     … 工学部（08）。学科コードだけ。必修は科目の側で割れない
    tools/senmon.py          … 残り9学部。学部規程の別表に科目名を引きに行く

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

from tools import engineering, foreign_studies, senmon

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

# ── マルチリンガル教育センター（所属14）の科目 ────────────────
# ナンバリングが 14CMLE で始まるものだけに使う規則。所属13 には当てない。
# 2026-08-25 時点でこの1,165件はまだ取得できていない（政岡さん作業中）が、
# KOAN の一覧から題名は実測ずみなので、入った瞬間に効くようにしてある。
MULTILINGUAL_PREFIX = "14CMLE"

# マルチリンガル科目のナンバリング末尾2文字は CELAS の区分そのもの。
# 1,160件で実測（2026-08-25）：
#   A7 グローバル理解  207件（うち193件は題名の規則で既に global）
#   B3 第1外国語(英語)  588件   B4 第2外国語系 321件   B5 選択外国語系 44件
# B4/B5 は第2外国語と選択外国語が混ざる ―― どちらになるかは
# 「その学生が第2外国語として選んだか」で決まる科目の外の属性なので、
# 末尾だけでは割れない。A7 だけは 193/193 が global で例外が無いので使う。
GLOBAL_NUMBERING_SUFFIX = "A7"

# 留学生向けの日本語科目。CELAS の区分は「第２外国語（日本語）」＝ lang2 だが、
# 日本人学生はこの枠で履修できない。区分を分けると chip が増えて
# 卒業要件の表と1対1で対応しなくなるので、区分は lang2 のままにして
# カードのタグ（build.py）で断る。
JP_ONLY_TITLES = ("専門日本語", "総合日本語")

# 各学部規程が「第2外国語」として名指ししている4言語。11学部すべてで同じ。
DAI2_LANGS = ("ドイツ語", "フランス語", "ロシア語", "中国語")

# グローバル理解科目。規程に名前が出ているものだけを入れている。
#   歯学部規程「グローバル理解で指定された授業科目の…『国際コミュニケーション演習』
#              又は『地域言語文化演習』の科目のいずれかを選択し」
#   人間科学部規程「グローバル理解の『多文化コミュニケーション (日本語) 』の科目」
GLOBAL_PREFIXES = ("国際コミュニケーション演習", "地域言語文化演習",
                   "多文化コミュニケーション")

# 選択外国語。人間科学部規程が挙げる「英語、ドイツ語、フランス語、ロシア語、
# 中国語、ギリシャ語及びラテン語」のうち、第2外国語の4言語と重ならないものと、
# 実測で出た他言語。「英語選択」は科目名がそのまま選択外国語を指す。
LANG_OPT_PREFIXES = ("英語選択", "スペイン語", "イタリア語", "朝鮮語",
                     "ギリシャ語", "ラテン語")

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
    numbering = course.get("numbering") or ""

    # 外国語学部の専門科目は学部チェックシートの行へ割る。CELAS の区分とは
    # 別系統なので別ファイルに置いてある（tools/foreign_studies.py）。
    if numbering.startswith(foreign_studies.NUMBERING_PREFIX):
        return foreign_studies.divide_foreign_studies(title, numbering)
    if numbering.startswith(engineering.NUMBERING_PREFIX):
        return engineering.divide_engineering(title, numbering)
    # 残り9学部は学部規程の別表（data/senmon_tables.json）を引く。
    if numbering[:2] in senmon.SHOZOKU:
        return senmon.divide_senmon(title, numbering)

    m = _PREFIX_RE.match(title)
    if m and m.group(1) in PREFIX:
        return PREFIX[m.group(1)], "title"

    # マルチリンガル教育センターの科目は題名で分ける。
    # ナンバリングは 総合英語 と 実践英語 で同じ値（14CMLE1BLB3）になるため
    # 使えない ―― 2026-08-25 に KOAN の詳細ページで実測した。
    if numbering.startswith(MULTILINGUAL_PREFIX):
        return _divide_multilingual(title, numbering)

    seg = numbering[6:8]
    if seg in NUMBERING:
        return NUMBERING[seg], "numbering"
    if seg == "1V" and any(w in title for w in SPORTS_WORDS):
        return "health_sports", "numbering"

    return None, None


def _divide_multilingual(title: str, numbering: str) -> tuple[str | None, str | None]:
    """所属14（マルチリンガル教育センター）の科目を区分へ割り当てる。

    「特別外国語演習」「専門日本語」「総合日本語」はどの学部規程にも
    区分の名指しが無い。2026-08-25 までは None にしていたが（規程に無い＝
    猜わない）、CELAS の区分コード（ナンバリング末尾2文字）で割れることが
    1,160件の実測で分かったので、そちらを出所にして拾っている。

    「日本人学生が履修できるか」は区分とは別の話で、区分は CELAS どおりに
    置き、履修可否はタグで断る（JP_ONLY_TITLES と build.py）。

    なお **第2外国語と選択外国語は科目の属性ではない**。ドイツ語の同じ科目でも、
    その学生が第2外国語として選んだのなら第2外国語、そうでなければ選択外国語に
    なりうる（人間科学部規程ほか）。ここでは「第2外国語として名指しされている
    4言語は第2外国語」という多数派に寄せている。絞り込みの入口としては
    これで足りるが、単位計算に使ってはいけない。
    """
    if title.startswith("総合英語"):
        return "lang1_sogo", "title"
    if title.startswith("実践英語"):
        return "lang1_jissen", "title"
    if any(title.startswith(w) for w in GLOBAL_PREFIXES):
        return "global", "title"
    if any(title.startswith(w) for w in LANG_OPT_PREFIXES):
        return "lang_opt", "title"
    if any(title.startswith(w) for w in DAI2_LANGS):
        return "lang2", "title"
    # 題名の規則から漏れたものは、ナンバリング末尾の区分コードで拾う。
    # 「特別外国語演習（タイ語）」等14件がここに来る ―― どの学部規程にも
    # 名前が出ないが、CELAS の区分コードは A7＝グローバル理解で、同じ
    # コードの193件は例外なく global。
    if numbering.endswith(GLOBAL_NUMBERING_SUFFIX):
        return "global", "numbering"
    # 留学生向けの日本語科目。CELAS の「第２外国語（日本語）」に当たる。
    # 日本人学生が履修できないことは build.py のタグで断る。
    if title in JP_ONLY_TITLES:
        return "lang2", "title"
    return None, None


# ── トラック（学部の中でさらに絞る軸）──────────────
# 区分（＝卒業要件のどの枠か）とは別の軸。外国語学部の専攻語、工学部の学科の
# ように「これが決まると科目の顔ぶれが変わる」もの。chip ではなく学部セレクタの
# 下に置く（区分の列に混ぜると、卒業要件の表と1対1で対応しなくなる）。
TRACK_FACULTY = {
    foreign_studies.NUMBERING_PREFIX: (foreign_studies.TRACK_KEY,
                                       foreign_studies.track_of),
    engineering.NUMBERING_PREFIX: (engineering.TRACK_KEY, engineering.track_of),
    **{code: (senmon.track_key(fac), senmon.track_of)
       for code, fac in senmon.SHOZOKU.items() if senmon.track_key(fac)},
}


def track(course: dict) -> str | None:
    """トラックを "<軸>:<値>" で返す。持たない科目は None。

    軸を前に付けるのは、学部をまたいでコードが衝突しないようにするため
    （外国語学部の "L"＝英語 と、工学部の学科キーが同じ空間に入る）。
    """
    numbering = course.get("numbering") or ""
    title = course.get("title") or ""
    for prefix, (key, fn) in TRACK_FACULTY.items():
        if numbering.startswith(prefix):
            # 科目名も渡す ―― 外国語学部は、同じナンバリングに専攻限定の
            # 【専攻科目】と全員履修できる（学共-…）が同居していて、
            # どちらかは名前の接頭マーカーでしか割れない。
            got = fn(numbering, title)
            return f"{key}:{got}" if got else None
    return None
