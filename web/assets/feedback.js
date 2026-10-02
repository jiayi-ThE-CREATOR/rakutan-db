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

  /* 科目ごとの「この科目の情報がおかしい？」（detail.js の .fbReport）。
     内容の誤りの指摘も、サイトへの意見と同じ意見箱・同じ Discord チャンネルに集める
     （2026-10-02 wang 指示）。科目名と時間割コードは button の data 属性に入っているので、
     一覧のデータには触らずに前置きを組める ―― 一覧・マイページのどちらでも同じく動く。 */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fb-report]");
    if (!b) return;
    e.preventDefault();
    openBox(`【内容の訂正】${b.dataset.fbReport}\n\n`);
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

/* 問い合わせ ―― フッタの「ラクハンへの問い合わせ」→ <dialog>（2026-09-30）
 *
 * 意見箱の右隣。意見箱は匿名で投げるだけなので、返事が要る相談・広告のことは
 * こちらで GUILD の Instagram の DM へ案内する。
 * 以前は /about#who（About の「運営」の節）へ飛ばしていたが、意見箱と同じく
 * その場でウィンドウが出る形にしてほしいという依頼で作り直し、節は消した。
 *
 * ウィンドウの HTML は6ページに書かず、ここで1回だけ組む（文言・QR を1か所で直すため）。
 * 開く入口は [data-contact] の付いた <a>。href は Instagram そのものにしてあるので、
 * この JS が落ちても押せば Instagram が開く。
 *
 * QR だけでは足りない：スマホで見ている人は、自分の画面の QR を読めない。
 * だから「Instagram を開く」も並べる。見た目は意見箱（.fbDlg / .fbForm）をそのまま使う。 */
(() => {
  const IG_URL = "https://www.instagram.com/osaka_ai_commumity/?hl=ja";
  const IG_ID = "@osaka_ai_commumity";
  let dlg = null;

  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "fbDlg";
    dlg.id = "ctDlg";
    dlg.setAttribute("aria-labelledby", "ctTitle");
    dlg.innerHTML = `
      <div class="fbForm ctBody">
        <h2 id="ctTitle">ラクハンへの問い合わせ</h2>
        <p class="fbNote">運営へのお問い合わせ・広告掲載のご相談は、ラクハンを運営している学生団体
          <b>GUILD の Instagram</b> に DM でお送りください。</p>
        <img class="ctQr" src="/assets/guild-instagram-qr.png" width="1240" height="1240"
             alt="GUILD 公式 Instagram（${IG_ID}）の QR コード" loading="lazy">
        <p class="ctId">${IG_ID}</p>
        <div class="fbBtns">
          <button type="button" class="fbCancel" data-ct-close>閉じる</button>
          <a class="fbSend ctIg" href="${IG_URL}" target="_blank" rel="noopener noreferrer">Instagram を開く</a>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector("[data-ct-close]").addEventListener("click", () => dlg.close());
    // 外側（背景）を押したら閉じる。意見箱と違って書きかけが無いので、閉じて失うものが無い。
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-contact]");
    if (!a) return;
    // 修飾キー・中クリックはブラウザに任せる（別タブで Instagram が開く）。
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (typeof HTMLDialogElement === "undefined") return;   // 古いブラウザは href のまま
    e.preventDefault();
    if (!dlg) build();
    dlg.showModal();
  });
})();
