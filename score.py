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

# 4軸それぞれの重み。合計 1.0。Phase 0 でチューニングする前提の v0 値。
# 重みは固定値ではなく「成績評価の内訳」から動的に決める。
#
# 固定重みでやると壊れる例：レポート1本12,000字・試験なし・出席なしの科目は、
# 試験軸と出席軸が満点になるので総合が「軽め」に出てしまう。実際には激重。
# 成績の100%がレポートなら、その科目はレポート負荷でほぼ全部判定されるべき。
#
# よって 試験/レポート/出席 の3軸には
#   floor（どの軸も最低限は見る）＋ 成績評価に占める比率  で重みを配る。
# 総合値を出すのに必要な「算出できた重みの割合」。
# これを下回る科目は総合値を出さず「情報不足」と表示する。
COVERAGE_MIN = 0.60

# 成績評価の内訳（eval_ratio）の合計がこれに満たない科目には総合値を出さない。
# COVERAGE_MIN が守るのは「4軸のうちいくつ測れたか」で、こちらが守るのは
# 「その軸の重み自体が正しいか」。別物なので両方要る。
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

# 「試験で評価される」「レポートで評価される」こと自体への加重。
# これは難しさではなく形なので、意図的に小さくしてある。
# 実際の難易度は口コミ（テストの難しさ・レポートの本数と分量）が決める。
EXAM_RATIO_COEF = 0.15
REPORT_RATIO_COEF = 0.15

# 2026-09-03: 小テストを出席から独立させて4軸にした。下限が 0.10×4＝0.40 に
# 増えたぶん、AXIS_SHARE を 0.58 → 0.48 に下げて合計 1.0 を保っている
# （0.40 ＋ 0.48 ＋ SCALE_WEIGHT 0.12 ＝ 1.00）。
AXIS_FLOOR = 0.10       # 4軸それぞれの下限（合計 0.40）
AXIS_SHARE = 0.48       # 成績評価比率に応じて配分される分
SCALE_WEIGHT = 0.12     # 規模・形態。事実ではなく推定なので最小固定

# /api/meta 用の説明
WEIGHTS = {
    "model": "dynamic",
    "axis_floor": AXIS_FLOOR,
    "axis_share": AXIS_SHARE,
    "scale": SCALE_WEIGHT,
    "note": "試験・レポート・出席・小テストの重みは、その科目の成績評価内訳から動的に決まる",
}



def _min_for_scoring() -> int:
    """口コミが採点に効き始める人数。正本は reviews.MIN_FOR_SCORING。

    reviews.py は score.py を使う側なので、モジュール先頭で import すると
    循環参照になる。呼ばれた時点で読む。
    """
    try:
        import reviews
        return int(reviews.MIN_FOR_SCORING)
    except Exception:
        return 3


def dynamic_weights(course: dict) -> dict[str, float]:
    er = course.get("eval_ratio") or {}
    shares = {k: float(er.get(k) or 0)
              for k in ("exam", "report", "attendance", "quiz")}
    total = sum(shares.values())
    if total <= 0:
        # 評価内訳が不明な科目は均等配分にする（推測で偏らせない）
        shares = {k: 1 / len(shares) for k in shares}
    else:
        shares = {k: v / total for k, v in shares.items()}
    w = {k: AXIS_FLOOR + AXIS_SHARE * s for k, s in shares.items()}
    w["scale"] = SCALE_WEIGHT
    return w

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
    """試験の重さ。返り値は 0〜100 の「楽さ」（高いほど楽）。

    以前は ease = 100 - 試験比率 だった。つまり「成績の100%が試験」＝
    最も重い、としていた。これは間違い。**試験で評価されることは
    難しさではなく、拘束の形**である。毎週の出席も課題も無く期末一発、
    というのはバイトを優先したい学生にとってはむしろ軽い。
    実データでも試験軸の平均が 32.8 まで落ち、1,112件中「軽め」が
    9件しか残らない原因になっていた（2026-08-15）。

    そこで2層に分ける。

      1層目（ここ・KOANだけで分かる）── 試験が「ある」ことによる軽い加重。
          レポート軸と同じ係数の考え方にする。あわせて、シラバスから
          読める構造だけを見る：中間試験もあるか（＝試験が2回）、持込可か。
      2層目（口コミが入ってから）── 「テストが難しい」という体感。
          KOANには絶対に書いていないので、口コミが来るまでは加算しない。

    したがって口コミが0件のうちは、この軸は「難しさ」を測っていない。
    測っているのは形だけである。evidence にそう書いて画面に出す。
    """
    ratio = (c.get("eval_ratio") or {}).get("exam")
    if ratio is None:
        return None, []

    why = []
    load = ratio * EXAM_RATIO_COEF
    if ratio == 0:
        why.append("試験なし")
    else:
        why.append(f"試験が成績の{ratio:.0f}%")

    # 中間と期末の両方があるなら、拘束される回数が増える。これは形の話。
    raw = c.get("eval_raw") or {}
    if any("中間" in k for k in raw) and any("期末" in k for k in raw):
        load += 12
        why.append("中間と期末の2回ある")

    if c.get("exam_type") == "持込可":
        load -= 25
        why.append("持込可")
    elif c.get("exam_type") == "持込不可":
        load += 8
        why.append("持込不可")

    # ── 2層目：口コミ由来の体感難易度（0=易しい 1=ふつう 2=難しい の平均）
    # 規定人数（reviews.MIN_FOR_SCORING）に届いた口コミだけを読む。
    # 1人の証言で総合値が半分になるのは根拠として弱すぎる、というのが
    # 2026-08-21 の判断。門の手前の口コミは数字に触れず、画面が
    # 「口コミがあります、中身を見てください」と出す（reviews.py の scored）。
    rv = c.get("reviews") or {}
    hard = rv.get("exam_hard") if rv.get("scored") else None
    if hard is not None:
        load += hard * 22
        why.append(f"口コミ：テストは{['易しめ','ふつう','難しい'][round(hard)]}")
    elif ratio:
        why.append("難しさは口コミ待ち" if not rv.get("n")
                   else f"口コミ{rv['n']}件あり ― 人数が足りず数字には未反映")

    return _clamp(100.0 - load), why


def _report_load(c: dict) -> tuple[float | None, list[str]]:
    """レポート負荷。本数と分量と時間外学習指示から出す。

    「レポートのみ＝楽」とは扱わない。レポート比率が高くても
    本数と分量が多ければ重いと判定する。
    """
    ratio = (c.get("eval_ratio") or {}).get("report")
    count = c.get("report_count")
    words = c.get("report_words")
    hours = c.get("out_of_class_hours")

    # 「レポートで評価される」ことは負荷ではない。負荷は本数・分量・時間外学習の
    # 側にある。その3つが全て無いとき、負荷は「軽い」のではなく「不明」である。
    #
    # ここを ratio だけで算出していたため、成績の80%がレポートの科目に
    # 「レポート軸88＝軽い」が付いていた（2026-08-14 実データで発覚）。
    # 間違う方向が「重い科目を軽いと言う」側なので、算出せず None を返す。
    # 総合値は score() のカバレッジ判定で「情報不足」に落ちる。
    if count is None and words is None and hours is None:
        if ratio:
            return None, [f"レポートが成績の{ratio:.0f}%だが、本数・分量が未取得"]
        return None, []

    why = []
    load = 0.0
    if ratio is not None:
        load += ratio * REPORT_RATIO_COEF
        why.append(f"レポートが成績の{ratio:.0f}%")
    if count is not None:
        load += min(count, 10) * 6.0
        why.append(f"レポート{count}本")
    if c.get("report_words"):
        w = c["report_words"]
        load += min(w / 8000.0, 1.0) * 20.0
        why.append(f"1本あたり約{w:,}字")
    if hours is not None:
        load += min(hours / 4.0, 1.0) * 25.0
        why.append(f"時間外学習の指示 週{hours}時間")
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


def _scale_ease(c: dict) -> tuple[float | None, list[str]]:
    """規模・開講形態。大人数講義ほど個別の詰めが甘くなりやすい、という経験則。

    これは事実ではなく推定なので重みを最も低くしてある。
    """
    cap = c.get("capacity")
    fmt = c.get("class_format")

    # 定員は KOAN に無く、実データでは 1,112件すべてが None。
    # 形態もほとんどが「講義科目」で、集中講義か演習でなければ何も分からない。
    # にもかかわらず既定値 50 を返していたため、全科目の総合値の12%が
    # 定数50で埋まり、分布全体が中央に引き寄せられていた（2026-08-15）。
    # 測れないものに数字を置かない、はレポート軸と同じ扱いにする。
    SIGNAL = {"集中講義", "演習", "セミナー"}
    if cap is None and fmt not in SIGNAL:
        return None, []

    why = []
    ease = 50.0
    if cap is not None:
        if cap >= 200:
            ease, band = 85.0, "大講義（定員200名以上）"
        elif cap >= 80:
            ease, band = 70.0, f"中規模講義（定員{cap}名）"
        elif cap >= 30:
            ease, band = 45.0, f"中小規模（定員{cap}名）"
        else:
            ease, band = 25.0, f"少人数・演習形式（定員{cap}名）"
        why.append(band)
    if fmt == "集中講義":
        ease += 10
        why.append("集中講義（短期間で完結）")
    if fmt == "演習" or fmt == "セミナー":
        ease -= 15
        why.append("演習形式（発表・議論の負担あり）")
    return _clamp(ease), why


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
    ("scale", "規模・形態", _scale_ease),
]


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
    """科目1件の楽単プロファイルを返す。

    総合値 (overall) は算出できた軸だけで重み付き平均を取り、
    重みは実際に使えた軸の合計で正規化する。欠損を平均値で
    埋めることはしない。
    """
    w = dynamic_weights(course)
    axes = {}
    weighted, weight_sum = 0.0, 0.0
    for key, label, fn in AXES:
        value, why = fn(course)
        axes[key] = {"label": label, "value": value,
                     "weight": round(w[key], 3), "evidence": why}
        if value is not None:
            weighted += value * w[key]
            weight_sum += w[key]

    # 成績評価の内訳が大きく欠けたままなら、軸の重みが実物とずれている。
    # 欠けた分は「負担ゼロ」として満点に化けるので、ここで止める。
    er_all = course.get("eval_ratio") or {}
    eval_captured = round(sum(er_all.values()), 1) if er_all else None
    partial_eval = eval_captured is not None and eval_captured < EVAL_TOTAL_MIN

    # 重みの合計は 1.0（floor 0.30 ＋ share 0.58 ＋ scale 0.12）なので、
    # weight_sum はそのまま「算出できた割合」になる。
    # 一番重い軸が測れていない科目に総合値を出すと、残った軽い軸だけで
    # 「軽め」が付いてしまう。カバレッジが足りなければ総合値は出さない。
    overall = (round(weighted / weight_sum, 1)
               if weight_sum >= COVERAGE_MIN and not partial_eval else None)
    conf = confidence(course)
    missing = [a["label"] for a in axes.values() if a["value"] is None]

    # 試験・レポートの「難しさ」は KOAN に書いていない。書いてあるのは形だけ。
    # 形だけで「軽め」と断言すると、成績の82%が一発試験の科目に楽単スコア
    # 最高が付く（実データで確認）。口コミが1件入るまでは断言しない。
    # 門をくぐっていない口コミは「難しさが確認されていない」ままとして扱う。
    # ここを緩めると、1件の口コミで「拘束は軽い」が「軽め」に変わり、
    # 誰も難しさを確かめていない一発試験の科目を推薦してしまう。
    er = course.get("eval_ratio") or {}
    rv = course.get("reviews") or {}
    scored_hard = rv.get("exam_hard") if rv.get("scored") else None
    pending = bool(er.get("exam")) and scored_hard is None

    return {
        "overall": overall,
        "band": band_of(overall, conf["level"], weight_sum, pending),
        "needs_review": pending,
        "coverage": round(weight_sum, 3),
        # 成績評価の内訳を何%拾えたか。100 未満なら総合値は出していない。
        "eval_captured": eval_captured,
        "eval_unclassified": course.get("eval_unclassified"),
        "missing_axes": missing,
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
LIGHT_MIN = 79
NORMAL_MIN = 67
HEAVYISH_MIN = 53


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
    "scale": "成績の甘さ",   # 規模からの推定。口コミが貯まるまでは確度が低い
}

# よくあるタイプ。スライダーをいきなり出すと誰も触らないので、
# まずこの4つから選ばせて、必要な人だけ微調整させる。
# 2026-09-03: サイトの右レールからは外した（上限スライダーへ置き換え）。
# **消していないのは LINE 公式アカウントがこれを読んでいるから** ――
# build.py の rank_presets() が preset_top を焼き、worker/index.js が引く。
# LINE 側の作り直しは別セッションの担当。そこが終わるまでは消さないこと。
# quiz は 5軸化に合わせて追加した（無いと小テストが順位に効かない）。
PRESETS = {
    "バイト優先":   {"attendance": 5, "quiz": 5, "report": 3, "exam": 2, "scale": 2},
    "GPA重視":     {"attendance": 2, "quiz": 3, "report": 3, "exam": 3, "scale": 5},
    "とにかく軽い": {"attendance": 4, "quiz": 4, "report": 4, "exam": 4, "scale": 4},
    "テストが苦手": {"attendance": 2, "quiz": 4, "report": 3, "exam": 5, "scale": 3},
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
CAP_AXES = ("attendance", "exam", "quiz", "report")
NO_CAP = 100


def _cap(caps: dict, key: str) -> int:
    try:
        return max(0, min(100, int(caps.get(key, NO_CAP))))
    except (TypeError, ValueError):
        return NO_CAP


def caps_impossible(caps: dict) -> bool:
    """4本の上限の合計が100%を下回っているか。

    成績評価の内訳は合計100%なので、合計が100を割った瞬間に
    条件を満たす科目は**原理的に存在しない**。実装ミスではなく仕様の性質。
    0件になってから気付かせるのではなく、そうなる前に画面で理由を出すために使う。
    """
    return sum(_cap(caps, k) for k in CAP_AXES) < 100


def passes_caps(course: dict, caps: dict) -> bool:
    """科目が4本の上限をすべて満たすか。

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
    """
    captured = course_score.get("eval_captured")
    if captured is None:
        return "シラバスに成績評価の内訳が載っていないため、判定を出していません。"
    if captured >= EVAL_TOTAL_MIN:
        return (f"判定に必要な情報が足りていません。"
                f"口コミが{_min_for_scoring()}件そろうと出ます。")
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
