"""テストとローカル確認のための静的サーバ。`python3 -m http.server` の代わり。

    python3 tools/serve.py 8791          # web/ を配る
    python3 tools/serve.py 8791 docs     # 別のディレクトリを配る

■ なぜ標準の http.server ではないのか（2026-09-22 実測）

`python3 -m http.server` は listen backlog が **5**
（socketserver.TCPServer.request_queue_size）。ブラウザは1ページを開くだけで
10本以上の接続を同時に張るので、溢れたぶんが RST になる:

    REQFAIL /assets/gate.js  net::ERR_SOCKET_NOT_CONNECTED
    REQFAIL /assets/shell.js net::ERR_CONNECTION_RESET
    PAGEERROR Cannot destructure property 'detailHtml' of 'window.rkDetail'

スクリプトが1本でも落ちると画面が boot せず、#conds も #list も空のままになる。
これが `tools/test_conds_layout.mjs` と `tools/test_kuchikomi_modal.mjs` が
ときどき落ちていた正体で、**どちらもサイト側の不具合ではなかった**。
単独で流せば通るのに、機械が混んでいると落ちるので「既知のNG」として
放置されていた（HANDOFF・PR に何度も書かれている）。

だから backlog を広げる。ついでに1リクエスト1行のログを出さない
（テストの出力が埋まるだけなので）。
"""
import functools
import os
import socketserver
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# ブラウザ1タブぶんの同時接続（10〜20本）に、並行して走るテストのぶんを足した数。
# 標準は 5。ここを戻すと上の RST が再発する。
socketserver.TCPServer.request_queue_size = 128


class Handler(SimpleHTTPRequestHandler):
    # **Cache-Control: no-store を足さないこと。** 足すとブラウザが毎回取りに行き、
    # Playwright の waitUntil:"networkidle" が成立しなくなる（2026-09-22 実測。
    # goto が 30秒でタイムアウトした）。
    def log_message(self, fmt, *args):
        pass  # 1リクエスト1行のログは、テストの出力を埋めるだけ


def main(argv):
    port = int(argv[1]) if len(argv) > 1 else 8791
    root = argv[2] if len(argv) > 2 else "web"
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        print(f"配るディレクトリが無い: {root}", file=sys.stderr)
        return 1
    handler = functools.partial(Handler, directory=root)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        # 起動を待つ側（テスト）が curl で叩けるようになった合図。
        print(f"http://127.0.0.1:{port}/  ←  {root}", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
