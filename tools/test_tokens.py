"""色・余白・モーションがトークン経由になっていることを確かめる。

裸の #xxxxxx が app.css に残っていると、ダークモードやブランド色の変更が
「14箇所を手で直す」作業に戻ってしまう。2026-08-21 まで、ロゴだけオレンジで
UI は緑という状態が2週間放置されたのは、まさにこれが原因だった。

色は2系統に分かれていて、混ぜて使わない。
  --brand 系   …… 「押せるもの」にだけ使う
  --scale-*    …… 4軸バーと band にだけ使う
混ぜると「ブランドの色」と「この科目は重い」が同じ色になり、数字の意味が壊れる。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKENS = ROOT / "web" / "assets" / "tokens.css"
APP = ROOT / "web" / "assets" / "app.css"

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


check(TOKENS.is_file(), "web/assets/tokens.css が無い")
check(APP.is_file(), "web/assets/app.css が無い")

if TOKENS.is_file():
    t = TOKENS.read_text(encoding="utf-8")
    # 旧色をコメントで説明することはある（なぜ変えたかを残すため）。
    # 実際に使われているかどうかは、コメントを外してから見る。
    t_code = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    for name in [
        "--brand:", "--brand-ink:", "--brand-soft:", "--focus:", "--brand-ground:",
        "--scale-light:", "--scale-mid:", "--scale-heavy:",
        "--band-none-bg:", "--band-light-bg:", "--band-mid-bg:", "--band-heavy-bg:",
        "--sp-1:", "--sp-8:", "--fs-xs:", "--fs-hero:",
        "--r-sm:", "--r-lg:", "--r-pill:",
        "--dur-fast:", "--dur:", "--dur-slow:", "--ease-out:", "--ease-brand:",
    ]:
        check(name in t, f"tokens.css に {name} が無い")

    check("#DB6209" in t, "ブランド色 #DB6209 が tokens.css に無い")
    check("#b4532a" not in t_code.lower(),
          "--scale-heavy の旧色 #b4532a が実際に使われている（#C0392B へ寄せる約束）")
    check("#C0392B" in t_code.upper(),
          "--scale-heavy が #C0392B になっていない")
    check("prefers-reduced-motion" in t,
          "tokens.css に prefers-reduced-motion の打ち消しが無い")
    check("prefers-color-scheme: dark" in t,
          "tokens.css にダークモードの定義が無い")

if APP.is_file():
    a = APP.read_text(encoding="utf-8")
    # コメント内の色名は説明のために書きたいことがあるので許す。
    without_comments = re.sub(r"/\*.*?\*/", "", a, flags=re.S)
    bare = re.findall(r"#[0-9a-fA-F]{3,8}\b", without_comments)
    check(not bare, f"app.css に裸の hex が残っている: {sorted(set(bare))[:10]}")
    check(":root{" not in without_comments.replace(" ", ""),
          "app.css に :root ブロックが残っている（tokens.css へ移すこと）")
    # 操作色とデータ目盛りを混ぜていないか、代表的な誤りを1つだけ見る。
    check("accent-color:var(--scale" not in without_comments.replace(" ", ""),
          "スライダーの accent-color にデータ目盛り色を使っている（操作色は --brand）")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print(f"  通過 {n} 件")
print("OK")
