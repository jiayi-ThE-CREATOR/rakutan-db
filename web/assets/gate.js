/* LINE 登録しないと使えない機能に、覆いをかける。
 *
 * ■ 何を解いたのか
 * それまでの「LINE 連携」は、マイページのボタンを押した印を localStorage に
 * 書くだけだった（store.js の rk_line_linked の注記どおり）。押した先で
 * 友だち追加をやめても分からないので、押して戻るだけで「連携済み」になった。
 * wang さんの 2026-09-13 の指摘はこれ。
 *
 * だから判定は localStorage をやめ、**サーバーに聞く**（GET /api/me）。
 * サーバーは LINE ログインで本人を確かめ、friendship status API で
 * 友だちかどうかを LINE 自身に確認している（worker/linelogin.js）。
 * 画面側の細工では通れない。
 *
 * ■ 閉じるのは3つ（2026-09-14 wang さん指定）
 *   条件チップ ／ 配点スライダー ／ 口コミあり ／ マイページの機能
 * 検索と一覧そのものは閉じない ―― 初めて来た人が何も見られないと、
 * 登録する理由まで分からなくなる。
 *
 * ■ 落ちたときは開ける（fail-open）
 * /api/me が届かない・未設定のときは覆いをかけない。障害や設定漏れで
 * サイト全体が使えなくなる方が、開いてしまうより害が大きいという判断。
 */
(() => {
  const LINE_ADD_URL = "https://line.me/R/ti/p/@733udbnt";

  /* 覆う相手は data-gate を持つ要素。HTML 側で指定する（JS に
     セレクタを並べると、HTML を直した人が気づけない）。 */
  const targets = () => Array.from(document.querySelectorAll("[data-gate]"));

  const veilHTML = (state) => {
    /* ログイン済みだが友だちでない人には、ログインではなく友だち追加を促す。
       ここを一緒にすると「ログインしたのに開かない」で行き止まりになる。 */
    const needFriend = state.loggedIn && !state.linked;
    const lead = needFriend
      ? "LINE で友だち追加すると使えます"
      : "LINE 登録すると使えます";
    const sub = needFriend
      ? "ラクハン【公式】を友だち追加してから、もう一度お試しください。"
      : "ラクハン【公式】と繋ぐと、この機能が使えます。登録は無料です。";
    const btn = needFriend
      ? `<a class="gateBtn" href="${LINE_ADD_URL}" target="_blank" rel="noopener noreferrer">LINE で友だち追加</a>`
      : `<button type="button" class="gateBtn" data-gate-login>LINE で続ける</button>`;
    return `<div class="gateBox">
        <p class="gateLead">${lead}</p>
        <p class="gateSub">${sub}</p>
        ${btn}
      </div>`;
  };

  function lock(el, state){
    if (el.dataset.gateLocked === "1") return;
    el.dataset.gateLocked = "1";
    el.classList.add("gated");

    /* 中身を1枚の箱に入れてから薄くする。子へ直接クラスを付けると、
       あとで中身を描き直す処理（load() など）が innerHTML を
       入れ替えたときに外れる。 */
    const inner = document.createElement("div");
    inner.className = "gateInner";
    while (el.firstChild) inner.appendChild(el.firstChild);
    el.appendChild(inner);

    /* 中身はタブ順から外す。見えてはいるが操作させないため。
       aria-hidden は付けない ―― 読み上げ利用者にも「何がロックされて
       いるか」は伝える必要がある。 */
    inner.setAttribute("inert", "");

    const veil = document.createElement("div");
    veil.className = "gateVeil";
    veil.innerHTML = veilHTML(state);
    el.appendChild(veil);
  }

  function unlock(el){
    if (el.dataset.gateLocked !== "1") return;
    delete el.dataset.gateLocked;
    el.classList.remove("gated");
    el.querySelector(".gateVeil")?.remove();
    const inner = el.querySelector(".gateInner");
    if (inner){
      inner.removeAttribute("inert");
      while (inner.firstChild) el.insertBefore(inner.firstChild, inner);
      inner.remove();
    }
  }

  const loginHref = () =>
    "/line/login?next=" + encodeURIComponent(location.pathname + location.search + location.hash);

  /* 覆われた機能を押したときの説明。**入口へ直行しない。**
     直行すると、押した人の画面がいきなり LINE になり「何のために飛ばされたのか」
     が分からない（2026-09-22 wang 指摘）。先に「何ができるようになるのか」と
     「登録は無料」を site の中で出し、入口へ進むかどうかは本人に選ばせる。 */
  function prompt(){
    const dlg = document.getElementById("gateDlg");
    /* ダイアログの無いページ（マイページ等）では今までどおり直行する ――
       説明が出せないなら、何も起きないより入口へ着くほうがまし。 */
    if (!dlg || typeof dlg.showModal !== "function"){ location.href = loginHref(); return; }
    const needFriend = state.loggedIn && !state.linked;
    dlg.querySelector("#gateDlgTitle").textContent =
      needFriend ? "LINE で友だち追加すると使えます" : "LINE 登録すると使えます";
    dlg.querySelector("#gateDlgBody").innerHTML = needFriend
      ? `<p class="gateDlgLead">ラクハン【公式】を友だち追加してから、もう一度お試しください。</p>
         <a class="gateBtn" href="${LINE_ADD_URL}" target="_blank" rel="noopener noreferrer">LINE で友だち追加</a>`
      : `<p class="gateDlgLead">重さのつまみを自分に合わせて動かしたり、ある項目がある授業を
           <b>✕</b> でまとめて外したり、授業内容のタグでしぼったりするには、
           LINE 登録が要ります。</p>
         <p class="gateDlgSub">ラクハン【公式】と繋ぐだけです。<b>登録は無料</b>で、
           授業の情報はそのまま見られます。</p>
         <a class="gateBtn" href="${loginHref()}">LINE で続ける</a>`;
    dlg.showModal();
  }

  /* 覆いのどこを押しても説明を出す（ボタンだけ有効だと、薄い中身を
     押した人には何も起きず「壊れている」に見える）。 */
  document.addEventListener("click", (e) => {
    const veil = e.target.closest?.(".gateVeil");
    if (!veil) return;
    /* 友だち追加の <a> は素通し（新しいタブで LINE を開かせる）。 */
    if (e.target.closest("a")) return;
    e.preventDefault();
    prompt();
  });

  /* 閉じる。幕（カードの外）を押しても閉じる ―― version.js と同じ作法。 */
  document.addEventListener("click", (e) => {
    const dlg = document.getElementById("gateDlg");
    if (!dlg || !dlg.open) return;
    if (e.target === dlg || e.target.closest?.("#gateDlgClose")) dlg.close();
  });

  /* 連携しているか。app.js の ✕（しぼり込み）が押されたときの判定に使う。
     まだ /api/me を聞けていない・届かないときは true（fail-open）―― 覆いと同じ考え方で、
     障害で機能が死ぬより開いてしまう方がましという判断（このファイルの冒頭参照）。 */
  let linked = true;
  /* 直近に聞いた /api/me。覆いを描くときと、説明のダイアログを出すときの
     両方が読む（「ログイン済みだが友だちでない」で文面が変わるため）。 */
  let state = { linked: true, loggedIn: false, configured: false };

  async function apply(){
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (res.ok) state = await res.json();
    } catch (e) {
      /* 届かないときは開けたまま（fail-open）。 */
      return;
    }
    linked = !!state.linked;
    const els = targets();
    if (state.linked) els.forEach(unlock);
    else els.forEach(el => lock(el, state));
  }

  /* 他のスクリプト（app.js / mypage.js）が中身を描き終わってから覆う。
     先に覆うと、あとから innerHTML を書かれて覆いごと消える節がある。 */
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", () => setTimeout(apply, 0));
  } else {
    setTimeout(apply, 0);
  }

  /* 描き直しの後にも掛け直せるよう、外から呼べる口を残す。 */
  window.rkGate = { apply, linked: () => linked, prompt };
})();
