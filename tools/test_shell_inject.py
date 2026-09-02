"""ヘッダ・ナビ・フッタの正本が1つであることを確かめる。

ブランド資料と実装が2週間ズレた（旧 B-3）のと同じことが、
index.html と about.html のあいだで起きるのを防ぐ。
コピーを2つ持つと必ず漂う。正本は templates/shell.html ひとつで、
build.py が各ページへ注入する。

「about.html がまだ無い」段階でも通るように、
存在するページ全部を突き合わせる形にしてある。
ページが増えたときに自動で対象になる。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SHELL = ROOT / "templates" / "shell.html"

REDLINE = "学生団体 GUILD が運営しています"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


check(SHELL.is_file(), "templates/shell.html が無い")

if SHELL.is_file():
    s = SHELL.read_text(encoding="utf-8")
    for marker in ("<!--PART:HEADER-->", "<!--/PART:HEADER-->",
                   "<!--PART:FOOTER-->", "<!--/PART:FOOTER-->"):
        check(marker in s, f"shell.html に {marker} が無い")
    check("Designed by GUILD" in s, "shell.html に Designed by GUILD が無い")
    check("AI Community" in s, "shell.html に AI Community が無い")
    check(REDLINE in s, f"shell.html に「{REDLINE}」が無い（レッドライン）")
    # ナビの About は幅の都合で「About」だけ（正式名は aria-label で渡している）。
    for nav in ["科目をさがす", 'aria-label="About ラクハン"', "マイページ", "口コミを書く"]:
        check(nav in s, f"shell.html のナビに「{nav}」が無い")

pages = sorted(WEB.glob("*.html"))
check(len(pages) >= 1, "web/ に HTML ページが無い")

shells = {}
for page in pages:
    t = page.read_text(encoding="utf-8")
    check("<!--SHELL:HEADER-->" in t,
          f"{page.name} に <!--SHELL:HEADER--> の目印が無い")
    head = re.search(r"<header[\s\S]*?</header>", t)
    foot = re.search(r"<footer[\s\S]*?</footer>", t)
    check(head is not None, f"{page.name} に <header> が無い（build.py を流していない）")
    check(foot is not None, f"{page.name} に <footer> が無い（build.py を流していない）")
    if head and foot:
        shells[page.name] = (head.group(0), foot.group(0))
        check(REDLINE in foot.group(0), f"{page.name} のフッタに「{REDLINE}」が無い")

# 全ページの外殻が一致していること。1つでもズレたら「漂い」が始まっている。
if len(shells) >= 2:
    base_name, base = sorted(shells.items())[0]
    for name, cur in sorted(shells.items())[1:]:
        check(cur[0] == base[0], f"{name} のヘッダが {base_name} と違う（外殻が漂っている）")
        check(cur[1] == base[1], f"{name} のフッタが {base_name} と違う（外殻が漂っている）")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {n} 件（対象ページ: {', '.join(p.name for p in pages)}）")
print("OK")
