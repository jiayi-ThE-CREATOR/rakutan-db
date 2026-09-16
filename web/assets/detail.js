/* 科目の「詳細」を組み立てるところ。一覧（app.js）とマイページ（mypage.js）が
 * **同じこの1本**を呼ぶ（2026-09-16 に app.js から切り出した）。
 *
 * なぜ分けたか
 * ────────────
 * マイページの時間割のコマを押したとき、一覧ページへ飛ばずにその場で詳細を
 * 出したい（本人の依頼）。app.js は #list のあるページでしか動かないので
 * マイページからは読めず、かといって同じ組み立てをもう1本書くと
 * **正本が2つになる** ―― 片方だけ直した日から、一覧とマイページで違う詳細が出る。
 * score.py を JS に移植しなかったのと同じ理由（app.js の「データ層」の注記）。
 *
 * ここに入れていいのは「科目1件を受け取って HTML の文字列を返す」だけの関数。
 * DOM も、絞り込みの状態（state）も、fetch も持たせないこと ―― 持たせた瞬間に
 * 読み込む側（app.js / mypage.js）のどちらかでしか動かないものになる。
 *
 * 読み込む順番: どちらのページでも **app.js / mypage.js より先**に置く
 * （index.html と mypage.html の <script> を参照）。両方 defer なので
 * 書いた順に実行される。
 */
(() => {

/* app.js・mypage.js と同じ書き方。科目名も評価方法名も KOAN 由来の
   外部文字列なので必ず通す。 */
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[ch]));

/* 成績評価の内訳（KOANシラバスの生の%）を積み上げバーで見せる（2026-09-05）。
 *
 * 出すのは **KOAN のシラバスの成績評価テーブルの行そのもの**（`eval_raw`）。
 * 文言も数字も並び順もシラバスのまま。こちらで種類にまとめ直したり、
 * 名前を付け替えたりしない（本人判断・2026-09-07）。
 *
 * なぜ eval_ratio（4区分に振り分けた値）を出さないか
 * ──────────────────────────────────────────────
 * 振り分けは採点のための都合であって、学生が見るべき事実ではない。
 * 実害が出ていた：
 *   ・`発表` は scrape/parse.py で report に入るので、
 *     「学習への参加度20% ＋ 発表80%」の科目が「レポート 80%」と出ていた。
 *     レポートは1本も無い。同じ形の科目が 1,363件（全7,906件で実測）
 *   ・`期末レポート` `期末課題` は試験ルールの裸の「期末」に当たるので
 *     「期末テスト」として出ていた（延べ172箇所）
 *   ・振り分けられなかった項目（723箇所・507科目）は灰色の「不明」に消えていた。
 *     中央値で35%の配点が名前ごと消えていたことになる
 * シラバスの行をそのまま出せば、この3つは同時に起きなくなる。
 *
 * **採点・つまみ・条件チップは今までどおり eval_ratio（4区分）を見る。**
 * 画面のこの部分だけがシラバス直写しになった。片方を直すときにもう片方が
 * 一緒に動くことは無いので、食い違って見えたらまずここを疑うこと。
 *
 * 色は種類ではなく**並び順**（--comp-1〜5）。KOAN の表は最大5列なので5色で足りる。
 * 同じ「レポート」でも科目によって色が違うが、凡例が隣にあるので困らない。 */

/* シラバスの表に「ここには書いていない」とだけ書かれている行（実測15種類・60箇所）。
 * 例：`補足情報を参照 100%`、`下記評価基準 100%`、`英文シラバスをご参照ください。100%`。
 *
 * **文言と数字はシラバスのまま出す**（この欄の原則）が、色だけ灰色にする。
 * 評価の成分と同じ色で塗ると「補足情報を参照という科目が成績の100%」に見えるため。
 * 灰色は「記載なし」と同じ役割の色 ―― 中身が分かっていない、の意味。
 *
 * 🚨 「その他（レポート、課題提出、…）」のような**中身を並べている行は成分**なので
 *    ここに入れない。実データで似た21種類（`その他の課題`『出席カードへのふり返り記入』
 *    など）を目視で分けた。増やすときは全1,134種類に当てて誤爆を見ること。
 *
 * 本当の配点はシラバス本文の「成績評価に関する補足情報」に書かれていることが多い。
 * KOAN の生HTMLを取り込めば埋められる（HANDOFF 参照）。それまでは灰色で出す。 */
const EVAL_POINTER =
  /^(下記|以下)|補足情報|ご参照ください|^各担当教員が判定$|^総合的に判断$|^講義と合わせて成績評価を行う$|^（その他の場合ここに記入）$/;

/* シラバス本文の「成績評価に関する補足情報」。表が使いものにならないときだけ出す。
 *
 * KOAN の成績評価テーブルは教員が埋めないことがある。実測（全7,906件）で
 * 表が空59件・「補足情報を参照」等だけ50件・合計が100%に届かない18件。
 * この137件の生HTMLを取り直したところ、**107件はこの欄に配点が書かれていた**
 * （うち63件は数字入り）。例：人文地理学演習は表が空で、補足情報に
 * 「授業で指示する課題類（80％）と授業での議論への貢献度（20％）で評価します。」
 *
 * **文章のまま出す。** ％を機械で拾って帯に足すことはしない ――
 * 「小課題3回（各20点）」のような書き方が混ざっていて、拾い方を決めた時点で
 * シラバスに無い解釈を足すことになる。帯はあくまで表の写し。 */
const evalNoteHtml = c => c.eval_note
  ? `<div class="compNote">シラバスの補足情報：${esc(c.eval_note)}</div>` : "";

function evalCompHtml(c){
  const raw = c.eval_raw;
  const rows = raw ? Object.entries(raw) : [];
  if (!rows.length)
    return evalNoteHtml(c) ||
      `<div class="compNote">評価方法の内訳はKOANから取得できていません。下の「KOAN公式シラバスを見る」で確認してください。</div>`;

  /* シラバスの表が100%に届いていない科目が18件ある（例：有機化学3は
     中間試験30% ＋ 期末試験40% で70%）。残りを他の行へ按分すると
     シラバスに無い数字を出すことになるので、「記載なし」として灰色で置く。 */
  const known = rows.reduce((sum, [, v]) => sum + (v || 0), 0);
  const gap = Math.max(0, Math.round((100 - known) * 10) / 10);
  const hasGap = gap >= 1;

  /* 本文に「毎回小テスト」とあるのに、成績評価の表には小テストの行が無い科目。
     表に無いものを表へ足すことはしないので、注記として別に出す。 */
  const quizNoRow = c.weekly_quiz &&
    !rows.some(([k]) => /小テスト|クイズ|quiz/i.test(k));

  /* 案内文の行は灰色。色の順番（--comp-1〜5）は成分の行だけで数えるので、
     案内文が混ざっても成分どうしの色がずれない。 */
  const pointers = rows.filter(([k]) => EVAL_POINTER.test(k));
  let seq = 0;
  const colorOf = k => EVAL_POINTER.test(k) ? "var(--comp-gap)"
                                            : `var(--comp-${(seq++ % 5) + 1})`;
  const colors = new Map(rows.map(([k]) => [k, colorOf(k)]));

  const dot = v => `<i class="compDot" style="background:${v}"></i>`;
  return `<div class="compBar">
      ${rows.filter(([, v]) => v > 0).map(([k, v]) =>
        `<div class="compSeg" style="width:${v}%;background:${colors.get(k)}"></div>`).join("")}
      ${hasGap ? `<div class="compSeg" style="width:${gap}%;background:var(--comp-gap)"></div>` : ""}
    </div>
    <div class="compLegend">
      ${rows.map(([k, v]) => `<span>${dot(colors.get(k))}${esc(k)}<b>${v}%</b></span>`).join("")}
      ${hasGap ? `<span>${dot("var(--comp-gap)")}記載なし<b>${gap}%</b></span>` : ""}
    </div>
    ${pointers.length ? (evalNoteHtml(c) ||
        `<div class="compNote">シラバスの成績評価の表には「${esc(pointers[0][0])}」とだけ書かれていて、内訳が分かりません。下の「KOAN公式シラバスを見る」で確認してください</div>`) : ""}
    ${quizNoRow ? `<div class="compNote">シラバス本文に「毎回小テスト」の記載がありますが、成績評価の表には配点がありません</div>` : ""}
    ${hasGap ? `<div class="compNote">シラバスの成績評価の表が${known}%ぶんしか埋まっていません。下の「KOAN公式シラバスを見る」で確認してください</div>` : ""}
    ${hasGap && !pointers.length ? evalNoteHtml(c) : ""}`;
}

/* 全学教育科目のシラバス公式ページ。時間割コード（c.id）だけ差し替える。
   セッション不要で開ける形式（政岡さんが 2026-08-20 に3件で確認）。
   j_s_cd=13 固定＝共通教育科目。
   実装は松下さん（PR #23）。作り直しで構造が変わったので、
   同じものを app.js へ移した（2026-08-24）。 */
// j_s_cd（所属コード）は科目ごとに違う（全学教育推進機構は13だが他学部は別値）。
// courses.built.json の shozoku_cd を使う。無ければ13にフォールバック
// （2026-08-26以前にビルドされた古いデータ・shozoku_cd未収集の科目向け。
// その場合、全学教育推進機構以外の科目はリンクが無効になりうる）。
const koanUrl = c => `https://koan.osaka-u.ac.jp/campusweb/campussquare.do?_flowId=SYW4201600-flow&nendo=2026&j_s_cd=${encodeURIComponent(c.shozoku_cd || "13")}&j_cd=${encodeURIComponent(c.id)}&langkbn=j`;

/* ── 口コミの中身 ─────────────────────
   数字だけ出しても「なぜ楽なのか」は伝わらない。件数・内訳・一言をまとめて出す。
   値は build.py が焼いた集計（複数件なら平均）。一言は publish:false のものを
   除いたぶんだけ入っている ―― 本文を止めても件数と数値は残るので、
   ここの n と一言の数は一致しないことがある。 */
const RV_ATT = ["なし", "たまに", "毎回"];
const RV_LV  = ["軽い", "ふつう", "重い"];
const rvLv = v => (v === null || v === undefined) ? "―" : RV_LV[Math.round(v)];

/* 集計はラベルではなく数字で出す（2026-08-24）。
 *
 * ラベルにすると、**誰も答えていない選択肢を「みんなの答え」として出す**。
 * 実データ 135093 は「なし」と「毎回」の2件で、平均 1.0 を RV_ATT に
 * 通すと「たまに」になる ―― そう答えた人は1人もいない。
 * 数字なら「0 と 2 を平均した 1.0」と読めるので、嘘にならない。
 *
 * 目盛りは元の 0〜2 のまま。1〜5 のような別の幅に引き伸ばすと、
 * 3択で集めたものに無い精度を足すことになる。凡例を横に添えて補う。
 *
 * 1件ずつ（panelEntry）は逆にラベルのまま ―― あちらは平均ではなく
 * 「その人がそう答えた」なので、ラベルが正確。
 */
const rvAvg = v => (v === null || v === undefined) ? "―" : `${v.toFixed(1)} / 2`;

/* 口コミの集計。モーダルの先頭に出す。
   一言3件（.rvn）は廃止した ―― モーダルに全件が1件ずつ出るので重複になる。
   値を <b> で包むのは、ラベルより数字を大きくするため（CSS 側で効かせる）。 */
function reviewHtml(c){
  const r = c.reviews;
  if (!r || !r.n) return "";
  const f = [["出席", rvAvg(r.attendance)],
             ["授業中の課題", rvAvg(r.in_class)],
             ["授業外の課題", rvAvg(r.out_class)]];
  if (r.exam_hard10 != null) f.push(["テストの難易度", `${r.exam_hard10} / 10`]);
  /* 「その他（持ち帰り形式）」等は 可／不可 に畳むと情報が落ちるので、
     畳んだ値に原文を添えて出す ―― 「可（持ち帰り形式）」。 */
  if (r.exam_bring){
    const m = (r.exam_bring_raw || "").match(/^その他[（(](.+)[）)]$/);
    f.push(["持ち込み", m ? `${r.exam_bring}（${m[1]}）` : r.exam_bring]);
  }
  if (r.report_words)        f.push(["レポート", `1本あたり約${r.report_words.toLocaleString()}字`]);
  /* 全幅にする条件は2つ。どちらも実データ・実測から引いた（2026-09-07）。
     ・値が長い ―― 数値側の最長「2.0 / 2」＝7文字と、持ち込みの括弧つき最短
       「可（オンライン）」＝8文字のあいだに境界を置く。
     ・ラベルが長い ―― 390px では半幅セルが 159px しかなく、ラベルは6文字までしか
       1行に収まらない（「授業中の課題」＝6文字は 21px の1行、
       「テストの難易度」＝7文字は 42px の2行になる。実測）。
       ラベルは固定文字列なので、値の長さでは拾えない。 */
  const cell = ([k, v]) =>
    `<span${(String(v).length > 7 || k.length > 6) ? ` class="w"` : ""}><i>${esc(k)}</i><b>${esc(v)}</b></span>`;
  return `<div class="rv">
      <div class="rvf">${f.map(cell).join("")}</div>
      <span class="bandNote">数字は${r.n}件の平均。出席は 0 なし〜2 毎回、課題は 0 軽い〜2 重い${
        r.conflicts?.length ? "。<b>答えが割れている項目があります</b>ので、下の1件ずつを読んでください" : ""}</span>
    </div>`;
}

function detailHtml(c){
  /* ── 詳細の並び（2026-09-10・口コミの集計を詳細にも出す）──────────
   *
   *   ── 成績評価の内訳  KOANの%を積み上げバーで
   *   ── 口コミ         集計（reviewHtml）＋本人の一言を1件だけ
   *   ── KOAN リンク
   *
   * 「読む・書く」ボタンと「時間割に追加」は一覧カードの操作バー（.cardActs）に
   * 残したまま ―― 2026-09-07 の判断（同じ操作を画面に2つ並べない）は変えない。
   * ただし wang から、モーダルを開かなくても集計数字（出席・課題・テストの
   * 難易度など）がここで見えてほしいと依頼があった（Discord 2026-09-10）。
   * reviewHtml() はモーダル（#panelBody）用に作った関数をそのまま再利用 ――
   * 集計の中身を二重に持たないため。一言は「一部だけでいい」との依頼どおり
   * 1件のみ、cardActsHtml と同じ notes[0] を出す（全件は N件を読む→で）。
   * 一言は .pNote ではなく専用の .dQuote で出す ―― .pNote はモーダルの
   * 1件ずつ表示（panelEntry）と共有のクラスなので、ここだけ吹き出し風に
   * 変えると影響範囲がモーダル側にも及んでしまう（2026-09-10、Claude Design
   * で4案作り松下さんが「そっと囲む」案を選定）。
   *
   * 元は score.py が計算した5軸の「重さ」スコアをバーで見せていたが、
   * 松下さんの依頼で「KOANシラバスに書かれている成績評価の生の%」に置き換えた
   * （2026-09-05）。担当教員の行と信頼度の注記は wang の依頼で削除（2026-09-06）。
   *
   * .dSec 自体は app.css に固有のスタイルを持たない（レイアウトは中の
   * .secH/.compBar 側が持つ）が、クラス名として消さないこと ――
   * tools/test_favorite.mjs が `.detail .dSec` を「詳細が描画された」の
   * 目印として待っている（2026-09-07）。 */
  const rn = c.reviews?.n || 0;
  const first = (c.reviews?.notes || [])[0] || "";
  return `<div class="dSec">
        <div class="secH">成績評価の内訳</div>
        ${evalCompHtml(c)}
      </div>
      ${rn ? `<div class="dSec">
        <div class="secH">口コミ <b>${rn}件</b></div>
        ${reviewHtml(c)}
        ${first ? `<p class="dQuote">${esc(first)}</p>` : ""}
      </div>` : ""}
      <div class="dActs">
        <a class="koanLink" href="${esc(koanUrl(c))}" target="_blank" rel="noopener noreferrer">この科目のKOAN公式シラバスを見る ↗</a>
      </div>`;
}

/* 呼ぶ側（app.js / mypage.js）に渡すのはこれだけ。
   app.js は rvLv・RV_ATT も使う（口コミを1件ずつ出す panelEntry）ので出しておく。 */
window.rkDetail = {
  detailHtml, reviewHtml, evalCompHtml, evalNoteHtml, koanUrl,
  RV_ATT, rvLv, rvAvg,
};

})();
