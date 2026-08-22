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

AXIS_FLOOR = 0.10       # 3軸それぞれの下限（合計 0.30）
AXIS_SHARE = 0.58       # 成績評価比率に応じて配分される分
SCALE_WEIGHT = 0.12     # 規模・形態。事実ではなく推定なので最小固定

# /api/meta 用の説明
WEIGHTS = {
    "model": "dynamic",
    "axis_floor": AXIS_FLOOR,
    "axis_share": AXIS_SHARE,
    "scale": SCALE_WEIGHT,
    "note": "試験・レポート・出席の重みは、その科目の成績評価内訳から動的に決まる",
}


def dynamic_weights(course: dict) -> dict[str, float]:
    er = course.get("eval_ratio") or {}
    shares = {k: float(er.get(k) or 0) for k in ("exam", "report", "attendance")}
    total = sum(shares.values())
    if total <= 0:
        # 評価内訳が不明な科目は均等配分にする（推測で偏らせない）
        shares = {k: 1 / 3 for k in shares}
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
    """出席・毎回課題による拘束。

    注意: 「出席点が高い＝楽」は片面でしかない。出席点が高い科目は
    毎週必ず出る必要があり、拘束としては重い。ここでは
    「出席さえすれば取れる度」ではなく「拘束の軽さ」として扱う。
    """
    ratio = (c.get("eval_ratio") or {}).get("attendance")
    if ratio is None and c.get("weekly_quiz") is None:
        return None, []
    why = []
    load = 0.0
    if ratio is not None:
        load += ratio * 0.55
        if ratio >= 50:
            why.append(f"出席・平常点が{ratio:.0f}%（毎週の出席がほぼ必須）")
        elif ratio > 0:
            why.append(f"出席・平常点が{ratio:.0f}%")
        else:
            why.append("出席点なし（試験・課題のみで評価）")
    if c.get("weekly_quiz"):
        load += 25.0
        why.append("毎回の小テスト・リアクションペーパーあり")
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
    if pending and overall >= 72:
        # 拘束の形は軽い。ただしテストの難しさは誰も確認していない。
        # ここで「軽め」と言い切ると、難しい一発試験の科目を推薦してしまう。
        return "拘束は軽い"
    if overall >= 72:
        return "軽め"
    if overall >= 55:
        return "標準"
    if overall >= 38:
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
    "scale": "成績の甘さ",   # 規模からの推定。口コミが貯まるまでは確度が低い
}

# よくあるタイプ。スライダーをいきなり出すと誰も触らないので、
# まずこの4つから選ばせて、必要な人だけ微調整させる。
PRESETS = {
    "バイト優先":   {"attendance": 5, "report": 3, "exam": 2, "scale": 2},
    "GPA重視":     {"attendance": 2, "report": 3, "exam": 3, "scale": 5},
    "とにかく軽い": {"attendance": 4, "report": 4, "exam": 4, "scale": 4},
    "テストが苦手": {"attendance": 2, "report": 3, "exam": 5, "scale": 3},
}
DEFAULT_WEIGHTS = PRESETS["とにかく軽い"]


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
        captured = course_score.get("eval_captured")
        reason = ("判定に必要な情報が足りていません。口コミが1件入ると出ます。"
                  if captured is None or captured >= EVAL_TOTAL_MIN else
                  f"シラバスの成績評価の内訳が{captured:.0f}%分しか読み取れないため、"
                  "判定を出していません。")
        return {"fit": None, "reason": reason, "weights": w, "labels": AXIS_LABEL}

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
