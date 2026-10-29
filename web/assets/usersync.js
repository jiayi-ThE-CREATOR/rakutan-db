/* 利用者の属性を数えるための送信と、時間割の端末間の同期。
 * 設計: docs/superpowers/specs/2026-10-05-user-stats-design.md
 *       docs/superpowers/specs/2026-10-29-timetable-sync-design.md（端末間の同期）
 *
 *  A（匿名・全員）… 学年・学部・時間割を window.rkSnap に渡す。その日の1回目かどうかは
 *                   analytics.js が決める（除外された端末も向こうで止まる）。
 *  B（ログイン者）… PUT /api/profile に丸ごと送る。ログイン済みかは gate.js が
 *                   /api/me に聞いた結果（rkGate.state()）を読む。変わったら2秒まとめて送り直す。
 *                   時間割は数える用の ID に加えて、rk_timetable そのもの（doc）も添える。
 *
 * トップ（data-wait="app"）は rk:app-ready まで待ってから A を送る。app.js が
 * LINE から来た ?faculty=&year= を書き込むのはその前なので、待たないと
 * LINE 経由の1回目が「未回答」として数えられる。
 *
 * 開いたときの1回は、何も入っていない端末（学年・学部・時間割がすべて空）なら送らない。
 * 別の端末（PC）で作った時間割を、ログインしただけのスマホが空で上書きしないため。
 * 本人が変えたとき（rk:store-changed）は空でも送る ―― 全部外した人の行を消すため。
 *
 * ■ 端末間の同期（2026-10-29）
 * ログインしたら、送る前にまず保存されている時間割（GET /api/profile）を聞く。
 *   保存が無い・聞けない … 今まで通り（空でなければ送る）
 *   この端末が空 ………… 保存されている方を黙って使う（新しい端末）
 *   同じ ……………………… 今まで通り
 *   違う ……………………… どちらを使うか本人に聞く（wang 決定：毎回聞く）。
 *                         答えるまでは送らない ―― 聞いている間に、保存されている方を上書きしないため
 * 保存されている方を使うときは、書き戻してからページを読み直す（画面はもう古い時間割で描いてある）。
 *
 * どれが失敗しても画面は止めない（送れなかった分は数えないだけ）。
 */
(() => {
  const store = window.rkStore;
  if (!store) return;

  const DEBOUNCE_MS = 2000;
  const TERMS = ["haru", "aki"];
  const SLOT_RE = /^[月火水木金][1-6]$/;          // worker/profile.js の cleanDoc と同じ
  const ID_RE = /^[0-9A-Z]{1,12}$/;
  const waitApp = (document.currentScript && document.currentScript.dataset.wait) === "app";
  let loggedIn = false;
  let holding = false;                            // 本人の答え待ち。このあいだは送らない
  let timer = 0;

  function snapNow() {
    try { if (window.rkSnap) window.rkSnap(store.snapshot()); } catch (e) {}
  }

  function isEmpty(s) {
    return !s.grade && !s.faculty && !s.tt.haru.length && !s.tt.aki.length;
  }

  const localDoc = () => (store.getTimetableDoc ? store.getTimetableDoc() : null);

  function push(onLoad) {
    if (!loggedIn || holding) return;
    if (onLoad === true && isEmpty(store.snapshot())) return;
    try {
      fetch("/api/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...store.snapshot(), doc: localDoc() || undefined }),
      }).catch(() => {});
    } catch (e) {}
  }

  /* 2つの時間割が同じか。サーバーが通す形（cleanDoc）だけで並べて比べる ――
     通らない値が端末に残っていると、毎回「違う」と聞くことになるため。 */
  function canon(doc) {
    const out = {};
    for (const t of TERMS) {
      const s = (doc && doc[t]) || {};
      out[t] = {
        slots: Object.entries(s.slots || {}).filter(([k, id]) => SLOT_RE.test(k) && ID_RE.test(String(id)))
          .map(([k, id]) => `${k}=${id}`).sort(),
        extra: (Array.isArray(s.extra) ? s.extra : []).map(String).filter((id) => ID_RE.test(id)).sort(),
      };
    }
    return JSON.stringify(out);
  }
  const courses = (doc) => new Set(TERMS.flatMap((t) => {
    const s = (doc && doc[t]) || {};
    return [...Object.values(s.slots || {}), ...(Array.isArray(s.extra) ? s.extra : [])].map(String);
  })).size;
  const when = (ms) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  function adopt(doc) {
    holding = false;
    store.setTimetableDoc(doc);
    if (store.timetableSaved && !store.timetableSaved()) return;   // 書けていないのに読み直すと、空に戻って繰り返す
    try { location.reload(); } catch (e) {}
  }

  /* どちらを使うか聞く。見た目はゲートの説明（gate.css の .gateDlg）と同じ部品。
     ✕・Esc は「あとで」――次に開いたときにもう一度聞き、それまでは送らない。 */
  function ask(local, saved) {
    holding = true;
    const d = document.createElement("dialog");
    d.className = "gateDlg";
    d.id = "ttSyncDlg";
    d.setAttribute("aria-labelledby", "ttSyncTitle");
    d.innerHTML = `<div class="gateDlgCard">
      <div class="gateDlgHead"><h2 id="ttSyncTitle">時間割が2つあります</h2>
        <button type="button" class="gateDlgClose" data-pick="later" aria-label="あとで決める">✕</button></div>
      <p class="gateDlgLead">この端末の時間割と、ほかの端末で保存した時間割が違います。どちらを使いますか？使わなかった方は消えます。</p>
      <button type="button" class="gateBtn" data-pick="saved">保存されている時間割を使う（${courses(saved.doc)}科目${saved.at ? `・${when(saved.at)} 保存` : ""}）</button>
      <button type="button" class="gateBtn gateBtnSub" data-pick="local">この端末の時間割を使う（${courses(local)}科目）</button>
      <p class="gateDlgSub">✕ で閉じると、次に開いたときにもう一度聞きます。</p>
    </div>`;
    d.addEventListener("click", (e) => {
      const b = e.target && e.target.closest && e.target.closest("[data-pick]");
      if (!b) return;
      const pick = b.dataset.pick;
      try { d.close(); d.remove(); } catch (err) {}
      if (pick === "saved") adopt(saved.doc);
      else if (pick === "local") { holding = false; push(false); }
    });
    document.body.appendChild(d);
    try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
  }

  async function reconcile() {
    let saved = null;
    try {
      const res = await fetch("/api/profile", { credentials: "same-origin" });
      if (res && res.ok) saved = await res.json();
    } catch (e) { saved = null; }
    if (!saved || !saved.ok || !saved.doc || !store.setTimetableDoc) { push(true); return; }
    const local = localDoc();
    if (canon(local) === canon(saved.doc)) { push(true); return; }
    if (!courses(local)) { adopt(saved.doc); return; }
    ask(local, saved);
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
      if (loggedIn) return reconcile();
    });
  }
})();
