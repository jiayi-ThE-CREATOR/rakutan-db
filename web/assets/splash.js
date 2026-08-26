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
  /* いつ流すか（2026-08-23 変更）
   *
   * 「タブを閉じて開き直したら、また見たい」という要望。
   * 以前は localStorage に時刻を持って24時間に1回だったが、
   * それだと同じ日に開き直しても流れなかった。
   *
   * sessionStorage はタブを閉じると消える。つまり
   *   閉じて開き直す・新しい窓・新しい訪問者 → 流れる
   *   About から戻ってきた・リロード          → 流れない
   * 後者を拾わないのは意図的。ここは複数ページのサイトなので、
   * / と /about を行き来するたびに 1.4秒 止められては道具にならない。
   */
  const KEY = "rk_splash_seen";

  const el = document.getElementById("splash");
  if (!el) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let seen = false;
  try { seen = sessionStorage.getItem(KEY) === "1"; } catch (e) { seen = false; }

  if (reduced || seen){
    document.documentElement.classList.add("splash-skip");
    // 演出を流さないので、この時点でもう「終わっている」。
    // onboard.js はまだ読み込まれていないので、イベントだけでは届かない。
    // あとから聞けるように rkSplash も置く（skip は何もしない関数）。
    window.rkSplash = { skip(){}, done: () => true };
    window.dispatchEvent(new CustomEvent("rk:splash-done"));
    return;
  }
  try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* 無視 */ }

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
      window.dispatchEvent(new CustomEvent("rk:splash-done"));
    };
    el.addEventListener("transitionend", end, { once: true });
    // タブが裏に回るとアニメーションもトランジションも走らないことがある。
    // その場合でも覆いが残らないよう、時間で必ず片付ける。
    setTimeout(end, 600);
  };

  setTimeout(done, 1400);
  el.addEventListener("click", done);
  window.addEventListener("keydown", e => { if (e.key === "Escape") done(); });

  window.rkSplash = { skip: done, done: () => finished };
})();
