#!/usr/bin/env python3
"""楽単DB プロトタイプ サーバ（標準ライブラリのみ・依存ゼロ）

API-first。画面は /api/courses を叩いているだけで、
LINE Bot も同じエンドポイントを使う。
ここを画面直結で作らないことが、8/7 の会議で決めた
「後から取り返せない設計判断」の中身。
（Custom GPT は 2026/8/11 に不採用。入口は LINE に一本化する）

起動:  python3 server.py [--port 8000]
"""

from __future__ import annotations

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import score as scoring

ROOT = Path(__file__).parent
DATA_PATH = ROOT / "data" / "courses.sample.json"
WEB_DIR = ROOT / "web"

with DATA_PATH.open(encoding="utf-8") as f:
    _raw = json.load(f)

COURSES: list[dict] = _raw["courses"]
DATA_META: dict = _raw["_meta"]
BY_ID = {c["id"]: c for c in COURSES}

DAYS = ["月", "火", "水", "木", "金"]
PERIODS = ["1", "2", "3", "4", "5"]


def _norm(s: str) -> str:
    return re.sub(r"[\s　]+", "", s).lower()


def search(params: dict) -> list[dict]:
    def get(k: str) -> str | None:
        v = params.get(k)
        return v[0] if v else None

    q = get("q")
    category, campus, term = get("category"), get("campus"), get("term")
    day, period = get("day"), get("period")
    min_conf = get("min_confidence")

    results = []
    for c in COURSES:
        if q and _norm(q) not in _norm(c["title"]):
            continue
        if category and c.get("category") != category:
            continue
        if campus and c.get("campus") != campus:
            continue
        if term and c.get("term") != term:
            continue
        dp = c.get("day_period") or ""
        if day and not dp.startswith(day):
            continue
        if period and not dp.endswith(period):
            continue
        e = scoring.enrich(c)
        if min_conf and e["rakutan"]["confidence"]["level"] not in _conf_ok(min_conf):
            continue
        results.append(e)

    sort = get("sort") or "rakutan"
    if sort == "rakutan":
        # 総合値の降順。判定不可は必ず末尾に落とす（上位に紛れさせない）。
        results.sort(key=lambda r: (r["rakutan"]["overall"] is None,
                                    -(r["rakutan"]["overall"] or 0)))
    elif sort == "confidence":
        order = {"high": 0, "mid": 1, "low": 2}
        results.sort(key=lambda r: order[r["rakutan"]["confidence"]["level"]])
    elif sort == "title":
        results.sort(key=lambda r: r["title"])
    return results


def _conf_ok(level: str) -> set[str]:
    return {"high": {"high"}, "mid": {"high", "mid"}}.get(level, {"high", "mid", "low"})


def openapi() -> dict:
    """LINE Bot 側や外部クライアントが読むスキーマ。

    API の仕様書そのものでもあるので、開発とデータ班の間の
    取り決めもここを正とする。
    """
    return {
        "openapi": "3.1.0",
        "info": {"title": "阪大 楽単DB API", "version": "0.1.0",
                 "description": "全学教育科目の負荷プロファイルを返す。数値はシラバスの事実項目のみから算出。"},
        "servers": [{"url": "http://localhost:8000"}],
        "paths": {
            "/api/courses": {
                "get": {
                    "operationId": "searchCourses",
                    "summary": "科目を検索して楽単プロファイル付きで返す",
                    "parameters": [
                        {"name": "q", "in": "query", "schema": {"type": "string"}, "description": "科目名の部分一致"},
                        {"name": "category", "in": "query", "schema": {"type": "string"}},
                        {"name": "campus", "in": "query", "schema": {"type": "string"}},
                        {"name": "term", "in": "query", "schema": {"type": "string"}},
                        {"name": "day", "in": "query", "schema": {"type": "string", "enum": DAYS}},
                        {"name": "period", "in": "query", "schema": {"type": "string", "enum": PERIODS}},
                        {"name": "min_confidence", "in": "query", "schema": {"type": "string", "enum": ["high", "mid", "low"]}},
                        {"name": "sort", "in": "query", "schema": {"type": "string", "enum": ["rakutan", "confidence", "title"]}},
                    ],
                    "responses": {"200": {"description": "OK"}},
                }
            },
            "/api/courses/{id}": {
                "get": {
                    "operationId": "getCourse",
                    "summary": "科目1件の詳細と算出根拠",
                    "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "responses": {"200": {"description": "OK"}, "404": {"description": "Not found"}},
                }
            },
        },
    }


def progress() -> dict:
    """進捗ダッシュボードのデータ。

    data/progress.json を各自が書き換えて push する運用。
    件数を数えれば分かるものだけは（auto:true）ここで自動集計し、
    人が書いた値で上書きされないようにする。
    """
    path = ROOT / "data" / "progress.json"
    if not path.exists():
        return {"error": "progress.json not found"}
    with path.open(encoding="utf-8") as f:
        p = json.load(f)

    live = ROOT / "data" / "courses.json"
    n_courses, fill = None, None
    if live.exists():
        with live.open(encoding="utf-8") as f:
            cs = json.load(f).get("courses", [])
        n_courses = len(cs)
        filled = sum(1 for c in cs if (c.get("eval_ratio") or {}))
        fill = round(filled / n_courses * 100) if n_courses else 0

    for it in p.get("items", []):
        if it.get("key") == "syllabus" and n_courses is not None:
            it["done"], it["note"] = n_courses, "courses.json から自動集計"
        if it.get("key") == "fillrate" and fill is not None:
            it["done"], it["note"] = fill, f"{fill}% が評価割合を記載（自動集計）"
        t = it.get("target") or 0
        it["pct"] = round(min(it.get("done", 0) / t, 1) * 100) if t else 0
    return p


class Handler(BaseHTTPRequestHandler):
    server_version = "RakutanDB/0.1"

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # LINE Bot / 別ドメインのフロントから叩けるように
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path):
        if not path.is_file():
            self._send_json({"error": "not found"}, 404)
            return
        types = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
                 ".svg": "image/svg+xml"}
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", types.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        path, params = u.path, parse_qs(u.query)

        if path == "/api/health":
            return self._send_json({"ok": True, "courses": len(COURSES), "data": DATA_META})

        if path == "/api/meta":
            return self._send_json({
                "categories": sorted({c["category"] for c in COURSES}),
                "campuses": sorted({c["campus"] for c in COURSES if c.get("campus")}),
                "terms": sorted({c["term"] for c in COURSES}),
                "days": DAYS, "periods": PERIODS,
                "weights": scoring.WEIGHTS,
                "disclaimer": DATA_META["note"],
            })

        if path == "/api/progress":
            return self._send_json(progress())

        if path == "/api/courses":
            results = search(params)
            return self._send_json({"count": len(results), "results": results})

        m = re.fullmatch(r"/api/courses/([A-Za-z0-9_-]+)", path)
        if m:
            c = BY_ID.get(m.group(1))
            if not c:
                return self._send_json({"error": "not found"}, 404)
            return self._send_json(scoring.enrich(c))

        if path == "/api/openapi.json":
            return self._send_json(openapi())

        if path.startswith("/api/"):
            return self._send_json({"error": "unknown endpoint"}, 404)

        # 静的ファイル
        rel = "index.html" if path == "/" else path.lstrip("/")
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR.resolve())):
            return self._send_json({"error": "forbidden"}, 403)
        return self._send_file(target)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"楽単DB prototype  →  http://localhost:{args.port}")
    print(f"  API   http://localhost:{args.port}/api/courses")
    print(f"  仕様  http://localhost:{args.port}/api/openapi.json")
    print(f"  科目数 {len(COURSES)}（{DATA_META['note']}）")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
