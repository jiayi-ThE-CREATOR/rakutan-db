"""web/index.html から CSS と JS が外に出ていることを確かめる。

分割そのものが目的ではない。分割が中途半端なまま次の作業へ進むと、
「片方はインライン、片方は外部」という状態が生まれて、
どちらを直せばいいのか分からなくなる。それを防ぐための番人。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / "web" / "index.html"
CSS = ROOT / "web" / "assets" / "app.css"
JS = ROOT / "web" / "assets" / "app.js"

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


html = INDEX.read_text(encoding="utf-8")

check(CSS.is_file(), "web/assets/app.css が無い")
check(JS.is_file(), "web/assets/app.js が無い")
check("<style>" not in html, "index.html に <style> が残っている")
check("/assets/app.css" in html, "index.html が app.css を読み込んでいない")
check("/assets/app.js" in html, "index.html が app.js を読み込んでいない")

# インラインの <script> が残っていないこと。ただし
# type="application/json" のようなデータブロックは対象外。
check(html.count("<script>") == 0, "index.html に素の <script> が残っている")

if CSS.is_file():
    css = CSS.read_text(encoding="utf-8")
    # 分割で中身が落ちていないかの粗い検査。代表的なセレクタが生きているか。
    for sel in [".wrap", ".card", ".chip", ".fab", ".sheet"]:
        check(sel in css, f"app.css に {sel} が無い（分割で落ちた可能性）")

if JS.is_file():
    js = JS.read_text(encoding="utf-8")
    for fn in ["function load(", "function renderMore(", "CAN_POST"]:
        check(fn in js, f"app.js に {fn} が無い（分割で落ちた可能性）")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {8 + 5 + 3} 件")
print("OK")
