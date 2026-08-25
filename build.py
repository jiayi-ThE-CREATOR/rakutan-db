#!/usr/bin/env python3
"""静的サイト用のデータを書き出す（Cloudflare Pages 用）。

    python3 build.py            # web/data/courses.built.json を作る
    python3 build.py --full     # シラバス原文も含めて出す（既定は出さない）

なぜ必要か
──────────
Cloudflare Pages は静的ホスティングなので server.py は動かない。
一方で採点ロジック(score.py)は Python で、これを JS に移植すると
「点数の正本が2つ」になり、片方だけ直した瞬間にサイトとLINEで
違う点数が出る。よって採点は Python のままビルド時に1回だけ実行し、
結果を静的JSONに焼く。ブラウザ側に残るのは match()（重み×軸スコアの
内積）だけで、これは判断を含まない算術。

SLIM（既定）
────────────
リポジトリは public なので、シラバス本文をそのまま置くと
原文の大量転載が git 履歴に永久に残り、検索にも載る。
表示に必要な事実は残し、本文は解析済みの値に置き換える。
--full は手元で中身を確認したいときだけ。
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import reviews
import score as scoring
from tools import engineering, faculty as faculty_mod, foreign_studies
from tools.division import JP_ONLY_TITLES, divide, track

ROOT = Path(__file__).parent
SRC = ROOT / "data" / "courses.json"
OUT = ROOT / "web" / "data" / "courses.built.json"
# 口コミ1件ずつは別ファイルにする。courses.built.json は絞り込みのたびに
# 全件なめるので、件数に比例して伸びるものを混ぜない。詳細パネルを最初に
# 開いた時だけ取りに行けば足りる（server.py も同じURLで返す）。
OUT_REVIEWS = ROOT / "web" / "data" / "reviews.built.json"
# 口コミ投稿の時間割（web/kuchikomi.html）が読む投影。courses.built.json は
# 12MB あり、時間割に要るのは科目名・担当・曜限・学部・学年だけなので、
# 全部を持って行かせない（reviews.built.json を分けたのと同じ理由）。
# 実測 gzip 531KB → 135KB。スマホで開く画面なので、この差は効く。
OUT_TIMETABLE = ROOT / "web" / "data" / "timetable.json"
SHELL = ROOT / "templates" / "shell.html"
PAGES = sorted((ROOT / "web").glob("*.html"))

# シラバス本文に出てくる出席要件を、数えられる形に落とす。
# 「全授業回数のうち3分の2以上出席」→ "2/3以上" だけ残して本文は捨てる。
_FRAC = re.compile(r"([0-9０-９]+)\s*分の\s*([0-9０-９]+)")
_RATIO = re.compile(r"([0-9０-９]+)\s*[／/]\s*([0-9０-９]+)")
_ABSENT = re.compile(r"([0-9０-９]+)\s*回以上(?:の)?欠席")
_Z2H = str.maketrans("０１２３４５６７８９", "0123456789")


def attendance_req(text: str | None) -> str | None:
    """出席要件を短い派生値にする。原文は返さない。"""
    if not text:
        return None
    t = text.translate(_Z2H)
    m = _FRAC.search(t)                       # 「3分の2」= 分母が先
    if m:
        return f"{m.group(2)}/{m.group(1)}以上の出席が必要"
    m = _RATIO.search(t)
    if m:
        return f"{m.group(1)}/{m.group(2)}以上の出席が必要"
    m = _ABSENT.search(t)
    if m:
        return f"{m.group(1)}回欠席で不可"
    if "毎回" in t and "出席" in t:
        return "毎回の出席が前提"
    return None


# 静的JSONに残すフィールド。ここに無いものは出さない（原文系は全部落ちる）。
KEEP = ["id", "title", "title_en", "category", "term", "day_period", "campus",
        "capacity", "class_format", "credits", "instructor", "numbering",
        "eval_ratio", "eval_raw", "eval_unclassified",
        "exam_type", "report_count", "report_words",
        "out_of_class_hours", "weekly_quiz", "tags", "source", "eligible_years",
        "reviews"]


def term_group(term: str | None) -> str:
    """学期を haru / aki / full の3つに畳む。

    KOAN の表記は6種類（春～夏学期／春学期／夏学期／秋～冬学期／秋学期／冬学期）
    ＋通年。画面と API の両方で同じ判定を書くと必ず片方だけ古くなるので、
    ここで1回畳んで courses.built.json に持たせる。

    値を日本語にしないのは、クエリ文字列に載せたときに文字化けするため
    （2026-08-24 に実測：?term=秋冬 が ç§å¬ として届いた）。

    full（通年）はどちらの学期でも履修対象なので、絞り込み側で必ず通す。
    """
    t = term or ""
    if "通年" in t:
        return "full"
    if "秋" in t or "冬" in t:
        return "aki"
    if "春" in t or "夏" in t:
        return "haru"
    return "unknown"


# 時間割のマスに置ける曜限。「月3」の形を1つずつ取り出す。
# 「金3,金4,金5」のように複数コマにまたがる科目があるので、単数ではなく配列。
#
# **空配列になる科目も落とさない。** 「他」（集中講義など1,060件）と土曜9件は
# マスが無いが、実在して履修されている。落とすと永久に口コミが付けられない
# ―― 理学部は667件中443件がこちらで、落とすと学部ごと投稿できなくなる。
# 画面は slots が空のものを「時間割に無い科目」として別の入口に出す。
_SLOT = re.compile(r"[月火水木金][1-6]")


def timetable_rows(courses: list[dict]) -> list[dict]:
    """口コミ投稿の画面が読む投影。

    ここに置くのは「絞り込みに要る事実」だけ。点数も口コミも入れない
    ―― 入れた瞬間に courses.built.json と同じものが2つになる。
    """
    rows = []
    for c in courses:
        rows.append({
            "id": c["id"],
            "title": c["title"],
            "instructor": c.get("instructor"),
            "slots": _SLOT.findall(c.get("day_period") or ""),
            # 「他」「土3」など、マスに置けない科目の原文。画面がそのまま出す
            # ―― 「集中講義」なのか「土曜」なのかで、学生の心当たりが違う。
            "day_period": c.get("day_period"),
            "term_group": term_group(c.get("term")),
            "faculty": faculty_mod.faculty_of(c),
            "eligible_years": c.get("eligible_years"),
            "track": c.get("track"),
        })
    return rows


def slim(course: dict) -> dict:
    out = {k: course.get(k) for k in KEEP}
    # 口コミの本文（一言）も公開物に載せる（2026-08-20 に方針変更。それまでは
    # 落としていた）。数字だけでは「なぜ楽なのか」が伝わらず、口コミの一番効く
    # 部分が学生に届いていなかった。
    #
    # ただし**このリポジトリは public で、載せた本文は git 履歴に永久に残る**。
    # 出せない一言（学則に触れる指南など）は data/reviews.json の側で
    # `"publish": false` を立てて落とす。reviews.aggregate() がそれを見て
    # notes から除く。落とすのは本文だけで、件数・数値はそのまま採点に効く
    # ―― 「その口コミが無かったこと」にはしない。
    out["attendance_req"] = attendance_req(course.get("attendance_rule"))
    out["term_group"] = term_group(course.get("term"))
    return out


def read_shell() -> dict[str, str]:
    """templates/shell.html から差し込む部品を取り出す。

    ヘッダとフッタを各ページへ手でコピーすると、必ず片方だけ古くなる。
    ブランド資料と実装が2週間ズレたのと同じ事故（旧 B-3）を、
    ページ間で繰り返さないための唯一の正本。
    """
    t = SHELL.read_text(encoding="utf-8")
    parts = {}
    for name in ("HEAD", "HEADER", "FOOTER"):
        open_, close = f"<!--PART:{name}-->", f"<!--/PART:{name}-->"
        parts[name] = t[t.index(open_) + len(open_):t.index(close)].strip()
    return parts


def inject_shell(page: Path, parts: dict[str, str]) -> bool:
    """1ページ分の <!--SHELL:XXX--> を差し替える。中身が変わったら True。

    目印は消さずに残す。消すと2回目の注入ができなくなる。
    """
    before = page.read_text(encoding="utf-8")
    after = before
    for name, html in parts.items():
        open_, close = f"<!--SHELL:{name}-->", f"<!--/SHELL:{name}-->"
        if open_ not in after or close not in after:
            continue
        i = after.index(open_) + len(open_)
        j = after.index(close, i)
        after = after[:i] + "\n" + html + "\n" + after[j:]
    if after != before:
        page.write_text(after, encoding="utf-8")
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true",
                    help="シラバス原文も含める（公開リポジトリには置かないこと）")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--allow-no-reviews", action="store_true",
                    help="口コミが0件でも上書きする（既定では止める）")
    ap.add_argument("--allow-fewer-courses", action="store_true",
                    help="いまの built.json より科目が減っても上書きする（既定では止める）")
    ap.add_argument("--out-reviews", default=str(OUT_REVIEWS))
    args = ap.parse_args()

    raw = json.loads(SRC.read_text(encoding="utf-8"))
    courses = raw["courses"]

    # 口コミを載せてから採点する。順番が逆だと反映されない。
    # 生データが無い人は集約ずみ（data/reviews.agg.json）で同じ数字になる。
    agg, rv_src = reviews.resolve()
    n_rv = reviews.apply(courses, agg)

    # 詳細パネル用の「1件ずつ」は生データからしか作れない（集約ずみは
    # 畳んだ後の姿しか持っていない）。持っていない人は焼き直さず、
    # リポジトリに入っている reviews.built.json をそのまま使う。
    rv_rows = reviews.load()

    # 口コミを持っていない人が流すと、口コミ入りの built.json を
    # 口コミ抜きで上書きしてしまう。黙って起きると気づけないので止める。
    dest_now = Path(args.out)
    if dest_now.exists() and n_rv == 0:
        try:
            had = sum(1 for c in json.loads(dest_now.read_text(encoding="utf-8"))
                      .get("courses", []) if c.get("reviews"))
        except (json.JSONDecodeError, OSError):
            had = 0
        if had and not args.allow_no_reviews:
            raise SystemExit(
                f"中止: いまの {dest_now.name} には口コミが {had} 科目ぶん入っていますが、\n"
                f"      今回の実行では0件でした。上書きすると口コミが消えます。\n"
                f"      data/reviews.agg.json が無いか、壊れていないか確認してください。\n"
                f"      本当に口コミ抜きで作るなら --allow-no-reviews を付けてください。")

    # 同じ守り方を科目数にも掛ける。data/courses.json は gitignore なので
    # （シラバス原文と教員名を含む＝公開リポジトリに置けない）、全所属7,877件を
    # 持っているのは取得した人だけ。共通教育1,112件しか持っていない人が流すと、
    # 7,877件の built.json が黙って1,112件に焼き直され、語学と学部の専門科目が
    # サイトから消える。2026-08-25 に口コミで同じことが起きている（112件→36件）。
    if dest_now.exists():
        try:
            had_courses = len(json.loads(dest_now.read_text(encoding="utf-8"))
                              .get("courses", []))
        except (json.JSONDecodeError, OSError):
            had_courses = 0
        if had_courses > len(courses) and not args.allow_fewer_courses:
            raise SystemExit(
                f"中止: いまの {dest_now.name} には科目が {had_courses:,} 件入っていますが、\n"
                f"      今回の入力（{SRC.name}）は {len(courses):,} 件しかありません。\n"
                f"      上書きすると差の {had_courses - len(courses):,} 件がサイトから消えます。\n"
                f"      {SRC.name} は gitignore なので、git pull では最新になりません。\n"
                f"      全所属ぶんを持っている人から受け取ってから流してください。\n"
                f"      本当に減らすなら --allow-fewer-courses を付けてください。")

    built = []
    for c in courses:
        # 留学生向けの日本語科目。区分は CELAS どおり第2外国語（＝lang2）に
        # 置いてあるので、そのままだと日本人学生の絞り込みに混ざる。
        # 区分を分けると卒業要件の表と1対1で対応しなくなるため、
        # カードのタグで断る（タグは score.py 経由で rakutan.tags に入る）。
        if c.get("title") in JP_ONLY_TITLES:
            c["tags"] = [*(c.get("tags") or []), "日本人履修不可"]
        base = dict(c) if args.full else slim(c)
        base["rakutan"] = scoring.score(c)      # 採点は必ず元データに対して行う
        # 科目区分。政岡さんの取得が入るまでは科目名とナンバリングからの推定で、
        # 出所を一緒に持たせる（画面で「推定」と断るため）。判定できないものは
        # null のまま ―― 画面では「その他」に集まる。
        base["division"], base["division_source"] = divide(c)
        # 学部の中でさらに絞る軸（外国語学部の専攻語・工学部の学科）。
        # 区分ではないので chip にはしない ―― 画面では学部セレクタの下に出る。
        base["track"] = track(c)
        built.append(base)

    # プリセット4つ分の順位を焼いておくと、LINE側は採点ロジックを持たずに済む。
    # 学年ごとに焼く。サイトの既定が1年なので、LINE も既定は "1" を読めばよい。
    # 1年生が履修できない科目を上位に出すと、選べない科目を薦めることになる。
    presets: dict[str, dict[str, list[str]]] = {}
    for year in (1, 2, 3, 4, 5, 6):   # 医・歯学部は6年制
        pool = [c for c in built
                if c["rakutan"]["overall"] is not None
                and year in (c.get("eligible_years") or [])]
        for name, weights in scoring.PRESETS.items():
            ranked = sorted(
                pool, key=lambda c: scoring.match(c["rakutan"], weights)["fit"],
                reverse=True)
            presets.setdefault(str(year), {})[name] = [c["id"] for c in ranked[:100]]

    judged = sum(1 for c in built if c["rakutan"]["overall"] is not None)
    payload = {
        "_meta": {
            **raw.get("_meta", {}),
            "built_count": len(built),
            "judged": judged,
            "unjudged": len(built) - judged,
            "slim": not args.full,
            "weights": scoring.WEIGHTS,
            "axis_label": scoring.AXIS_LABEL,
            "presets": scoring.PRESETS,
            # 口コミが採点に効き始める人数。画面の文言がこれを読む。
            # 2026-08-24：門を3件にしたのに「1件入ると出ます」と
            # 表示し続けていたので、数字を持たせて食い違いを止める。
            "min_for_scoring": reviews.MIN_FOR_SCORING,
            "note": "採点は build.py（score.py）で確定済み。"
                    "ブラウザ側は重み×軸スコアの内積のみ行う。",
            "eligible_years_note": "履修できる学年。KOAN の学年絞り込みで判定"
                                   "（scrape/years.py）。既定の表示は1年生。",
        },
        "preset_top": presets,   # {"1": {プリセット名: [id,...]}, "2": {...}, ...}
        "courses": built,
    }

    dest = Path(args.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(payload, ensure_ascii=False,
                               separators=(",", ":")), encoding="utf-8")

    # 口コミ1件ずつ（詳細パネル用）。--full でも中身は同じ ―― ここに出るのは
    # 選択式の回答と一言だけで、シラバス原文は元から入っていない。
    rv_dest = Path(args.out_reviews)
    rv_dest.parent.mkdir(parents=True, exist_ok=True)
    pub = reviews.public_rows(rv_rows)
    # courses.built.json と同じ守り方。生データを持っていない人が流したときに
    # 中身の入ったファイルを空で上書きさせない。集約ずみからは1件ずつを
    # 復元できないので、ここは「焼かない」しか手が無い。
    if not pub and rv_dest.exists() and not args.allow_no_reviews:
        try:
            had = len(json.loads(rv_dest.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            had = 0
        if had:
            print(f"  ⚠ {rv_dest.name} は据え置き（{had} 科目ぶん）"
                  " ―― 生データが無いので1件ずつは焼き直せません")
            pub = None
    if pub is not None:
        rv_dest.write_text(json.dumps(pub, ensure_ascii=False,
                                      separators=(",", ":")), encoding="utf-8")

    # 時間割の投影。courses.built.json と同じ元データから同じ実行で焼くので、
    # 片方だけ古くなることが無い。
    tt = timetable_rows(courses)
    OUT_TIMETABLE.write_text(json.dumps(tt, ensure_ascii=False,
                                        separators=(",", ":")), encoding="utf-8")
    n_slot = sum(1 for r in tt if r["slots"])
    print(f"→ {OUT_TIMETABLE}  {len(tt)} 件"
          f"（時間割のマスに置ける {n_slot} 件／置けない {len(tt) - n_slot} 件）")

    kb = dest.stat().st_size / 1024
    src_label = {"raw": "生データ", "agg": "集約ずみ", "none": "なし"}[rv_src]
    print(f"  口コミ {sum(a['n'] for a in agg.values())} 件 → {n_rv} 科目に反映"
          f"（{src_label}）")
    # data/reviews.json は .gitignore 対象で、git では運ばれない。
    # 2026-08-21 に既存36件へ taken_year を入れたが、それは各自の手元の
    # ファイルにしか無い ―― 古いコピーで焼き直すと受講年が黙って消える。
    # 消えたことに気付けるよう、ここで必ず声を出す。
    no_year = sum(1 for r in rv_rows if r.get("taken_year") is None)
    if no_year:
        print(f"  ⚠ 受講年が入っていない口コミ {no_year} 件 "
              f"／ 全 {len(rv_rows)} 件")
        print("     data/reviews.json が古い可能性があります。"
              "2026-08-21 時点の36件は全て 2026 で埋まっているはずです。")

    # courses.json に居ない科目IDに付いた口コミ。画面には出しようがないので
    # 落ちていることに気付けるよう数だけ出す（データ品質チェック側の材料）。
    orphan = sorted(set(pub or {}) - {c["id"] for c in courses})
    if orphan:
        print(f"  ⚠ 科目が見つからない口コミ {len(orphan)} 科目分"
              f"：{'、'.join(orphan)}")
    conflicted = [cid for cid, a in agg.items() if a["conflicts"]]
    print(f"  回答が割れている科目 {len(conflicted)} 件"
          + (f"：{'、'.join(conflicted)}" if conflicted else ""))
    if pub is not None:
        print(f"→ {rv_dest}  {rv_dest.stat().st_size / 1024:,.1f} KB  "
              f"（{len(pub)} 科目の1件ずつ）")
    print(f"→ {dest}  {kb:,.0f} KB  ({'SLIM' if not args.full else 'FULL'})")
    print(f"  科目 {len(built)} 件 ／ 判定できた {judged} 件 "
          f"／ 情報不足 {len(built) - judged} 件")
    if not args.full:
        print("  シラバス原文は含めていません（出席要件だけ派生値で保持）")

    # 要件表を公開側へ写す。courses.built.json には入れない
    # ―― あちらは絞り込みのたびに読む1.7MB で、要件表は学部を選んだときだけ要る。
    req_src = ROOT / "data" / "faculty_requirements.json"
    if req_src.exists():
        req = json.loads(req_src.read_text(encoding="utf-8"))
        # 学部チェックシート由来の区分は、写すときに合流させる。
        # data/faculty_requirements.json は fetch_requirements.py が CELAS から
        # 作り直すファイルなので、あちらへ直接書くと次のスクレイプで消える。
        req = foreign_studies.apply_to_requirements(req)
        req = engineering.apply_to_requirements(req)
        req_dest = ROOT / "web" / "data" / "requirements.json"
        req_dest.write_text(json.dumps(req, ensure_ascii=False, indent=1),
                            encoding="utf-8")
        print(f"→ {req_dest}")
    else:
        print("※ data/faculty_requirements.json が無いので学部の絞り込みは出ません。"
              "  python3 tools/fetch_requirements.py を流してください。")


    parts = read_shell()
    changed = [p.name for p in PAGES if inject_shell(p, parts)]
    print(f"  外殻を注入: {', '.join(changed)}" if changed else "  外殻に変更なし")

if __name__ == "__main__":
    main()
