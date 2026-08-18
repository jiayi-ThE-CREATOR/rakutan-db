"""KOAN（CampusSquare）へのアクセス層。fetch.py と parse.py が共有する。

実測でわかっていること（2026-08-11 に確認）:

* 入口は  /campusweb/campussquare.do?_flowId=SYW4201600-flow&locale=ja_JP
  ここで JSESSIONID と _flowExecutionKey が発行される。
* 検索は同じURLへの POST。_eventId=search。
  共通教育科目は categoryFlg=2 / jShozokucdSubjects=0:13。
  2026年度で 1,112件。
* 一覧は100件ずつ。ページ送りは GET で
  _eventId_paging=_eventId_paging&_displayCount=100&_pageCount=N
* 詳細は GET で
  _eventId=eventSyReferInfoWindow&nendo=..&jikanwariShozokucd=13&jikanwaricd=<時間割コード>
* ログインは一切不要（外部公開シラバス）。

_flowExecutionKey はレスポンスごとに変わる。基本は最後に受け取った値を使い、
失敗したらフローを張り直す（Session.refresh）。
"""

from __future__ import annotations

import re
import time

import requests
from bs4 import BeautifulSoup

BASE = "https://koan.osaka-u.ac.jp/campusweb/campussquare.do"
FLOW_ID = "SYW4201600-flow"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# 共通教育科目（＝全学教育科目）
SHOZOKU_KYOTSU = "0:13"


class Koan:
    """1セッション分の会話。delay は毎リクエスト前に待つ秒数。

    学校のサーバに負荷をかけない・不審なトラフィックに見せないために、
    delay は既定で 2 秒。ここを短くしないこと。
    """

    def __init__(self, delay: float = 2.0, timeout: int = 45):
        self.delay = delay
        self.timeout = timeout
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "ja,en;q=0.8"})
        self.key: str | None = None
        self._last = 0.0

    # ── 低レベル ───────────────────────────────
    def _wait(self):
        gap = time.monotonic() - self._last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self._last = time.monotonic()

    @staticmethod
    def _key_of(html: str) -> str | None:
        m = re.search(r'name="_flowExecutionKey"\s+value="([^"]+)"', html)
        if m:
            return m.group(1)
        m = re.search(r"_flowExecutionKey=([^&\"'\s]+)", html)
        return m.group(1) if m else None

    def refresh(self) -> str:
        """フローを張り直して _flowExecutionKey を取り直す。"""
        self._wait()
        r = self.s.get(BASE, params={"_flowId": FLOW_ID, "locale": "ja_JP"},
                       timeout=self.timeout)
        r.raise_for_status()
        self.key = self._key_of(r.text)
        if not self.key:
            raise RuntimeError("_flowExecutionKey が取れない。KOAN側の構造が変わった可能性")
        return r.text

    # ── 検索 ──────────────────────────────────
    def search(self, nendo: str = "2026", shozoku: str = SHOZOKU_KYOTSU) -> str:
        if not self.key:
            self.refresh()
        self._wait()
        data = {
            "s_no": "0", "_flowExecutionKey": self.key, "_eventId": "search",
            "nendo": nendo, "categoryFlg": "2",
            "jShozokuCodeMajor": "00", "jShozokucdSubjects": shozoku,
            "kaikokbncd": "", "yobi": "", "jigen": "", "nenji": "", "bunyacd": "",
            "kaikoKamokunm": "", "kyokannm": "", "kyokankn": "",
            "freeword": "", "freewordCondition": "0",
        }
        r = self.s.post(BASE, data=data, timeout=self.timeout)
        r.raise_for_status()
        self.key = self._key_of(r.text) or self.key
        return r.text

    def page(self, n: int, display: int = 100) -> str:
        """一覧の n ページ目（1始まり）。"""
        self._wait()
        r = self.s.get(BASE, params={
            "_flowExecutionKey": self.key,
            "_eventId_paging": "_eventId_paging",
            "_displayCount": str(display), "_pageCount": str(n),
        }, timeout=self.timeout)
        r.raise_for_status()
        self.key = self._key_of(r.text) or self.key
        return r.text

    def detail(self, nendo: str, shozoku_cd: str, jikanwaricd: str) -> str:
        """シラバス詳細。キーが切れていたら1度だけ張り直して再試行する。"""
        for attempt in (1, 2):
            self._wait()
            r = self.s.get(BASE, params={
                "_eventId": "eventSyReferInfoWindow",
                "_flowExecutionKey": self.key, "nendo": nendo,
                "jikanwariShozokucd": shozoku_cd, "jikanwaricd": jikanwaricd,
                "locale": "ja_JP",
            }, timeout=self.timeout)
            if r.ok and "成績評価" in r.text:
                return r.text
            if attempt == 1:
                self.refresh()
                self.search(nendo)
        raise RuntimeError(f"詳細が取れない: {jikanwaricd}")


# ── 一覧ページの解析 ─────────────────────────────
def total_count(html: str) -> int | None:
    m = re.search(r"全部で\s*([\d,]+)\s*件", html)
    return int(m.group(1).replace(",", "")) if m else None


def list_rows(html: str) -> list[dict]:
    """一覧テーブルから1行ずつ。referW('2026','13','138531','ja_JP') が拾える行だけ。"""
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for tr in soup.find_all("tr"):
        btn = tr.find("input", attrs={"onclick": re.compile(r"referW\(")})
        if not btn:
            continue
        m = re.search(r"referW\('([^']*)','([^']*)','([^']*)'", btn["onclick"])
        if not m:
            continue
        tds = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        # 検索フォームと結果表を丸ごと含む外側の <tr> にも referW( が入っている。
        # そこを拾うと tds[1] がフォームのラベル「年度」になり、
        # そのページ先頭科目の開講所属が壊れる（1ページ1件 × 12ページ ＝ 12件）。
        # 本物のデータ行はちょうど9列（No.〜参照）。桁が違うものは外側の tr。
        if not 8 <= len(tds) <= 12:
            continue
        rows.append({
            "nendo": m.group(1), "shozoku_cd": m.group(2), "code": m.group(3),
            "shozoku": tds[1], "kaikoki": tds[2], "kaiko_kbn": tds[3],
            "day_period_raw": tds[4], "title": tds[6], "instructor": tds[7],
        })
    return rows
