/* バージョン＆最新機能 ―― 右下の入口 → <dialog> で更新履歴を出す
 *
 * ★ 新しい版を出したときに触るのは、下の RELEASES の先頭に1件足すことだけ。
 *   ここが版の唯一の正本で、右下のバッジに出る番号も、
 *   ダイアログの中身も、全部この配列から作る。2か所に書かない。
 *
 *   date    "YYYY-MM-DD"（画面には 2026.8.26 の形で出す）
 *   version "1.2" / "1.2.1"（画面には v1.2。右下のバッジにも出る）
 *           MAJOR.MINOR.PATCH の三段。付け方は下の「版番号の付け方」
 *   title   その版を一言で（過去の版は、畳んだ1行にこれだけが出る）
 *   items   [{ tag, lead|head, text?, icon?, href? }]
 *           tag  "new" | "improve" | "fix"（この3つ以外は書けない）
 *           lead 太字の見出し（20文字まで）。畳みの中の項目はこれが要る
 *           head 主打にするときの見出し（lead の代わりに書く。下の「主打」）
 *           text 見出しの下に続く説明。lead なら省いてよい
 *           href その機能が実際にある場所（下の「リンク」）
 *
 * ── 見出し（lead）―― 畳みの中も箇条書きにしない ───
 *   畳みを開いた人が最初にするのは「自分に関係あるか」の判定で、
 *   長い文を1行目から読むことではない。だから項目は必ず
 *   **太字の見出し＋説明**の2段で書く。見出しだけで意味が通るなら text は省く。
 *
 *     { tag: "fix", lead: "学部を変えても専攻が残る",
 *       text: "学科・専攻を持たない学部を選ぶと、前の学部の選択が残っていました" }
 *
 *   lead も head も無い項目は tools/test_version.mjs が落とす。
 *   「〜するようになりました」を見出しに入れない ―― 全項目がそうだから情報が無い。
 *
 * ── リンク（href）──────────────────────
 *   「新しく増えたもの」は、読んだその場で見に行けるようにする。
 *   href を書くと見出しの下に「見てみる →」が出る。
 *
 *     href: "/#sliders"       同じページの中 ―― ダイアログを閉じて、その場所へ飛んで光らせる
 *     href: "/about#strength" 別ページ ―― ふつうに遷移する
 *
 *   ★ 別ページに `#…` を付けてよいのは、**その id が HTML に最初から書いてある**
 *     ページだけ（/about など）。マイページのように JS が中身を作るページでは、
 *     ブラウザが HTML を読んだ時点でその id がまだ無く、飛ばずに上で止まる
 *     ―― 飛んだつもりで飛んでいないので、`#` を付けずにページだけを指す
 *     （2026-09-22 本番で実測。#mpTimetable は上のほうに在るので偶然それらしく見えていた）
 *
 *   ・サイトの中（"/" で始まる）だけ。外部リンクは書けない（テストが落とす）
 *   ・**いま行ってもその機能が見えるもの**にだけ付ける。科目を選ばないと出ない
 *     もの（詳細パネルの中身）や、もう作り直した機能には付けない ――
 *     飛んだ先に何も無いのが、リンクが一度も押されなくなる一番の近道
 *   ・飛び先の id は app.js 側の持ち物。消えていないかは、版を出すときに一度押して確かめる
 *   ・**同じページの飛び先がその画面に無いときは、リンク自体が出ない**
 *     （PC だけの機能をスマホで読んだとき／id が消えたとき）。
 *     別ページの飛び先は確かめようがないので出る ―― そこは人が確かめる
 *
 * ── 主打（head / icon）―― ここがこの画面の要 ─────
 *   head を書いた項目だけが、版の先頭に「カード」として大きく出る。
 *   head の無い項目は tag ごとに畳まれ、開かないと見えない。
 *
 *     { tag: "new", icon: "filter",
 *       head: "配点でしぼれます",                       ← 24文字まで
 *       text: "出席・小テスト・レポートが何%かを指定できます" }  ← 60文字まで
 *
 *   ・**1つの版につき 1〜3件**。0件でも4件でも tools/test_version.mjs が落ちる。
 *     「今回いちばん変わったことは何か」を、出す人が必ず1回考えるための門
 *   ・icon は下の ICONS にある名前だけ。無い名前を書くと同じく落ちる
 *   ・主打にした項目は、畳んだ一覧には出ない（同じ文を2か所に出さない）。
 *     だから head と text は「これ単体で意味が通る」短文にする
 *   ・4件目からは head を付けない。lead を書いて畳みの中に入れる
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
      date: "2026-09-23",
      version: "1.3",
      title: "重さの出し方を作り直した・授業内容でさがせる",
      items: [
        { tag: "improve", icon: "score",
          head: "重さの出し方を作り直しました",
          text: "テストの有無をいちばん大きく見ます。ほとんどの授業で判定が変わります" },
        { tag: "new", icon: "search", href: "/#conds",
          head: "授業内容でさがせます",
          text: "歴史・AI・食などのタグで、何の話をする授業かからしぼれます（LINE 登録が要ります）" },
        { tag: "improve", icon: "filter", href: "/#sliders",
          head: "つまみは「好みの重さ」に",
          text: "テストや出席をどれくらい重く見るかを、自分に合わせて動かせます" },
        { tag: "new", lead: "カードのタグから絞り込み",
          text: "科目カードのタグを押すと、そのタグでしぼれます。AI がシラバスを読んで付けたものなので、間違いを見つけたら科目の詳細の「タグが違う？」から教えてください" },
        { tag: "new", lead: "時間割のコマから詳細", href: "/mypage",
          text: "重さの内訳が見られます。外すときはコマの右下の ✕ を押してください" },
        { tag: "new", lead: "条件をまとめて戻せます", href: "/#conds",
          text: "学部・学年もふくめて一度に戻せます（スマホは学期の下、PC は「絞り込み」の右）" },
        { tag: "new", lead: "「発表」でしぼれます",
          text: "発表が成績に入らない授業だけを探せます" },
        { tag: "new", lead: "意見箱に画像を添付",
          text: "スクリーンショットを1枚まで送れます（5MB まで）" },
        { tag: "improve", lead: "テストの無い授業の数え方",
          text: "テストのない授業は「レポート・出席・小テスト・発表」のうち、その授業に実際にある項目だけで重さを判定します" },
        { tag: "improve", lead: "口コミが1件目から効く",
          text: "人数が増えるほど強く効き、判定全体の2割までです（これまでは3件そろうまで数字に効きませんでした）" },
        { tag: "improve", lead: "しぼり込みは ✕ へ移動",
          text: "つまみの右の ✕ を押すと、その項目がある授業を一覧から外します。重さを動かすのと ✕ は LINE 登録した人の機能です。つまみの下の「重さを既定に戻す」でいつでも元に戻せます" },
        { tag: "improve", lead: "発表をレポートと別に判定",
          text: "これまで発表もレポートとして数えていたため重さがずれていました。「レポートのみ」は発表のある授業を含まなくなりました" },
        { tag: "improve", lead: "数字の名前が「相性度」に",
          text: "これまでの「楽単スコア」から名前が変わりました" },
        { tag: "improve", lead: "LINE のおすすめも並び替え",
          text: "新しい判定に合わせて順番が変わります" },
        { tag: "improve", lead: "コマに担当教員",
          text: "科目名・担当教員・時間割コードの順で出します" },
        { tag: "improve", lead: "条件のボタンを3列に整理",
          text: "押したボタンと、自動で含まれるボタンを色で見分けられます" },
        { tag: "improve", lead: "「卒業要件」を選べるボタンに",
          text: "左の絞り込みの「卒業要件」を、押す前に何が選べるか分かるボタンにしました" },
        { tag: "improve", lead: "トップの見出しと説明",
          text: "履修登録で何が分かるか、授業内容でもさがせることが伝わる形に変えました" },
        { tag: "fix", lead: "「あなたに合う」が二重に出る",
          text: "すぐ下の一覧にも同じ科目が並んでいました" },
      ],
    },
    {
      date: "2026-09-16",
      version: "1.2",
      title: "配点でしぼれる・時間割コード",
      items: [
        { tag: "new", icon: "filter", href: "/#sliders",
          head: "配点でしぼれます",
          text: "出席・期末テスト・小テスト・レポートが何%かを指定して探せます" },
        { tag: "new", icon: "link",
          head: "KOAN の時間割コード",
          text: "各科目に表示。コピーして写せて、コードでの検索もできます" },
        { tag: "new", icon: "chat",
          head: "口コミが読みやすく",
          text: "一覧から直接ひらく大きな画面に変わり、文字も大きくなりました" },
        { tag: "new", lead: "小テストを出席と分けて表示",
          text: "「出席は緩いけれど毎週小テストがある」授業が見分けられます" },
        { tag: "new", lead: "一覧から直接「時間割に追加」",
          text: "科目の詳細を開かなくても押せます" },
        { tag: "new", lead: "左の絞り込みを畳める", href: "/#grip",
          text: "条件と一覧のあいだにある矢印を押すと畳めて、一覧が広がります（PC）" },
        { tag: "new", lead: "科目の詳細を ✕ で閉じる",
          text: "Esc キーでも閉じます。閉じると一覧だけの画面に戻ります（PC）" },
        { tag: "new", lead: "About にスライドショー", href: "/about#strength",
          text: "「ラクハンの強み」を、実際の画面のスクショで紹介しています" },
        { tag: "improve", lead: "条件と配点のつまみが連動",
          text: "「出席なし」などの条件を押すと、対応するつまみが動きます" },
        { tag: "improve", lead: "表が空の授業でも配点が読める",
          text: "「授業で指示する課題類（80％）と授業での議論への貢献度（20％）」のような、シラバス本文の記述をそのまま出しています" },
        { tag: "improve", lead: "ボタンを一覧側にまとめた",
          text: "「口コミを読む・書く」「時間割に追加」が一覧側に移り、科目の詳細が短くなりました" },
        { tag: "improve", lead: "一覧を画面の中央に",
          text: "科目を選んでいないあいだ、右側が大きく空いて見えていたのを詰めました（PC）" },
        { tag: "fix", lead: "成績評価の内訳をそのまま表示",
          text: "これまでは4つに分類し直していたので、発表だけで成績が付く授業が「レポート」と表示されたり、分類できない項目が「不明」に消えたりしていました" },
        { tag: "fix", lead: "「期末レポート」をテストから外した",
          text: "レポートだけで成績が付く授業が「レポートのみ」で見つかるようになりました（482→508科目）。テストではなくレポートとして重さを判定します" },
      ],
    },
    {
      date: "2026-09-02",
      version: "1.1.1",
      title: "科目データを最新の時間割に更新",
      items: [
        { tag: "improve", icon: "data",
          head: "科目データを更新しました",
          text: "KOAN を取り直して 7,877件 → 7,906件。外国語学部などが 29件ふえました" },
        { tag: "fix", lead: "取り下げられた 3件を削除",
          text: "お気に入りや「私の時間割」に入れていた場合は、その科目だけ表示されなくなります" },
        { tag: "improve", lead: "開いたときの演出",
          text: "「履修登録、どれくらい手間がかかるか。」を出すようにしました" },
      ],
    },
    {
      date: "2026-08-31",
      version: "1.1",
      title: "マイページと「私の時間割」",
      items: [
        { tag: "new", icon: "star", href: "/mypage",
          head: "マイページができました",
          text: "学部・学年を覚えるので、来るたびに選び直さなくて済みます" },
        { tag: "new", icon: "calendar", href: "/mypage",
          head: "「私の時間割」",
          text: "曜限のマスに科目を入れて、埋まっているコマを残せます" },
        { tag: "new", icon: "mobile", href: "/mypage",
          head: "スマホのカレンダーへ連携",
          text: "祝日・休講日・振替授業日は公式の学年暦に合わせています" },
        { tag: "new", lead: "気になる科目に★", href: "/mypage",
          text: "お気に入りはマイページからまとめて見られます" },
        { tag: "new", lead: "最初に学部と学年をたずねる",
          text: "答えると絞り込みの初期値になります（飛ばせます）" },
        { tag: "new", lead: "LINE の回答をサイトへ引き継ぎ",
          text: "学部・学年を二度聞かないようにしました" },
        { tag: "new", lead: "フッタに公式 SNS",
          text: "X・Instagram・LINE" },
        { tag: "improve", lead: "ダークモードなどの見た目",
          text: "読みにくかった文字、セレクトの見た目、PC で右カラムがはみ出すのを直しました" },
        { tag: "fix", lead: "学部を変えても専攻が残る",
          text: "学科・専攻を持たない学部を選ぶと、前の学部の選択が残っていました" },
      ],
    },
    {
      date: "2026-08-26",
      version: "1.0",
      title: "ラクハン 公開",
      items: [
        { tag: "new", icon: "score", href: "/#list",
          head: "阪大 全学部 7,877件を公開",
          text: "シラバスの成績評価の内訳から、試験・レポート・出席・規模の4軸で表示" },
        { tag: "new", icon: "calendar", href: "/#grid",
          head: "空きコマから探せます",
          text: "「火3が空いてる、何取ろう」から始められる時間割グリッド" },
        { tag: "new", icon: "check",
          head: "登録もログインも不要",
          text: "URL を開くだけ。会員登録はありません" },
        { tag: "new", lead: "あなたの優先度スライダー", href: "/#sliders",
          text: "プリセットもあり、相性の高い順に並べ替えられます" },
        { tag: "new", lead: "学部・学科・学年でしぼる", href: "/#rail",
          text: "学期・科目区分でも。学年を選ぶと履修できない科目を外します" },
        { tag: "new", lead: "口コミの投稿", href: "/kuchikomi",
          text: "選択式3問＋一言、1分もかかりません" },
        { tag: "new", lead: "科目ごとの共有リンク",
          text: "開いている画面のURLをそのまま友だちに渡せます" },
        { tag: "new", lead: "LINE 公式アカウント",
          text: "検索とおすすめが受け取れます" },
        { tag: "improve", lead: "測れない科目は「情報不足」",
          text: "一番重い軸が測れていない科目には総合値を出さず、数字には信頼度を添えています" },
        { tag: "improve", lead: "スマホのヘッダを2段に",
          text: "ロゴ行とメニュー行に分け、画面を広く使えるようにしました" },
      ],
    },
  ];

  /* ── アイコン ───────────────────────────
     主打カードの左に出す。24×24 の線画で、色は CSS の currentColor 任せ
     （ブランドは単色なので、塗り分けも階調も持たせない）。
     名前は「何の話か」で選ぶ。ここに無い題材が来たら1つ足す ――
     足さずに近いもので済ませると、同じ絵が並んで見分けがつかなくなる。 */
  const ICONS = {
    /* 判定・重さ・スコア（天秤） */
    score: ["M12 4v15", "M8.5 20h7", "M4 8h16",
            "M4 8 1.8 13a2.7 2.7 0 0 0 4.4 0Z", "M20 8l2.2 5a2.7 2.7 0 0 1-4.4 0Z"],
    /* さがす（虫めがね） */
    search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m16.2 16.2 4.3 4.3"],
    /* しぼりこむ・条件・配点（漏斗） */
    filter: ["M3.5 5h17l-6.6 7.7v6.1l-3.8 2v-8.1Z"],
    /* 時間割・カレンダー */
    calendar: ["M4 6.5h16v14H4Z", "M4 10.5h16", "M8.5 3.5v4", "M15.5 3.5v4", "M7.5 14h3v3h-3Z"],
    /* お気に入り・マイページ */
    star: ["M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9Z"],
    /* 口コミ */
    chat: ["M20 4.5H4v11h4.5v4.2l4.7-4.2H20Z"],
    /* 科目データ・件数 */
    data: ["M12 3.5c4.4 0 8 1.2 8 2.7s-3.6 2.7-8 2.7-8-1.2-8-2.7 3.6-2.7 8-2.7Z",
           "M4 6.2v5.6c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7V6.2",
           "M4 11.8v5.6c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7v-5.6"],
    /* スマホ・表示・レイアウト */
    mobile: ["M7 2.8h10v18.4H7Z", "M10.5 18.4h3"],
    /* 共有リンク・KOAN へ飛ぶ */
    link: ["M10.3 13.7a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2",
           "M13.7 10.3a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"],
    /* 直した・できるようになった */
    check: ["M4.5 12.5 9.5 17.5 19.5 6.5"],
    /* 上のどれでもないとき */
    sparkle: ["M11 3.5l1.9 5.1 5.1 1.9-5.1 1.9L11 17.5 9.1 12.4 4 10.5l5.1-1.9Z",
              "M18.3 15.8l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8Z"],
  };

  /* 畳みの見出し。並び順もこの配列のとおり（新機能が先、修正が最後）。
     「修正」を最後の既定で畳むのは、読みに来た人が知りたいのは
     たいてい「増えたこと」のほうだから。 */
  const GROUPS = [
    ["new", "新しい機能"],
    ["improve", "改善したところ"],
    ["fix", "直した不具合"],
  ];
  const SEEN_KEY = "rakuhan.seenVersion";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const $ = (id) => document.getElementById(id);
  const fab = $("verFab");
  const dlg = $("verDlg");
  const list = $("verList");
  if (!fab || !dlg || !list || RELEASES.length === 0) return;

  const latest = RELEASES[0];

  /* 開屏の左下にも同じ番号を出す。版の正本はこの RELEASES ひとつなので、
     index.html 側は空の入れ物だけを置き、数字はここから流し込む。
     splash.js は同期スクリプトで先に走り、version.js は defer で後から走るが、
     覆いは 1400ms 出ているので入れ替わりは間に合う。
     入れ物が無いページ（about など）と、version.js が落ちた場合は
     空のまま ―― CSS の :empty で消える。 */
  const splashVer = $("splashVer");
  if (splashVer) splashVer.textContent = "v" + latest.version;

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
     この1行が最後の砦になる。アイコンも同じ理由で
     createElementNS で組む（SVG の文字列を流し込まない）。 */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const icon = (name) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    (ICONS[name] || ICONS.sparkle).forEach((d) => {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      svg.append(p);
    });
    const box = el("span", "verIcon");
    box.append(svg);
    return box;
  };

  /* 「見てみる →」。同じページの中なら、ダイアログを閉じてその場所へ運ぶ。
     別ページならふつうの <a> のまま（遷移すればダイアログは消える）。
     href はサイトの中だけ（tools/test_version.mjs が外部リンクを落とす）ので、
     rel="noopener" のような外向けの用心は要らない。 */
  /* 飛び先が「いまこの画面に」無いリンクは隠す。
       ・PC だけの機能（左の絞り込みの矢印はスマホでは出ない）
       ・app.js 側で id が消えたとき
     どちらも押した先に何も無く、「押しても何も起きないリンク」がいちばん早く
     信用を失う。別ページ（pathname が違う）は今この場で確かめようがないので
     そのまま出す ―― 確かめるのは版を出す人の仕事（CLAUDE.md「リンク」）。

     ★ この判定は描画時ではなく**ダイアログを開くたび**に走らせる。
     version.js は読み込み直後に描くが、飛び先の多く（#list #grid #sliders）は
     app.js がデータを取ってから作るので、描画時にはまだ存在しない。
     ここで一度間違えて、出るべきリンクが全部消えた（2026-09-22）。 */
  const reachable = (href) => {
    const url = new URL(href, location.href);
    if (url.pathname !== location.pathname || !url.hash) return true;
    const t = document.querySelector(url.hash);
    if (!t) return false;
    /* 見るのは「CSS で消されているか」であって、「いま大きさがあるか」ではない。
       #sliders / #list / #grid は静的な HTML に在るが、app.js がデータを入れるまで
       高さ 0 で立っている。大きさで判定すると、回線が遅い人には最初の数秒だけ
       リンクが消える（本番で実測。ローカルは速くて気づけなかった）。
       消したいのは PC 限定の機能（.gripRail{display:none}）のほうだけ。 */
    if (typeof t.checkVisibility === "function") return t.checkVisibility();
    return t.offsetParent !== null;   // checkVisibility が無いブラウザ
  };

  const jump = (href) => {
    const a = el("a", "verJump", "見てみる");
    a.setAttribute("href", href);
    a.append(el("span", "verJumpArrow", "→"));
    a.addEventListener("click", (e) => {
      const url = new URL(href, location.href);
      if (url.pathname !== location.pathname) return;   // 別ページ：ブラウザに任せる
      e.preventDefault();
      dlg.close();
      const target = url.hash && document.querySelector(url.hash);
      if (!target) return;
      /* 左の絞り込みは畳めるので（v1.2）、畳んだまま飛ぶと何も見えない。
         飛び先がその中なら先に開く。#grip は app.js の持ち物なので、
         無ければ何もしない（触れないものに依存しない）。 */
      const grip = document.getElementById("grip");
      const rail = document.getElementById("rail");
      if (grip && rail && rail.contains(target) && grip.getAttribute("aria-expanded") === "false") {
        grip.click();
      }
      /* 運んで、一瞬だけ光らせる。 */
      let flashOff = 0;
      const flash = () => {
        target.classList.remove("verFlash");
        void target.offsetWidth;            // アニメーションを頭から流し直す
        target.classList.add("verFlash");
        clearTimeout(flashOff);
        flashOff = setTimeout(() => target.classList.remove("verFlash"), 1600);
      };
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      flash();

      /* 一度運んで終わりにしない。飛んだ直後にも一覧は伸び続けていて
         （app.js がデータを入れ終わるまで箱は空のまま立っている）、
         運んだ先が画面の外へ押し出される ―― 本番で実測: 飛んだあとの
         #sliders が top=1117、#list が top=1830（画面の高さは 900）。

         「◯秒だけ見張る」では駄目だった。データが届くのが 2.5秒で、
         1.6秒の見張りはその前に終わっている（2026-09-22 に実際に外した）。
         見るべきは時間ではなく**ページの高さが変わったかどうか**なので、
         伸びるたびに運び直し、利用者が自分で動かしたらすぐ手を離す。 */
      const settle = () => {
        const r = target.getBoundingClientRect();
        // 「上端が画面の上半分に見えている」を落ち着いた状態とする。
        // 一覧のように画面より高いものは、全体を入れようとすると永遠に決まらない。
        if (r.top >= 0 && r.top < innerHeight * 0.6) return;
        target.scrollIntoView({ block: "center", behavior: "auto" });
        flash();
      };
      let ro = null, timer = 0;
      const release = () => {
        if (ro) ro.disconnect();
        clearTimeout(timer);
        removeEventListener("wheel", release);
        removeEventListener("touchstart", release);
        removeEventListener("keydown", release);
      };
      /* 利用者が自分で動かし始めたら、もう運び直さない。
         "scroll" は自分の scrollIntoView でも鳴るので使えない。 */
      addEventListener("wheel", release, { passive: true, once: true });
      addEventListener("touchstart", release, { passive: true, once: true });
      addEventListener("keydown", release, { once: true });
      timer = setTimeout(release, 6000);   // 伸び終わらなくても6秒で手を離す
      if (typeof ResizeObserver === "function") {
        ro = new ResizeObserver(settle);
        ro.observe(document.documentElement);
      }
    });
    return a;
  };

  /* 版1件の中身（主打カード＋畳み）。最新版はそのまま置き、
     過去の版は <details> の中に同じものを入れる ―― 形を分けない。 */
  const body = (rel) => {
    const frag = document.createDocumentFragment();
    const items = rel.items || [];
    const heads = items.filter((it) => it.head);
    const rest = items.filter((it) => !it.head);

    if (heads.length) {
      const ul = el("ul", "verHeads");
      heads.forEach((it) => {
        const li = el("li", "verHeadItem");
        const txt = el("span", "verHeadBody");
        txt.append(el("b", "verHeadTitle", it.head));
        if (it.text) txt.append(el("span", "verHeadText", it.text));
        if (it.href) txt.append(jump(it.href));
        li.append(icon(it.icon), txt);
        ul.append(li);
      });
      frag.append(ul);
    }

    GROUPS.forEach(([tag, name]) => {
      const got = rest.filter((it) => it.tag === tag);
      if (!got.length) return;
      /* 既定は畳んだまま（open を付けない）。「修正がいくつ直ったか」を
         知りたい人だけが開く ―― それが載せない理由にはならないので、
         件数は畳んだ行にも出す。 */
      const d = el("details", "verGroup");
      const sum = el("summary", "verGroupSum");
      sum.append(el("span", "verGroupName", name), el("span", "verGroupNum", String(got.length)));
      d.append(sum);
      const ul = el("ul", "verItems");
      got.forEach((it) => {
        /* 畳みの中も箇条書きの長文にしない。太字の見出しで「何の話か」を先に出し、
           説明はその下に弱い色で置く ―― 開いた人が拾い読みできるように。 */
        const row = el("li", "verItem");
        row.append(el("b", "verItemLead", it.lead));
        if (it.text) row.append(el("span", "verItemText", it.text));
        if (it.href) row.append(jump(it.href));
        ul.append(row);
      });
      d.append(ul);
      frag.append(d);
    });

    return frag;
  };

  RELEASES.forEach((rel, i) => {
    const li = el("li", "verRel");

    /* 最新版だけ開いた状態で置く。過去の版は1行に畳む ――
       開いた瞬間に読むべきものを、画面いっぱいの箇条書きで埋めないため。 */
    if (i === 0) {
      li.className = "verRel verRelNow";
      const head = el("div", "verRelHead");
      const time = el("time", "verDate", fmt(rel.date));
      time.setAttribute("datetime", rel.date);
      head.append(time, el("span", "verVer", "v" + rel.version));
      /* 未読の最新版にだけ NEW。ダイアログを開いた時点で既読になるので、
         次に開いたときは付かない。 */
      if (unseen) head.append(el("span", "verNew", "NEW"));
      li.append(head);
      if (rel.title) li.append(el("h3", "verRelTitle", rel.title));
      li.append(body(rel));
    } else {
      /* 過去の版のまえに置く見出し。<ol> の直下なので <li> で包むが、
         中身は見出しにして、読み上げの目次から飛べるようにする。 */
      if (i === 1) {
        const label = el("li", "verPast");
        label.append(el("h3", "verPastTitle", "これまでの更新"));
        list.append(label);
      }
      li.className = "verRel verRelOld";
      const d = el("details", "verOld");
      const sum = el("summary", "verOldSum");
      const time = el("time", "verDate", fmt(rel.date));
      time.setAttribute("datetime", rel.date);
      sum.append(time, el("span", "verVer", "v" + rel.version),
                 el("span", "verOldTitle", rel.title || ""));
      d.append(sum);
      const box = el("div", "verOldBody");
      box.append(body(rel));
      d.append(box);
      li.append(d);
    }

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
    /* 開くたびに、飛び先がいまの画面に在るリンクだけを残す
       （画面の幅も、app.js が作り終えたかも、このときにしか分からない）。 */
    list.querySelectorAll("a.verJump").forEach((a) => {
      a.hidden = !reachable(a.getAttribute("href"));
    });
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
