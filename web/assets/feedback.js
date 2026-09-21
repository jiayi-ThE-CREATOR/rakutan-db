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

  // 画像添付。任意項目なので送信ボタンの活性条件には関わらない。
  const drop = $("fbDrop");
  const dropHint = $("fbDropHint");
  const dropPreview = $("fbDropPreview");
  const dropThumb = $("fbDropThumb");
  const dropMeta = $("fbDropMeta");
  const dropRemove = $("fbDropRemove");
  const dropInput = $("fbImageInput");
  const imgMsg = $("fbImgMsg");

  const IMG_MAX = 5 * 1024 * 1024;   // worker/index.js の FB_MAX_IMAGE_BYTES と同じ値
  const IMG_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  let imageDataUrl = null;

  function resetImage() {
    imageDataUrl = null;
    dropInput.value = "";
    dropPreview.hidden = true;
    dropHint.hidden = false;
    imgMsg.textContent = "";
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function handleFile(file) {
    if (!file) return;
    if (!IMG_TYPES.has(file.type)) {
      imgMsg.textContent = "画像ファイル（png・jpeg・webp・gif）を選んでください";
      imgMsg.className = "fbMsg ng";
      return;
    }
    if (file.size > IMG_MAX) {
      imgMsg.textContent = "画像は5MBまでです";
      imgMsg.className = "fbMsg ng";
      return;
    }
    imgMsg.textContent = "";
    imgMsg.className = "fbMsg";
    try {
      imageDataUrl = await readAsDataURL(file);
    } catch {
      imgMsg.textContent = "画像を読み込めませんでした";
      imgMsg.className = "fbMsg ng";
      return;
    }
    dropThumb.src = imageDataUrl;
    dropMeta.textContent = `${file.name}（${Math.round(file.size / 1024)}KB）`;
    dropHint.hidden = true;
    dropPreview.hidden = false;
  }

  if (drop && dropInput) {
    dropInput.addEventListener("change", () => handleFile(dropInput.files[0]));

    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("isOver");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove("isOver");
      })
    );
    drop.addEventListener("drop", (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });

    // .fbDrop は <label for="fbImageInput"> なので、中のボタンのクリックも
    // 素通りするとラベルの既定動作（ファイル選択ダイアログ）が再度開いてしまう。
    dropRemove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetImage();
    });
  }

  function say(t, cls) {
    msg.textContent = t;
    msg.className = "fbMsg" + (cls ? " " + cls : "");
  }

  function sync() {
    const n = text.value.trim().length;
    send.disabled = sending || n === 0;
    count.textContent = `${text.value.length} / ${MAX}`;
  }

  /* 前置き文つきで開けるようにする（授業内容タグの「タグが違う？」から呼ばれる）。
     書きかけがあるときは上書きしない ―― 途中まで書いて開き直した人の文章を消さない。
     カーソルは末尾に置く（前置きの続きから書き始められるように）。 */
  function openBox(prefill){
    say("");
    if (prefill && !text.value.trim()) text.value = prefill;
    sync();
    dlg.showModal();
    text.focus();
    text.setSelectionRange(text.value.length, text.value.length);
  }

  open.addEventListener("click", () => openBox());
  /* app.js から呼ぶための入口。意見箱は app.js と独立して動くので、
     窓口をここに1つだけ出して、向こうから DOM を触らせない。 */
  window.rkFeedback = { open: openBox };

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
          image: imageDataUrl || undefined,
        }),
      });
      if (res.ok) {
        form.reset();
        resetImage();
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
