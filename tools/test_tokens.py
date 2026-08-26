"""色・余白・モーションがトークン経由であること、
そして色の組み合わせが実際に読めることを確かめる。

■ なぜトークン経由を強制するか
裸の #xxxxxx や rgba() が app.css に残っていると、ダークモードや
ブランド色の変更が「何十箇所を手で直す」作業に戻る。
2026-08-21 まで、ロゴだけオレンジで UI は緑という状態が
2週間放置されたのは、まさにこれが原因だった。

■ なぜコントラストまで測るか
tokens.css の色は、2026-08-22 に一つずつ実測して決めた値。
たとえばブランドオレンジ #DB6209 は明地で 3.35:1 しかなく、
小さい文字には使えない。だから文字用に --brand-text を分けてある。
こういう前提は、見た目をいじる人には見えない。
値を1つ変えただけで静かに読めなくなり、しかも誰も気づかない。
だから機械に守らせる。

■ 色を足す・変えるとき
下の CONTRAST に1行足すこと。組み合わせを登録し忘れると、
そのペアは誰にも検査されないまま本番へ出る。

基準（WCAG 2.1）:
  通常の文字        4.5:1
  大きい文字        3.0:1（24px 以上、または太字18.66px 以上）
  図形・UI の境界   3.0:1
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKENS = ROOT / "web" / "assets" / "tokens.css"
APP = ROOT / "web" / "assets" / "app.css"
# mypage.css も同じ理由で見張る（2026-08-26 追加：ここが未検査だったせいで
# 前回タスクの裸色がすり抜けた）。
MYPAGE = ROOT / "web" / "assets" / "mypage.css"

# ── 検査する組み合わせ ────────────────────────
# (説明, 文字の色, 下地の色, 最低比)
# 最低比 3.0 は「大きい文字」か「図形」。コメントで理由を書くこと。
CONTRAST = [
    ("本文",                        "--ink",              "--paper",            4.5),
    ("本文（カードの上）",          "--ink",              "--card",             4.5),
    ("弱い文字",                    "--soft",             "--paper",            4.5),
    ("いちばん弱い文字",            "--muted",            "--card",             4.5),
    ("案内帯（.note）",             "--soft",             "--dim",              4.5),

    ("オレンジの文字",              "--brand-text",       "--paper",            4.5),
    ("オレンジの文字（カード上）",  "--brand-text",       "--card",             4.5),
    ("オレンジの文字（淡い地）",    "--brand-text",       "--brand-soft",       4.5),
    ("オレンジの面の上の文字",      "--brand-ink",        "--brand",            4.5),
    # 相性の数字は 25px/600。大きい文字なので 3.0 でよい。
    ("相性の数字（25px）",          "--brand",            "--card",             3.0),

    # 採点に効いていない口コミの注意帯。明地は黒帯／暗地は白帯に反転する
    # （新しい色相を足さずに強さを出すため。松下さん 2026-08-24）。
    ("注意帯の上の文字",            "--alert-ink",        "--alert-face",       4.5),
    # 注意帯の面とカード地の見分け。図形なので 3.0 でよい。
    ("注意帯の面 vs カード地",      "--alert-face",       "--card",             3.0),

    ("口コミの吹き出しの文字",      "--ink",              "--brand-soft",       4.5),
    ("吹き出しの引用符",            "--brand",            "--brand-soft",       3.0),
    ("条件タグ",                    "--scale-light-text", "--scale-light-soft", 4.5),
    ("口コミ件数",                  "--scale-light-text", "--card",             4.5),
    ("未取得・情報不足の赤",        "--scale-heavy",      "--card",             4.5),
    # 4軸バーの塗りは図形。3.0 でよい。
    ("4軸バー 軽い",                "--scale-light",      "--dim",              3.0),
    ("4軸バー ふつう",              "--scale-mid",        "--dim",              3.0),
    ("4軸バー 重い",                "--scale-heavy",      "--dim",              3.0),

    ("band 情報不足",               "--band-none-ink",    "--band-none-bg",     4.5),
    ("band 軽い",                   "--band-light-ink",   "--band-light-bg",    4.5),
    ("band ふつう",                 "--band-mid-ink",     "--band-mid-bg",      4.5),
    ("band 重い",                   "--band-heavy-ink",   "--band-heavy-bg",    4.5),

    ("ヘッダのロゴタイプ",          "--on-dark",          "--brand-ground",     4.5),
    ("Designed by GUILD",           "--on-dark-strong",   "--brand-ground",     4.5),
    ("ナビ",                        "--on-dark-mid",      "--brand-ground",     4.5),
    ("ヘッダの副題",                "--on-dark-weak",     "--brand-ground",     4.5),
    ("AI Community",                "--on-dark-faint",    "--brand-ground",     4.5),
    # 罫線は図形。3.0 でよい。
    ("ヘッダの罫",                  "--on-dark-line",     "--brand-ground",     3.0),
]

REQUIRED = [
    "--brand", "--brand-ink", "--brand-text", "--brand-soft", "--focus", "--brand-ground",
    "--scale-light", "--scale-light-text", "--scale-mid", "--scale-heavy",
    "--band-none-bg", "--band-light-bg", "--band-mid-bg", "--band-heavy-bg",
    "--on-dark", "--on-dark-line",
    "--sp-1", "--sp-8", "--fs-xs", "--fs-hero",
    "--r-sm", "--r-lg", "--r-pill",
    "--dur-fast", "--dur", "--dur-slow", "--ease-out", "--ease-brand",
]

fails = []
n = 0


def check(cond, msg):
    global n
    n += 1
    if not cond:
        fails.append(msg)


def strip_comments(t):
    return re.sub(r"/\*.*?\*/", "", t, flags=re.S)


# ── 色の計算 ────────────────────────────────
def parse_color(v):
    """#rgb / #rrggbb / rgba(r,g,b,a) を (r, g, b, a) にする。"""
    v = v.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{3})", v)
    if m:
        return tuple(int(c * 2, 16) for c in m.group(1)) + (1.0,)
    m = re.fullmatch(r"#([0-9a-fA-F]{6})", v)
    if m:
        h = m.group(1)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    m = re.fullmatch(r"rgba?\(([^)]*)\)", v)
    if m:
        parts = [x.strip() for x in m.group(1).split(",")]
        r, g, b = (int(float(x)) for x in parts[:3])
        a = float(parts[3]) if len(parts) > 3 else 1.0
        return (r, g, b, a)
    return None


def over(fg, bg):
    """半透明の文字を下地に重ねて、実際に見える色にする。"""
    r, g, b, a = fg
    br, bg_, bb, _ = bg
    return (r * a + br * (1 - a), g * a + bg_ * (1 - a), b * a + bb * (1 - a), 1.0)


def luminance(c):
    def lin(x):
        x /= 255
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def ratio(fg, bg):
    fg = over(fg, bg) if fg[3] < 1 else fg
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# ── tokens.css を読む ───────────────────────
def block(t, start):
    """start の直後から、対応する } までを返す。"""
    i = t.index(start) + len(start)
    depth = 1
    j = i
    while depth:
        if t[j] == "{":
            depth += 1
        elif t[j] == "}":
            depth -= 1
        j += 1
    return t[i:j - 1]


def vars_of(css):
    return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", css))


check(TOKENS.is_file(), "web/assets/tokens.css が無い")
check(APP.is_file(), "web/assets/app.css が無い")
check(MYPAGE.is_file(), "web/assets/mypage.css が無い")
if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    sys.exit(1)

raw = strip_comments(TOKENS.read_text(encoding="utf-8"))
light = vars_of(block(raw, ":root{"))

dark = dict(light)
m = re.search(r"@media\s*\(prefers-color-scheme:\s*dark\)\s*\{", raw)
if m:
    dark.update(vars_of(block(raw, raw[m.start():m.end()])))

for name in REQUIRED:
    check(name + ":" in raw, f"tokens.css に {name} が無い")

check("#DB6209" in raw, "ブランド色 #DB6209 が tokens.css に無い")
check("#b4532a" not in raw.lower(),
      "--scale-heavy の旧色 #b4532a が実際に使われている（#C0392B へ寄せる約束）")
check("prefers-reduced-motion" in raw, "prefers-reduced-motion の打ち消しが無い")
check("prefers-color-scheme: dark" in raw, "ダークモードの定義が無い")

# ── app.css / mypage.css に裸の色が無いこと ──────
for path in (APP, MYPAGE):
    css = strip_comments(path.read_text(encoding="utf-8"))
    bare_hex = re.findall(r"#[0-9a-fA-F]{3,8}\b", css)
    check(not bare_hex, f"{path.name} に裸の hex がある: {sorted(set(bare_hex))[:8]}")
    bare_fn = re.findall(r"\b(?:rgba?|hsla?)\([^)]*\)", css)
    check(not bare_fn, f"{path.name} に裸の rgba/hsl がある: {sorted(set(bare_fn))[:8]}")
    check(":root{" not in css.replace(" ", ""),
          f"{path.name} に :root がある（tokens.css へ移すこと）")

# ── コントラスト ────────────────────────────
for label, fg_name, bg_name, need in CONTRAST:
    for theme, table in (("ライト", light), ("ダーク", dark)):
        n += 1
        fg_raw, bg_raw = table.get(fg_name), table.get(bg_name)
        if fg_raw is None or bg_raw is None:
            fails.append(f"[{theme}] {label}: {fg_name} か {bg_name} が未定義")
            continue
        fg, bg = parse_color(fg_raw), parse_color(bg_raw)
        if fg is None or bg is None:
            fails.append(f"[{theme}] {label}: 色として読めない（{fg_raw} / {bg_raw}）")
            continue
        r = ratio(fg, bg)
        if r < need:
            fails.append(
                f"[{theme}] {label}: {r:.2f}:1 しかない（{need}:1 必要）"
                f"  {fg_name}={fg_raw.strip()} on {bg_name}={bg_raw.strip()}")

if fails:
    print("NG")
    for f in fails:
        print("  -", f)
    print()
    print("色を変えたなら、その組み合わせが読める値かどうかを直してください。")
    print("組み合わせを足したいときは tools/test_tokens.py の CONTRAST に1行足す。")
    sys.exit(1)

print(f"  通過 {n} 件（うちコントラスト {len(CONTRAST) * 2} 組・ライト/ダーク両方）")
print("OK")
