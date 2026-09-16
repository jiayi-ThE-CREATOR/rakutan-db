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
# 科目の詳細を組み立てるところ。2026-09-16 に app.js から切り出した
# （マイページが同じものをその場で開くため。detail.js の冒頭に理由がある）。
DETAIL = ROOT / "web" / "assets" / "detail.js"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


html = INDEX.read_text(encoding="utf-8")

check(CSS.is_file(), "web/assets/app.css が無い")
check(JS.is_file(), "web/assets/app.js が無い")
check(DETAIL.is_file(), "web/assets/detail.js が無い")
check("/assets/detail.js" in html, "index.html が detail.js を読み込んでいない")
# 読み込む順番。app.js は先頭で window.rkDetail を分割代入するので、
# detail.js が後ろにあると app.js が丸ごと落ちる（＝一覧が真っ白）。
check(html.index("/assets/detail.js") < html.index("/assets/app.js"),
      "index.html で detail.js が app.js より後ろにある（app.js が落ちる）")
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
    # 分割で中身が落ちていないかの粗い検査。
    # 「いま存在するはずの関数」を見る。機能を意図的に消したらここも直すこと
    # （renderMore は 2026-08-22 のページング化で撤去した）。
    for fn in ["function load(", "function renderPage(", "function card(", "CAN_POST"]:
        check(fn in js, f"app.js に {fn} が無い（分割で落ちた可能性）")
    # detailHtml は detail.js へ移した。app.js 側は受け取るだけ。
    check("window.rkDetail" in js, "app.js が detail.js から詳細の関数を受け取っていない")

if DETAIL.is_file():
    dj = DETAIL.read_text(encoding="utf-8")
    for fn in ["function detailHtml(", "function reviewHtml(", "function evalCompHtml(",
               "window.rkDetail"]:
        check(fn in dj, f"detail.js に {fn} が無い（切り出しで落ちた可能性）")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {n} 件")
print("OK")
