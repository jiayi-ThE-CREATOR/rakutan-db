/* ブラウザに残す状態の、唯一の窓口。
 *
 * app.js と mypage.js の両方がここだけを通す。localStorage を直に触ると
 * 「片方だけ try/catch を忘れる」「鍵の名前がずれる」が必ず起きる。
 *
 * プライベートモードでは getItem/setItem がその場で例外を投げる。
 * だから全部を read()/write() でくるみ、**失敗しても既定値で動き続ける**。
 * 保存できないだけで、その回の操作は画面上では成立させる。
 *
 * 鍵は5つ:
 *   osaka_u_settings … kuchikomi と共用。こちらは faculty / grade だけ触る
 *   rk_onboarded     … 開屏の問診が一度出た印。localStorage（一生に一度）
 *   rk_favorites     … { v:1, ids:{ "<id>": <追加時刻> } }
 *   rk_timetable     … { v:1, aki:{slots,extra}, haru:{slots,extra} }
 *   rk_cal_added     … { v:1, ids:{ "<id>": true } }。外部カレンダーに
 *                      「追加した」とサイト側で覚えているだけの印で、
 *                      実際にGoogle/Outlook/iCal側に追加されたかは確認していない
 *                      （2026-08-27 マイページのカレンダー連携で追加）
 */
(() => {
  const K_SET = "osaka_u_settings";
  const K_ON  = "rk_onboarded";
  const K_FAV = "rk_favorites";
  const K_TT  = "rk_timetable";
  const K_CAL = "rk_cal_added";
  const TERMS = ["haru", "aki"];
  /* localStorage への書き込みが失敗したキーだけを持つメモリ内フォールバック
     （プライベートモードの全滅・quota 枯渇のどちらでも使う）。
     書けなかった値をここに退避し、書けるようになった瞬間に write() が
     自分で片付ける（下記）。だからここに残っているキーは
     「いま localStorage には書けていない」の印でもある。 */
  const memFallback = new Map();

  /* getItem/setItem は非対称に落ちることがある（quota 枯渇は setItem だけが
     QuotaExceededError を投げ、getItem は正常に働く）。この状態を
     「setItem が失敗したら catch する」だけで済ませると、write の失敗を
     memFallback に退避したのに read はそれを見ずに localStorage の
     古い値を返し続け、星を押しても次の描画で元に戻る事故になる
     （final-review.md §2.1）。だから read はまず memFallback を見る。 */
  const read = (k) => {
    if (memFallback.has(k)) return memFallback.get(k);
    try { return localStorage.getItem(k); } catch (e) { return null; }
  };
  const write = (k, v) => {
    try {
      localStorage.setItem(k, v);
      /* delete は省略できない。省略すると、一度でも setItem が落ちて
         退避したキーは、その後 localStorage への書き込みが成功しても
         read() が memFallback を先に見る限り永久に古い退避値を返し続け、
         本物の書き込みが二度と見えなくなる。memFallback は
         「いま書けていないキーだけ」を持つ集合でなければならない。 */
      memFallback.delete(k);
    } catch (e) { memFallback.set(k, v); }
  };
  /* JSON.parse は壊れた値でも投げる。既定値へ落として先へ進む。
     「情報が無い」で止めない ―― 止めると画面が真っ白になる。 */
  const readObj = (k) => {
    const raw = read(k);
    if (!raw) return {};
    try {
      const o = JSON.parse(raw);
      return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  };

  const emptyTerm = () => ({ slots: {}, extra: [] });

  function readTT() {
    const o = readObj(K_TT);
    const out = { v: 1 };
    for (const t of TERMS) {
      const s = o[t];
      out[t] = (s && typeof s === "object")
        ? { slots: (s.slots && typeof s.slots === "object") ? s.slots : {},
            extra: Array.isArray(s.extra) ? s.extra : [] }
        : emptyTerm();
    }
    return out;
  }
  const writeTT = (tt) => write(K_TT, JSON.stringify(tt));
  const term = (t) => (TERMS.includes(t) ? t : "aki");

  window.rkStore = {
    getProfile() {
      const o = readObj(K_SET);
      return { faculty: o.faculty || "", grade: o.grade || "" };
    },
    /* 既存の semester / department には触らない（kuchikomi の領分）。
       だから丸ごと上書きせず、読んでから2つだけ差し替える。 */
    setProfile({ faculty, grade }) {
      const o = readObj(K_SET);
      if (faculty !== undefined) o.faculty = faculty;
      if (grade !== undefined) o.grade = grade;
      write(K_SET, JSON.stringify(o));
    },

    isOnboarded()  { return read(K_ON) === "1"; },
    markOnboarded(){ write(K_ON, "1"); },

    getFavorites() {
      const ids = readObj(K_FAV).ids;
      if (!ids || typeof ids !== "object" || Array.isArray(ids)) return [];
      return Object.keys(ids).sort((a, b) => (ids[b] || 0) - (ids[a] || 0));
    },
    isFavorite(id) {
      const ids = readObj(K_FAV).ids;
      return !!(ids && typeof ids === "object" && !Array.isArray(ids) && ids[id]);
    },
    toggleFavorite(id) {
      const o = readObj(K_FAV);
      const ids = (o.ids && typeof o.ids === "object" && !Array.isArray(o.ids)) ? o.ids : {};
      const now = !ids[id];
      if (now) ids[id] = Date.now(); else delete ids[id];
      write(K_FAV, JSON.stringify({ v: 1, ids }));
      return now;
    },

    getTimetable(t) { return readTT()[term(t)]; },
    setSlot(t, slot, id) {
      const tt = readTT(); tt[term(t)].slots[slot] = id; writeTT(tt);
    },
    clearSlot(t, slot) {
      const tt = readTT(); delete tt[term(t)].slots[slot]; writeTT(tt);
    },
    addExtra(t, id) {
      const tt = readTT(); const e = tt[term(t)].extra;
      if (!e.includes(id)) e.push(id);
      writeTT(tt);
    },
    removeExtra(t, id) {
      const tt = readTT(); const k = term(t);
      tt[k].extra = tt[k].extra.filter((x) => x !== id);
      writeTT(tt);
    },

    isCalAdded(id) {
      const ids = readObj(K_CAL).ids;
      return !!(ids && typeof ids === "object" && !Array.isArray(ids) && ids[id]);
    },
    markCalAdded(id) {
      const o = readObj(K_CAL);
      const ids = (o.ids && typeof o.ids === "object" && !Array.isArray(o.ids)) ? o.ids : {};
      ids[id] = true;
      write(K_CAL, JSON.stringify({ v: 1, ids }));
    },
    unmarkCalAdded(id) {
      const o = readObj(K_CAL);
      const ids = (o.ids && typeof o.ids === "object" && !Array.isArray(o.ids)) ? o.ids : {};
      delete ids[id];
      write(K_CAL, JSON.stringify({ v: 1, ids }));
    },
  };
})();
