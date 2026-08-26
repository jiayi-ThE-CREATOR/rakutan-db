/* 開屏の問診。
 *
 * 守っていること：
 *  1. **一生に一度だけ出す。** 門は localStorage の rk_onboarded。
 *     splash が sessionStorage なのは「閉じて開き直したらまた見たい」から。
 *     問診は逆で、履修登録期に1日何度も開く学生を毎回止めてはいけない。
 *  2. **降りるのは問診そのものであって、設問ごとではない。**
 *     最初のカードで [そのまま使う] を押したら1問も聞かない。
 *     設問に入ったら学部と学年は両方答える。
 *  3. **演出とデータの両方が揃ってから出す。** 演出は1.4秒で終わるが
 *     courses.built.json はもっと掛かることがある。先に出すと、
 *     答えた瞬間に反映するものがまだ無い。
 *  4. 学部の一覧をここに持たない。正本は requirements.json。
 */
(() => {
  if (rkStore.isOnboarded()) return;

  let splashDone = !!(window.rkSplash && window.rkSplash.done && window.rkSplash.done());
  let appReady = false;
  window.addEventListener("rk:splash-done", () => { splashDone = true; maybeShow(); });
  window.addEventListener("rk:app-ready",   () => { appReady = true;   maybeShow(); });

  let shown = false;
  let el = null;
  const answer = { faculty: "", grade: "" };

  function maybeShow(){
    if (shown || !splashDone || !appReady) return;
    shown = true;
    build();
    step("gate");
  }

  function build(){
    el = document.createElement("div");
    el.className = "onboard";
    el.id = "onboard";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="onboardInner">
      <div class="onboardCard" data-card="gate">
        <h2>学部と学年を教えてもらえますか</h2>
        <p>あなたが履修できる科目だけを出せます。答えなくてもすべての機能が使えます。</p>
        <div class="onboardBtns">
          <button id="onboardStart" class="primary">教える</button>
          <button id="onboardSkip">そのまま使う</button>
        </div>
      </div>
      <div class="onboardCard" data-card="faculty">
        <h2>学部はどれですか</h2>
        <div class="onboardOpts" id="onboardFaculties"></div>
      </div>
      <div class="onboardCard" data-card="grade">
        <h2>いま何年生ですか</h2>
        <div class="onboardOpts" id="onboardGrades"></div>
      </div>
    </div>`;
    document.body.appendChild(el);

    /* 学部の一覧は requirements.json が正本。app.js が読んだものを借りる。 */
    const facs = (window.REQ && window.REQ.faculties) || [];
    document.getElementById("onboardFaculties").innerHTML = facs.map(f =>
      `<button data-faculty="${f.key}">${f.label}</button>`).join("");
    document.getElementById("onboardGrades").innerHTML = [1,2,3,4,5,6].map(g =>
      `<button data-grade="${g}">${g}年</button>`).join("");

    document.getElementById("onboardSkip").onclick = () => finish(false);
    document.getElementById("onboardStart").onclick = () => {
      /* カードは data-step の CSS 切り替えで隠すだけで DOM には残る
         （このあと戻る操作が無いので消していい）。「答えたくない」を
         設問側に残さないため、gate を離れる瞬間に取り除く。
         残したままだと #onboardSkip は #onboard の子孫であり続け、
         「設問の中に居ない」を data-step だけでは表せない。 */
      document.getElementById("onboardSkip").remove();
      step("faculty");
    };
    el.querySelectorAll("[data-faculty]").forEach(b => b.onclick = () => {
      answer.faculty = b.dataset.faculty; step("grade");
    });
    el.querySelectorAll("[data-grade]").forEach(b => b.onclick = () => {
      answer.grade = b.dataset.grade; finish(true);
    });
  }

  function step(name){
    el.dataset.step = name;
    const card = el.querySelector(`[data-card="${name}"]`);
    const first = card && card.querySelector("button");
    if (first) first.focus();
  }

  function finish(answered){
    rkStore.markOnboarded();
    if (answered){
      rkStore.setProfile({ faculty: answer.faculty, grade: answer.grade });
      window.dispatchEvent(new CustomEvent("rk:profile-set", { detail: { ...answer } }));
    }
    el.remove();
  }
})();
