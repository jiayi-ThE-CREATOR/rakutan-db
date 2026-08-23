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

ROOT = Path(__file__).parent
SRC = ROOT / "data" / "courses.json"
OUT = ROOT / "web" / "data" / "courses.built.json"
# 口コミ1件ずつは別ファイルにする。courses.built.json は絞り込みのたびに
# 全件なめるので、件数に比例して伸びるものを混ぜない。詳細パネルを最初に
# 開いた時だけ取りに行けば足りる（server.py も同じURLで返す）。
OUT_REVIEWS = ROOT / "web" / "data" / "reviews.built.json"
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
    return out


def read_shell() -> dict[str, str]:
    """templates/shell.html から差し込む部品を取り出す。

    ヘッダとフッタを各ページへ手でコピーすると、必ず片方だけ古くなる。
    ブランド資料と実装が2週間ズレたのと同じ事故（旧 B-3）を、
    ページ間で繰り返さないための唯一の正本。
    """
    t = SHELL.read_text(encoding="utf-8")
    parts = {}
    for name in ("HEADER", "FOOTER"):
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

    built = []
    for c in courses:
        base = dict(c) if args.full else slim(c)
        base["rakutan"] = scoring.score(c)      # 採点は必ず元データに対して行う
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


    parts = read_shell()
    changed = [p.name for p in PAGES if inject_shell(p, parts)]
    print(f"  外殻を注入: {', '.join(changed)}" if changed else "  外殻に変更なし")

if __name__ == "__main__":
    main()
