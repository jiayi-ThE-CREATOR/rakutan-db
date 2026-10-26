/* About ページ「ラクハンの強み」の画像カルーセル。
 * 動きの土台はネイティブの横スクロール + scroll-snap（about.css側）。
 * ここでは矢印・ドットからの操作と、スクロール位置に合わせた
 * ドット・矢印の状態更新だけをやる。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const track = $("strTrack");
  const prev = $("strPrev");
  const next = $("strNext");
  const dotsWrap = $("strDots");
  if (!track || !prev || !next || !dotsWrap) return;

  const slides = track.querySelectorAll(".strSlide");
  const dots = dotsWrap.querySelectorAll(".strDot");
  if (!slides.length) return;

  function current() {
    return Math.round(track.scrollLeft / track.clientWidth);
  }

  function goTo(i) {
    const c = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: c * track.clientWidth, behavior: "smooth" });
  }

  function sync() {
    const i = Math.max(0, Math.min(slides.length - 1, current()));
    dots.forEach((d, j) => d.classList.toggle("on", j === i));
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
  }

  prev.addEventListener("click", () => goTo(current() - 1));
  next.addEventListener("click", () => goTo(current() + 1));
  dots.forEach((d, i) => d.addEventListener("click", () => goTo(i)));

  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goTo(current() + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(current() - 1); }
  });

  // scroll イベントは連発するので、rAF で間引いて反映する。
  let ticking = false;
  track.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { sync(); ticking = false; });
  }, { passive: true });

  window.addEventListener("resize", sync);

  sync();
})();

/* #data・#userdata は「くわしく知りたい人へ」の中に畳んである（2026-10-25）。
   外からそこへ飛んできた人に閉じたままの見出しだけ見せないよう、開いてから寄せる。 */
(() => {
  const openTarget = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (el && el.tagName === "DETAILS" && !el.open){ el.open = true; el.scrollIntoView(); }
  };
  openTarget();
  window.addEventListener("hashchange", openTarget);
})();
