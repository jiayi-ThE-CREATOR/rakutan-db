/* バージョン＆最新機能 ―― 右下の入口 → <dialog> で更新履歴を出す
 *
 * ★ 新しい版を出したときに触るのは、下の RELEASES の先頭に1件足すことだけ。
 *   ここが版の唯一の正本で、右下のバッジに出る番号も、
 *   ダイアログの中身も、全部この配列から作る。2か所に書かない。
 *
 *   date    "YYYY-MM-DD"（画面には 2026.8.26 の形で出す）
 *   version "1.2" / "1.2.1"（画面には v1.2。右下のバッジにも出る）
 *           MAJOR.MINOR.PATCH の三段。付け方は下の「版番号の付け方」
 *   title   その版を一言で
 *   items   [{ tag: "new" | "improve" | "fix", text: "…" }]
 *           new=新機能 / improve=改善 / fix=修正。この3つ以外を書くと「更新」と出る
 *
 * ── 版番号の付け方 ─────────────────────────
 *   MAJOR  サイトの性格が変わる大改版。人が決める。AI からは提案しない
 *   MINOR  そのぶんに新機能（tag:"new"）が1件でも入っている  1.1 → 1.2
 *   PATCH  改善・修正・データ更新だけ（new が1件も無い）      1.2 → 1.2.1
 *
 *   例）v1.1.1 は 9/02 のデータ更新。new が無いので PATCH。
 *   ※ 過去の版の番号は原則いじらない。書き換えると localStorage の
 *     rakuhan.seenVersion と食い違い、既読の人にもう一度オレンジの点が出る
 *
 * ── いつ出すか ─────────────────────────────
 *   2026年10月から毎週水曜にまとめて出す。その週に載せるものが
 *   1件も無ければ版を切らない（空の版は出さない）。
 *   載せる／載せないの判定は CLAUDE.md「版に載せるかの判定」。
 *   決まった文案は docs/version-pending.md に貯め、水曜にここへ移して空にする
 *
 *   ・新しいものを上に。並べ替えはしないので、順番はこの配列のまま出る
 *   ・利用者が読むところなので、内部の言い方（リファクタ・CI）は書かない。
 *     「その人の画面で何が変わったか」だけを書く
 *
 * app.js（科目一覧）とは独立して動く。about や ads にも同じものが出るので、
 * 一覧のデータや DATA グローバルには触らないこと。
 */
(() => {
  const RELEASES = [
    {
      date: "2026-09-02",
      version: "1.1.1",
      title: "科目データを最新の時間割に更新",
      items: [
        { tag: "improve", text: "KOAN の時間割が更新されていたので取り直しました。科目は 7,877件 → 7,906件。外国語学部が 24件、マルチリンガルが 5件、理学部が 2件、文学部が 1件ふえています" },
        { tag: "fix", text: "大学側で取り下げられた 3件を外しました。お気に入りや「私の時間割」に入れていた場合は、その科目だけ表示されなくなります" },
      ],
    },
    {
      date: "2026-08-31",
      version: "1.1",
      title: "マイページと「私の時間割」",
      items: [
        { tag: "new", text: "マイページを足しました。学部・学年を覚えるので、来るたびに選び直さなくて済みます" },
        { tag: "new", text: "気になる科目に★。お気に入りはマイページからまとめて見られます" },
        { tag: "new", text: "「私の時間割」。曜限のマスに科目を入れて、自分の埋まっているコマを残せます" },
        { tag: "new", text: "時間割をスマホのカレンダーへ連携（1件ずつ・まとめて追加・削除）。祝日と大学行事の休講日、振替授業日は公式の学年暦に合わせています" },
        { tag: "new", text: "最初に学部と学年をたずねる画面。答えると絞り込みの初期値になります（飛ばせます）" },
        { tag: "new", text: "LINE で答えた学部・学年をサイトへ引き継ぎ、同じことを二度聞かないようにしました" },
        { tag: "new", text: "フッタにラクハン公式の X・Instagram・LINE" },
        { tag: "improve", text: "ダークモードの読みにくかった文字、セレクトの見た目、PC で右カラムがはみ出す不具合を直しました" },
        { tag: "fix", text: "学科・専攻を持たない学部を選ぶと、前の学部の専攻の選択が残っていたのを直しました" },
      ],
    },
    {
      date: "2026-08-26",
      version: "1.0",
      title: "ラクハン 公開",
      items: [
        { tag: "new", text: "阪大 全学部の科目 7,877件を、シラバスの成績評価の内訳から 試験・レポート・出席・規模 の4軸で表示。登録もログインも要りません" },
        { tag: "new", text: "空きコマ（曜限）から探せる時間割グリッド。「火3が空いてる、何取ろう」から始められます" },
        { tag: "new", text: "「あなたの優先度」のスライダーとプリセットで、相性順に並べ替え" },
        { tag: "new", text: "学部・学科・学年・学期・科目区分でしぼりこみ。学年を選ぶと履修できない科目を外します" },
        { tag: "new", text: "口コミの投稿をサイトに取り込みました。選択式3問＋一言、1分もかかりません" },
        { tag: "new", text: "科目ごとの共有リンク。開いている画面のURLをそのまま友だちに渡せます" },
        { tag: "new", text: "LINE 公式アカウントから、検索とおすすめが受け取れます" },
        { tag: "improve", text: "一番重い軸が測れていない科目には総合値を出さず「情報不足」と表示。数字には信頼度を添えています" },
        { tag: "improve", text: "スマホのヘッダをロゴ行とメニュー行の2段に組み直して、画面を広く使えるようにしました" },
      ],
    },
  ];

  const TAGS = { new: "新機能", improve: "改善", fix: "修正" };
  const SEEN_KEY = "rakuhan.seenVersion";

  const $ = (id) => document.getElementById(id);
  const fab = $("verFab");
  const dlg = $("verDlg");
  const list = $("verList");
  if (!fab || !dlg || !list || RELEASES.length === 0) return;

  const latest = RELEASES[0];

  /* 2026-08-26 → 2026.8.26。0埋めしないのは、リリース告知の書き方に合わせるため。 */
  const fmt = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${y}.${Number(m)}.${Number(d)}`;
  };

  /* localStorage は例外を投げる環境がある（プライベートウィンドウ・
     サイトデータを止めている設定）。読めなくても入口は必ず出す。 */
  const seen = {
    get() {
      try { return localStorage.getItem(SEEN_KEY); } catch (e) { return null; }
    },
    set(v) {
      try { localStorage.setItem(SEEN_KEY, v); } catch (e) { /* 覚えないだけ */ }
    },
  };

  /* 初めて来た人にも点は出す。全部が新しいので、嘘にはならない。 */
  const unseen = seen.get() !== latest.version;

  /* ── 描画 ───────────────────────────────
     data は自分たちが書くものだが、innerHTML は使わない。
     ここに他人の文字（口コミなど）が流れ込む改造が入ったとき、
     この1行が最後の砦になる。 */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  RELEASES.forEach((rel, i) => {
    const li = el("li", "verRel");

    const head = el("div", "verRelHead");
    const time = el("time", "verDate", fmt(rel.date));
    time.setAttribute("datetime", rel.date);
    head.append(time, el("span", "verVer", "v" + rel.version));
    /* 未読の最新版にだけ NEW。ダイアログを開いた時点で既読になるので、
       次に開いたときは付かない。 */
    if (i === 0 && unseen) head.append(el("span", "verNew", "NEW"));
    li.append(head);

    if (rel.title) li.append(el("h3", "verRelTitle", rel.title));

    const ul = el("ul", "verItems");
    (rel.items || []).forEach((it) => {
      const row = el("li", null);
      row.append(el("span", "verTag verTag-" + it.tag, TAGS[it.tag] || "更新"));
      row.append(el("span", "verItemText", it.text));
      ul.append(row);
    });
    li.append(ul);
    list.append(li);
  });

  $("verFabNum").textContent = "v" + latest.version;
  $("verNow").textContent =
    `いまのバージョンは v${latest.version}（${fmt(latest.date)} 更新）`;
  fab.setAttribute(
    "aria-label",
    `バージョン＆最新機能（いまは v${latest.version}）`
  );
  $("verDot").hidden = !unseen;
  fab.hidden = false;   // JS が動いたときだけ出す（中身を作れないボタンは出さない）

  /* ── 開閉 ─────────────────────────────── */
  fab.addEventListener("click", () => {
    dlg.showModal();
    seen.set(latest.version);
    $("verDot").hidden = true;
  });
  $("verClose").addEventListener("click", () => dlg.close());
  /* 幕（ダイアログの外）を押しても閉じる。<dialog> 自身が全画面なので、
     押された場所がカードの外かどうかで判定する。 */
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
})();
