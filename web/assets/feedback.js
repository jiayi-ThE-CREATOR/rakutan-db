/* 意見箱 ―― フッタの「ご意見・改善要望」→ <dialog> → POST /api/feedback
 *
 * app.js（科目一覧）とは独立して動く。about ページにもフッタ経由で同じものが出るので、
 * 一覧のデータや DATA グローバルには一切触らないこと。
 *
 * 送信先は Worker（worker/index.js）で、そこから Discord のチャンネルへ流れる。
 * 静的配信だけの環境（server.py / assets のみの wrangler）では /api/feedback が
 * 無いので、そのときは「受付準備中」と出す。黙って捨てない。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const open = $("fbOpen");
  const dlg = $("fbDlg");
  const form = $("fbForm");
  if (!open || !dlg || !form) return;

  const text = $("fbText");
  const contact = $("fbContact");
  const hp = $("fbWebsite");
  const send = $("fbSend");
  const msg = $("fbMsg");
  const count = $("fbCount");

  const MAX = 1000;   // worker/index.js の FB_MAX_TEXT と同じ値
  let sending = false;

  function say(t, cls) {
    msg.textContent = t;
    msg.className = "fbMsg" + (cls ? " " + cls : "");
  }

  function sync() {
    const n = text.value.trim().length;
    send.disabled = sending || n === 0;
    count.textContent = `${text.value.length} / ${MAX}`;
  }

  open.addEventListener("click", () => {
    say("");
    sync();
    dlg.showModal();
    text.focus();
  });

  $("fbCancel").addEventListener("click", () => dlg.close());
  text.addEventListener("input", sync);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending || text.value.trim().length === 0) return;
    sending = true;
    sync();
    say("送信中…");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: text.value,
          contact: contact.value,
          website: hp.value,                                   // honeypot
          from: (location.pathname + location.search).slice(0, 200),
        }),
      });
      if (res.ok) {
        form.reset();
        say("送りました。ありがとうございます。", "ok");
        setTimeout(() => dlg.close(), 1400);
      } else if (res.status === 400) {
        say("本文が空のようです。もう一度お願いします。", "ng");
      } else {
        // 503（webhook 未設定）と 404/405（静的配信のみ）を同じ文言にまとめる。
        // 利用者にとってはどちらも「今は受け取れない」で、区別しても何もできない。
        say("いまは受け取れませんでした。時間をおいて試してください。", "ng");
      }
    } catch (err) {
      say("通信できませんでした。電波の良いところで試してください。", "ng");
    } finally {
      sending = false;
      sync();
    }
  });

  sync();
})();
