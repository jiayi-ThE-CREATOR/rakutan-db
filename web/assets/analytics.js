/* 計測の入口。「誰を数えるか」を決める唯一の場所。
 *
 * ■ なぜ beacon のタグを直に置かず、この1枚を挟むのか
 *
 * 1. 自分たちを数から外す窓口が要る。
 *    協賛の話で出す数字に、開発中の自分の再読み込みが混ざっていると、
 *    その数字は説明できない。Cloudflare 側にも「このパスは計測しない」
 *    という Rules があるが、**あれは Cloudflare にDNSを向けた
 *    サイトだけの機能**で、ラクハンの独自ドメインは nginx（VPS）から
 *    Worker へ中継している＝向けていない。だから除外はこちら側で持つしかない。
 *
 * 2. beacon のタグが6ページに複製されていた。
 *    トークンを差し替える日が来たとき、5ページ直して1ページ忘れる形だった。
 *    正本をこのファイル1つにする（ページ側は読み込むだけ）。
 *
 * ■ チームに配る URL（1人1回・ブラウザごと）
 *
 *    https://rakuhan.nocode-sol.co.jp/?nostats=1   … 以後この端末を数えない
 *    https://rakuhan.nocode-sol.co.jp/?nostats=0   … 数に戻す
 *
 *   押したことが画面に出る（帯を4秒）。出ないと、やったつもりの人が残る。
 *   印は localStorage なので **ブラウザごと・端末ごとに1回ずつ**必要で、
 *   シークレットウィンドウには残らない。ここは仕様として諦める
 *   ―― 端末を特定して覚える仕組みは、計測を減らすために作るには重すぎる。
 *
 * ■ store.js を通していない理由
 *   store.js は index.html と mypage.html にしか載っていない。計測は6ページ
 *   全部に載る。読み込み順の前後で計測が消える方が事故なので、ここだけは
 *   localStorage を直に触る。鍵は rk_nostats ひとつだけに留めること。
 */
(() => {
  const KEY = "rk_nostats";
  // Cloudflare Web Analytics のサイトトークン。公開されている値（HTML に出る）。
  const TOKEN = "b0324782e4e44ca58b45e4dd0c270112";

  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const write = () => { try { localStorage.setItem(KEY, "1"); } catch (e) {} };
  const drop  = () => { try { localStorage.removeItem(KEY); } catch (e) {} };

  /* 効いたことを本人に見せる。チームの半分はコードを読まない人なので、
     console.log では「やったつもり」が残る。 */
  function notice(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;" +
      "max-width:90vw;padding:10px 16px;border-radius:8px;font-size:14px;line-height:1.4;" +
      "background:var(--ink,#16181d);color:var(--on-dark,#fff);box-shadow:0 2px 8px rgba(0,0,0,.24)";
    const put = () => { document.body.appendChild(el); setTimeout(() => el.remove(), 4000); };
    if (document.body) put();
    else document.addEventListener("DOMContentLoaded", put, { once: true });
  }

  const param = new URL(location.href).searchParams.get("nostats");
  if (param === "1") { write(); notice("この端末を計測から外しました"); }
  else if (param === "0") { drop(); notice("この端末を計測に戻しました"); }

  // 除外された端末は、ここで打ち切る。beacon そのものを読み込まない
  // ―― 読み込んでから捨てるのでは、Cloudflare 側に数が残る。
  if (read() === "1") return;

  const s = document.createElement("script");
  /* type="module" は Cloudflare の指定。IE など古いブラウザが
     beacon の構文で落ちるのを防ぐためで、機能上の意味は無い。
     トークンは data-cf-beacon 属性ではなくクエリで渡す
     ―― 動的に足したタグでも確実に読まれる、公式の書き方（タグマネージャ向け）。 */
  s.type = "module";
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js?token=" + TOKEN;
  document.head.appendChild(s);
})();
