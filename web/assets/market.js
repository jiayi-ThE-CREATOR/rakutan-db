/* 教科書マーケット（試作・2026-10-25 hayashi）。
 *
 * 棚の本は web/data/market.json（tools/build_market.py が courses.built.json から作る）。
 * 在庫と価格はここで本ごとに決まった値を作るデモ。予約と出品は localStorage にだけ残し、
 * サーバーには何も送らない ―― テスト版の D1 は本番と共有なので、試作で書き込まない。
 *
 * 流れ（チームで決めた案）
 *   買う … 本を選ぶ → 中古を1冊選ぶ → 受け取りの枠を選ぶ → 予約完了（代金は窓口で払う）
 *   売る … 本を選ぶ → 状態 → 写真 → 持ち込む枠 → 申し込み → 棚に「確認中」で並ぶ
 *   受け渡しは窓口（決まった場所・決まった時間帯）に来てもらう。枠は時間割の空きコマを印で示す。
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const norm = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();

  const DAYS = ["月", "火", "水", "木", "金"];
  const PERIODS = [1, 2, 3, 4, 5, 6];
  const PAGE = 40;
  const COOP_URL = "https://www.u-coop.net/textbook/osaka-u/toyonaka/indicate.php";
  const PLACE = "豊中キャンパスの受け渡し窓口（場所は決まり次第お知らせ）";
  /* 窓口を開ける枠（仮）。昼休みは誰でも空いているので毎日、4限は曜日を絞る。 */
  const WINDOW = { 月: ["昼", "4"], 火: ["昼"], 水: ["昼", "4"], 木: ["昼"], 金: ["昼", "4"] };
  const SLOT_TIME = { 昼: "12:10–13:00（昼休み）", 4: "15:10–16:40（4限）" };
  const COND = { good: "きれい", some: "書き込み少し", many: "書き込み多め" };

  /* ── 保存（この端末だけ） ── */
  const LS_RES = "rk_mk_res", LS_SELL = "rk_mk_sell";
  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]") || []; } catch (e) { return []; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let reservations = load(LS_RES);
  let sells = load(LS_SELL);

  /* ── 時間割（store.js） ── */
  const tt = (t) => { try { return window.rkStore.getTimetable(t); } catch (e) { return { slots: {}, extra: [] }; } };
  const idsOf = (t) => { const x = tt(t); return [...Object.values(x.slots || {}), ...(x.extra || [])].map(String); };
  const myNow = new Set(idsOf("aki"));     // 今の学期（10月なので秋冬）
  const myPrev = new Set(idsOf("haru"));   // 前の学期 ―― 売る側の候補
  const myAll = new Set([...myNow, ...myPrev]);
  const busySlots = new Set(Object.keys(tt("aki").slots || {}));
  const hasTT = myAll.size > 0;

  /* ── デモ在庫 ── */
  const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  function demoStock(b, i) {
    const h = hash(b.k);
    const n = i < 240 ? h % 4 : (h % 9 === 0 ? 1 : 0);
    const out = [];
    for (let j = 0; j < n; j++) {
      const c = ["good", "some", "many"][(h >>> (j * 3 + 2)) % 3];
      const base = 600 + ((h >>> 5) % 20) * 100;
      const price = Math.max(300, base - (c === "some" ? 200 : c === "many" ? 400 : 0) - j * 100);
      out.push({ id: `${b.k}#${j}`, cond: c, price });
    }
    return out.filter((s) => !reservations.some((r) => r.stock === s.id));
  }

  let BOOKS = [];
  const byKey = new Map();
  const state = { mine: false, slots: new Set(), term: "all", stock: false, q: "", limit: PAGE };

  const slotsOf = (dp) => String(dp || "").match(/[月火水木金][1-6]/g) || [];
  const isMine = (b) => b.courses.some((c) => myAll.has(String(c.id)));
  const pendingOf = (b) => sells.filter((s) => s.k === b.k);

  /* 仮の表紙。本番では出品者の写真に置き換える。色は書名から決める（毎回同じ色）。 */
  function coverHtml(b) {
    const h = hash(b.k) % 360;
    return `<div class="mkCover" style="background:hsl(${h} 32% 34%)">
      <span class="t">${esc(b.title)}</span><small>${esc(b.author || b.publisher || "")}</small></div>`;
  }

  function statusHtml(b) {
    if (b.stock.length) {
      const min = Math.min(...b.stock.map((s) => s.price));
      return `<div class="mkSt ok">中古 ${b.stock.length}冊 <b>¥${min.toLocaleString()}〜</b></div>`;
    }
    if (pendingOf(b).length) return `<div class="mkSt wait">確認中 ${pendingOf(b).length}冊</div>`;
    return `<div class="mkSt none">中古はまだありません</div>`;
  }

  function courseLine(b) {
    const mine = b.courses.find((c) => myAll.has(String(c.id)));
    const c0 = mine || b.courses[0];
    const more = b.courses.length > 1 ? ` ほか${b.courses.length - 1}コマ` : "";
    return `${esc(c0.title)}${more}`;
  }

  function cardHtml(b) {
    return `<button type="button" class="mkCard" data-k="${esc(b.k)}">
      ${coverHtml(b)}
      <div class="mkCardB">
        ${isMine(b) ? `<span><span class="mkTag mine">あなたの時間割</span></span>` : ""}
        <div class="mkCardC">${courseLine(b)}</div>
        <div class="mkCardT">${esc(b.title)}</div>
        ${statusHtml(b)}
      </div></button>`;
  }

  /* ── 絞り込み ── */
  function matches(b) {
    if (state.mine && !isMine(b)) return false;
    if (state.stock && !b.stock.length && !pendingOf(b).length) return false;
    if (state.term !== "all" && !b.courses.some((c) => c.term === state.term || c.term === "full" || c.term === "unknown")) return false;
    if (state.slots.size && !b.courses.some((c) => slotsOf(c.dp).some((s) => state.slots.has(s)))) return false;
    if (state.q) {
      const q = norm(state.q);
      const hay = norm([b.title, b.author, ...b.courses.map((c) => c.title + c.ins)].join(""));
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderShelf() {
    const hit = BOOKS.filter(matches);
    hit.sort((a, b) => (isMine(b) - isMine(a)) || ((b.stock.length > 0) - (a.stock.length > 0)) || (a._i - b._i));
    $("#mkCount").textContent = `${hit.length.toLocaleString()}冊`;
    $("#mkShelf").innerHTML = hit.length
      ? hit.slice(0, state.limit).map(cardHtml).join("")
      : `<p class="mkEmpty">条件に合う教科書がありません</p>`;
    $("#mkMore").hidden = hit.length <= state.limit;
  }

  function renderGrid() {
    const has = new Set(BOOKS.flatMap((b) => b.courses.flatMap((c) => slotsOf(c.dp))));
    let h = `<span></span>${DAYS.map((d) => `<span>${d}</span>`).join("")}`;
    for (const p of PERIODS) {
      h += `<span>${p}</span>`;
      for (const d of DAYS) {
        const s = d + p;
        const cls = [has.has(s) ? "has" : "", busySlots.has(s) ? "mine" : ""].join(" ").trim();
        h += `<button type="button" data-slot="${s}" class="${cls}" aria-pressed="${state.slots.has(s)}"
                aria-label="${d}曜${p}限">${busySlots.has(s) ? "●" : ""}</button>`;
      }
    }
    $("#fGrid").innerHTML = h;
    $("#fGridClear").hidden = !state.slots.size;
  }

  function renderMine() {
    const items = [
      ...reservations.map((r, i) => `<li><span class="mkTag mine">受け取り予約</span><b>${esc(byKey.get(r.k)?.title || "")}</b>
         <small>${esc(r.slotLabel)}・¥${r.price.toLocaleString()}</small><button type="button" data-cancel-res="${i}">取り消す</button></li>`),
      ...sells.map((s, i) => `<li><span class="mkTag">確認中（売る）</span><b>${esc(byKey.get(s.k)?.title || "")}</b>
         <small>持ち込み ${esc(s.slotLabel)}</small><button type="button" data-cancel-sell="${i}">取り消す</button></li>`),
    ];
    $("#mkMine").innerHTML = items.length
      ? `<div class="mkMine"><h3>あなたの予約・申し込み（この端末に保存）</h3><ul>${items.join("")}</ul></div>` : "";
  }

  function refreshAll() {
    BOOKS.forEach((b) => { b.stock = demoStock(b, b._i); });
    renderMine(); renderShelf();
  }

  /* ── 受け取り・持ち込みの枠 ── */
  function windowSlots() {
    const out = [];
    const d = new Date(); d.setHours(0, 0, 0, 0);
    for (let i = 1; out.length < 9 && i < 21; i++) {
      const day = new Date(d.getTime() + i * 864e5);
      const w = "日月火水木金土"[day.getDay()];
      for (const s of WINDOW[w] || []) {
        if (out.length >= 9) break;
        const label = `${day.getMonth() + 1}/${day.getDate()}（${w}）${SLOT_TIME[s]}`;
        const busy = s !== "昼" && busySlots.has(w + s);
        out.push({ id: `${day.toISOString().slice(0, 10)}_${s}`, label, busy, lunch: s === "昼" });
      }
    }
    return out;
  }

  function slotsHtml(name) {
    return `<p class="mkPlace">場所：${esc(PLACE)}</p><div class="mkSlots">${windowSlots().map((s) => `
      <label class="mkSlot"><input type="radio" name="${name}" value="${esc(s.id)}" data-label="${esc(s.label)}">
        <span>${esc(s.label)}</span>${!hasTT ? "" : s.busy ? `<span class="busy">授業あり</span>` : `<span class="free">空きコマ</span>`}</label>`).join("")}</div>`;
  }

  /* ── 本のダイアログ ── */
  const dlg = $("#mkDlg");
  const dlgBody = $("#mkDlgBody");
  const showDlg = (html) => { dlgBody.innerHTML = `<button type="button" class="mkX" data-close aria-label="閉じる">×</button><div class="mkDlgIn">${html}</div>`; if (!dlg.open) dlg.showModal(); };

  function openBook(k) {
    const b = byKey.get(k);
    if (!b) return;
    const courses = [...b.courses].sort((x, y) => myAll.has(String(y.id)) - myAll.has(String(x.id)));
    const code = (courses.find((c) => myAll.has(String(c.id))) || courses[0]).id;
    const amazon = `https://www.amazon.co.jp/s?k=${encodeURIComponent(b.isbn || b.title)}`;
    const pend = pendingOf(b).length;
    showDlg(`
      <div class="mkDlgTop">${coverHtml(b)}<div>
        <h3 id="mkDlgTitle">${esc(b.title)}</h3>
        <div class="mkMeta">${[b.author, b.publisher, b.year].filter(Boolean).map(esc).join("　")}${b.isbn ? `<br>ISBN ${esc(b.isbn)}` : ""}</div>
      </div></div>
      <div><p class="mkSecH">この本を使う授業（${b.courses.length}コマ）</p>
        <ul class="mkUse">${courses.slice(0, 60).map((c) => `<li class="${myAll.has(String(c.id)) ? "mine" : ""}">
          <i>${esc(c.dp || "—")}</i><a href="/?c=${encodeURIComponent(c.id)}">${esc(c.title)}</a> <small>${esc(c.ins)}</small>${myAll.has(String(c.id)) ? `<span class="mkTag mine">あなたの時間割</span>` : ""}</li>`).join("")}</ul></div>
      <div><p class="mkSecH">中古で買う</p>
        ${b.stock.length ? `<ul class="mkStock">${b.stock.map((s) => `<li><label>
            <input type="radio" name="stock" value="${esc(s.id)}" data-price="${s.price}" data-cond="${s.cond}">
            ${esc(COND[s.cond])}<b>¥${s.price.toLocaleString()}</b></label></li>`).join("")}</ul>`
          : `<p class="mkHint">いまは在庫がありません。${pend ? `確認中の本が${pend}冊あります（窓口で確かめたら買えるようになります）。` : ""}</p>`}</div>
      <div><p class="mkSecH">新品で買う</p>
        <div class="mkNew">
          <a class="mkExt" href="${COOP_URL}" target="_blank" rel="noopener noreferrer">生協の教科書リスト ↗<small>時間割コード ${esc(code)} で検索</small></a>
          <a class="mkExt" href="${amazon}" target="_blank" rel="noopener noreferrer">Amazon で探す ↗<small>${b.isbn ? "ISBN で検索" : "書名で検索"}</small></a>
        </div></div>
      ${b.stock.length ? `<button type="button" class="mkPrimary" id="toSlot" disabled>受け取りの日時を選ぶ</button>` : ""}`);
    dlgBody.dataset.k = k;
  }

  function openSlot(k, stockId, price, cond) {
    const b = byKey.get(k);
    showDlg(`
      <div><h3 id="mkDlgTitle">受け取りの日時を選ぶ</h3>
        <div class="mkMeta">${esc(b.title)}・${esc(COND[cond])}・¥${price.toLocaleString()}</div></div>
      ${slotsHtml("rslot")}
      <button type="button" class="mkPrimary" id="doReserve" disabled>この日時で予約する</button>
      <button type="button" class="mkSub" id="backBook">戻る</button>`);
    Object.assign(dlgBody.dataset, { k, stock: stockId, price, cond });
  }

  function reserve() {
    const { k, stock, price, cond } = dlgBody.dataset;
    const r = dlgBody.querySelector("input[name=rslot]:checked");
    const b = byKey.get(k);
    const no = `RK-${String(hash(stock + r.value) % 10000).padStart(4, "0")}`;
    reservations.push({ k, stock, price: Number(price), cond, slot: r.value, slotLabel: r.dataset.label, no });
    save(LS_RES, reservations);
    showDlg(`<div class="mkDone">
        <div class="ok"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
        <h3 id="mkDlgTitle">予約しました</h3>
        <dl><dt>本</dt><dd>${esc(b.title)}</dd><dt>状態</dt><dd>${esc(COND[cond])}</dd>
          <dt>代金</dt><dd>¥${Number(price).toLocaleString()}（受け取るときに窓口で払います）</dd>
          <dt>日時</dt><dd>${esc(r.dataset.label)}</dd><dt>場所</dt><dd>${esc(PLACE)}</dd><dt>予約番号</dt><dd>${no}</dd></dl>
        <p class="mkHint">窓口で予約番号を伝えてください。LINE でログインすると、前日にお知らせが届きます（試作では届きません）。</p>
        <button type="button" class="mkSub" data-close>閉じる</button></div>`);
    refreshAll();
  }

  /* ── 売る ── */
  const sell = { k: "", cond: "", slot: null };
  function sellReady() { $("#sellSubmit").disabled = !(sell.k && sell.cond && sell.slot); }
  function pickBook(k) {
    sell.k = k;
    const b = byKey.get(k);
    $("#sellPicked").hidden = !k;
    $("#sellPicked").innerHTML = k ? `${esc(b.title)}<button type="button" id="sellUnpick">選び直す</button>` : "";
    $("#sellQ").hidden = !!k; $("#sellPick").hidden = !!k; $("#sellSuggest").hidden = !!k;
    sellReady();
  }
  function pickRow(b, note) {
    return `<button type="button" data-pick="${esc(b.k)}">${esc(b.title)}<small>${esc(note)}</small></button>`;
  }
  function renderSuggest() {
    const prev = BOOKS.filter((b) => b.courses.some((c) => myPrev.has(String(c.id)))).slice(0, 6);
    $("#sellSuggest").innerHTML = prev.length
      ? `<div class="mkSug"><div class="mkSugH">前の学期（春夏）にあなたが取った授業の教科書</div>${prev.map((b) =>
          pickRow(b, b.courses.find((c) => myPrev.has(String(c.id))).title)).join("")}</div>`
      : `<p class="mkHint">マイページの時間割に前の学期の授業を入れておくと、ここに教科書が出ます。</p>`;
  }
  function renderPick() {
    const q = norm($("#sellQ").value);
    if (!q) { $("#sellPick").innerHTML = ""; return; }
    const hit = BOOKS.filter((b) => norm(b.title + b.courses.map((c) => c.title).join("")).includes(q)).slice(0, 8);
    $("#sellPick").innerHTML = hit.map((b) => pickRow(b, courseLine(b).replace(/&amp;/g, "&"))).join("")
      || `<p class="mkHint">見つかりません</p>`;
  }

  /* ── タブ ── */
  function setTab(t) {
    for (const btn of document.querySelectorAll(".mkTabs button")) btn.setAttribute("aria-selected", String(btn.dataset.tab === t));
    $("#buy").hidden = t !== "buy"; $("#sell").hidden = t !== "sell";
    if (location.hash !== `#${t}`) history.replaceState(null, "", `${location.pathname}${location.search}#${t}`);
  }

  /* ── イベント ── */
  document.addEventListener("click", (e) => {
    const t = e.target;
    const tab = t.closest(".mkTabs button"); if (tab) return setTab(tab.dataset.tab);
    const card = t.closest(".mkCard"); if (card) return openBook(card.dataset.k);
    if (t.closest("[data-close]")) return dlg.close();
    const slot = t.closest("#fGrid button[data-slot]");
    if (slot) { const s = slot.dataset.slot; state.slots.has(s) ? state.slots.delete(s) : state.slots.add(s); state.limit = PAGE; renderGrid(); return renderShelf(); }
    if (t.closest("#fGridClear")) { state.slots.clear(); renderGrid(); return renderShelf(); }
    if (t.closest("#fMine")) { state.mine = !state.mine; $("#fMine").setAttribute("aria-pressed", String(state.mine)); state.limit = PAGE; return renderShelf(); }
    const term = t.closest("#fTerm button");
    if (term) { state.term = term.dataset.term; for (const b of document.querySelectorAll("#fTerm button")) b.setAttribute("aria-pressed", String(b === term)); return renderShelf(); }
    if (t.closest("#mkMore")) { state.limit += PAGE; return renderShelf(); }
    if (t.closest("#toSlot")) { const s = dlgBody.querySelector("input[name=stock]:checked"); return openSlot(dlgBody.dataset.k, s.value, Number(s.dataset.price), s.dataset.cond); }
    if (t.closest("#backBook")) return openBook(dlgBody.dataset.k);
    if (t.closest("#doReserve")) return reserve();
    const cr = t.closest("[data-cancel-res]"); if (cr) { reservations.splice(Number(cr.dataset.cancelRes), 1); save(LS_RES, reservations); return refreshAll(); }
    const cs = t.closest("[data-cancel-sell]"); if (cs) { sells.splice(Number(cs.dataset.cancelSell), 1); save(LS_SELL, sells); return refreshAll(); }
    const pk = t.closest("[data-pick]"); if (pk) return pickBook(pk.dataset.pick);
    if (t.closest("#sellUnpick")) return pickBook("");
    const cond = t.closest("#sellCond button");
    if (cond) { sell.cond = cond.dataset.cond; for (const b of document.querySelectorAll("#sellCond button")) b.setAttribute("aria-pressed", String(b === cond)); return sellReady(); }
    if (t.closest("#goShelf")) { setTab("buy"); return openBook(t.closest("#goShelf").dataset.k); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "stock") $("#toSlot").disabled = false;
    if (t.name === "rslot") $("#doReserve").disabled = false;
    if (t.name === "sslot") { sell.slot = { id: t.value, label: t.dataset.label }; sellReady(); }
    if (t.id === "fStock") { state.stock = t.checked; renderShelf(); }
    if (t.id === "sellPhoto") {
      $("#sellThumbs").innerHTML = [...t.files].slice(0, 4).map((f) => `<img alt="" src="${URL.createObjectURL(f)}">`).join("");
    }
  });
  let qTimer = 0;
  $("#fQ").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; state.limit = PAGE; renderShelf(); }, 150); });
  $("#sellQ").addEventListener("input", renderPick);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  $("#sellForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("#sellSubmit").disabled) return;
    const k = sell.k;
    sells.push({ k, cond: sell.cond, slot: sell.slot.id, slotLabel: sell.slot.label });
    save(LS_SELL, sells);
    refreshAll();
    $("#sellForm").innerHTML = `<div class="mkStep mkDone">
      <div class="ok"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>申し込みました</h3>
      <dl><dt>本</dt><dd>${esc(byKey.get(k).title)}</dd><dt>状態</dt><dd>${esc(COND[sell.cond])}</dd>
        <dt>持ち込み</dt><dd>${esc(sell.slot.label)}</dd><dt>場所</dt><dd>${esc(PLACE)}</dd></dl>
      <p class="mkHint">棚には「確認中」で並びました。窓口で状態を確かめたら「購入できる」に変わります。買い取り額は持ち込んだときにお伝えします。</p>
      <button type="button" class="mkPrimary" id="goShelf" data-k="${esc(k)}">棚で見る</button></div>`;
  });

  /* ── 起動 ── */
  fetch("/data/market.json").then((r) => r.json()).then((d) => {
    BOOKS = d.books;
    BOOKS.forEach((b, i) => { b._i = i; byKey.set(b.k, b); });
    $("#fMineHint").textContent = hasTT
      ? `時間割の授業で使う教科書は ${BOOKS.filter(isMine).length}冊`
      : "マイページで時間割を作ると、使う教科書がここに出ます";
    if (hasTT && BOOKS.some(isMine)) { state.mine = true; $("#fMine").setAttribute("aria-pressed", "true"); }
    if (matchMedia("(min-width:1024px)").matches) $("#fMore").open = true;
    renderGrid(); renderSuggest();
    $("#sellSlots").innerHTML = slotsHtml("sslot");
    refreshAll();
    setTab(location.hash === "#sell" ? "sell" : "buy");
    const k = new URLSearchParams(location.search).get("k");
    if (k && byKey.has(k)) openBook(k);
  }).catch(() => { $("#mkShelf").innerHTML = `<p class="mkEmpty">棚を読み込めませんでした</p>`; });
})();
