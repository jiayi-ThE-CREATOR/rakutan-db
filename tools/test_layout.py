"""PC 用のレイアウトが実在することを確かめる。

2026-08-22 まで、この CSS には幅ベースの @media が1つも無かった。
あったのは prefers-color-scheme の2つだけで、
.wrap .hd .sheet .inner が全部 max-width:560px。
つまり PC でもスマホと同じ1列だった。しかも tools/shots.mjs は
22日間ずっと 1280px のスクショを撮っていて、そこに写っていた。
同じことが二度起きないよう、ここで固定する。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "web" / "assets" / "app.css"
INDEX = ROOT / "web" / "index.html"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


css = APP.read_text(encoding="utf-8")
html = INDEX.read_text(encoding="utf-8")

for bp in ["768px", "1024px", "1440px"]:
    check(re.search(r"@media[^{]*min-width:\s*" + bp, css),
          f"ブレークポイント min-width:{bp} が無い")

for cls in ["workbench", "rail", "results", "inspector"]:
    check(f'"{cls}"' in html or f'class="{cls}' in html,
          f"index.html に .{cls} が無い")
    check("." + cls in css, f"app.css に .{cls} が無い")

# .wrap の 560px 決め打ちが残っていないこと。
# .sheet .inner（スマホの投稿シート）だけは 560px のままでよい。
check(not re.search(r"\.wrap\s*\{[^}]*max-width:\s*560px", css),
      ".wrap に max-width:560px が残っている（PC が1列に戻る）")
check(not re.search(r"\.hd\s*\{[^}]*max-width:\s*560px", css),
      ".hd に max-width:560px が残っている（ヘッダだけ細いまま）")

check("grid-template-columns" in css, "3カラムの grid-template-columns が無い")

# 詳細の組み立ては1本のまま、という約束。
js = (ROOT / "web" / "assets" / "app.js").read_text(encoding="utf-8")
check(js.count("function detailHtml(") == 1,
      "detailHtml が1本ではない（PC 用とスマホ用に分裂している）")
check("matchMedia" in js, "app.js に matchMedia による分岐が無い")
check("selectedCourseId" in js, "app.js に selectedCourseId が無い")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {n} 件")
print("OK")
