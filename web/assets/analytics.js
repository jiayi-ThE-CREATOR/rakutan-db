/* 計測の入口。「誰を数えるか」「何を数えるか」を決める唯一の場所。
 *
 * ■ なぜ beacon のタグを直に置かず、この1枚を挟むのか
 *
 * 1. 自分たちを数から外す窓口が要る。
 *    協賛の話で出す数字に、開発中の自分の再読み込みが混ざっていると、
 *    その数字は説明できない。Cloudflare 側にも「このパスは計測しない」
 *    という Rules があるが、**あれは Cloudflare にDNSを向けた
 *    サイトだけの機能**で、ラクハンの独自ドメインは nginx（VPS）から
 *    Worker へ中継している＝向けていない。だから除外はこちら側で持つしかない。
 *
 * 2. beacon のタグが6ページに複製されていた。
 *    トークンを差し替える日が来たとき、5ページ直して1ページ忘れる形だった。
 *    正本をこのファイル1つにする（ページ側は読み込むだけ）。
 *
 * ■ 数字は2本立てにしてある（2026-09-03）
 *
 *   ① Cloudflare Web Analytics（beacon）… ページ表示・国・端末・Core Web Vitals
 *   ② 自前の POST /api/hit           … 「実際に使われた回数」
 *
 *   ① だけでは足りない。beacon は cloudflareinsights.com にあるので、
 *   広告ブロッカー（Brave / uBlock / DuckDuckGo）が塞ぐ。学生の端末で
 *   これが効いている率は低くない。つまり ① は**必ず下限**になる。
 *   ② は同じドメインなので塞がれない。2つの差が、そのまま
 *   「どれくらい塞がれているか」の目安になる。
 *
 *   ② で数えるのは3つだけ:
 *     pv     … ページを開いた
 *     search … 検索語を入れて絞り込んだ（打っている途中は数えない）
 *     detail … 科目の詳細を開いた
 *   検索語そのもの・科目ID・Cookie・端末IDは送らない。送るのはパスだけで、
 *   クエリ（?c=<科目id> など）は Worker 側で落としている。
 *
 * ■ UU（日・月）の数え方（2026-10-05 追加）
 *
 *   端末IDを発行して送る形にはしない。代わりに「この端末はきょう（今月）もう
 *   数えた」という日付だけを localStorage に置き、その日（月）の最初の pv に
 *   d=1（m=1）を付ける。サーバーに届くのは 0/1 だけで、誰の1なのかは分からない。
 *   日付は JST で切る（速報・tools/stats.mjs の日付と揃える）。
 *   数えているのは「ブラウザの数」で、人の数ではない ―― スマホと PC で来た人は2、
 *   シークレットウィンドウや閲覧データを消した人は同じ日でも2回数える。
 *   つまり UU は**上に振れる**。サーバー側で IP から判定する案は、独自ドメインが
 *   nginx（VPS）経由で Worker から見える IP が全部同じなので使えない。
 *
 * ■ 属性のスナップショット（2026-10-05 追加・spec 2026-10-05-user-stats）
 *
 *   window.rkSnap({ grade, faculty, tt }) を usersync.js が呼ぶ。その日（JST）の
 *   1回目だけ、学年・学部・時間割の科目IDを e:"snap" で送る。日付印は rk_sd。
 *   ここでも端末IDは送らない。学年・学部・時間割を読むのは store.js で、
 *   このファイルは渡された値を送るだけ。
 *
 * ■ チームに配る URL（1人1回・ブラウザごと）
 *
 *    https://rakuhan.nocode-sol.co.jp/?nostats=1   … 以後この端末を数えない
 *    https://rakuhan.nocode-sol.co.jp/?nostats=0   … 数に戻す
 *
 *   ①②の両方が止まる。押したことが画面に出る（帯を4秒）。出ないと、
 *   やったつもりの人が残る。印は localStorage なので **ブラウザごと・
 *   端末ごとに1回ずつ**必要で、シークレットウィンドウには残らない。
 *   ここは仕様として諦める ―― 端末を特定して覚える仕組みは、
 *   計測を減らすために作るには重すぎる。
 *
 * ■ store.js を通していない理由
 *   store.js は index.html と mypage.html にしか載っていない。計測は6ページ
 *   全部に載る。読み込み順の前後で計測が消える方が事故なので、ここだけは
 *   localStorage を直に触る。鍵は rk_nostats と UU の日付印 rk_d・rk_m、
 *   スナップショットの日付印 rk_sd の4つだけに留めること。
 */
(() => {
  const KEY = "rk_nostats";
  const SKEY = "rk_s";            // 「この訪問はもう数えた」の印（タブを閉じると消える）
  const DKEY = "rk_d";            // 「きょう（JST）はもう数えた」日付 YYYY-MM-DD
  const MKEY = "rk_m";            // 「今月（JST）はもう数えた」月 YYYY-MM
  const SDKEY = "rk_sd";          // 「きょう（JST）は属性をもう送った」日付 YYYY-MM-DD
  // Cloudflare Web Analytics のサイトトークン。公開されている値（HTML に出る）。
  const TOKEN = "b0324782e4e44ca58b45e4dd0c270112";
  const HIT_URL = "/api/hit";
  /* 1ページで送る上限。将来どこかで rkTrack を呼ぶループを書いてしまっても、
     Analytics Engine の無料枠（1日10万件）を1人で溶かせないようにする蓋。 */
  const MAX_HITS = 60;

  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const write = () => { try { localStorage.setItem(KEY, "1"); } catch (e) {} };
  const drop  = () => { try { localStorage.removeItem(KEY); } catch (e) {} };

  /* 効いたことを本人に見せる。チームの半分はコードを読まない人なので、
     console.log では「やったつもり」が残る。 */
  function notice(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;" +
      "max-width:90vw;padding:10px 16px;border-radius:8px;font-size:14px;line-height:1.4;" +
      "background:var(--ink,#16181d);color:var(--on-dark,#fff);box-shadow:0 2px 8px rgba(0,0,0,.24)";
    const put = () => { document.body.appendChild(el); setTimeout(() => el.remove(), 4000); };
    if (document.body) put();
    else document.addEventListener("DOMContentLoaded", put, { once: true });
  }

  const param = new URL(location.href).searchParams.get("nostats");
  if (param === "1") { write(); notice("この端末を計測から外しました"); }
  else if (param === "0") { drop(); notice("この端末を計測に戻しました"); }

  const excluded = read() === "1";

  /* この訪問で初めてかどうか。sessionStorage なのでタブを閉じれば消える
     ―― 「今日何人来たか」ではなく「何回の訪問があったか」を数えている。
     端末を横断して同じ人だと判定する仕組みは、意図的に持たない。 */
  function newSession() {
    try {
      if (sessionStorage.getItem(SKEY)) return 0;
      sessionStorage.setItem(SKEY, "1");
      return 1;
    } catch (e) { return 0; }
  }

  /* UU の印。その日（月）初めてなら 1 を返して印を更新する。
     localStorage が使えない端末は 0 ―― 数え直しを繰り返して上に膨らむより、
     数え損ねる方を選ぶ（訪問の n と同じ考え方）。 */
  function firstIn(key, value) {
    try {
      if (localStorage.getItem(key) === value) return 0;
      localStorage.setItem(key, value);
      return 1;
    } catch (e) { return 0; }
  }
  // JST の日付。JST は夏時間が無いので +9 固定でよい。
  const jstDay = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  /* sendBeacon はページを離れる途中でも届く。ここで待たない
     ―― 計測のために操作を1msでも遅らせない。 */
  function send(body) {
    try {
      if (navigator.sendBeacon &&
          navigator.sendBeacon(HIT_URL, new Blob([body], { type: "application/json" }))) return;
      fetch(HIT_URL, {
        method: "POST", body, keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    } catch (e) {}
  }

  let sent = 0;
  const lastKey = Object.create(null);

  /* app.js から呼ばれる唯一の窓口。
     dedupe を渡すと、同じ値が続いたぶんは数えない（検索窓は打鍵ごとに
     確定するので、これが無いと「統計」と打つだけで数回に化ける）。 */
  function hit(event, dedupe) {
    if (excluded || sent >= MAX_HITS) return;
    if (dedupe !== undefined) {
      if (lastKey[event] === dedupe) return;
      lastKey[event] = dedupe;
    }
    sent++;
    const isPv = event === "pv";
    const day = isPv ? jstDay() : "";
    const body = JSON.stringify({
      e: event,
      p: location.pathname,
      n: isPv ? newSession() : 0,
      d: isPv ? firstIn(DKEY, day) : 0,
      m: isPv ? firstIn(MKEY, day.slice(0, 7)) : 0,
    });
    send(body);
  }

  /* 1日1回の属性スナップショット。印（rk_sd）を残せない端末は送らない
     ―― 毎回「その日の1回目」に見えて上に膨らむより、数え損ねる方を選ぶ（UU と同じ）。 */
  function snap(s) {
    if (excluded) return;
    if (!firstIn(SDKEY, jstDay())) return;
    const ids = [...new Set([...(s?.tt?.haru || []), ...(s?.tt?.aki || [])].map(String))];
    send(JSON.stringify({ e: "snap", g: String(s?.grade || ""), f: String(s?.faculty || ""), ids }));
  }

  /* 除外された端末でも生やす。app.js 側に「計測が有効なら」という
     条件分岐を持ち込まないため（分岐が増えると必ず片方が腐る）。 */
  window.rkTrack = hit;
  window.rkSnap = snap;

  if (excluded) return;

  const s = document.createElement("script");
  /* 🚨 Cloudflare の管理画面にある貼り付け用タグと同じ形にする
     （data-cf-beacon 属性でトークンを渡す・type="module" は付けない）。
     2026-09-03〜10-05 は type="module" ＋ ?token= の形で、beacon は読み込まれるのに
     cloudflareinsights.com/cdn-cgi/rum へ1件も送っておらず、ダッシュボードは
     ページ表示も読み込み時間も 0 のままだった（エラーは出ない）。
     module のスクリプトでは beacon が自分のタグ（currentScript）を見つけられず、
     src のトークンを読めないのが原因とみている。ヘッドレス Chrome で実測して、
     下の形で rum が 204 を返すことを確かめた。 */
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }));
  document.head.appendChild(s);

  hit("pv");
})();
