"""楽単スコア算出エンジン

設計方針（チーム会議「楽単ロジック」論点への回答）:

1. S〜F のような単一の総合評価は出さない。負荷を4軸に分解して出す。
   理由: クロバスの S〜F 評価体系は流用できない（法務）だけでなく、
   「レポートのみ＝楽」のような単純化が事実として誤りだから。
   レポート1本1万字は期末試験より重い。

2. 数値スコアにはシラバスの事実項目しか入れない。
   「先生が優しい」「板書が読めない」等の当てはめられない情報は
   tags として別レイヤーに置き、スコアには一切influenceさせない。
   理由: 数字の根拠を全部提示できる状態を保つため（信用問題）。

3. どの科目にも必ず confidence（信頼度）を付ける。
   埋まっていない項目は「不明」として扱い、勝手に平均値で埋めない。
   信頼度が低い科目は UI 側で必ずその旨を出す。
"""

from __future__ import annotations

# 2026-09-17: 採点を「相性度」に作り直した
# （docs/superpowers/specs/2026-09-16-aishoudo-engine-design.md）。
#
#   相性度 ＝ (1 − s) × 事実層 ＋ s × 体感層
#   事実層 ＝ EXAM_SHARE × 試験の楽さ ＋ (1 − EXAM_SHARE) × 試験以外の楽さ
#
# 重みは科目の成績評価内訳からではなく、学生の側から来る（いまは多数派の好み1つ）。
# 以前の動的重みは「試験があるか」の差を潰し、試験のみの科目がレポートのみの
# 科目より軽く出ていた（85.0 ＞ 55.0）。
#
# ここに以前書かれていた「固定重みでやると、レポート1本12,000字・試験なし・出席なしの
# 科目が満点の軸に引っぱられて軽く出る」問題は、試験以外を「その科目にある項目だけ」で
# 平均することで解いている（aishoudo）。

# 成績評価の内訳（eval_ratio）の合計がこれに満たない科目には総合値を出さない。
# 2026-09-17 に COVERAGE_MIN（算出できた重みの割合）は消した。
# いまは内訳が読めて、この割合に届いているかだけが「総合値を出すか」を決める。
#
# 合計が 100 に届かないケースは2種類あり、**どちらも「実際より楽に見える」
# 方向にだけ外れる**：
#   ① METHOD_RULES がその評価方法名を知らず、割合ごと落ちた
#      → その軸は「負担ゼロ」として満点になる。eval_unclassified に名前が残る
#   ② KOAN のシラバス側の表がそもそも 100% になっていない
#      → こちらは直しようがない。実データでは1件だけ（137135、合計90%）
#
# **なぜ 100 ではなく 80 か。** 軸の重みは残った内訳から正規化して決まる
# （dynamic_weights）ので、90% 読めていれば科目の形はもう決まっている。
# 残り10%がどの軸に乗っても順位はほとんど動かない。そこで「1割程度の不足で
# 判定を捨てる」のはやり過ぎとして、8割読めていれば出すことにした
# （2026-08-20 の判断）。実際に問題だったのは 20%〜70% しか読めていない
# 科目の方で、そこに 89.0（かなり楽）が付いて1年生のおすすめに載っていた。
#
# ①は落ちた項目が eval_unclassified に残り、parse.py も一覧を出すので、
# 8割を超えていて総合値が出る場合でも「気づけない」ことにはならない。
EVAL_TOTAL_MIN = 80.0

# 試験の楽さ。試験が内訳に無ければ 100、あれば 100 −（EXAM_BASE ＋ 比率 × EXAM_RATIO_COEF）。
# EXAM_BASE は「試験があること自体の重さ」。38〜42 が平地（最大 band 29.5%）で、
# 35 にすると 43.1% に崩れた（全 7,906件で実測）。40 はその真ん中。
EXAM_BASE = 40.0
EXAM_RATIO_COEF = 0.20
# 2026-09-11: 0.15 → 0.45。0.15 では「レポートが成績の80%」でも 12点しか
# 引かれず 88点＝軽い になる。これが 2026-08-14 に軸ごと None にした原因
# だったが、誤りは ratio を使ったことではなく係数が小さすぎたことだった。
# 0.45 なら 80% → 64点「標準」で妥当な位置に来る。
REPORT_RATIO_COEF = 0.45

# 2026-09-16: 発表を独立した軸にした。PRESENTATION_BASE は「発表があること自体の
# 負担」―― 人前に立つ・日程が動かせない・グループなら他人と合わせる、という
# レポートとは違う性質の重さ。
PRESENTATION_BASE = 30.0
PRESENTATION_RATIO_COEF = 0.25

# 事実層のうち試験が占める割合と、試験以外の項目どうしの重み。
# **試験以外は、その科目に実際にある項目だけで正規化する**（aishoudo）。
# 全項目に固定で配ると、無い項目の満点 100 が混ざり、試験なしの科目 3,959件が
# 6点幅に潰れた。ある項目だけにすると 15.5点幅に広がる（実測）。
EXAM_SHARE = 0.50
OTHER_WEIGHTS = {"presentation": 0.20, "report": 0.15, "attendance": 0.15, "quiz": 0.10}

# 体感層（口コミ）の取り分。中身の違う回答の人数で増やし、FEEL_FULL_AT 人で上限。
# 1人 6.7% ／ 2人 13.3% ／ 3人以上 20%。上限が 20% なので、1人の回答で
# band を何段も跨ぐ事故（2026-08-21 の 78.0 → 41.6）は起きない。
FEEL_MAX_SHARE = 0.20
FEEL_FULL_AT = 3

# /api/meta 用の説明
WEIGHTS = {
    "model": "aishoudo",
    "exam_share": EXAM_SHARE,
    "other_weights": OTHER_WEIGHTS,
    "feel_max_share": FEEL_MAX_SHARE,
    "feel_full_at": FEEL_FULL_AT,
    "note": "相性度 ＝ (1−体感の取り分)×事実層 ＋ 体感の取り分×体感層。事実層は試験と、その科目にある試験以外の項目で決まる",
}

# 信頼度の判定に使う項目。ここが埋まっているほど信頼できる。
EVIDENCE_FIELDS = [
    "eval_ratio",          # 成績評価の内訳（%）
    "report_count",        # レポート本数
    "out_of_class_hours",  # 授業時間外学習の指示時間
    "capacity",            # 定員
    "class_format",        # 授業形態
    "day_period",          # 曜限
]


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


def _exam_load(c: dict) -> tuple[float | None, list[str]]:
    """試験の楽さ。返り値は 0〜100（高いほど楽）。

    2026-09-17: 「試験があること」自体を重さとして数えるようにした（EXAM_BASE）。
    それまでは「試験で評価されるのは難しさではなく形」として比率×0.15 しか引かず、
    試験のみの科目がレポートのみの科目より軽く出ていた。方針は「多くの学生は
    試験を嫌い、レポートのほうがまし」。

    口コミの「テストの難しさ」はここには入れない。体感層（_feel）が持つ。
    内訳そのものが読めない科目だけ None。試験が内訳に無いのは「試験なし」＝100。
    """
    er = c.get("eval_ratio")
    if er is None:
        return None, []
    ratio = float(er.get("exam") or 0.0)
    if ratio == 0:
        return 100.0, ["試験なし"]
    why = [f"試験が成績の{ratio:.0f}%"]
    load = EXAM_BASE + ratio * EXAM_RATIO_COEF
    raw = c.get("eval_raw") or {}
    if any("中間" in k for k in raw) and any("期末" in k for k in raw):
        load += 8
        why.append("中間と期末の2回ある")
    if c.get("exam_type") == "持込可":
        load -= 15
        why.append("持込可")
    elif c.get("exam_type") == "持込不可":
        load += 5
        why.append("持込不可")
    return _clamp(100.0 - load), why


def _report_load(c: dict) -> tuple[float | None, list[str]]:
    """レポート負荷。まず割合で「形」を測り、量が取れていれば足す。

    2026-09-11: 本数・分量・時間外学習が全て無いときに軸ごと None を返す
    実装をやめた。KOAN はこの3つを実測で 0件 / 3件 / 149件（全7,906件中）
    しか埋めておらず、レポート軸は 98% の科目で動いていなかった。軸が1本
    死ぬと weight_sum が COVERAGE_MIN を割り、科目ごと「情報不足」に落ちる
    ―― 4,121件（54%）がこれだった。

    2026-08-14 に軸を止めた判断は、係数が小さすぎた標定の問題（100 −
    ratio×0.15 なので 80% でも 88点＝軽い）に対して軸の廃止で答えたもの。
    係数を上げれば 80% → 64点になる（REPORT_RATIO_COEF のコメント参照）。

    試験軸も ratio だけで「形」を測り、難しさは口コミ待ちにしている。
    レポート軸だけが別の基準で黙るのは非対称なので揃える。

    **測っているのは形だけ。**「レポート40%」が1本2,000字なのか5本1万字
    なのかは区別できない。evidence にそう書いて画面に出す。
    """
    er = c.get("eval_ratio")
    if er is None:
        # 内訳そのものが読めない科目。勝手に満点にすると、ズレは必ず
        # 「実際より楽に見える」方向にだけ出る。
        return None, []

    # キーが無い＝0%（不明ではない）。出席軸・小テスト軸と同じ扱い。
    ratio = float(er.get("report") or 0.0)
    count = c.get("report_count")
    words = c.get("report_words")
    hours = c.get("out_of_class_hours")

    why = []
    load = ratio * REPORT_RATIO_COEF
    if ratio > 0:
        why.append(f"レポートが成績の{ratio:.0f}%")
    else:
        why.append("レポートなし")
    if count is not None:
        load += min(count, 10) * 6.0
        why.append(f"レポート{count}本")
    if words:
        load += min(words / 8000.0, 1.0) * 20.0
        why.append(f"1本あたり約{words:,}字")
    if hours is not None:
        load += min(hours / 4.0, 1.0) * 25.0
        why.append(f"時間外学習の指示 週{hours}時間")
    if ratio > 0 and count is None and words is None:
        why.append("本数・分量は取得できていないため、形のみで判定")
    return _clamp(100.0 - load), why


def _attendance_load(c: dict) -> tuple[float | None, list[str]]:
    """出席・平常点による拘束。

    注意: 「出席点が高い＝楽」は片面でしかない。出席点が高い科目は
    毎週必ず出る必要があり、拘束としては重い。ここでは
    「出席さえすれば取れる度」ではなく「拘束の軽さ」として扱う。

    2026-09-03: 毎回の小テストの負担は `_quiz_load` へ移した。ここで
    weekly_quiz を足すと、小テストが独立した軸になった後は**二重計上**になる。

    内訳そのものが読めない科目（eval_ratio が無い）は None を返す。
    キーが無いだけの科目は「0%」であって「不明」ではない ――
    出席点が内訳に無いのは事実として読み取れている。
    """
    er = c.get("eval_ratio")
    if er is None:
        return None, []
    ratio = float(er.get("attendance") or 0.0)
    load = ratio * 0.55
    if ratio >= 50:
        why = [f"出席・平常点が{ratio:.0f}%（毎週の出席がほぼ必須）"]
    elif ratio > 0:
        why = [f"出席・平常点が{ratio:.0f}%"]
    else:
        why = ["出席点なし（試験・課題のみで評価）"]
    return _clamp(100.0 - load), why


def _quiz_load(c: dict) -> tuple[float | None, list[str]]:
    """毎回の小テスト・リアクションペーパーによる拘束。

    出席とは別の負担である。出席だけなら座っていればよいが、小テストは
    毎回そのつど準備が要る。以前は出席軸に足し込んでいたため、
    「出席は緩いが毎週小テストがある科目」が緩い側に出ていた。

    比率が内訳に無いのは「0%」＝負担なしであって不明ではない。
    内訳そのものが読めない科目だけ None を返す。
    """
    er = c.get("eval_ratio")
    if er is None:
        return None, []
    ratio = float(er.get("quiz") or 0.0)
    why = []
    load = ratio * 0.55
    if ratio > 0:
        why.append(f"小テストが成績の{ratio:.0f}%")
    # 配点が付いていなくても、本文に「毎回小テスト」と書かれていれば拘束はある。
    if c.get("weekly_quiz"):
        load += 25.0
        why.append("毎回の小テスト・リアクションペーパーあり")
    elif ratio == 0:
        why.append("小テストなし")
    return _clamp(100.0 - load), why


def _presentation_load(c: dict) -> tuple[float | None, list[str]]:
    """発表の重さ。返り値は 0〜100 の「楽さ」（高いほど楽）。

    2026-09-16 に report から独立させた。レポートは夜中に書き足せるが、発表は
    人前に立ち、日程が動かせず、グループなら他人と合わせる必要がある。この
    「あること自体の負担」を PRESENTATION_BASE で表し、比率ぶんを足す。

    比率が内訳に無いのは「0%」＝負担なしであって不明ではない。
    内訳そのものが読めない科目だけ None を返す。
    """
    er = c.get("eval_ratio")
    if er is None:
        return None, []
    ratio = float(er.get("presentation") or 0.0)
    if ratio == 0:
        return 100.0, ["発表なし"]
    load = PRESENTATION_BASE + ratio * PRESENTATION_RATIO_COEF
    return _clamp(100.0 - load), [f"発表が成績の{ratio:.0f}%"]


def _schedule_note(c: dict) -> list[str]:
    """スコアには入れないが体感コストとして表示する情報。"""
    notes = []
    dp = c.get("day_period")
    if dp and dp.endswith("1"):
        notes.append("1限（体感コスト大）")
    if c.get("campus") and c.get("campus") != "豊中":
        notes.append(f"{c['campus']}キャンパス（移動あり）")
    return notes


AXES = [
    ("exam", "試験", _exam_load),
    ("report", "レポート・課題", _report_load),
    ("attendance", "出席拘束", _attendance_load),
    ("quiz", "小テスト", _quiz_load),
    ("presentation", "発表", _presentation_load),
]


def _present_others(c: dict) -> list[str]:
    """試験以外で、その科目に実際にある項目。比率が 0 の項目は入れない。

    小テストは比率 0 でも、本文に「毎回小テスト」とあれば負担なので入れる。
    """
    er = c.get("eval_ratio") or {}
    return [k for k in OTHER_WEIGHTS
            if float(er.get(k) or 0.0) > 0 or (k == "quiz" and c.get("weekly_quiz"))]


def _feel(c: dict) -> tuple[float | None, float]:
    """体感層の楽さ（0〜100）と取り分。口コミから楽さが1つも取れなければ (None, 0.0)。

    口コミの値はどれも 0〜2（2 が重い）。100 − 50 × 値 で楽さにして平均する。
    テストの難しさは試験がある科目だけ見る。
    「課題はなかった」は取り込み時に未回答と同じ None になっていて区別できない。
    """
    rv = c.get("reviews") or {}
    if not rv.get("n"):
        return None, 0.0
    signals = []
    has_exam = float((c.get("eval_ratio") or {}).get("exam") or 0.0) > 0
    if has_exam and rv.get("exam_hard") is not None:
        signals.append(100.0 - 50.0 * rv["exam_hard"])
    for k in ("attendance", "in_class", "out_class"):
        if rv.get(k) is not None:
            signals.append(100.0 - 50.0 * rv[k])
    if not signals:
        return None, 0.0
    people = rv.get("n_distinct") or rv["n"]
    share = FEEL_MAX_SHARE * min(people, FEEL_FULL_AT) / FEEL_FULL_AT
    return sum(signals) / len(signals), share


def aishoudo(values: dict, present: list[str], feel: tuple[float | None, float],
             exam_share: float = EXAM_SHARE,
             other_weights: dict | None = None) -> float:
    """相性度。values は各軸の楽さ、present は _present_others、feel は _feel の返り値。

    exam_share と other_weights は、LINE のプリセットのように好みを変えて
    並べ直すときだけ渡す（match）。既定は多数派の好み。
    """
    ow = OTHER_WEIGHTS if other_weights is None else other_weights
    ws = sum(ow.get(k, 0.0) for k in present)
    other = (100.0 if ws <= 0
             else sum(values[k] * ow.get(k, 0.0) for k in present) / ws)
    fact = exam_share * values["exam"] + (1 - exam_share) * other
    ease, share = feel
    total = fact if ease is None else (1 - share) * fact + share * ease
    return round(total, 1)


def confidence(c: dict) -> dict:
    known = [f for f in EVIDENCE_FIELDS if c.get(f) not in (None, {}, "")]
    n = len(known)
    total = len(EVIDENCE_FIELDS)
    if n >= 5:
        level = "high"
    elif n >= 3:
        level = "mid"
    else:
        level = "low"
    return {
        "level": level,
        "known": n,
        "total": total,
        "missing": [f for f in EVIDENCE_FIELDS if f not in known],
    }


def score(course: dict) -> dict:
    """科目1件の相性度プロファイルを返す。

    内訳が読めない科目、内訳が EVAL_TOTAL_MIN に届かない科目には総合値を出さない。
    欠けた分を平均値で埋めることはしない。
    """
    axes = {}
    for key, label, fn in AXES:
        value, why = fn(course)
        axes[key] = {"label": label, "value": value, "evidence": why}

    er = course.get("eval_ratio") or {}
    eval_captured = round(sum(er.values()), 1) if er else None
    readable = (course.get("eval_ratio") is not None
                and eval_captured is not None and eval_captured >= EVAL_TOTAL_MIN)
    present = _present_others(course)
    feel = _feel(course)
    overall = (aishoudo({k: a["value"] for k, a in axes.items()}, present, feel)
               if readable else None)
    conf = confidence(course)

    # 試験があるのに、口コミでテストの難しさを確かめた人がまだいない。
    # おすすめ順の第1キー（build.py の preset_key）と band の「拘束は軽い」が読む。
    rv = course.get("reviews") or {}
    pending = float(er.get("exam") or 0.0) > 0 and rv.get("exam_hard") is None

    return {
        "overall": overall,
        "band": band_of(overall, conf["level"], 1.0 if er else 0.0, pending),
        "needs_review": pending,
        # LINE のプリセットで並べ直すとき（match）に、科目の中身を読まずに済むように持つ。
        "present": present,
        "feel": {"value": None if feel[0] is None else round(feel[0], 3),
                 "share": round(feel[1], 3)},
        "eval_captured": eval_captured,
        "eval_unclassified": course.get("eval_unclassified"),
        "missing_axes": [a["label"] for a in axes.values() if a["value"] is None],
        "axes": axes,
        "confidence": conf,
        "notes": _schedule_note(course),
        # tags はスコアに一切入らない。表示のみ。
        "tags": course.get("tags", []),
    }


# band のしきい値。**分布に合わせた定数であって、絶対的な意味は無い。**
#
# 2026-09-03、小テストを独立させて4軸→5軸にしたときに 72/55/38 から
# 80/68/54 へ引き上げた。軸を1本足すと、その軸が満点になる科目
# （小テストが無い6,473件）の総合値が機械的に上がる。実測では
# **判定できた3,602件すべてが上がり、下がった科目は0件**だった
# （中央値 +2.7）。しきい値を据え置くと「新しい根拠は何も無いのに
# 軽い判定が426件増える」ことになる。
#
# 一方、順位はほとんど動いていない（小テストあり/なし/weekly_quiz の
# 3群とも、順位の中央値の移動は0.6ポイント未満）。動いたのは目盛りの
# ほうなので、目盛りに合わせてしきい値を置き直した。
#
# 新しい値は「変更前と同じ割合を切る位置」を実測して求めた（79.3 / 67.6 / 53.1）。
#
# 🚨 **切り上げてはいけない。** 分布が滑らかでないので、1動かすと大きく跳ぶ。
#   79 → 73.7%（目標 73.5%）だが 80 にすると 67.6% ―― 5.9ポイント飛ぶ
#   53 → 98.7%（目標 96.6%）だが 54 にすると 88.5% ―― 10.2ポイント飛ぶ
# とくに **53.1 ちょうどに348件が固まっている**（「出席・平常点が100%」だけで
# 評価される科目は入力が同一なので総合値も同一になる）。しきい値をこの塊の
# 上に置くと、348件が一斉に「重め」へ落ちる。だから最も近い整数を採る。
#
# 軸を足す・係数を変えるときは、必ず tools/test_haiten_filter.py の
# band 分布チェックを通すこと。
# 2026-09-11: レポート軸が生き返って判定できる科目が 3,638 → 7,474 件に
# 増えたので、4,121件が判定不能だった頃の分布で決めた 79/67/53 は使えない。
#
# 選び方は 2026-09-03 と同じ ―― 実測分布で「±1 動かしても大きく跳ばない」
# 平らな場所だけを候補にして、その中から4つの band が均等に近くなる位置を採る。
#
# 🚨 76・77・78 には置けない。78.2 ちょうどに 742 件が固まっており、
#   78 → 79 で 16.2pt 跳ぶ。閾値をこの塊の上に置くと 742 件が一斉に band を
#   変える（2026-09-03 に 53.1 の 348件 で同じことを避けたのと同じ理屈）。
#
# 87 / 79 / 75 はいずれも ±1 で 1.3pt 以下しか動かない平らな場所で、
# 結果の分布は やや重め 26.0% ／ 重め 25.1% ／ 標準 22.2% ／
# 拘束は軽い 20.1% ―― 最大の band でも 27.5%（改修前は 72% が
# 「拘束は軽い」に集まっていた）。
# 2026-09-16: 発表を独立した軸にし、保底を内訳に出てくる軸だけに付けたので、
# 約7,300科目の点数が動いた。87/79/75 はその前の分布の値なので置き直す。
#
# 選び方は同じ ―― ±1 動かしても 1.5pt 以下しか動かない平らな場所だけを候補にし、
# 4つの band の最大が最も小さくなる3点を採る。
#
# 🚨 発表の固定罰点を 25 にすると最良の3点が 83/72/30 になり最大 band 42.5% まで
#   崩れた。地形は係数に対して単調ではないので、係数を変えたら必ず測り直すこと。
#
# 83 / 77 / 69 での分布は やや重め 2,322 ／ 重め 2,192 ／ 拘束は軽い 1,688 ／
# 標準 1,190 ―― tools/test_report_axis.py の⑧が見る最大 band は 31.0%。
# 2026-09-17: 採点を相性度に作り直し、ほぼ全科目の点数が動いた。83/77/69 は
# その前の分布の値なので置き直す。選び方は同じ（±1 で 1.5pt 以下しか動かない
# 平らな場所から、4つの band の最大が最も小さくなる3点）。
# 試験の固定罰点 EXAM_BASE を 35 にすると最大 band 43.1% まで崩れた。
# 係数を変えたら必ず測り直すこと。
LIGHT_MIN = 84
NORMAL_MIN = 71
HEAVYISH_MIN = 65


def band_of(overall: float | None, conf_level: str,
            coverage: float = 1.0, pending: bool = False) -> str:
    """表示用の区分。信頼度が低いときは断定しない。

    クロバスの S〜F は使わない（法務リスク・差別化の両面）。
    """
    if overall is None:
        # 「測れなかった」と「そもそもデータが無い」を区別する。
        # 情報不足＝口コミが1件入れば判定できるようになる科目。
        return "情報不足" if coverage > 0 else "判定不可"
    if conf_level == "low":
        return "参考値"
    if pending and overall >= LIGHT_MIN:
        # 拘束の形は軽い。ただしテストの難しさは誰も確認していない。
        # ここで「軽め」と言い切ると、難しい一発試験の科目を推薦してしまう。
        return "拘束は軽い"
    if overall >= LIGHT_MIN:
        return "軽め"
    if overall >= NORMAL_MIN:
        return "標準"
    if overall >= HEAVYISH_MIN:
        return "やや重め"
    return "重め"


def enrich(course: dict) -> dict:
    """API が返す形。元データ＋算出結果。"""
    out = dict(course)
    out["rakutan"] = score(course)
    return out


# ═══════════════════════════════════════════════════════════════
# 相性（マッチング）── 松下モックの中心アイデアを取り込んだ部分
#
# 「楽単」は科目の属性ではなく、その人との相性である。
# 出席を落としたくない人と、GPAが欲しい人は、別の科目にたどり着く。
# よって順位は「科目の絶対スコア」ではなく
# 「学生の重み × 科目の軸スコア」で決める。
#
# 学生に見せる軸名は、シラバス用語ではなく学生の言葉にする。
# ═══════════════════════════════════════════════════════════════

# 内部の軸 → 学生に見せる軸名
AXIS_LABEL = {
    "attendance": "出席の緩さ",
    "report": "課題の軽さ",
    "exam": "テストの楽さ",
    "quiz": "小テストの少なさ",
    "presentation": "発表の少なさ",
}

# よくあるタイプ。スライダーをいきなり出すと誰も触らないので、
# まずこの4つから選ばせて、必要な人だけ微調整させる。
# 2026-09-03: サイトの右レールからは外した（上限スライダーへ置き換え）。
# **消していないのは LINE 公式アカウントがこれを読んでいるから** ――
# build.py の rank_presets() が preset_top を焼き、worker/index.js が引く。
# LINE 側の作り直しは別セッションの担当。そこが終わるまでは消さないこと。
# quiz は 5軸化に合わせて追加した（無いと小テストが順位に効かない）。
PRESETS = {
    "バイト優先":   {"attendance": 5, "quiz": 5, "report": 3, "exam": 2, "presentation": 3},
    "GPA重視":     {"attendance": 2, "quiz": 3, "report": 3, "exam": 3, "presentation": 3},
    "とにかく軽い": {"attendance": 4, "quiz": 4, "report": 4, "exam": 4, "presentation": 4},
    "テストが苦手": {"attendance": 2, "quiz": 4, "report": 3, "exam": 5, "presentation": 3},
}
DEFAULT_WEIGHTS = PRESETS["とにかく軽い"]


# ═══════════════════════════════════════════════════════════════
# 配点の上限でしぼる（2026-09-03）
#
# スライダーの意味を「あなたがどれだけ気にするか（重み 0〜5）」から
# 「その配点が何%以下の科目を出すか（上限 0〜100%）」へ変えた。
# 学生が言うのは「出席が重い授業はイヤ」であって
# 「出席を重み4で評価したい」ではない。
#
# 上限は**科目を落とす**。順位は落とさない ―― 並び順は楽単スコアが決める。
# 役割を分けておかないと「なぜ消えたか」も「なぜ上位か」も説明できなくなる。
#
# server.py と web/assets/app.js に同じ判定がある。片方だけ直さないこと。
# ═══════════════════════════════════════════════════════════════

# 上限をかけられる軸。規模・形態（scale）は成績評価の内訳ではないので入らない。
# 🚨 2026-09-16 に presentation を足した。**ここに無いキーの上限は passes_caps が
# 黙って無視する**（最初の「全部 100% なら通す」判定がこのタプルしか見ない）。
# 入れ忘れると「発表なし」チップが全 7,906件に一致した（実測）。
# web/assets/app.js の CAP_AXES と同じにすること。
CAP_AXES = ("attendance", "exam", "quiz", "report", "presentation")
NO_CAP = 100


def _cap(caps: dict, key: str) -> int:
    try:
        return max(0, min(100, int(caps.get(key, NO_CAP))))
    except (TypeError, ValueError):
        return NO_CAP


def caps_impossible(caps: dict) -> bool:
    """CAP_AXES の上限の合計が100%を下回っているか。

    成績評価の内訳は合計100%なので、合計が100を割った瞬間に
    条件を満たす科目は**原理的に存在しない**。実装ミスではなく仕様の性質。
    0件になってから気付かせるのではなく、そうなる前に画面で理由を出すために使う。
    """
    return sum(_cap(caps, k) for k in CAP_AXES) < 100


def passes_caps(course: dict, caps: dict) -> bool:
    """科目が CAP_AXES の上限をすべて満たすか。

    **上限を1本でも 100% から動かしたら、配点が最後まで読めない科目は通さない。**
    eval_unclassified が残る科目は「残りの%」にどの軸が隠れているか分からず、
    黙って通すとズレは必ず「実際より楽に見える」方向にだけ出る
    （EVAL_TOTAL_MIN と同じ判断。app.js の evalKnown も同じ理由で外している）。

    上限が全部 100%（＝既定）のときは何も落とさない。触っていないのに
    件数が減る画面は、何が起きたのか説明できない。
    """
    if all(_cap(caps, k) >= NO_CAP for k in CAP_AXES):
        return True
    er = course.get("eval_ratio")
    if not er or course.get("eval_unclassified"):
        return False
    # 🚨 内訳が「振り分けられている」だけでは足りない。**合計が100%に
    # 届いているか**も見る。2026-09-03 実測：デンマーク語V〜VIIの6件は
    # eval_unclassified が空なのに内訳が「試験20%」しか無く（＝シラバスの表が
    # そもそも埋まっていない）、4本の上限を20%にしても通り抜けていた。
    # 残り80%に何が入るか分からない以上、通してはいけない。
    # 同じ理由で score() も EVAL_TOTAL_MIN 未満の科目に総合値を出していない。
    if sum(er.values()) < EVAL_TOTAL_MIN:
        return False
    # キーが無い＝0%（不明ではない）。0% はどの上限も通る。
    return all(float(er.get(k) or 0.0) <= _cap(caps, k) for k in CAP_AXES)


def parse_caps(params: dict) -> dict:
    """クエリ文字列から上限を取り出す。?cap_attendance=30 の形。"""
    caps = {}
    for k in CAP_AXES:
        v = params.get("cap_" + k)
        v = v[0] if isinstance(v, list) else v
        if v is None:
            continue
        try:
            caps[k] = max(0, min(100, int(v)))
        except (TypeError, ValueError):
            pass
    return caps


def _unjudged_reason(course_score: dict) -> str:
    """総合値を出さないと決めた科目に、その理由を返す。

    件数は reviews.MIN_FOR_SCORING が正本。ここに数字を書くと、門を変えたときに
    文言だけ古くなる（2026-08-24 まで門は3件なのに「1件入ると出ます」と出していた）。

    2026-09-03: eval_captured が None（＝シラバスに成績評価の内訳がそもそも
    載っていない152件）にも「口コミが3件そろうと出ます」と言っていた。
    **待っても出ない。** 足りないのは口コミではなくシラバスの表なので、
    口コミが何件入っても軸は埋まらない。5軸化で出席軸が「不明」を返すように
    なり、この152件の band が 情報不足→判定不可 に変わって画面で目立つように
    なったため直した。

    2026-09-06: 「口コミが N件そろうと出ます」は**文を返さない**（空文字）。
    待っているのが口コミなら、カードの ※ の行が投稿への誘いとして同じことを
    言う。2か所で言うと、同じカードに口コミの話が二段で並ぶ。
    ここで待っても出ない2つ（内訳が無い／読み取れた%が足りない）は、
    ※ の行が出ない科目なので今までどおり文を返す。

    2026-09-07: 「シラバスに載っていない」と「こちらが読み分けられない」を
    **言い分ける**ようにした。内訳の欄をシラバス直写しに変えた（#127）ので、
    科目の詳細には内訳が4項目・合計100%で出ているのに、一覧のカードで
    「シラバスに内訳が載っていない」と言う状態になっていた（507科目）。
    例：総合英語（Content-based English）は
    `Learning engagnement 35% / mini news presetations 5% / short speeches 30%
     / reading and listening comprehension 30%` と**シラバスには書いてある**。
    載っていないのではなく、METHOD_RULES がこの4つをどの区分にも
    振り分けられていない。見分けは eval_unclassified が空かどうかで付く。

    **スコアは1点も変わらない。ここで変えたのは文だけ。**

    2026-09-11: 読み分けられない項目がある科目の文言を、こちらの都合の説明から
    **読む人への案内**に変えた（363科目）。「種類に読み分けられなかった」は
    こちらの分類器の話で、読む人には何の情報でもない。

    この363科目は成績のつけ方がそもそも特殊で、項目名を機械で分類しても
    意味のある軸にならない（例:「TOEFL ITPの得点 40%」「e-learningの
    取り組み状況 40%」）。**点数は出さない。** 代わりに、科目の詳細の
    「成績評価の内訳」がシラバスの表をそのまま写して出しているので、
    そちらを読んでもらう。判断は学生に返す。
    """
    captured = course_score.get("eval_captured")
    unclassified = course_score.get("eval_unclassified")
    if captured is None:
        if unclassified:
            return ("この授業は成績のつけ方が特殊なため、点数での判定は出していません。"
                    "下の「成績評価の内訳」に、シラバスに書かれているとおりの"
                    "項目と配点を出しています。")
        return "シラバスに成績評価の内訳が載っていないため、判定を出していません。"
    if captured >= EVAL_TOTAL_MIN:
        return ""
    if unclassified:
        return ("この授業は成績のつけ方が特殊なため、点数での判定は出していません。"
                "下の「成績評価の内訳」に、シラバスに書かれているとおりの"
                "項目と配点を出しています。")
    return (f"シラバスの成績評価の内訳が{captured:.0f}%分しか読み取れないため、"
            "判定を出していません。")


def match(course_score: dict, weights: dict | None = None) -> dict:
    """学生の重みを掛けた相性と、その理由の文章を返す。

    数値だけ出しても「なぜ勧められたか」が伝わらないので、
    重みの高い軸のうち満たしたもの／満たさなかったものを言葉にする。
    """
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    axes = course_score["axes"]

    # 総合値を出さないと決めた科目に、相性の数字だけ出してはいけない。
    # 学生が実際に見て比較するのはこの数字なので、ここを素通しにすると
    # 「情報不足」の判定が画面上では無かったことになる（2026-08-15）。
    if course_score.get("overall") is None:
        # 「口コミが入れば出る」と言えるのは、口コミで埋まる穴のときだけ。
        # 成績評価の内訳そのものが欠けている科目は口コミでは直らない
        # （シラバス側の問題）ので、同じ文言を出すと嘘になる。
        return {"fit": None, "reason": _unjudged_reason(course_score),
                "weights": w, "labels": AXIS_LABEL}

    total, wsum = 0.0, 0.0
    for k, weight in w.items():
        v = axes.get(k, {}).get("value")
        if v is not None and weight > 0:
            total += v * weight
            wsum += weight
    fit = round(total / wsum) if wsum > 0 else None

    # 重視している順に見て、満たした軸／満たさない軸を拾う
    ranked = sorted(w.items(), key=lambda kv: -kv[1])
    good, bad = [], []
    for k, weight in ranked:
        v = axes.get(k, {}).get("value")
        if v is None or weight < 3:
            continue
        (good if v >= 66 else bad if v < 45 else []).append(AXIS_LABEL[k])

    parts = []
    if good:
        parts.append(f"あなたが重視する{'・'.join(good[:2])}を満たしています。")
    if bad:
        parts.append(f"一方で{'・'.join(bad[:2])}は期待できません。")
    if not parts:
        parts.append("重視している条件については、この科目は平均的です。")

    return {"fit": fit, "reason": "".join(parts),
            "weights": w, "labels": AXIS_LABEL}


def explain(course_score: dict) -> dict:
    """画面に出す数字と理由。**ユーザーの重みは使わない。**

    2026-09-03: スライダーが「重み」から「上限」に変わったので、内積で出す
    「相性」という数字は入力を失った。重み無しで出した数字に「あなたとの相性」
    という名前を付けると嘘になるので、表に出すのは総合の楽単スコアにする。
    上限は絞り込み、順位は楽単スコア ―― 役割を分ける。

    match() は消していない。**LINE が読む preset_top は重み付きの順位**で、
    build.py の rank_presets() がそれを使っている（LINE 側の作り直しは別の担当）。

    web/assets/app.js の matchLocal() と同じ内容にすること。片方だけ直さない。
    """
    if course_score.get("overall") is None:
        return {"fit": None, "reason": _unjudged_reason(course_score),
                "labels": AXIS_LABEL}
    axes = course_score["axes"]
    good, bad = [], []
    for k in CAP_AXES:
        v = axes.get(k, {}).get("value")
        if v is None:
            continue
        (good if v >= 66 else bad if v < 45 else []).append(AXIS_LABEL[k])
    parts = []
    if good:
        parts.append(f"{'・'.join(good[:2])}が期待できます。")
    if bad:
        parts.append(f"{'・'.join(bad[:2])}は期待できません。")
    if not parts:
        parts.append("どの軸も平均的な科目です。")
    return {"fit": course_score["overall"], "reason": "".join(parts),
            "labels": AXIS_LABEL}


def parse_weights(params: dict) -> dict | None:
    """クエリ文字列から重みを取り出す。?preset=バイト優先 か ?w_attendance=5 の形。"""
    def one(k):
        v = params.get(k)
        return v[0] if v else None

    preset = one("preset")
    if preset in PRESETS:
        return dict(PRESETS[preset])
    w = {}
    for k in AXIS_LABEL:
        v = one("w_" + k)
        if v is not None:
            try:
                w[k] = max(0, min(5, int(v)))
            except ValueError:
                pass
    return w or None
