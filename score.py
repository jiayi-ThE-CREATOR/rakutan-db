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
    """期末試験の重さ。返り値は 0〜100 の「楽さ」（高いほど楽）。"""
    ratio = (c.get("eval_ratio") or {}).get("exam")
    if ratio is None:
        return None, []
    why = []
    ease = 100.0 - ratio  # 試験比率がそのまま重さ
    if c.get("exam_type") == "持込可":
        ease += 35
        why.append("持込可の試験")
    elif c.get("exam_type") == "持込不可":
        ease -= 10
        why.append("持込不可の試験")
    if ratio == 0:
        why.append("期末試験なし")
    else:
        why.append(f"試験が成績の{ratio:.0f}%")
    return _clamp(ease), why


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
        load += ratio * 0.15
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
    if cap is None and fmt is None:
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

    # 重みの合計は 1.0（floor 0.30 ＋ share 0.58 ＋ scale 0.12）なので、
    # weight_sum はそのまま「算出できた割合」になる。
    # 一番重い軸が測れていない科目に総合値を出すと、残った軽い軸だけで
    # 「軽め」が付いてしまう。カバレッジが足りなければ総合値は出さない。
    overall = (round(weighted / weight_sum, 1)
               if weight_sum >= COVERAGE_MIN else None)
    conf = confidence(course)
    missing = [a["label"] for a in axes.values() if a["value"] is None]

    return {
        "overall": overall,
        "band": band_of(overall, conf["level"], weight_sum),
        "coverage": round(weight_sum, 3),
        "missing_axes": missing,
        "axes": axes,
        "confidence": conf,
        "notes": _schedule_note(course),
        # tags はスコアに一切入らない。表示のみ。
        "tags": course.get("tags", []),
    }


def band_of(overall: float | None, conf_level: str,
            coverage: float = 1.0) -> str:
    """表示用の区分。信頼度が低いときは断定しない。

    クロバスの S〜F は使わない（法務リスク・差別化の両面）。
    """
    if overall is None:
        # 「測れなかった」と「そもそもデータが無い」を区別する。
        # 情報不足＝口コミが1件入れば判定できるようになる科目。
        return "情報不足" if coverage > 0 else "判定不可"
    if conf_level == "low":
        return "参考値"
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
