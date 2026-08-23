#!/usr/bin/env python3
"""ラクハン LINE Bot（プロトタイプ・標準ライブラリのみ）

方針（README.md / ROADMAP.md より）:
  - 採点ロジックは書かない。公開URLの courses.built.json を読むだけ
  - 本番は静的配信（/api/courses は無い）なので、built.json をまるごと取得してメモリ上で検索する
  - preset_top はすでに学年で1段深い（"1"〜"6"）。既定は "1"

起動:
  export LINE_CHANNEL_SECRET=...
  export LINE_CHANNEL_ACCESS_TOKEN=...
  python3 line/bot.py [--port 8090]
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA_URL = os.environ.get(
    "RAKUTAN_DATA_URL",
    "https://rakutan-db.wjy20050815.workers.dev/data/courses.built.json",
)
CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "")
ACCESS_TOKEN = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "")
CACHE_TTL_SEC = 300

PRESET_NAMES = ["バイト優先", "GPA重視", "とにかく軽い", "テストが苦手"]
GRADE_KANJI = {"1": "1年", "2": "2年", "3": "3年", "4": "4年", "5": "5年", "6": "6年"}

_cache_lock = threading.Lock()
_cache = {"data": None, "fetched_at": 0.0}


def load_data(force: bool = False) -> dict:
    """courses.built.json をメモリにキャッシュする。TTL 5分。"""
    with _cache_lock:
        if not force and _cache["data"] is not None and time.time() - _cache["fetched_at"] < CACHE_TTL_SEC:
            return _cache["data"]
        req = urllib.request.Request(DATA_URL, headers={"User-Agent": "rakutan-line-bot/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        _cache["data"] = data
        _cache["fetched_at"] = time.time()
        return data


def _grade_from_text(text: str) -> str:
    m = re.search(r"([1-6１-６])\s*年", text)
    if m:
        n = m.group(1).translate(str.maketrans("１２３４５６", "123456"))
        return n
    return "1"


def _preset_from_text(text: str) -> str | None:
    for name in PRESET_NAMES:
        if name in text:
            return name
    return None


def _format_course(c: dict) -> str:
    r = c.get("rakutan") or {}
    overall = r.get("overall")
    overall_s = f"{overall:.0f}点" if isinstance(overall, (int, float)) else "―"
    band = r.get("band") or "―"
    day = c.get("day_period") or "―"
    instr = c.get("instructor") or "―"
    return f"{c['title']}（{day}／{instr}）\n {band}・{overall_s}"


def handle_text(text: str) -> str:
    data = load_data()
    courses = {c["id"]: c for c in data["courses"]}
    preset_top = data["preset_top"]

    grade = _grade_from_text(text)
    preset = _preset_from_text(text)

    if preset:
        ids = preset_top.get(grade, preset_top.get("1", {})).get(preset, [])[:5]
        if not ids:
            return f"{GRADE_KANJI.get(grade, grade)}向けの「{preset}」データが見つかりませんでした。"
        lines = [f"{GRADE_KANJI.get(grade, grade)}「{preset}」おすすめ TOP{len(ids)}"]
        for i, cid in enumerate(ids, 1):
            c = courses.get(cid)
            if c:
                lines.append(f"{i}. {_format_course(c)}")
        lines.append("\n※最終判断は必ずKOAN公式シラバスで確認してください。")
        return "\n".join(lines)

    # 通常検索（部分一致・楽単スコア降順）
    q = text.strip()
    if not q:
        return (
            "科目名で検索するか、「バイト優先」「GPA重視」「とにかく軽い」「テストが苦手」の"
            "いずれかを送ってください（例:「1年 とにかく軽い」）。"
        )
    matched = [c for c in courses.values() if q in (c.get("title") or "")]
    if not matched:
        return f"「{q}」に一致する科目が見つかりませんでした。"
    matched.sort(key=lambda c: (c.get("rakutan") or {}).get("overall") or -1, reverse=True)
    lines = [f"「{q}」の検索結果（上位{min(5, len(matched))}件）"]
    for i, c in enumerate(matched[:5], 1):
        lines.append(f"{i}. {_format_course(c)}")
    lines.append("\n※最終判断は必ずKOAN公式シラバスで確認してください。")
    return "\n".join(lines)


def verify_signature(body: bytes, signature: str) -> bool:
    if not CHANNEL_SECRET:
        return False
    mac = hmac.new(CHANNEL_SECRET.encode("utf-8"), body, hashlib.sha256).digest()
    expected = base64.b64encode(mac).decode("utf-8")
    return hmac.compare_digest(expected, signature or "")


def reply(reply_token: str, text: str) -> tuple[int, str]:
    payload = json.dumps(
        {"replyToken": reply_token, "messages": [{"type": "text", "text": text[:5000]}]}
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/reply",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {ACCESS_TOKEN}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[line-bot]", self.address_string(), fmt % args)

    def _send(self, code: int, body: bytes = b""):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b"ok")
        else:
            self._send(404)

    def do_POST(self):
        if self.path != "/webhook":
            self._send(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        signature = self.headers.get("X-Line-Signature", "")

        if not verify_signature(body, signature):
            self._send(401, b"invalid signature")
            return

        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, b"bad json")
            return

        # LINEには200を即返し、応答はここで送る（この実装では同期処理）
        self._send(200, b"ok")

        for event in payload.get("events", []):
            if event.get("type") != "message":
                continue
            message = event.get("message", {})
            if message.get("type") != "text":
                continue
            reply_token = event.get("replyToken")
            text = message.get("text", "")
            try:
                answer = handle_text(text)
            except Exception as e:  # noqa: BLE001
                answer = "エラーが発生しました。少し時間をおいて試してください。"
                print("[line-bot] handle_text error:", repr(e))
            status, resp_body = reply(reply_token, answer)
            print(f"[line-bot] reply -> {status} {resp_body[:200]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()

    if not CHANNEL_SECRET or not ACCESS_TOKEN:
        raise SystemExit(
            "LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN が未設定です（環境変数で渡してください）"
        )

    load_data(force=True)
    print(f"[line-bot] courses.built.json 読み込み完了 ({DATA_URL})")

    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"[line-bot] listening on :{args.port}  (POST /webhook, GET /health)")
    server.serve_forever()


if __name__ == "__main__":
    main()
