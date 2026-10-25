/* 全ページ共通の外殻の動き。
 *
 * app.js はワークベンチ（一覧・絞り込み・詳細）専用で、
 * #list が無いページで読み込むと途中で落ちる。
 * ページをまたいで要るものはこちらへ置き、About のような
 * 一覧を持たないページは、このファイルだけを読む。
 */
(() => {
  /* ナビの現在地。ページを分けた以上、どこにいるか分からないのは事故。 */
  const here = location.pathname.replace(/\/$/, "") || "/";
  const key = (here === "/" || here === "/index.html") ? "home"
            : here.startsWith("/ads") ? "ads"
            : here.startsWith("/about") ? "about"
            : here.startsWith("/mypage") ? "mypage"
            : here.startsWith("/kuchikomi") ? "kuchikomi" : null;
  if (!key) return;
  /* マイページはナビの外（ヘッダ右端の .hdMy）に出したので、
     .nav 配下だけを見ると /mypage で現在地が付かなくなる。header 全体から探す。 */
  const el = document.querySelector(`header [data-nav="${key}"]`);
  if (el) el.setAttribute("aria-current", "page");
})();
