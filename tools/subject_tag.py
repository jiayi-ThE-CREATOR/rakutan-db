#!/usr/bin/env python3
"""シラバス本文を Gemini に投げて、授業内容タグを付ける。**一度きりのバッチ処理**。

    python3 tools/extract_syllabus_text.py     # 先にこれ（本文を集める）
    export GEMINI_API_KEY=...
    python3 tools/subject_tag.py --limit 40    # まず40件で動作確認
    python3 tools/subject_tag.py               # 全件

→ `data/subjects.ai.tsv`（id / 科目名 / タグ）。**人が上から読んで直せる形**にする。
  直したい行は `data/subjects.manual.tsv` に書くと、そちらが AI に勝つ。

■ 常駐させないこと
本番の配信経路には一切入らない。手で1回流して TSV を作るだけ。
ラクハンのサイトは静的配信で、実行時に LLM を呼ぶ設計にはしない。

■ 有料 API を使わない
Gemini の無料枠を使う（本人の恒久方針）。呼び出しは urllib だけで書いてある
――このリポジトリは依存を増やさない（bs4 以外は標準ライブラリ）。

■ 途中で止めて再開できる
7,906件を1件ずつ投げると止まったとき最初からになる。TSV に書けたぶんは
「済み」として飛ばすので、何度実行しても安全（scrape/fetch.py と同じ考え方）。

■ 語彙は tools/subjects.py が正本
プロンプトに語彙を書き写さない。書き写すと語彙を足したときにプロンプトだけ
古くなり、モデルが知らないキーを返して clean() に黙って落とされる
（＝タグが付かない科目が増えるだけで、原因が画面から見えない）。

設計は docs/plans/2026-09-03-naiyou-tag-design.md
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.subjects import clean, vocab_prompt  # noqa: E402

TEXT = ROOT / "data" / "syllabus_text.jsonl.gz"
BUILT = ROOT / "web" / "data" / "courses.built.json"
OUT = ROOT / "data" / "subjects.ai.tsv"

# 1件ぶんに投げる本文の長さ。概要は中央値344文字・最大703文字、各回の題目は
# 中央値272文字なので、この長さでほぼ切り落とさずに済む。長い科目だけ切る。
ABSTRACT_MAX = 700
KAIJI_MAX = 700

API = ("https://generativelanguage.googleapis.com/v1beta/models/"
       "{model}:generateContent")


def course_block(row: dict, course: dict | None) -> str:
    """1科目ぶんの投げる文。

    学部とナンバリングは**文脈として**渡す（「設計製図」がどの分野の設計かを
    判断するのに要る）。ただし **出力ラベルにはしない** ―― `08MEEN→機械` を
    そのままタグにすると、実測で77%が「1学部90%以上」になり、学部フィルタの
    言い換えにしかならなかった（却下した案）。
    """
    c = course or {}
    parts = [f"### {row['id']}",
             f"科目名: {row.get('title') or c.get('title') or ''}"]
    if c.get("category"):
        parts.append(f"開講: {c['category']}（分野の手がかり。タグではない）")
    if row.get("subtitle"):
        parts.append(f"サブタイトル: {row['subtitle']}")
    if row.get("abstract"):
        parts.append(f"概要: {row['abstract'][:ABSTRACT_MAX]}")
    if row.get("kaiji"):
        parts.append(f"各回: {row['kaiji'][:KAIJI_MAX]}")
    return "\n".join(parts)


def batches(rows: list[dict], size: int):
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def build_prompt(rows: list[dict], courses: dict) -> str:
    blocks = "\n\n".join(course_block(r, courses.get(r["id"])) for r in rows)
    return (
        "大学のシラバスを読んで、その授業が「何の話をするのか」でタグを付けます。\n"
        "学生が『面白そうか』を選ぶための分類です。学部や科目区分の言い換えでは"
        "ありません。\n\n"
        f"{vocab_prompt()}\n"
        # 本文が「英文シラバスをご参照ください。」の1文しか無い科目がある。
        # そういう科目でも科目名は残っているので、そこから確実に言えることは
        # 付けてよい ―― 実測で Cross Cultural Psychology に何も付かなかった。
        # 学生も「たいていは科目名で分かる」と言っている（ユーザーインタビュー）。
        "概要が空だったり「英文シラバスを参照」とだけ書かれている科目もあります。\n"
        "その場合は科目名から確実に言えるものだけを付けてください"
        "（想像で補わないこと）。\n\n"
        "出力は1科目1行、次の形だけを返してください（説明や見出しは不要）:\n"
        "  科目コード<TAB>キー,キー\n"
        "科目名からも判断できない科目だけ、キーを空にした行を返してください。\n\n"
        f"{blocks}\n"
    )


def parse_reply(text: str) -> dict[str, list[str]]:
    """返事 → {id: [キー…]}。**壊れた行は他を巻き添えにせず捨てる。**

    モデルは見出しや言い訳の文を混ぜてくることがある。1行でも例外にすると
    そのバッチ20件が丸ごと落ちるので、読めた行だけ拾う。
    """
    got: dict[str, list[str]] = {}
    for line in (text or "").splitlines():
        if "\t" not in line:
            continue
        cid, _, tags = line.partition("\t")
        cid = cid.strip()
        if not cid.isdigit():
            continue
        got[cid] = clean([t.strip() for t in tags.split(",") if t.strip()])
    return got


def already_done(tsv: Path) -> set[str]:
    """TSV に書けている id。**タグ0個の科目も「済み」に数える。**

    数えないと、判定できなかった科目へ実行のたびに投げ続けることになる。
    """
    if not tsv.is_file():
        return set()
    with tsv.open(encoding="utf-8", newline="") as f:
        return {r[0] for r in csv.reader(f, delimiter="\t") if r}


def remaining(rows: list[dict], done: set[str]) -> list[dict]:
    return [r for r in rows if r["id"] not in done]


def append_rows(tsv: Path, rows) -> None:
    """**追記**であって上書きではない（止めて再開しても前の結果が残る）。"""
    tsv.parent.mkdir(parents=True, exist_ok=True)
    with tsv.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        for cid, title, tags in rows:
            w.writerow([cid, title, ",".join(tags)])


def _ssl_context():
    """TLS の検証に使う証明書を決める。

    macOS の python.org 版 Python は**システムの証明書を見ない**ので、
    そのままだと CERTIFICATE_VERIFY_FAILED になる（2026-09-04 に実際に踏んだ）。
    直し方は3つあり、この関数は上から順に試す:
      ① 既定の証明書で通るならそれを使う（/usr/bin/python3 等）
      ② certifi が入っていればそれを使う（多くの環境で入っている）
      ③ どちらも駄目なら None を返し、呼び出し側が直し方を出して止まる
    **検証を切る選択肢は置かない。** 鍵を載せた通信なので、そこは緩めない。
    """
    import ssl
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen("https://generativelanguage.googleapis.com/",
                                    timeout=15, context=ctx):
            pass
        return ctx
    except urllib.error.HTTPError:
        return ctx          # 404 でも TLS は通っている
    except urllib.error.URLError as e:
        if not isinstance(getattr(e, "reason", None), ssl.SSLError):
            return ctx      # ネットワーク側の問題。証明書のせいではない
    try:
        import certifi
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


def ask(prompt: str, model: str, key: str, timeout: int = 120,
        ctx=None) -> str:
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
    req = urllib.request.Request(
        API.format(model=model) + f"?key={key}",
        data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        doc = json.loads(r.read())
    try:
        return doc["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        # 安全フィルタ等で candidates が空になることがある。バッチを落として先へ。
        return ""


def load_rows() -> tuple[list[dict], dict]:
    if not TEXT.is_file():
        sys.exit(f"{TEXT} がありません。先に `python3 tools/extract_syllabus_text.py` "
                 "を流してください（data/raw/ を持っている人だけが流せます）。")
    with gzip.open(TEXT, "rt", encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    courses = {}
    if BUILT.is_file():
        courses = {c["id"]: c
                   for c in json.loads(BUILT.read_text(encoding="utf-8"))["courses"]}
    return rows, courses


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-2.5-flash")
    ap.add_argument("--size", type=int, default=20, help="1回に投げる科目数")
    ap.add_argument("--limit", type=int, default=0, help="0で全件")
    ap.add_argument("--sleep", type=float, default=4.0,
                    help="呼び出し間隔（秒）。無料枠のレート制限に合わせる")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY が環境にありません。")

    ctx = _ssl_context()
    if ctx is None:
        sys.exit(
            "TLS の証明書を検証できません（macOS の python.org 版でよくあります）。\n"
            "  どれかひとつで直ります:\n"
            "    ・/Applications/Python 3.x/Install Certificates.command を実行する\n"
            "    ・pip install certifi\n"
            "    ・/usr/bin/python3 tools/subject_tag.py として流す")

    rows, courses = load_rows()
    tsv = Path(args.out)
    todo = remaining(rows, already_done(tsv))
    if args.limit:
        todo = todo[:args.limit]
    if not todo:
        print("投げるものがありません（すべて済み）。")
        return
    print(f"対象 {len(todo)} 件 / 全 {len(rows)} 件（済みは飛ばしています）")

    tagged = failed = 0
    for i, batch in enumerate(batches(todo, args.size), 1):
        try:
            reply = ask(build_prompt(batch, courses), args.model, key, ctx=ctx)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            # 1バッチ落ちても止めない。済みに入らないので次回の実行で拾い直す。
            print(f"  [{i}] 失敗（次回に持ち越し）: {e}")
            failed += len(batch)
            time.sleep(args.sleep)
            continue
        got = parse_reply(reply)
        append_rows(tsv, [(r["id"], r.get("title", ""), got.get(r["id"], []))
                          for r in batch])
        tagged += sum(1 for r in batch if got.get(r["id"]))
        print(f"  [{i}] {len(batch)}件 → タグ付き "
              f"{sum(1 for r in batch if got.get(r['id']))}件")
        time.sleep(args.sleep)

    print(f"\n→ {tsv}")
    print(f"   タグが付いた科目 {tagged} 件 / 持ち越し {failed} 件")
    print("次は `python3 tools/subject_survey.py` で3つの表を見ること。"
          "合格するまで画面には繋がない。")


if __name__ == "__main__":
    main()
