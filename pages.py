"""科目ごとの静的ページ（/c/<時間割コード>）と、その sitemap を焼く。

    python3 pages.py            # web/data/courses.built.json から焼き直す
    （build.py の最後でも同じものが呼ばれる）

■ なぜ要るか
`/?c=<id>` は index.html を返すだけで、title も description もトップと同じ、
canonical も `/` を指す。sitemap に並べても Google は全部トップの重複として捨てる。
「科目名 楽単」で検索してくる人を拾うには、科目ごとに中身の違う HTML が要る
（2026-09-30 wang 決定。ROADMAP「科目ごとの静的ページ」）。

■ 決めごと（2026-09-30 wang 決定・再提案しない）
- 単位は**コマ**（時間割コード1つ＝1ページ）。科目名でまとめると、同じ科目の
  教員と数字が横に並び「教員の比較」になる（README「教員名の扱い」）
- **title に曜限と教員名を入れる。** 「総合英語（LAS）」は204コマあり、
  科目名だけでは title が全部同じになる。それでも重なる428組は学期、
  さらに重なれば時間割コードで分ける（title は全件で一意 ―― test_course_pages.py）
- **載せるのは事実だけ。** 相性度・band は好み（ブラウザの中だけ）で変わるので
  焼けない。口コミの本文は未登録の人に伏せる約束（#168）なので件数だけ。
  採点の見せ方の正本は detail.js ひとつ ―― ここで描き直すと正本が2つになる。
  重さを見たい人は「ラクハンで重さを見る」（/?open=<id>）へ送る
- 同じ科目名の他のコマ・同じ教員の他の科目へのリンクは作らない

■ 入力は公開ずみの courses.built.json だけ
build.py の本体は生データ（data/courses.json・gitignore）が無いと動かない。
ページは生データを持っていない人でも焼き直せるよう、焼いたあとの JSON から作る。
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILT = ROOT / "web" / "data" / "courses.built.json"
TEMPLATE = ROOT / "templates" / "course.html"
SHELL = ROOT / "templates" / "shell.html"
OUT_DIR = ROOT / "web" / "c"
SITEMAP = ROOT / "web" / "sitemap-courses.xml"
HOST = "https://rakuhan.nocode-sol.co.jp"


def esc(s) -> str:
    return html.escape(str(s), quote=True)


def instructors(c: dict) -> list[str]:
    return [s.strip() for s in str(c.get("instructor") or "").split(",") if s.strip()]


def ins_label(c: dict) -> str:
    """一覧カードの insLabel（app.js）と同じ形：1〜2名はそのまま、3名以上は先頭＋ほかN名。"""
    n = instructors(c)
    if not n:
        return ""
    return "・".join(n) if len(n) <= 2 else f"{n[0]} ほか{len(n) - 1}名"


def slot_label(c: dict) -> str:
    # KOAN の「他」は「曜限が決まっていない」（集中講義とは別物。app.js の注記）。
    dp = c.get("day_period") or ""
    if c.get("term") == "集中":
        return "集中講義"
    return "曜限なし" if dp in ("", "他") else dp


def base_label(c: dict) -> str:
    parts = [slot_label(c), ins_label(c)]
    return "・".join(p for p in parts if p)


def page_labels(courses: list[dict]) -> dict[str, str]:
    """title の括弧の中身。科目名＋曜限＋教員で重なるものだけ学期を、
    それでも重なるものは時間割コードを足して、全件で一意にする。"""
    def key(c, lab):
        return (c["title"], lab)

    labels = {c["id"]: base_label(c) for c in courses}
    for extra in (lambda c: c.get("term") or "", lambda c: c["id"]):
        seen: dict[tuple, int] = {}
        for c in courses:
            k = key(c, labels[c["id"]])
            seen[k] = seen.get(k, 0) + 1
        for c in courses:
            if seen[key(c, labels[c["id"]])] > 1 and extra(c):
                labels[c["id"]] = f"{labels[c['id']]}・{extra(c)}"
    return labels


def koan_url(c: dict) -> str:
    # detail.js の koanUrl と同じ形。
    return ("https://koan.osaka-u.ac.jp/campusweb/campussquare.do?_flowId=SYW4201600-flow"
            f"&nendo=2026&j_s_cd={c.get('shozoku_cd') or '13'}&j_cd={c['id']}&langkbn=j")


def fmt_pct(v: float) -> str:
    return f"{v:g}%"


def exam_fact(c: dict) -> str:
    """テストの有無。内訳が最後まで分かっているときだけ「なし」と言う
    （app.js の evalKnown と同じ線 ―― 振り分けられなかった項目に試験が隠れうる）。"""
    ratio = c.get("eval_ratio") or {}
    if ratio.get("exam"):
        return f"あり（成績の {fmt_pct(ratio['exam'])}）"
    if c.get("eval_ratio") and not c.get("eval_unclassified"):
        return "なし"
    return "シラバスからは判別できません"


def eval_top(c: dict, k: int = 3) -> str:
    raw = c.get("eval_raw") or {}
    items = sorted(raw.items(), key=lambda kv: -(kv[1] or 0))
    s = "、".join(f"{name} {fmt_pct(v)}" for name, v in items[:k] if v is not None)
    return s + ("ほか" if len(items) > k else "")


def years_label(c: dict) -> str:
    ys = c.get("eligible_years") or []
    if not ys:
        return ""
    ys = sorted(ys)
    if ys == list(range(ys[0], ys[-1] + 1)) and len(ys) > 1:
        return f"{ys[0]}〜{ys[-1]}年"
    return "・".join(f"{y}年" for y in ys)


def render(c: dict, label: str, tpl: str) -> str:
    cid = c["id"]
    title = f"{c['title']}（{label}）｜テストの有無・成績評価｜ラクハン"
    credits = c.get("credits")
    head_bits = [c.get("term"), f"{float(credits):g}単位" if credits else None]
    desc = f"{c['title']}（{base_label(c)}）。{'・'.join(b for b in head_bits if b)}。テスト：{exam_fact(c)}。"
    if c.get("eval_raw"):
        desc += f"成績評価：{eval_top(c)}。"
    desc += "阪大 全学部の科目の重さを出すラクハン（学生団体 GUILD・非公式）。"

    rows = [
        ("開講", c.get("term")),
        ("曜限", slot_label(c)),
        ("単位", f"{float(credits):g}" if credits else None),
        ("履修できる学年", years_label(c)),
        ("授業形態", c.get("class_format")),
        ("担当教員", "、".join(instructors(c))),
        ("テスト", exam_fact(c)),
        ("時間割コード", cid),
    ]
    facts = "\n".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in rows if v)

    raw = c.get("eval_raw") or {}
    if raw:
        ev = "<table class=\"cpFacts\"><tbody>\n" + "\n".join(
            f"<tr><th>{esc(k)}</th><td>{esc(fmt_pct(v)) if v is not None else '—'}</td></tr>"
            for k, v in sorted(raw.items(), key=lambda kv: -(kv[1] or 0))) + "\n</tbody></table>"
    else:
        ev = "<p>成績評価の内訳はKOANから取得できていません。KOAN公式シラバスで確認してください。</p>"

    n = ((c.get("reviews") or {}).get("n")) or 0
    rv = (f"この科目の口コミは {n} 件あります。内容は「ラクハンで重さを見る」から読めます。"
          if n else "この科目の口コミはまだありません。")

    sub = " ／ ".join(p for p in (slot_label(c), ins_label(c), c.get("term")) if p)
    rep = {
        "title": esc(title), "description": esc(desc), "url": f"{HOST}/c/{cid}",
        "id": esc(cid), "h1": esc(c["title"]), "sub": esc(sub), "koan": esc(koan_url(c)),
        "facts": facts, "eval": ev, "reviews": esc(rv),
    }
    return re.sub(r"\{\{(\w+)\}\}", lambda m: rep[m.group(1)], tpl)


def shell_parts() -> dict[str, str]:
    """templates/shell.html の部品。7,906ページに複製されるので注釈は落とす
    （1ページあたり約6KB。正本の注釈は shell.html に残っている）。"""
    t = SHELL.read_text(encoding="utf-8")
    parts = {}
    for name in ("HEAD", "HEADER", "FOOTER"):
        o, e = f"<!--PART:{name}-->", f"<!--/PART:{name}-->"
        body = t[t.index(o) + len(o):t.index(e)]
        body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
        parts[name] = re.sub(r"\n\s*\n+", "\n", body).strip()
    return parts


def build_pages(built: Path = BUILT) -> int:
    courses = json.loads(built.read_text(encoding="utf-8"))["courses"]
    tpl = TEMPLATE.read_text(encoding="utf-8")
    for name, body in shell_parts().items():
        tpl = tpl.replace(f"<!--SHELL:{name}--><!--/SHELL:{name}-->", body)
    labels = page_labels(courses)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    keep = set()
    for c in courses:
        p = OUT_DIR / f"{c['id']}.html"
        keep.add(p.name)
        out = render(c, labels[c["id"]], tpl)
        if not p.exists() or p.read_text(encoding="utf-8") != out:
            p.write_text(out, encoding="utf-8")
    # データから消えた科目のページは残さない（404 にする）。
    stale = [p for p in OUT_DIR.glob("*.html") if p.name not in keep]
    for p in stale:
        p.unlink()

    # lastmod は付けない。付けると焼くたびに全行が変わり、差分が読めなくなる。
    urls = "\n".join(f"  <url><loc>{HOST}/c/{c['id']}</loc></url>" for c in courses)
    SITEMAP.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!-- pages.py が焼く。手で書き換えないこと。 -->\n"
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{urls}\n</urlset>\n", encoding="utf-8")
    print(f"→ {OUT_DIR.relative_to(ROOT)}/  {len(courses)} ページ"
          f"（消した古いページ {len(stale)}）／ {SITEMAP.name}")
    return len(courses)


if __name__ == "__main__":
    build_pages()
