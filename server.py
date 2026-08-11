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


# 学生が実際に使う言葉での絞り込み条件。
# 「検索窓に何を打てばいいか分からない」学生のための入口なので、
# シラバス用語ではなく結果で書く。
CONDITIONS = {
    "出席なし":     lambda c: (c.get("eval_ratio") or {}).get("attendance") == 0,
    "レポートのみ": lambda c: (c.get("eval_ratio") or {}).get("exam") == 0,
    "持ち込み可":   lambda c: c.get("exam_type") == "持込可",
    "1限以外":      lambda c: not (c.get("day_period") or "").endswith("1"),
    "集中講義":     lambda c: c.get("class_format") == "集中講義",
    "小テストなし": lambda c: c.get("weekly_quiz") is False,
}


def search(params: dict) -> dict:
    """絞り込み・相性・空きコマの件数をまとめて返す。

    空きコマグリッドと条件チップの件数は、曜限フィルタ「以外」を
    適用した集合で数える。そうしないと、コマを選んだ瞬間に
    他のコマが全部0件になって次の一手が打てなくなる。
    """
    def get(k: str) -> str | None:
        v = params.get(k)
        return v[0] if v else None

    q = get("q")
    category, campus, term = get("category"), get("campus"), get("term")
    day, period = get("day"), get("period")
    min_conf = get("min_confidence")
    conds = [c for c in (params.get("cond") or []) if c in CONDITIONS]
    weights = scoring.parse_weights(params)

    base = []
    for c in COURSES:
        if q and _norm(q) not in _norm(c["title"]):
            continue
        if category and c.get("category") != category:
            continue
        if campus and c.get("campus") != campus:
            continue
        if term and c.get("term") != term:
            continue
        if any(not CONDITIONS[k](c) for k in conds):
            continue
        e = scoring.enrich(c)
        if min_conf and e["rakutan"]["confidence"]["level"] not in _conf_ok(min_conf):
            continue
        e["match"] = scoring.match(e["rakutan"], weights)
        base.append(e)

    # 空きコマグリッドと条件チップの件数（曜限フィルタは掛けない）
    slots = {d: {p: 0 for p in PERIODS} for d in DAYS}
    for e in base:
        dp = e.get("day_period") or ""
        if len(dp) >= 2 and dp[0] in slots and dp[1:] in PERIODS:
            slots[dp[0]][dp[1:]] += 1
    facets = {k: sum(1 for e in base if fn(e)) for k, fn in CONDITIONS.items()}

    results = base
    if day:
        results = [e for e in results if (e.get("day_period") or "").startswith(day)]
    if period:
        results = [e for e in results if (e.get("day_period") or "").endswith(period)]

    sort = get("sort") or "fit"
    if sort == "fit":
        results.sort(key=lambda r: (r["match"]["fit"] is None, -(r["match"]["fit"] or 0)))
    elif sort == "rakutan":
        results.sort(key=lambda r: (r["rakutan"]["overall"] is None,
                                    -(r["rakutan"]["overall"] or 0)))
    elif sort == "confidence":
        order = {"high": 0, "mid": 1, "low": 2}
        results.sort(key=lambda r: order[r["rakutan"]["confidence"]["level"]])
    elif sort == "title":
        results.sort(key=lambda r: r["title"])

    return {"count": len(results), "results": results,
            "slots": slots, "facets": facets,
            "weights": (results or base or [{}])[0].get("match", {}).get("weights")
                       if (results or base) else scoring.DEFAULT_WEIGHTS}


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

    def do_POST(self):
        """口コミ投稿。4タップで取った選択式の値だけを受ける。

        自由記述は一言のみ。長文は書かれないし、推薦にも使えない。
        ここで集める3項目は、KOANから取れない情報そのもの。
        """
        if urlparse(self.path).path != "/api/reviews":
            return self._send_json({"error": "unknown endpoint"}, 404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send_json({"ok": False, "error": "bad json"}, 400)

        cid = body.get("course_id")
        if cid not in BY_ID:
            return self._send_json({"ok": False, "error": "unknown course"}, 400)
        rec = {
            "course_id": cid,
            "attendance": body.get("attendance"),   # 0=なし 1=たまに 2=毎回
            "workload": body.get("workload"),       # 0=軽い 1=ふつう 2=重い
            "grading": body.get("grading"),         # 0=甘い 1=ふつう 2=厳しい
            "note": (body.get("note") or "")[:60],
        }
        if any(rec[k] not in (0, 1, 2) for k in ("attendance", "workload", "grading")):
            return self._send_json({"ok": False, "error": "missing choice"}, 400)

        path = ROOT / "data" / "reviews.json"
        items = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        items.append(rec)
        path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        return self._send_json({"ok": True, "total": len(items)})

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
                "conditions": list(CONDITIONS),
                "presets": scoring.PRESETS,
                "axis_labels": scoring.AXIS_LABEL,
                "disclaimer": DATA_META["note"],
            })

        if path == "/api/reviews":
            f = ROOT / "data" / "reviews.json"
            items = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
            return self._send_json({"total": len(items), "items": items[-50:]})

        if path == "/api/progress":
            return self._send_json(progress())

        if path == "/api/courses":
            return self._send_json(search(params))

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
