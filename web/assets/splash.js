/* ラクハン オープニング演出
 *
 * ロゴは元から2本の SVG stroke path なので、筆順どおりに書き出せる。
 * 外部ライブラリは使わない。自分たちのブランド資産をそのまま動かすので、
 * 既製テンプレートを当てたような感じにならない。
 *
 * 守っていること：
 *  1. データ取得を待たせない。app.js の読み込みはこれと並行に走る。
 *     演出は courses.built.json（1.6MB / gzip 83KB）の
 *     もともとある待ち時間を覆うものであって、待ちを増やすものではない。
 *  2. 再訪では流さない。履修登録の時期は1日に何度も開く。
 *     毎回1.4秒止められるのは、道具としては邪魔でしかない。
 *  3. prefers-reduced-motion では完全にスキップする。
 *  4. 覆いの下のページはすでに描画ずみ。DOM もスクリーンリーダーも塞がない。
 *  5. クリックと Esc でいつでも飛ばせる。待たされるのが嫌な人を人質にしない。
 */
(() => {
  const KEY = "rk_splash_at";
  const AGAIN_AFTER = 24 * 60 * 60 * 1000;   // 24時間

  const el = document.getElementById("splash");
  if (!el) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let last = 0;
  try { last = Number(localStorage.getItem(KEY) || 0); } catch (e) { last = 0; }
  const fresh = Date.now() - last > AGAIN_AFTER;

  if (reduced || !fresh){
    document.documentElement.classList.add("splash-skip");
    return;
  }
  try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* 無視 */ }

  el.hidden = false;
  document.documentElement.classList.add("splash-on");

  // 筆の長さを測って dashoffset の初期値にする。
  // 決め打ちの数字にすると、パスを直したとき静かに壊れる。
  el.querySelectorAll(".splashMark path").forEach(p => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
  });

  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("run")));

  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    el.classList.add("out");
    const end = () => {
      el.hidden = true;
      document.documentElement.classList.remove("splash-on");
      document.documentElement.classList.add("splash-skip");
    };
    el.addEventListener("transitionend", end, { once: true });
    // タブが裏に回るとアニメーションもトランジションも走らないことがある。
    // その場合でも覆いが残らないよう、時間で必ず片付ける。
    setTimeout(end, 600);
  };

  setTimeout(done, 1400);
  el.addEventListener("click", done);
  window.addEventListener("keydown", e => { if (e.key === "Escape") done(); });

  window.rkSplash = { skip: done };
})();
