/* 利用者の属性を数えるための送信。
 * 設計: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *
 *  A（匿名・全員）… 学年・学部・時間割を window.rkSnap に渡す。その日の1回目かどうかは
 *                   analytics.js が決める（除外された端末も向こうで止まる）。
 *  B（ログイン者）… PUT /api/profile に丸ごと送る。ログイン済みかは gate.js が
 *                   /api/me に聞いた結果（rkGate.state()）を読む。変わったら2秒まとめて送り直す。
 *
 * トップ（data-wait="app"）は rk:app-ready まで待ってから A を送る。app.js が
 * LINE から来た ?faculty=&year= を書き込むのはその前なので、待たないと
 * LINE 経由の1回目が「未回答」として数えられる。
 *
 * 開いたときの1回は、何も入っていない端末（学年・学部・時間割がすべて空）なら送らない。
 * 別の端末（PC）で作った時間割を、ログインしただけのスマホが空で上書きしないため。
 * 本人が変えたとき（rk:store-changed）は空でも送る ―― 全部外した人の行を消すため。
 *
 * どれが失敗しても画面は止めない（送れなかった分は数えないだけ）。
 */
(() => {
  const store = window.rkStore;
  if (!store) return;

  const DEBOUNCE_MS = 2000;
  const waitApp = (document.currentScript && document.currentScript.dataset.wait) === "app";
  let loggedIn = false;
  let timer = 0;

  function snapNow() {
    try { if (window.rkSnap) window.rkSnap(store.snapshot()); } catch (e) {}
  }

  function isEmpty(s) {
    return !s.grade && !s.faculty && !s.tt.haru.length && !s.tt.aki.length;
  }

  function push(onLoad) {
    if (!loggedIn) return;
    if (onLoad === true && isEmpty(store.snapshot())) return;
    try {
      fetch("/api/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(store.snapshot()),
      }).catch(() => {});
    } catch (e) {}
  }

  if (waitApp) window.addEventListener("rk:app-ready", snapNow);
  else snapNow();

  window.addEventListener("rk:store-changed", () => {
    clearTimeout(timer);
    timer = setTimeout(() => push(false), DEBOUNCE_MS);
  });

  const gate = window.rkGate;
  if (gate && gate.ready) {
    gate.ready.then(() => {
      loggedIn = !!(gate.state && gate.state().loggedIn);
      push(true);
    });
  }
})();
