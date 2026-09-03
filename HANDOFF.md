# 引き継ぎ記録

## ルール ── 直列タスクを終えたら、必ずこの4項目を残してから渡す

1. **何が動く状態か** ―― コマンド1行で再現できる形で書く
2. **何をしていないか** ―― 既知の穴、未確認のこと。ここを省くと次の人が同じ場所を掘り返す
3. **次の人が最初に打つコマンド** ―― 考えさせない。コピペで動き出せるように
4. **踏んだ罠** ―― 同じ穴に落ちるのを防ぐ。時間を一番節約するのはここ

**書き方**：Discord に投稿し、同じ内容をこのファイルの先頭（ルールの直下）に追記して push する。

**口頭の説明は、このメモを書いた上で行う。** 15分の口頭はメモの代わりにはならない。
渡す相手は移動中や深夜に詰まる。そのとき開けるのは文字だけ。

> 直列＝前の人が終わらないと始められないタスク。並行タスクにこの義務は無いが、
> 詰まったとき用に書いておくと自分が助かる。

---

## 2026-09-03 ｜ 毎朝のアクセス速報を流入元ごとに Discord へ（cron）｜ Claude → 次の人

本人からの依頼。「毎日のアクセス数を、Instagram / LINE / X と**流入元を分けて** Discord に自動で流したい」。

### 1. 何が動く状態か

**まだ本番には出ていません。** ブランチ `feat/daily-traffic-report`（PR 待ち）。

新しく数を取る仕組みは足していません。**すでにある `POST /api/hit` の blob2（パス）を読むだけ**です。
`/api/hit` はパスを残しているので、配布ずみの `/l/<slug>` がそのまま流入元になります
（＝**過去ぶんの数字も最初から埋まる**。クライアントは1行も変えていない）。

    node tools/test_traffic_report.mjs        # 通過 65 件
    npx wrangler dev --test-scheduled --local # 別の窓で
    curl "http://localhost:8788/__scheduled?cron=0+23+*+*+*"

ローカルで cron → Discord まで一通り通してあります（webhook を 127.0.0.1 に向けて実測）。

- `worker/traffic.js`（新規）… slug の表・SQL・本文の組み立て・cron の中身
- `worker/index.js` … `scheduled` を生やして `runDailyTraffic` を呼ぶだけ
- `wrangler.toml` … `[triggers] crons = ["0 23 * * *"]`（**UTC。JST 08:00**）
- `tools/traffic_preview.mjs`（新規）… けさ届くはずの本文を手元で見る（Discord へは送らない）

**slug を2枚に割らないこと。** 配信（`TRACKING_SLUGS`）も集計も
`worker/traffic.js` の `STATS_CHANNELS` 1枚から作っています。ここから漏れた slug は
404 になるか「直接・その他」へ静かに化けます。テストが両方を見張ります。

**LINE 公式アカウント用に `/l/line`（メッセージ）と `/l/line-rich`（リッチメニュー）を足しました**
（従来の14本 → 16本）。オープンチャットの oc1〜5 とは別枠で数えます。

### 2. 何をしていないか

- **本物の Analytics Engine に対して SQL を1度も通していません**（API トークンが手元に無いため）。
  形は `tools/stats.mjs` の実績ある SQL に `blob2` を足しただけですが、
  **デプロイ前に下のプレビューを1回**流してください。落ちてもその日の朝に
  「数字を取れませんでした」と Discord に出る作りです（黙って止まらない）。
- secret が3本未登録です（下記）。`STATS_DISCORD_WEBHOOK` が無いあいだ cron は外へ一切出ません。
- **`/l/line`・`/l/line-rich` はまだどこにも貼っていません。** LINE 公式のリッチメニューと
  自動応答のURLを差し替えるのは人の作業です。貼るまで LINE 公式ぶんは「直接・その他」に混ざります。
- 流入元が分かるのは **slug 付きのリンクを踏んだ人だけ**です。裸のURL・ブックマーク・
  口コミで聞いて手打ちした人は全部「直接・その他」。ここは仕様として諦めています
  （referrer を送らせる案は、Instagram と LINE のアプリ内ブラウザが referrer を落とすので割に合わない）。
- 入口が `/l/ig` でも、サイト内でロゴや About を押すとパスが `/` に変わります。だから
  **流入元の正本は「訪問」**（タブを開いて最初の1回＝必ず入口で立つ）。ページ表示・検索・詳細は参考値です。

### 3. 次の人が最初に打つコマンド

    # ① 本物のデータで本文を見る（トークンの作り方は tools/stats.mjs の先頭）
    CF_ACCOUNT_ID=<32桁> CF_API_TOKEN=<トークン> node tools/traffic_preview.mjs

    # ② PR を main へ入れる（約80秒で自動デプロイ）

    # ③ secret を3本入れる（**wrangler.toml にもコードにも書かない。このリポジトリは public**）
    npx wrangler secret put STATS_DISCORD_WEBHOOK   # Discord「サイトトラフィック」の webhook URL
    npx wrangler secret put CF_ACCOUNT_ID
    npx wrangler secret put CF_API_TOKEN            # 権限は アカウント / Account Analytics / 読み取り だけ

    # ④ 翌朝 08:00 を待たずに確かめたいなら、Cloudflare のダッシュボード
    #    （Workers → rakutan-db → 設定 → トリガー）から cron を手で1回実行する

### 4. 踏んだ罠

- 🚨 **Workers の入口モジュールは「関数以外の named export」を受け付けない。**
  `export const STATS_SQL = "…"` を `worker/index.js` に置いたら、`wrangler dev` が
  `Incorrect type for map entry 'STATS_SQL': the provided value is not of type
  'function or ExportedHandler'` で**起動ごと**落ちました（＝本番なら全機能が死ぬ）。
  単体テスト（node から import）では素通りするので、**入口を触ったら必ず一度 `wrangler dev` を起こす**。
  表や SQL 文をテストから読みたいときは、入口ではない別ファイルに置く（それが `worker/traffic.js`）。
  戻り防止として `test_traffic_report.mjs` が `worker/index.js` の `export const|let|var|class` を弾きます。
- **cron の時刻は UTC。** `0 8 * * *` と書くと JST 17:00 に鳴ります。JST 08:00 は `0 23 * * *`（前日）。
- Analytics Engine を読むときは `_sample_interval` を掛ける。件数が増えると Cloudflare 側が
  間引いて保存するので、掛け忘れるとその日だけ静かに少なく出ます（`tools/stats.mjs` と同じ罠）。
- **0件のときに黙らない設計にしてあります。** Discord 上では「誰も来なかった」と
  「計測が壊れた」が同じ沈黙に見えるためで、0でも失敗でも1通は鳴ります。
- `tools/test_favorite.mjs` は**この作業より前から落ちています**（`#inspector .detail .favBtn` が
  30秒出てこない）。`main` でも同じところで落ちるので、今回の変更とは無関係です。誰かの担当分。

---

## 2026-09-02 ｜ ヘッダの組み替え（GUILD をロゴの隣へ／マイページを隅へ／口コミを塗る）｜ Claude → 次の人

本人からの依頼、3点。
① 「Designed by GUILD」をロゴ「ラクハン」の側へ寄せる ②空いた右側にマイページを移す
③ マイページが居た場所（ナビの4つ目）に口コミを書くを持ってきて、オレンジで目立たせる。

> **2026-09-02 追記3** ―― ナビの `About` を `About ラクハン` に戻した（本人の希望）。
> 隙間を 8→6px にして 390px 以上は4項目が1行に収まる（実測 必要 357.9px / 使える幅 358px）。
> **360〜375px は入らず2行になる**（375px で 21px 足りない）。ただし口コミは右端＝
> マイページの真下に残るので、単独で左下へ落ちる元の問題は再発しない。
> 1行を全機種で通したいなら `About` に戻すのが唯一の手。ラベルを縮めずに詰める余地はもう無い。

> **2026-09-02 追記2（同日中の続き）** ―― 口コミの位置を直した。
> 400〜499px ではナビが `3＋1` に折り返し、**口コミだけが単独で最下段の左に取り残されていた**
> （1行まるごとを1つのボタンが食う）。`margin-left:auto` で帯の右端＝マイページの真下に固定し、
> ナビの `About ラクハン` を `About` に短縮して4項目を1行に収めた（正式名は `aria-label` で渡している）。
> 隙間と文字も狭い画面だけ一段詰めた（12→8px / 13→12px）。
> **ヘッダは 139px → 99px**（360px 以上で1行）。320px だけは入らず2行になるが、そのときも右端に残る。
> 外したもの：`@media (max-width:399px)` の「ナビを 2×2 に組む」ルール。
> grid にすると `margin-left:auto` が効かないので、戻すなら右端固定ごと組み直すこと。

### 1. 何が動く状態か

**本番に出ています**（`main` `73d0cd3`・2026-09-02 16:54 反映確認）。
全6ページで `hdMy` / `navCta` の存在と、`tokens.css` の境目が 1023px であることを確認ずみ。

    curl -s https://rakuhan.nocode-sol.co.jp/ | grep -c 'class="navCta"'   # 1 なら反映済み

戻すときは `git revert 73d0cd3` を `main` へ。ヘッダ以外に触れていないので単独で戻せます。

    python3 -m http.server 8140 --directory web
    node tools/test_mypage.mjs http://localhost:8140   # OK 51
    node tools/test_onboard.mjs http://localhost:8140  # OK 30
    node tools/test_index_gate.mjs http://localhost:8140  # OK 37
    node tools/test_feedback.mjs http://localhost:8140 # 通過 40
    node tools/test_version.mjs http://localhost:8140  # 98件
    python3 tools/test_shell_inject.py                 # OK 47
    python3 tools/test_tokens.py                       # OK 103

ヘッダの構造（全6ページ共通。正本は `templates/shell.html`）:

    〜1023px  1行目： [ラ]クハン │ Designed by GUILD        (マイページ)
              2行目： 科目をさがす  今後のステップ  About ラクハン  【口コミを書く】
    1024px〜  1行  ： [ラ]クハン │ Designed by GUILD  …  ナビ4項目 【口コミを書く】 (マイページ)

- **GUILD はロゴの隣**。`.by{margin-left:auto}`（右端へ飛ばす指定）を外しただけ
- **マイページはナビの外**（`.hdMy`）。細い枠の丸ボタン。塗らないのは「塗るのは1画面に1つ」を守るため
- **口コミを書く（`.navCta`）はオレンジの塗り**。文字は白ではなく `--brand-ink`（黒）。
  白は `#DB6209` の上で 3.67:1 しか出ず、小さい文字の 4.5:1 に届かない（黒なら 4.75:1）
- 現在地の印：ナビは下線、口コミは白いリング（オレンジ地に橙の下線は見えないため）、
  マイページは枠がオレンジになる

ヘッダの高さ（実測、mypage）：320〜430px = 139px ／ 520〜1023px = 105px ／ 1024px〜 = 65px。
**ナビが5項目から4項目に減ったので、狭い画面では前より低い**（400px 未満の 2×2 が 3行→2行）。

### 2. していないこと・変えたこと

- **ヘッダが1行になる境目を 640px → 1024px に上げた。** マイページを1行に足すと
  ロゴ・ナビ・マイページの合計が 943px 必要で、640〜942px では GUILD が折れ、
  口コミの塗りが2行に割れていた（実測 768px でヘッダ 124px）。入らない幅は2段のままの方が低い。
  `tokens.css` の `--fs-hdr-sub` の境目（640→1024）も揃えた。**この値はヘッダ専用**で、
  他に使っている箇所は無いことを grep で確認ずみ
- **`web/index.html` を手で編集していない。** 変えたのは `templates/shell.html` で、
  `build.py` の `read_shell()/inject_shell()` を呼んで6ページへ注入した（松下さんの担当ファイルを直接触らない）
- **`python build.py` は丸ごとは流していない**（手元の `data/courses.json` が 1,112件しかなく通らない ―― 9/1・9/2 のエントリと同じ）。
  外殻の注入だけを呼んだ
- **`.fab`（一覧の下に浮く「口コミを書く」）はそのまま。** あちらは
  「いま開いている科目への口コミ」で、ナビの `.navCta` は `/kuchikomi` への移動。別物なので両方残した。
  画面に橙の丸が2つ並ぶのが気になるなら、消すのは `.fab` ではなく先に相談を（投稿数に直結する）
- **PC でのタブ順が見た目と1つズレる。** DOM は ロゴ→マイページ→ナビ の順（狭い画面の見た目に合わせた）で、
  1024px 以上では `order` でナビを先に見せている。読み上げの順としては壊れていないが、
  気になるなら DOM を並べ替えて狭い画面側を grid で拾い直すこと
- **口コミが増えないままなら、この塗りは効いていない。** 効果の確認は Cloudflare Web Analytics の
  `/kuchikomi` のページビューで見る（今回は数字を取っていない）

### 3. 次の人が最初に打つコマンド

    python3 -m http.server 8140 --directory web
    # 390px（スマホ）と 1280px（PC）と 1023/1024px の境目を見る
    node tools/test_mypage.mjs http://localhost:8140
    python3 tools/test_shell_inject.py && python3 tools/test_tokens.py

ヘッダを直すときは **`web/*.html` ではなく `templates/shell.html`** を編集し、

    python3 -c "import build; p=build.read_shell(); print([x.name for x in build.PAGES if build.inject_shell(x,p)])"

で6ページへ流す（`python build.py` はデータが揃っていないと通らない）。

### 4. 踏んだ罠

- **`.hd` を grid にしたのに `.nav` へ `grid-column:1/-1` を書き忘れ、ナビの帯が右端で切れた。**
  背景色が付いている要素を grid のセルに入れると、はみ出しではなく「短い帯」として静かに出る。
  負のマージンで幅いっぱいに見せている要素は、**親を grid に変えた瞬間にセル幅に閉じ込められる**
- **オレンジの塗りにホバーで `opacity:.88` を当ててはいけない。** `kuchikomi.css` の
  `.primary-btn` と同じ書き方だが、ヘッダは濃色帯なので橙が地に沈み、黒文字が 3.94:1 まで落ちる。
  明地のボタンでは起きない。輪郭（box-shadow）で応えるようにした
- **`shell.js` が `.nav a[data-nav=...]` で現在地を探していた。** マイページをナビの外へ出した瞬間、
  `/mypage` だけ現在地が付かなくなる。`header [data-nav=...]` に広げた。
  ナビから何かを出すときは、この1行を必ず一緒に見ること
- **`tools/test_mypage.mjs` が「ナビが5項目」を数えていた。** 4項目＋ナビ外の1つに直し、
  「口コミが `.navCta`（塗り）であること」を足した。塗りが外れたら気づける
- **`tools/test_favorite.mjs` と `tools/check_division_ui.mjs` は落ちるが、この変更とは無関係。**
  前者は 9/1 の HANDOFF に既出（待っている `#inspector .detail .favBtn` は #90 で意図的に消した要素）。
  後者は `#divs` の `.chips` が既定で `hidden`（アコーディオン化）なのにテストが開かずに click しており、
  390px でも 1280px でも同じ場所で止まる。どちらもヘッダには触れていない
- **`tools/test_eligibility.py` は Python 3.9 では実行できない**（`str | None` の注釈）。
  この端末の `python3` は 3.9 系。落ちても慌てないこと
- **この端末には `node` も `node_modules` も無い。** `~/.nvm/versions/node/v22.23.2/bin/node` を直に叩き、
  playwright は scratchpad に入れて動かした（リポジトリには何も残していない）。
  `~/Library/Caches/ms-playwright` のブラウザは 1223 で、playwright 1.62.1 が要求する 1234 と番号が違う
- **しゅんやさんの端末の `~/Desktop/rakutan-db-main` は git リポジトリではない。** ZIP を展開したもので、
  `.git` が無い＝そのままでは push できない。今回は `main` を scratchpad へ clone し、
  12ファイルを上書きしてコミットして押した。**押す前に `diff -rq` で main と突き合わせ、
  差分が今回の12ファイルだけであることを確認すること**（他人の作業が混ざったまま押さないため）
- **Homebrew も `gh` も入っていなかった。** Homebrew は sudo が要るので入れず、
  `gh` の公式バイナリ（darwin arm64）を `~/.local/bin/gh` に置いた。認証は済んでいる
  （`olive10ma10`・keyring・`repo` スコープ）。**PATH に `~/.local/bin` が無いのでフルパスで叩くこと**

---

## 2026-09-03 ｜ 「本当の訪問数」を数えられるようにした ｜ Claude → 次の人

本人から「AI のクローラや自分たちの閲覧が混ざっていない数字が欲しい」。
調べた結果、**混ざっていたのは思っていた場所ではなかった**ので、まずそこから。

- Cloudflare の数字は2種類ある。**Workers のリクエスト数**（サーバ側）は
  GPTBot・ClaudeBot・スキャナまで全部入りで、これは訪問数として使えない。
  一方 **Web Analytics の beacon** はブラウザで JS が動いたときだけ上がるので、
  JS を動かさないクローラは最初から入っていない
- 残っていた穴は2つ ―― ① ダッシュボードで **`Exclude Bots = Yes`** を
  掛けていなかった（JS をレンダリングする Googlebot はここで落ちる）。
  これは本人が 9/2 に設定ずみ。② 自分たちの閲覧。これが今回のコード

### 1. 何が動く状態か

```bash
node tools/test_analytics.mjs        # OK 65（偽ブラウザ＋Worker の両方）
python3 -m http.server 8140 --directory web &
node tools/test_sort.mjs             # OK
node tools/test_mypage.mjs           # OK 51 checks
python3 tools/test_shell_inject.py   # OK
```

**PR #95（2026-09-03 マージずみ）と PR #97 の2本立て。**
#97 は当初 #96 として #95 の上に積んでいたが、#95 を `--delete-branch` 付きで
マージした時点で base ごと消えて自動クローズされた（GitHub は再オープンさせない）。
作り直したのが #97 で、中身は同じ・main の上に rebase ずみ。

**#95 ― 計測の入口を1本に。** `web/assets/analytics.js` が唯一の正本になり、
6ページに複製されていた beacon のタグが消えた。チームに配る URL:

    https://rakuhan.nocode-sol.co.jp/?nostats=1   … 以後この端末を数えない
    https://rakuhan.nocode-sol.co.jp/?nostats=0   … 数に戻す

踏むと帯が4秒出る。印は localStorage の `rk_nostats` ひとつ。
**ブラウザごと・端末ごとに1回ずつ**必要（シークレットには残らない）。

**#97 ― 自前の計測 `POST /api/hit`。** Analytics Engine（`STATS` 束縛・
データセット `rakutan_use`）へ3種類だけ書く: `pv` / `search` / `detail`。
読み出しは `CF_ACCOUNT_ID=… CF_API_TOKEN=… node tools/stats.mjs [日数]`。
Cookie・端末ID・IP・**検索語**・科目IDは送っていない（送るのはパスだけで、
クエリは Worker 側で落としている）。

実ブラウザで確認ずみ ―― 読み込みで `{e:"pv",n:1}`、カードを開いて
`{e:"detail"}`、同じ語で2回検索して `search` は1件、`?nostats=1` のあとは0件。

### 2. 何をしていないか

- **まだデプロイしていない。** `[[analytics_engine_datasets]]` を足したので、
  マージ後の自動デプロイで初めて `STATS` が生える。それまで `/api/hit` は
  204 を返すだけで何も記録しない（束縛が無い環境で落ちないことはテストずみ）
- **API トークンを作っていない。** `tools/stats.mjs` は
  「アカウント / Account Analytics / 読み取り」だけのトークンが要る。
  作れるのは本番アカウントの持ち主（政岡さん）。作り方は stats.mjs の先頭
- **広告ブロッカーにどれくらい塞がれているかは、まだ数字が無い。**
  デプロイ後、Web Analytics の数と `stats.mjs` の `pv` を並べて初めて分かる
- **無料枠（Analytics Engine 1日10万件）の見張りが無い。** 履修登録の山で
  近づいたら、まず `pv` を落として `search` / `detail` だけにする
- **`/about` に説明を足していない。** 元から利用者向けの計測の記載が無く、
  今回も個人を特定する情報を増やしていないため、文面を触っていない
- `tools/test_favorite.mjs` は落ちるが **main でも同じように落ちる**
  （`#inspector .detail .favBtn` が出ない）。今回の変更とは無関係

### 3. 次の人が最初にやること

```bash
gh pr merge 97 --squash --delete-branch   # #95 はマージずみ。約80秒で自動デプロイ
# デプロイ後、自分の端末を除外してから数分待って:
CF_ACCOUNT_ID=<32桁> CF_API_TOKEN=<作ったトークン> node tools/stats.mjs 7
```

`stats.mjs` が「まだ1件も届いていません」と言ったら、疑う順番は
① まだデプロイされていない ② **nginx が Origin と Referer を両方落としている**
③ 自分の端末が `?nostats=1` で除外されている。

### 4. 踏んだ罠

- **Web Analytics の Rules（パスで計測を止める機能）は使えない。**
  あれは Cloudflare に DNS を向けたサイト専用で、独自ドメインは
  nginx（VPS）から Worker へ中継している＝向けていない。除外は自前で持つしかない
- **`data-cf-beacon` 属性は、動的に足したタグで読まれる保証が無い。**
  トークンは `?token=…` のクエリで渡す（Cloudflare 公式のタグマネージャ向けの書き方）
- **`showDetail()` の中で数えてはいけない。** あの関数は画面幅が変わったときにも
  呼ばれるので、PC で窓を縮めただけで「詳細を開いた」が1件増える。
  数えるのは `bindCardHandler` のクリック側
- **`/api/hit` で Origin を必須にしてはいけない。** nginx がヘッダを落とす設定に
  変わった日に、集計が誰にも気づかれずゼロになる。だから
  「**合わない Origin だけを弾く**（無いものは通す）」にしてある
- **Analytics Engine の集計では `_sample_interval` を必ず掛ける。**
  件数が増えると Cloudflare が間引いて保存するので、掛け忘れるとその日だけ
  静かに少なく出る（`tools/stats.mjs` の SQL に入れてある）
- **積んだ PR（stacked PR）の下の段を `--delete-branch` でマージしてはいけない。**
  base ブランチが消えた瞬間、上の段の PR は **retarget ではなく自動クローズ**され、
  しかも GitHub は再オープンさせてくれない（作り直すしかない）。
  下の段は `--delete-branch` を付けずにマージし、上の段の base を main に
  付け替えてからブランチを消すこと
- **`[[analytics_engine_datasets]]` は、先にダッシュボードで dataset を作らないと
  デプロイが落ちる**（`[code: 10089] You need to enable Analytics Engine`）。
  2026-09-03 に20分溶かした。厄介なのは **`wrangler deploy --dry-run` では気づけない**
  こと ―― dry-run は束縛を一覧に出すだけでサーバへ問い合わせないので、
  ローカルでは何の問題も無いように見える。作る場所は
  `dash.cloudflare.com/<account_id>/workers/analytics-engine` で、
  「Enable」ボタンは無く **Create Dataset が実質の有効化**。
  入力する2つは wrangler.toml と完全一致させること（`rakutan_use` / `STATS`）
- **`sendBeacon` は DevTools の Network で `ping` 型として出る。**
  「Fetch/XHR」で絞ると **1件も見えない**ので、動いていないと誤診する。
  「全部」にしてから `hit` で絞ること
- **PM 本人のブラウザで beacon が `ERR_BLOCKED_BY_CLIENT` になっていた**（2026-09-03 実測）。
  広告ブロッカーが効いているのは仮説ではなく事実で、
  Cloudflare Web Analytics の数字が下限であることの裏付けになる

---

## 2026-09-02 ｜ マイページの「LINE 連携」｜ Claude → 次の人

本人から「マイページに LINE のログイン窓口を」という依頼。ただし本人の指定で
**「ログインというより公式アカウントのフォロー」**。だから **LINE Login (OAuth) も
LIFF も入れていない**。チャネルの追加設定も、サーバ側の実装も、通信も無い。
やっているのは「友だち追加のリンクを置き、繋がっている**とサイト側が思っている**
状態を localStorage に覚える」だけ。

### 1. 何が動く状態か

    python3 -m http.server 8141 --directory web
    node tools/test_mypage.mjs   http://localhost:8141   # OK 49
    node tools/test_onboard.mjs  http://localhost:8141   # OK 30
    node tools/test_store.mjs                            # OK 42
    python3 tools/test_tokens.py                         # OK 101

マイページの先頭（プロフィールの上）に「LINE 連携」の節が出る。2状態:

- **未連携** … 何が届くかの2行 ＋「LINE で友だち追加」ボタン
  （`https://line.me/R/ti/p/@733udbnt`・フッタと同じ公式アカウント）
- **連携済み** …「LINE 連携済み」＋「LINE を開く」＋
  取り消し導線「まだ友だち追加していない場合はこちら」

**印（`rk_line_linked`）が立つのは2つの場合だけ**:
① bot の「ラクハンで見る」から `?from=line` で来たとき（`web/assets/app.js`。
既存の学部・学年の引き継ぎと同じ分岐に1行足しただけ）
② マイページの友だち追加ボタンを押したとき

変更点:

- `web/assets/store.js` … 6つ目の鍵 `rk_line_linked` と
  `isLineLinked / markLineLinked / clearLineLinked`。`removeItem` は足していない
  （memFallback の後始末が read/write の2本で閉じている形を崩さないため。`"0"` を書く）
- `web/assets/app.js` … `from=line` の分岐の先頭で `markLineLinked()`。
  学部・学年の検証**より前**に置いた ―― クエリが壊れていても、bot のボタンから
  来たことは確かなので
- `web/mypage.html` / `mypage.js` / `mypage.css` … 節の骨格と `renderLine()`。
  `renderLine()` は `boot()` の **fetch より前**に呼ぶ（下の catch は return するので、
  後ろに置くと timetable.json が落ちたとき LINE の節ごと消える）

### 2. 何をしていないか

- **`tools/test_tokens.py` に基準を外す枠（`EXEMPT`）を足した。** ボタンは LINE 公式の
  緑＋白（`--sns-line` #06C755 ＋ `--sns-line-ink` #fff）にしたが、この組み合わせは
  **2.26:1** しかなく 4.5:1 に通らない。LINE 側のガイドラインで色を変えられない
  ブランド資産なので、この1組だけ外している（本人判断）。**外した組も測って毎回
  数字を出す**ので、黙って通ることはない。
  **ここに足していいのは「外部が色を指定していて動かせない資産」だけ。**
  「通らないから外す」で足したくなったら、それは `CONTRAST` の仕事
- **`version.js` に版を足していない。** #90・#91 も足しておらず、版は PR ごとではなく
  リリースごとに切っているように見えたため。次の版を出す人が
  「マイページから LINE 公式アカウントを友だち追加できるようにしました」を拾ってほしい
- **`?from=line` をマイページでは消費していない。** bot の `siteUri()` は `/` しか
  指さないので、`/mypage?from=line` は現状ありえない。bot がマイページを指すように
  なったら、URL 消費を共通関数に出すこと（今は app.js に1つだけ）
- **`python build.py` は流していない**（表示だけの変更。手元の `data/courses.json` は
  1,112件しかなく、そもそも通らない ―― 9/1 のエントリと同じ）
- **`tools/test_favorite.mjs` は落ちるが、この変更とは無関係。** `origin/main` の
  ソースを `git archive` で取り出して同じテストを流し、同じ Timeout を確認ずみ。
  待っているのが `#inspector .detail .favBtn` で、これは **#90（9/1 の詳細パネル整理）で
  意図的に消した要素**。テスト側の追随漏れ

### 3. 次の人が最初に打つコマンド

    git switch feat/mypage-line-link
    python3 -m http.server 8141 --directory web
    # 390px でマイページを開く。localStorage の rk_line_linked を消すと未連携に戻る

### 4. 踏んだ罠

- **押した `<a>` を click の処理中に DOM から外すと、ブラウザによっては
  `target="_blank"` の遷移が実行されない**（「押したのに LINE が開かない」）。
  `markLineLinked()` の直後に `renderLine()` を呼びたくなるが、`setTimeout(…, 0)` で
  次のタスクまで待たせている。テストも `waitForSelector("#mpLineUndo")` で
  この間を待っている
- **押した先で本当に友だち追加したかは、サイトには絶対に戻ってこない。**
  だから「連携済み」は嘘をつきうる。取り消し導線（`#mpLineUndo`）は飾りではなく、
  この嘘の唯一の出口。消さないこと
- **共有リンク（`?faculty=&year=` だけ）で印を立ててはいけない。** 学部・学年の
  引き継ぎが `from=line` の有無で線を引いているのと同じ理由で、友だち追加して
  いない人のマイページに「連携済み」と出てしまう。`test_onboard.mjs` の⑩に
  この確認を足した

---

## 2026-09-01 ｜ 科目詳細パネルの整理（案A）｜ 松下(Claude) → 次の人

本人（松下）から「『科目を探す』の科目詳細欄のUIがごちゃごちゃ」という相談。
390px で実測すると **詳細だけで 949px（カード全体 1,193px ＝ 画面3枚ぶん）** あり、
原因は情報量より **操作の並べ方** だった ―― 全幅の灰色ボタンが5つ縦積みで、
最後の ☆ はラベルが無く、カード右上の ☆ と機能が重複していた。

3案（見出しで区切る／タブ／要約ファースト）をモックで並べて比較し、**案A を採用**。
**合格条件は本人の指定で「押すべきボタンが一目で分かる」の1つ**に確定している。
比較モック（案B・案Cも2ページ目に残してある）:
https://claude.ai/code/artifact/5f8a571e-d286-4b33-ac9d-95fdf3bde818

### 1. 何が動く状態か

    python -m http.server 8123 --directory web

390px で科目カードをタップ → 詳細が開く。1280px 以上では右カラムに出る。
※ ブラウザのキャッシュが強いので、直らないときは Ctrl+Shift+R。

実測（【総合】カーボンニュートラルと私たちの未来 / 口コミ4件）:

- **スマホ 390px**：カード 1,193px → 1,046px（詳細 949px → 801px）
- **PC 1280×1000・口コミを開いた状態**：右カラムの中身 1,376px → **1,103px**、
  「時間割に追加」の位置 1,208px → **925px**（枠は 968px）

変更点（`web/assets/app.js` と `web/assets/app.css` の2ファイルのみ）:

- **操作を5つ→3つ。** 時間割に追加＝主（`--brand` の面）／この科目の口コミを書く・
  この科目のKOAN公式シラバスを見る＝副（`--brand-soft` の面）。新しい `.dActs` でまとめた
- **詳細の ☆ を削除**（`detailHtml` と `.detail .favBtn`）。カード右上の ☆ が残り、
  クリックの同期は `data-id` でまとめて行っているので機能は落ちない
- **「口コミを見る（N件）」→「N件すべてを1件ずつ読む →」のテキストリンク風に格下げ。**
  要素は `<button class="panelBtn">` のまま（`<a>` にすると `panelBtnFor()` /
  `openPanel()` / `panelSetOpen()` の3箇所に影響する）
- **見出しで2つに区切った**（`.dSec` / `.secH`）：「重さの根拠」「口コミ N件」
- **データなしの軸を1行に畳んだ**（`.axMiss`）。`axRow()` は値が無いと空文字を返すようになり、
  ラベル集めは `detailHtml` 側でやる
- **一言は先頭3件まで**（`reviewHtml`）。残りは上のリンクから1件ずつ読む
- `.ttAddBtn[aria-pressed="true"]`（時間割に入っています）は面を `--dim` に落とした。
  主ボタンのままだと「まだ押していない」に見えるため
- **PC の「1件ずつ」を、集計の下に足す形から「集計 ⇄ 1件ずつ」の差し替えに変えた**
  （`openPanel` の PC 分岐）。「口コミ N件」の節の中身だけが入れ替わり、
  リンクの文言は「閉じる」ではなく「集計に戻る」になる。
  **重さの根拠（4軸）と操作は動かない**ので、当初の意図「4軸を見ながら口コミを読む」は残る。
  スマホ（全画面シート）は変更なし

**変えていないもの**：一言→数値の順序（しゅんやさんの指摘④で意図的に入れ替えた順）、
担当教員の位置、`.conf`（信頼度）の文言、`tokens.css`、`templates/shell.html`。

### 2. 何をしていないか

- **`python build.py` が通っていない。** 手元の `data/courses.json` が 1,112件（共通教育のみ）で、
  `web/data/courses.built.json` の 7,877件（全所属）より少ないため、build.py が
  「6,765件が消える」と警告して中止する。**これは正しい動作。**
  `--allow-fewer-courses` は付けていない。今回の変更は表示だけなので再ビルドは不要だが、
  **全所属ぶんの courses.json を持っている人（wang / 政岡）でないと build.py は流せない**
- **`tools/test_reviews.py` が落ちる。今回の変更とは無関係**（変更前の状態でも同じく落ちる）。
  中身は「実データの受講年が全件埋まっている」で、科目 **137199** の口コミに `taken_year` が無い。
  口コミ取り込み（wang / しゅんや）の領域なので触っていない
- **PC の「1件ずつ」は、残りのスクロールが消えたわけではない。** 差し替え式にして
  中身 1,376px → 1,103px、「時間割に追加」の位置 1,198px → 925px まで縮めたが、
  枠は 968px（1280×1000）なので、開いた状態から操作へ行くにはまだ少しスクロールする。
  詰めるなら `.dActs` を列の下端に貼り付ける（`position:sticky; bottom:0`）案がある。**未着手**
- **口コミが10件を超えたときは未検証。** いまの最大は4件。100件目標なので1科目10件は
  起こりえる。そのときは「1件ずつ」を5件で切って「もっと読む」を足すことになる
- **削除した説明文の行き先が無い。** 詳細から消した
  「定員・レポートの分量・テストの難しさは KOAN に書いていない。ここだけが情報源。」は、
  **いま UI のどこにも無い。** 右カラムの空状態（`index.html` の `.inspectorEmpty`）には
  軽い/ふつう/重いの凡例と信頼度の説明しかない。About か空状態への移設は未着手
- 実機（iPhone / Android）での確認はしていない。Chromium の 390px / 1280px と
  ダークモードのみ

### 3. 次の人が最初に打つコマンド

    python -m http.server 8123 --directory web
    # 別のターミナルで
    for t in web_split tokens layout shell_inject scoring_gate; do python tools/test_$t.py; done

上の5本は通る（test_reviews は上記の理由で落ちるが、この変更とは無関係）。
PR を出す前に、全所属ぶんの `data/courses.json` を持っている人が `python build.py` を流すこと。

### 4. 踏んだ罠

- **`.panelBtn` を `<a>` に変えてはいけない。** 見た目はリンクにしたが、要素は button のまま。
  `panelBtnFor()` が `.panelBtn[data-id=...]` で探し、`openPanel()` が `insertAdjacentHTML`
  でリストを差し込み、`panelSetOpen()` が `textContent` を書き戻している
- **PC の差し替えは「隠す」と「戻す」が別の関数にある。** `openPanel` が
  `.rv` に `hidden` を付け、`panelSetOpen` が `.rv[hidden]` から外す。
  片方だけ直すと、閉じても集計が戻らない（または二重に出る）
- **ボタンの文言は2箇所にある。** `detailHtml` と `panelSetOpen` の両方に
  「N件すべてを1件ずつ読む →」がある。片方だけ直すと、閉じた瞬間に文字が変わる
- **`--brand-line`（#f0c9a8）の1px枠は白地の上で 1.54:1 しかない。** 最初のモックは
  白地＋枠線のボタンだったが、操作の境界に必要な 3.0:1 に届かないので、既存の
  `.reviewBtn` と同じ「淡い面」に変えた。**枠線で階層を作ろうとしないこと**
- **`--scale-heavy-soft` を「データなし」の地に使わないこと。** 赤系の地を敷くと
  「この科目は重い」に見える。情報が無いことは重さではない。`--dim`（中立）を使う
- **フッタが UI のラベルを文字列で名指ししている。** `templates/shell.html:34` に
  「科目を選ぶと出る「KOAN公式シラバスを見る」から開けます。」とある。
  この文言を縮めると、shell.html + build.py + 6ページに差分が広がる。だから
  ボタンを横2列にせず、ラベルを保ったまま縦3つにした
- **`tools/shots.mjs` は静的サーバ相手だと最後の `11-progress` で落ちる。**
  `tools/progress.html` は `web/` の外にあり静的サーバから見えないため。11枚は撮れている
- **Windows のコンソールは cp932 なので、テストの失敗メッセージが
  `UnicodeEncodeError` で潰れる。** `PYTHONIOENCODING=utf-8 python tools/test_reviews.py`
  で読める。これを知らないと「何が落ちたか」が分からない

---

## 2026-09-02 ｜ 口コミが入ったら Discord に通知（投稿を Worker 経由にした） ｜ wang(Claude) → 次の人

「サイト経由の口コミが入ってきたら通知してほしい」への対応。**通知そのものより、
投稿を落とさないことを優先して設計している**（今日は履修登録開始日）。

これまで投稿は `web/assets/kuchikomi.js` から GAS を直接叩いていたので、
Worker は投稿を一件も見ておらず、「来た」を知る手段が無かった。そこで
**投稿を Worker 経由に変え**、GAS が success を返したときだけ Discord へ1通鳴らす。
**GAS もスプレッドシートも列も payload も変えていない**（しゅんやさんの持ち場は無傷）。

### 1. 何が動く状態か

    node tools/test_kuchikomi_relay.mjs    # 36件パス
    # 実物での確認（本番 GAS へ1件だけ流した）:
    npx wrangler dev --port 8788 --local
    curl -X POST -H 'content-type: text/plain' --data-binary @payload.json \
      http://localhost:8788/api/kuchikomi     # → {"status":"success"} / 3.4秒

- `worker/index.js`：`POST /api/kuchikomi` を新設。受け取った body を**一字も変えず**
  GAS へ中継し、GAS の応答をそのままクライアントへ返す。`status:"success"` のときだけ
  `ctx.waitUntil()` で Discord へ送る（応答は待たせない）
- `web/assets/kuchikomi.js`：`GAS_URL` → `POST_URL = '/api/kuchikomi'`（実質2行）。
  成功判定・toast・localStorage は触っていない。ついでに跨オリジンでもなくなった
- 通知の形（自由記述は載せない。読みたい人はシートを開く）:

      📝 口コミが1件（2科目）  基礎工学部・電子物理科学科・2年・春・夏学期
      ・線形代数学I（佐藤）
      ・基礎工学のための数学A（田中）

- 科目は10件まで並べ、超えた分は「… ほか N 科目」。`allowed_mentions` は閉じてある

### 2. 何をしていないか

- ★**`REVIEW_DISCORD_WEBHOOK` が未登録**（人がやること）。登録するまで**投稿は今まで通り
  成功するが通知は鳴らない**。意見箱と secret を分けてあるので別チャンネルに落とせる
- ★**しゅんやさんのシートにテスト行が1行入っている**
  （`【テスト】通知配線の疎通確認（この行は削除してください）` / 学部も `【テスト】…`）。**削除が要る**
- **Cloudflare の本番エッジからの POST は未確認。** ローカルの workerd → 本番 GAS は
  実測ずみだが、デプロイ後にもう1件だけ試すのが確実（同じ手順でテスト行が増えるので、
  試したらまた消す）
- `server.py`（ローカル開発サーバ）は `/api/kuchikomi` を持たない。**ローカルで投稿を
  試すには `npx wrangler dev`**。`server.py` に中継を足すかは未決（足せばローカルからも
  本番シートに書けてしまうので、足さない方がいいかもしれない）
- 日次ダイジェストは**選ばなかった**。件数を数えるには保存先（D1）か GAS 側の改修が要り、
  どちらも「通知が欲しいだけ」に対して重い。1投稿1通なら記録が要らない
- 通知は D1 に何も残していない。`tools/ingest_reviews.py` の手動 TSV 取り込みは今まで通り
- 松下さんの担当領域（投稿の導線＝`kuchikomi.js`）に2行入っている（担当表は README 7章）

### 3. 次の人が最初にやること

    npx wrangler secret put REVIEW_DISCORD_WEBHOOK

URL は Discord の該当チャンネル → 編集 → 連携サービス → ウェブフックを作成 → コピー。
（意見箱 `FEEDBACK_DISCORD_WEBHOOK` と同じ作り方。別チャンネルでよい）

### 4. 踏んだ罠

- **GAS の `/exec` は GET でリダイレクト0の 200 を返す。** 「302 を Worker が跨げるか」を
  最大のリスクとして見ていたが、実測では存在しなかった。POST も workerd から素通りする
- **通知のために投稿を落とす設計にしてはいけない。** webhook 未設定・Discord 落ち・
  body 破損のどれが起きても中継だけは通る、をテストで固定してある。ここを緩めると
  一番混む日に投稿ごと死ぬ
- **`wrangler dev` は `.dev.vars` の変更を拾わないことがある。** 受け皿のポートを変えたら
  dev ごと再起動する（古い値のまま動いていて、通知が届かないように見えた）

## 2026-08-31 ｜ トップページの学年フィルタが0件に落ちる不具合を修正 ｜ 松下(Claude) → 次の人

本人（松下）から「トップページを開いただけで学年チップがどれも選択されておらず、0件になる」という
報告（スクリーンショット添付）を受けて調査・修正。最初は「デフォルトを『すべて』に変えてほしい」
という依頼だったが、`web/assets/app.js` の既定はすでに2026-08-26に`year:"all"`へ直っており
（本番でも複数パターンで再現せず）、実際の原因は別にあった。

**原因**：`web/kuchikomi.html`（口コミを書く）の「① いまの学年」と、トップページ／マイページの
学年フィルタが、同じ localStorage キー `osaka_u_settings` を共用している（`web/assets/store.js`
のコメント参照）。ところが値の形式が食い違っていた：

- トップページ側（`app.js`・`mypage.js`）が読む/書く学年は `"1"`〜`"6"`（数字だけ）
- 口コミ側（`kuchikomi.js`）が書いていた学年は `"1年"`〜`"6年"`、加えて `"修士"` `"博士"`

口コミページで一度でも学年を選ぶと、トップページ側は例えば `"3年"` を受け取り、
`YEARS`（`"1"`〜`"6"`・`"all"`）のどれとも一致せず学年チップが全部非選択になり、
`+state.year` も `NaN` になって学年フィルタが全科目を弾く＝0件になっていた。

### 1. 何が動く状態か

    python server.py --port 8000
    # → http://localhost:8000/kuchikomi で「① いまの学年」を「3年」や「修士」にする
    # → http://localhost:8000/ を開く（学年チップが正しく反応する。「修士」は数字が無いので「すべて」のまま）

- `web/assets/app.js`:
  - `boot()` 内、`profile.grade` を `state.year` にあてる箇所を `/^[1-6]$/` で検証してから代入
  - `rk:profile-set` イベントの `grade` も同様に検証
  - これにより、口コミ側から来た壊れた値だけでなく、**既にlocalStorageに入ってしまっている
    過去の壊れたデータ**（`"3年"`や`"修士"`）も自動的に無視され「すべて」にフォールバックする
    （ユーザーがlocalStorageを消す必要は無い。動作確認済み）
- `web/assets/kuchikomi.js`:
  - `sharedGradeOf()` を新設。select の値（`"3年"`等）から数字だけ（`"3"`）を取り出し、
    `"修士"`/`"博士"`は空文字にする
  - `saveSettingsToLocal()` で `grade` にこの数字だけを書くよう変更（GAS送信用の
    `handleSubmit()` の payload は `els.gradeSelect.value` のまま変更していない ―― 
    しゅんやさんのスプレッドシートの列は無関係）
  - 復元側（`init()`）も、保存されている数字に `"年"` を足してから select と突き合わせるよう変更

### 2. 何をしていないか

- push・PR は未作成（区切りとしてここに記録。運用は`web/CLAUDE.md`3章の通り）
- commit も未実施
- `kuchikomi.js` は本来 wang さん担当（オーナー表に明記は無いが `feat/wang-kuchikomi-*` 系）。
  今回も本人の直接依頼で松下(Claude)が編集した。念のため共有推奨
- 既にブラウザに `"修士"`/`"博士"` を選んだ記録が残っている人は、今回の修正後にトップページ側は
  正しく「すべて」に戻るが、**口コミページ自身の「前回の選択を覚えている」機能は、修士・博士だけは
  今後効かなくなる**（数字が無く共有キーに書けないため）。実害は「毎回選び直すだけ」で、
  投稿自体やGAS送信には影響しない
- スマホ幅での見た目は未確認（今回はロジックのみの修正で見た目の変更は無い）
- 同じ `osaka_u_settings` を読む他の画面（マイページの学部・学年欄など）への影響は
  「壊れた値を無視して既定に戻る」方向にしか効かないため、悪化はしないはずだが、
  マイページでの目視確認はしていない

**追記（同日）**：この不具合の確認中、手元の `data/courses.json` に `eligible_years` が
1件も入っていない状態になっていた（罠⑧／⑩として既に HANDOFF に記録済みのやつ）ため、
`python3 scrape/years.py` を実行して埋め直した（本人の許可を得て実行。1112件中1110件に
反映、2件は「どの学年の一覧にも出てこない」科目でこれは正常）。これは repo に入らない
gitignore 対象のローカルデータなので、他の人が同じ罠を踏んだら各自で流し直すだけでよい
（新しいコマンドではない。README/HANDOFF既存の手順どおり）。

### 3. 次の人が最初にやること

    git status   # このセッションでの変更2ファイル（app.js・kuchikomi.js）が残っているはず
    git diff web/assets/app.js web/assets/kuchikomi.js
    python3 build.py
    for t in web_split tokens layout shell_inject scoring_gate reviews; do python3 tools/test_$t.py; done
    node tools/shots.mjs /tmp/rk

上記が通ってから commit → PR。

### 4. 今回踏んだ罠

- **「デフォルトを変えてほしい」という依頼の言葉どおりに直すと、何も直らないところだった。**
  依頼された変更（`state.year`の既定値）はコード上すでに正しく、本番でも複数パターン
  （PC/スマホ・フレッシュ状態・学部学年を答えた後）で0件を再現できなかった。
  本人にスクリーンショットを見せてもらって初めて「学年チップがどれも選択されていない」
  という、単なるデフォルト値の話ではない状態だと分かった。**症状の言葉を鵜呑みにせず、
  実際の画面（スクリーンショット）で状態を確認しにいったのが決め手。**
- **同じ localStorage キーを2つの画面（`app.js`系と`kuchikomi.js`）が別々の書き方で
  共用していると、片方の画面を触っただけでもう片方が静かに壊れる。** `store.js` に
  「唯一の窓口」の役割があるのに、`kuchikomi.js` だけがそれを経由せず直接
  `localStorage.setItem('osaka_u_settings', ...)` している ―― 今回はそこがズレの温床だった。
  同じキーを触る画面が増えるときは、書式が揃っているか（またはどちらかが窓口を経由しているか）を疑うとよい

---

## 2026-08-31 ｜ 口コミ投稿モーダルの科目選択に検索欄を追加 ｜ 松下(Claude) → 次の人

本人（松下）から「口コミを書くで、③（時間割に無い科目）には科目名の検索があるのに、
②（時間割から選ぶ）で開くモーダルの科目選択には無い」という指摘を受けて追加。
`web/assets/kuchikomi.js`・`web/kuchikomi.html`・`web/assets/kuchikomi.css` を編集。
このページの主担当は wang（`feat/wang-kuchikomi-*` 系ブランチ）だが、
`web/CLAUDE.md` のオーナー表には kuchikomi.js が明記されておらず、本人の直接依頼のため実施。
振る舞いの中核（採点・データ取得・GAS送信）には触れていない、既存パターンの横展開。

### 1. 何が動く状態か

    python server.py --port 8000
    # → http://localhost:8000/kuchikomi
    # 学期・学部・学科を選び、時間割グリッドの好きなマスをクリック
    # → モーダルの「1 どの科目？」の直下に検索欄「科目名でしぼりこむ」が出る
    # → 文字を打つと下のプルダウンがその場で絞り込まれる（例：「力学」で7件に絞れる）

- `web/kuchikomi.html`: モーダルの「1 どの科目？」に `<input type="search" id="modal-subject-search">`
  を追加（初期状態は `hidden`。開くときに JS が出し分ける）
- `web/assets/kuchikomi.js`:
  - `openEditor()` で、時間割のマス（`slot`）を開いたときだけ検索欄を表示。
    ③時間割に無い科目（`kind:'extra'`）は元から1件しか候補が無いので検索欄は出さない
  - `renderModalSubjectOptions()` を新設。検索文字列で `modalSubjects`（そのマスの全候補）を
    `title.includes(q)` で絞り込み、プルダウンを描き直す。0件のときは「該当する科目が見つかりません」
    と出す（③の `extraCandidates()`/`renderExtraSelect()` と同じ作り）
  - 絞り込み中でも、いま選んでいる科目（`select.value`）は保持する（③と同じ `keep` の仕組み）
- `web/assets/kuchikomi.css`: `.modal-subject-search` に検索欄と下のプルダウンの間の余白だけ追加
  （色・枠線は `app.css` の共通 `input[type=search]` をそのまま使っていて、新しい値は足していない）

### 2. 何をしていないか

- **push・PR は未作成。** `web/CLAUDE.md` の運用（区切りがつくまでコミットだけ）に従い、
  ここまでで一区切りとして HANDOFF に記録。PR前に流すチェック
  （`build.py` → `tools/test_*.py` → `tools/shots.mjs`）はまだ実行していない
- git commit も未実施（本人の指示があれば作成する）
- wang 本人への「kuchikomi.js を触った」報告はしていない（本人からこの HANDOFF を渡す想定）
- スマホ幅（390px）での見た目は未確認。ブラウザの自動化ツールでの screenshot が
  このセッションでは撮れず（後述の罠）、JS 経由の値検証のみで動作確認した
- 検索は科目名の部分一致のみ。担当教員名では絞り込めない（③の `extra-search` も同じ仕様なので合わせた）

### 3. 次の人が最初にやること

    git status   # このセッションでの変更3ファイルが残っているはず
    python3 build.py
    for t in web_split tokens layout shell_inject scoring_gate reviews; do python3 tools/test_$t.py; done
    node tools/shots.mjs /tmp/rk

上記が通ってから `git add` → commit → PR。commit前に `git diff` で
`web/kuchikomi.html` `web/assets/kuchikomi.js` `web/assets/kuchikomi.css` の3ファイルだけが
変わっていることを確認する。

### 4. 今回踏んだ罠

- **同じ placeholder テキストの input が2つあると、`find` ツールの結果が紛らわしい。**
  ③の `#extra-search` と今回追加した ②の `#modal-subject-search` は両方
  `placeholder="科目名でしぼりこむ"` で文言を揃えたため、ブラウザ自動化の `find` が
  同じテキストで2件ヒットし、最初は `ref` を取り違えて③の欄に入力していた
  （③が絞り込まれて0件になり、一瞬「検索が壊れた」ように見えた）。
  `id` を直接指定する `getElementById` で見分けるのが確実
- **このセッションの Browser pane は `computer{action:"screenshot"}` が空白/タイムアウトを
  繰り返した。** `read_page`/`get_page_text`/`javascript_tool` は正常に動いたので、
  見た目の最終確認はスクリーンショットではなく DOM 上の値（`options.length`・`value`など）で行った。
  次の人がスクリーンショットで見た目を確認する場合は、念のためこの現象が再発しないか見ておくとよい

---

## 2026-08-31 ｜ 右下に「バージョン＆最新機能」を足した（更新履歴のダイアログ）｜ wang(Claude) → 次の人

`main` へ直接入れた。データにも API にも触っていない。触ったのは新規3ファイルと
`templates/shell.html`、そして build.py が注入した `web/*.html` 6枚だけ。

### 1. 何が動く状態か

**全ページの右下に入口が出て、押すと更新履歴のダイアログが開く。**
狭い画面は丸バッジ（`v1.1` だけ）、700px からは横長のピル（`v1.1 バージョン＆最新機能`）。
未読の版があるあいだは右上にオレンジの点が付き、一度開くと消える（localStorage
`rakuhan.seenVersion`）。ESC・✕・幕クリックのどれでも閉じる。

```bash
python3 -m http.server 8143 --directory web &
node tools/test_version.mjs && node tools/test_feedback.mjs && node tools/test_index_gate.mjs
python3 tools/test_shell_inject.py && python3 tools/test_tokens.py && python3 tools/test_layout.py
```

新しいファイルは3つ。

- **`web/assets/version.js`** ―― 先頭の `RELEASES` が**版の唯一の正本**。
  新しい版を出したら、ここの先頭に1件足すだけ。右下のバッジの番号も、
  ダイアログの中身も全部ここから作る。書式は
  `{ date:"YYYY-MM-DD", version:"1.0", title:"…", items:[{tag:"new|improve|fix", text:"…"}] }`
- **`web/assets/version.css`** ―― 見た目。app.css（科目一覧の担当）には1行も足していない
- **`tools/test_version.mjs`** ―― 配線（全ページに入口があるか）と版データの形を見張る。
  日付が YYYY-MM-DD でない・tag が3種以外・新しい版が下にある、で落ちる

器（ボタンと `<dialog>`）は `templates/shell.html` に置いて `build.py` で6ページへ注入した。
入口は `hidden` で置き、JS が中身を作れたときだけ表に出す ―― JS が動かない環境で
空のボタンだけが残らないようにするため。

**載っている版は2つ。** v1.0（2026.8.26 公開）と **v1.1（2026.8.31）**。
v1.1 は 8/26 以降に本番へ出たもの ―― マイページ・お気に入り・私の時間割・
カレンダー連携・開屏の問診・LINE の引き継ぎ・フッタの SNS・ダークモードの修正。
どちらも git 履歴から起こした草案なので、**文面はいつでも直してよい**
（`RELEASES` の text を書き換えるだけ。テストは形しか見ていない）。

### 2. 何をしていないか

- **予定（これから出す版）は載せていない。** 「出したもの」だけを書く場所にして、
  これから何をするかは `/ads`「今後のステップ」に任せた。ダイアログの最下部からそこへリンクしている。
  予定を2か所に書くと必ず片方が古くなる
- **版番号を自動で上げる仕組みは作っていない。** `RELEASES` を手で足す運用。
  1画面に収まる規模なので、生成の仕組みを足す方が壊れやすいと判断した
- **どこまでを1つの版にするかの線引きは決めていない。** 今回は「公開＝1.0／その後まとめて 1.1」
  としただけ。次に誰かが版を切るときに決めればよい
- **1024px ちょうどでページが横に 100px はみ出す**（`scrollWidth` 1124 / `innerWidth` 1024）。
  これは**前からある**もので、今回の入口を DOM ごと外しても同じ数字だった。3カラムに
  切り替わる境目の問題なので別件

### 3. 次の人が最初にやること

1. `node tools/test_version.mjs` を通す
2. v1.0 / v1.1 の文面を読む。利用者向けの言い方になっているか確認して、必要なら直す
3. 次に版を出すときは `web/assets/version.js` の `RELEASES` の先頭に1件足すだけ

### 4. 踏んだ罠

- **作業ツリーが origin/main から 55 コミット遅れていた。** 気づかず旧ツリーの上に作って、
  拉げてから作り直した（`git stash` → `git pull --ff-only` → 当て直し → `build.py` で再注入）。
  `web/*.html` は生成物なので、当て直しは shell.html だけ直せば済む。
  **並行で人と AI が触るリポジトリなので、手を付ける前に `git fetch && git status -sb` を見ること**
- **`python3 -m http.server` では `/about` が 404 になる**（`/about.html` なら出る）。
  拡張子なしの URL を解くのは `server.py` と Worker 側なので、静的サーバで確認するときは
  `.html` を付ける。付けずに「about ページに入口が無い」と誤診しかけた
- **`build.py` を丸ごと流すと data/ の焼き直しまで走る。** 外殻の注入だけしたいときは
  `python3 -c "import build; parts=build.read_shell(); [build.inject_shell(p,parts) for p in build.PAGES]"`
- 右下は空いているが、**下中央には `.fab`（口コミを書く）がいる**。320px 幅でも 30px の
  すき間が残ることを実測して置き場所を決めた（390px で 65px）

---

## 2026-08-29 ｜ ダークモードの文字コントラスト修正＋UI細部の見た目直し ｜ 松下(Claude) → 次の人

wangからの依頼（8/28 23:37「右の文字が見にくい」＋添付画像）を起点に、同じ原因の箇所をまとめて直した。
そのあと本人との対話の中で見つかった、select（学部・学年など）の見た目やカレンダー連携の
細かい不具合も同じブランチでまとめて直している。ブランチは `fix/darkmode-contrast`
（`fix/mypage-fav-term-note` はPR #83で既にマージ済みのため、`origin/main` から切り直した）。

### 1. 何が動く状態か

    python -m http.server 8123 --directory web
    # → http://localhost:8123/mypage.html （ブラウザ/OSをダークモードにして確認）
    # → http://localhost:8123/               （初回訪問の「学部と学年を教えてもらえますか」）

**ダークモードの文字コントラスト（`web/assets/mypage.css`・`web/assets/app.css`）:**
- `.mpFavActions button`（お気に入り一覧「時間割に入れる」「☆ 外す」）に `color:var(--soft)` を追加
- `.mpPick`（空きコマ配置ポップアップの科目ボタン）に `color:var(--ink)` を追加
- `#mpPicker` / `.mpCalDlg`（ダイアログ本体。空きコマ配置・カレンダー連携の両方）に
  `background:var(--card); color:var(--ink);` を追加 ―― ダイアログ自体が背景色を持たず
  常に白のままだったのが根本原因。これで中の「閉じる」ボタンや説明文もまとめて直った
- `.mpRow select`（プロフィールの学部・学年）に `background:var(--card); color:var(--ink);` を追加
- `#mpPickerSearch`（空きコマ配置の「科目名で検索」）に同上を追加
- `.onboardBtns button, .onboardOpts button`（初回訪問の「そのまま使う」「学部はどれですか」）に
  `color:var(--ink)` を追加

いずれも「背景色（`background`）だけ指定があって文字色（`color`）が抜けている」という同じ形の
バグで、ライトモードの見た目は変えていない（`--card`がライトでは元々白なので無変化）。
全箇所、ダークモード表示で文字が読めること・ライトモードが変わっていないことをブラウザで確認済み。

**ページャーの矢印ボタンのズレ（`web/assets/app.js`・`web/assets/app.css`）:**
スマホ幅で「科目を探す」一覧の一番下、ページ送りの `‹ 1 2 … 47 ›` の `‹`/`›` だけ位置がズレる不具合。
原因はクラス名衝突（後述）。矢印ボタンのクラス名を `nav` → `pnArrow` に変更して解消。
スマホ幅(375px)で矢印と数字ボタンの縦位置が完全一致すること、PC幅のヘッダーナビの見た目が
変わっていないことを確認済み。

**select（`<select>`）を開いたときの見た目（`web/assets/app.css`）:**
学部・学年などの選択肢一覧が「ブラウザ標準の白背景＋青いハイライト」のままで、サイトの色と
浮いていた件。`appearance:base-select`（CSSだけで`<select>`の中身を丸ごとスタイルできる新しい
プロパティ。HTML側の変更は不要）で、背景・ホバー色・行間・文字色をサイトの色に合わせた。

```css
select, ::picker(select){ appearance:base-select; }
::picker(select){ border:1px solid var(--rule); border-radius:var(--r-sm); background:var(--card); }
option{ padding:3px var(--sp-3); color:var(--ink); }
option:hover, option:focus{ background:var(--brand-soft); }
```

**Chrome/Edge 135以降・Safari 27以降で確認ずみ。未対応ブラウザ（2026-08-29時点のFirefoxなど）では
この宣言がまるごと無視され、直す前のネイティブ表示に戻るだけなので壊れない**（プログレッシブ
エンハンスメント）。行の高さは直す前の見た目（実測44px）に近づけたあと、本人の指示で30pxまで
詰めている。あわせて `#facSec select`（科目一覧の「学部を選ぶ」）の `display:block` が
`appearance:base-select` の内部レイアウトと衝突し、▼アイコンが文字の下に落ちる不具合も
`display:flex;align-items:center;justify-content:space-between;` に変えて直した
（`[hidden]`を上書きする目的は値ではなくセレクタの詳細度で成立するので、blockをflexに変えても壊れない）。

**カレンダー連携モーダルの説明文（`web/assets/mypage.js` `openCalAdd()`）:**
長すぎて読まれなかった説明文を短縮。「追加するカレンダーを選んでください。Outlook/Googleは
ログイン済みであることを確認してください。」を単一科目・複数科目どちらでも先頭に固定表示し、
「組織アカウントの場合はOffice365を選んでください」（ボタンのラベルで分かるので冗長）を削除、
祝日・振替対応の詳しい仕組みの説明は「秋・冬学期の祝日・振替授業日に対応しています（Googleでの
動作は未確認）。」の1文に短縮した（Aboutページへの切り出しは本人判断で見送り）。

**時間割マスとカレンダーアイコンの重なり（`web/assets/mypage.css`）:**
時間割の科目マス（`.mpCell.filled`）でタイトルが長いと、右上に重ねて置いている
カレンダー追加ボタン（`.mpCalBtn`）と文字が重なる不具合。`.mpCell.filled` に
`padding-right:22px` を追加して回避（縦方向の余白で確保すると、CSS Gridで同じ行の
他のマスまで一律に背が伸びるため、横方向で確保した）。

### 2. 何をしていないか

- ダークモード全体を1画面ずつ総ざらいしたわけではない。他の画面（口コミフォーム・詳細パネルなど）
  はまだ見ていない
- `appearance:base-select` はFirefox等の未対応ブラウザでは今まで通りの見た目（青いハイライト）の
  ままになる。全ブラウザで統一されたわけではない
- wangへの「直りました」報告はまだしていない

### 3. 次の人が最初にやること

    git status  # fix/darkmode-contrast ブランチ上、コミット済み

push・PR作成をするかは本人に確認すること。他にダークモードで読みにくい箇所が
見つかったら、同じ「`background`はあるのに`color`が無い」パターンを疑うとよい
（`grep -n "background:var(--card)" web/assets/*.css` などで拾える）。

### 4. 今回踏んだ罠

**ページャーの矢印ボタン、`class="pn nav"` の "nav" がヘッダーの `.nav`（ナビ帯）と
名前が衝突していた。** `app.css` の `@media (max-width:639px)` 内に
`.nav{margin:11px calc(-1 * var(--pad)) -12px; ...}` というスマホ幅専用ルールがあり、
本来はヘッダーのナビ帯用なのに、同じ`nav`というクラス名を持つページャーの矢印ボタンにも
効いてしまい、`margin-top:11px; margin-bottom:-12px` が乗って位置がズレていた。
PC幅（639px超）ではこのメディアクエリ自体が発動しないので、**スマホ幅でだけ**症状が出る。
2026-08-29の`panelBtn`/`ttAddBtn`衝突と全く同じ種類の罠（クラス名を見た目の使い回しだけで
決めると、無関係な既存セレクタに引っかかることがある）。**クラス名を足す前に、そのクラス名が
既に別の場所で（別の意味で）使われていないか `grep` で確認すること。**

**`<dialog>` 要素は `background`/`color` を自分で指定しない限り、OS/ブラウザがダークモードでも
常にライトモード扱いになる。** このサイトはどこにも `color-scheme` プロパティを宣言していないため、
`prefers-color-scheme: dark` を検知しても `<dialog>` のUA既定色（`Canvas`/`CanvasText`）は
ライトのまま変わらない。中の要素だけ`--ink`等のダーク対応トークンで直しても、乗っている土台
（ダイアログ自体）がライトのままだと「白背景に白文字」のような組み合わせが起こり得る
（今回`.mpPick`は自前の`background`を持っていたので事なきを得たが、`#mpPickerClose`は
`background:none`だったため、ダイアログの白地に明るいグレー文字が乗ってほぼ見えなくなっていた）。
**ボタン単体の文字色だけでなく、乗っている土台がダークモードに対応しているかも確認すること。**

**`<option>` は `<select>` から `color` を継承しない。** `appearance:base-select` で
select自体に`color:var(--ink)`を指定しても、中の`<option>`はUA既定の黒固定のままで、
ダークモードで「黒文字が暗い背景に乗ってほぼ見えない」状態になっていた（見た目は薄暗いグレーに
見えて一見「効いているように」誤認しやすい）。`option`に直接`color`を指定して解決。
これも上の`<dialog>`と同じ「継承に任せると効かないフォーム系要素がある」パターン。

**`appearance:base-select` は select の `display` を上書きしていると内部レイアウトが崩れる。**
`#facSec select{display:block}` のように意図的に`display`を変えていた箇所で、
選んだ文字と▼アイコンを横並びにする仕組みが効かなくなり、▼が文字の下に落ちた
（`.mpRow select`など`display`を触っていないselectでは問題が起きなかった）。
新しいCSS機能を既存の`display`上書きと組み合わせるときは、その上書きの元々の目的
（今回は`[hidden]`を上書きするため）を保ったまま値だけ調整できないか確認すること。

---

## 2026-08-29 ｜ PR #83 前チェック：build.pyスキップ判断とshots.mjsにserver.pyが要る件 ｜ 松下(Claude) → 次の人

上の①②（カレンダー連携・詳細パネルからの時間割追加）をまとめてPR化する前に、
`web/CLAUDE.md` 3章のPR前チェックを実行した記録。コード変更は `.claude/launch.json` への
1エントリ追加のみ（下記）。

### 1. 何が動く状態か

    for t in web_split tokens layout shell_inject scoring_gate reviews; do
      python tools/test_$t.py
    done

→ 5本OK。`test_reviews.py` のみ後述の理由でNG。

    node tools/shots.mjs <出力先> http://localhost:8000

→ 14枚すべて成功（`server.py` を `--port 8000` で起動している前提）。
`.claude/launch.json` に `server-py`（`python server.py --port 8000`）を追加したので、
次回からは `preview_start({name:"server-py"})` で起動できる。

`python build.py` は**実行していない**（理由は次項）。

### 2. 何をしていないか

- **`build.py` はあえて実行していない。** この機械の `data/courses.json` は共通教育
  1,112件しか無く、公開中の `web/data/courses.built.json`（全所属7,877件）を上書きすると
  6,765件減る。今回の変更（web/assets/配下のJS/CSSのみ）はスコアリング・データ生成に
  一切触れていないので、build.pyを回す必要自体が無いと判断した
- **`test_reviews.py` の1件（実データの受講年が全件埋まっている）はNGのまま。**
  科目id `137199` の口コミデータで受講年が1件欠落している。`git diff origin/main` で
  このブランチが `data/`・`web/data/`・`reviews.py`・`build.py`・`test_reviews.py` の
  どれも変更していないことを確認済みで、**このPRとは無関係な既存のデータ品質の問題。**
  直していない（口コミデータの担当はしゅんやさん／wangさん）

### 3. 次の人が最初にやること

`test_reviews.py` のNG（科目id 137199）を、口コミデータ担当に伝えるか自分で直すかを判断する。
急ぐものではない（このPRをブロックしていない）。

### 4. 今回踏んだ罠

**`node tools/shots.mjs` は `python -m http.server`（プレーンな静的サーバ）の上では
一部の画面が撮れない。** `/kuchikomi` のような拡張子なしURLをこのサーバは解決できず
404になり、12枚目（kuchikomi）で失敗する。`server.py` は「拡張子が無いパスは.htmlとして
探す」処理を持っているので、**shots.mjsを使うときは必ずserver.py（`python server.py`）を
使うこと。** `.claude/launch.json` に `server-py` 設定を足したので次回はそちらを使えばよい。

---

## 2026-08-29 ｜ 科目一覧の詳細パネルから「私の時間割」に追加 ｜ 松下(Claude) → 次の人

wangからの依頼②。これで①②とも完了。ブランチは `fix/mypage-fav-term-note`。

配置ロジック（コンフリクト確認＋上書き確認＋複数コマ一括配置）が `mypage.js` にしか
無く `index.html` から呼べない問題は、本人と相談し、中身を `store.js`（app.js/mypage.js
両方が既に読む共有ファイル）に `rkStore.putCourse()` として移して解決した。
通年・不明（`term_group` が full/unknown）の科目は、本人確認のうえ両学期に同時に追加する。

### 1. 何が動く状態か

`web/assets/store.js` に `termsFor`／`slotsOf`／`putCourse`／`inTimetable` を追加。
`web/assets/mypage.js` の `putCourse` は9行の薄いラッパーに縮小（挙動は変えていない）。
`web/assets/app.js` の `detailHtml()` に「時間割に追加」ボタンを追加し、クリック処理を
`favBtn` と同じ委任パターンで実装。`web/assets/app.css` に `.ttAddBtn` のスタイルを追加
（`.panelBtn` と見た目は同じ）。

    python -m http.server 8123 --directory web
    # → http://localhost:8123/?c=<科目id>（PC幅・1024px以上でないと右カラムの詳細が出ない）

科目詳細パネル下部に「時間割に追加」ボタンが出る。押すと:

- 曜限がある科目：その科目の`term_group`に応じた学期（aki/haru確定なら1つ、full/unknownなら
  両方）に、複数コマも一括で配置。既に別の科目が入っているコマがあれば、対象学期をまたいで
  1回だけ上書き確認（`[秋・冬] 水2：〇〇` のように学期ラベル付き）
- 曜限が無い科目：対象学期の「曜限なし枠」に追加
- 成功すると、ボタンが「時間割に入っています」に変わる（星と同じ即時反映）
- `mypage.html`を開くと実際に時間割グリッドに反映されている

ブラウザconsoleで直接 `rkStore.putCourse(...)` を呼んで単体確認、実際にボタンをクリックして
end-to-endでも確認ずみ（`node --check` 3ファイルOK、`node tools/test_mypage.mjs` 43件OK、
`python tools/test_layout.py` OK＝既存のマイページ動作に回帰なし）。

### 2. 何をしていないか

- 時間割からの削除（外す）操作はこの入口には無い。既存のマイページ側のグリッド操作を使う
- 一覧のカード自体（`card()`）には追加していない。あくまで詳細パネルのみ
- 通年・不明科目を「両学期に追加」とした結果、片方の学期だけ外したいケースは考慮していない
  （現状は両学期ともマイページ側で個別に外す必要がある）

### 3. 次の人が最初にやること

    git status  # fix/mypage-fav-term-note ブランチ上

①②とも完了。push・PR作成をするかどうかは本人に確認すること
（`web/CLAUDE.md` 3章の運用どおり、区切りがついたのでこのタイミングでまとめる想定）。

### 4. 今回踏んだ罠

**`app.js`（`courses.built.json`）の科目オブジェクトには `.slots` 配列が無く、
`day_period` の文字列（例:「水2」）しか持たない。** `mypage.js`（`timetable.json`）側は
既に `.slots` を持っていたため、最初「両方とも `.slots` がある」前提で実装し、動作確認で
初めて「一覧側の科目は必ず曜限なし扱いになる」バグに気づいた。`build.py` の `_SLOT`
正規表現（`[月火水木金][1-6]`）と同じ抽出をする `rkStore.slotsOf()` を足して解決。

**ボタンのCSSクラスに既存の `.panelBtn` をそのまま流用したところ、口コミ0件の科目で
`app.js` の `panelBtnFor`（`.panelBtn[data-id=...]` で口コミ件数ボタンを探す関数）が
新しいボタンを誤って口コミ一覧の開閉トグルだと誤認する事故が発生。** 見た目だけ共有し
（`app.css` で `.panelBtn,.ttAddBtn` にスタイルをまとめる）、クラス名自体は分けて解決。
**この手のクラス名の使い回しは、スタイルだけでなくクエリセレクタとしても使われていないか
確認してから流用すること。**

---

## 2026-08-29 ｜ カレンダー連携①振替授業日対応：単発予定の追加＋元の曜日の停止 ｜ 松下(Claude) → 次の人

前回（休講日対応）の続き。wangからの依頼①の残りだった振替授業日（10/16金→月曜授業、
11/5木→月曜授業）に対応した。**②（情報パネルから時間割に追加）はまだ未着手。**
ブランチは `fix/mypage-fav-term-note`。

本人に事前確認した2点: (1) 振替の単発予定は「カレンダーに追加」を押したときに自動で
一緒に入れる (2) 振替日は元の曜日（例: 10/16の金曜コマ）の通常進行も止める。両方その通り実装。

### 1. 何が動く状態か

`web/assets/mypage.js` に `TRANSFERS`／`transferSuspendDatesForDay`／`transferExtraDatesForDay`／
`transferRange`／`icsTransferEvent` を追加。`icsEvent`・`googleUrl`・`outlookUrl`・`buildICS`・
`onCalAddMethod`・`openCalAdd` を変更。

    python -m http.server 8123 --directory web
    # → http://localhost:8123/mypage.html

秋・冬学期タブで、月曜1限のみのコマに科目を入れて「カレンダーに追加」すると:

- **iCal**: 通常の月曜くり返し予定に加えて、10/16・11/5の日付に「（振替）科目名」という
  単発予定が2つ増える（ブラウザconsoleで `buildICS([{id:"t",title:"t",slots:["月1"]}])`
  を実行し、`DTSTART:20261016T0850`／`DTSTART:20261105T0850` の単発VEVENTを確認ずみ）
- 金曜1限のみのコマ（`slots:["金1"]`）で同様に確認すると、金曜のくり返し予定の`EXDATE`に
  `20261016`が入り、その日の通常の金曜回が正しく止まっている（10/16は本来金曜授業が
  休みで月曜授業だけが行われるため）ことを確認ずみ
- **Google/Outlook**: 月曜1限だけの科目で「カレンダーに追加」を押すと、通常の1回に加えて
  振替2件分のタブが開く（計3回。モーダルの件数表示 `tabCount` もこの数を反映するよう修正
  し、複数科目での実際のタブ数と一致することを確認ずみ）
- モーダルの注記文（秋・冬学期のみ）を「振替授業日には対応していません」から、
  対応済みである旨の文言に変更

### 2. 何をしていないか

- **春・夏学期（haru）の振替日（5/8金→水曜）は未収集。** `TRANSFERS.haru = []`のまま
- **wangからの依頼②（情報パネルから時間割に追加）は未着手。**
- Googleの`recur`でのEXDATE除外が実際に効くかは、前回同様引き続き未検証（振替の単発予定は
  くり返しを持たないので、この未検証事項の影響を受けるのは休講日除外の方だけ）
- テストは追加していない。ロジックはブラウザconsoleでの手動確認のみ

### 3. 次の人が最初にやること

    git status  # fix/mypage-fav-term-note ブランチ上

②（情報パネルから時間割に追加）に進むか、haru側の休講日・振替日を集めるかは本人に確認すること。

### 4. 今回踏んだ罠

特になし（前回のPDF取り違えの教訓をそのまま活かして、今回は最初からCELASの正しいURLで
データを確定できた）。

---

## 2026-08-28 ｜ カレンダー連携①祝日対応：秋・冬学期の休講日をEXDATEで反映 ｜ 松下(Claude) → 次の人

wang からの依頼2件（①祝日・振替授業日対応 ②情報パネルから時間割に追加）のうち①を実装した。
**振替授業日（②相当の扱い）は今回含まれていない。** ブランチは `fix/mypage-fav-term-note`。

（前回この項目に「学部ごとに休講日が違うかも」という懸念を書いていたが、CELAS発行の
全学共通教育学年暦を正しいURLで読み直した結果、その懸念は無かった。前回の記録は削除し、
この項目に差し替えている。）

### 1. 何が動く状態か

`web/assets/mypage.js` の「カレンダー連携」ブロック（`HOLIDAYS`／`CAL_SYNC_UNTIL`／
`isHoliday`／`holidayDatesForDay`／`nextDateFor`／`icsEvent`／`googleUrl`／`openCalAdd`）。

    python -m http.server 8123 --directory web
    # → http://localhost:8123/mypage.html

秋・冬学期タブで、休講日と重なる曜日のコマを「カレンダーに追加」すると:

- **iCal（.ics）**: `EXDATE` に休講日が正しく入る（曜日でフィルタ済み。ブラウザのconsoleで
  `icsEvent({id:"t",title:"t"},{day:"月",startPeriod:"1",endPeriod:"1"})` を実行して確認ずみ）
- **Outlook**: 単発の次回予定が休講日を自動で1週飛ばす（`nextDateFor` 側で対応。くり返し非対応なので
  これで十分）
- **Google**: `recur` パラメータに `EXDATE` を試験的に追加。**効くかどうかは未検証**（後述）
- 冬学期の繰り返し予定は 2027-02-08（月）で打ち切り（2/9以降は春休みのため）
- モーダルの注記文を、秋・冬学期のときだけ「iCal・Outlookは反映済み、Googleは未検証」に変更

秋・冬学期の休講日リスト（`HOLIDAYS.aki`。CELAS発行「令和8年度 全学共通教育 学年暦」
`R8_gakunenreki.pdf` を本人が2026-08-28に確認し確定）:

    2026-10-12（月・スポーツの日）　2026-11-02（月・大学祭）　2026-11-03（火・文化の日）
    2026-11-04（水・大学祭片付け）　2026-11-23（月・勤労感謝の日）
    2026-12-28〜31（月〜木・年末）
    2027-01-01（金・元日）　2027-01-11（月・成人の日）　2027-01-15（金）　2027-02-04（木）

判定ルールは「学年暦の丸数字（授業週番号）が付いていない平日＝休講日」という、本人が
PDF自身の凡例から確認した基準。2/9以降は本人の知識により「春休み」として一括で
繰り返し終了日（`CAL_SYNC_UNTIL.aki = 2027-02-08`）を早める形にした（個別の除外日にはしていない）。

### 2. 何をしていないか

- **振替授業日（10/16金→月曜授業、11/5木→月曜授業）には未対応。** 除外ではなく単発予定の
  追加になるため、性質が違う別実装が要る。②のタスクと合わせて着手する想定
- **春・夏学期（haru）の休講日は未収集。** `HOLIDAYS.haru = []`（空）のままなので、haru側は
  従来通り祝日にも予定が入る。モーダルの注記文もharuでは旧文言のまま
- **Googleの`recur`でのEXDATE除外が実際に効くかは未検証。** URLに正しく組み込まれることは
  確認したが、Google公式ドキュメントに記載が無く、ログインして実際にGoogleカレンダーに
  保存して除外が効くかまでは本人のアカウントでの確認が必要
- テストは追加していない（`tools/test_mypage.mjs` はカレンダー連携を見ていない。ロジックは
  ブラウザconsoleでの手動確認のみ）

### 3. 次の人が最初にやること

    git status  # fix/mypage-fav-term-note ブランチ上、コミット前

②（情報パネルから時間割に追加）に進むか、振替授業日対応をやるか、haru側の休講日を集めるかは
未確定。優先順位は本人に確認すること。

### 4. 今回踏んだ罠

**学年暦PDFのURLを取り違えていた。** 最初に使っていた
`www.sfs.osaka-u.ac.jp/.../academic_calendar2026.pdf` は外国語学部・人文学研究科向けの
学年暦で、全学共通のものではなかった（タイトル行で判明）。正しくは
`www.celas.osaka-u.ac.jp/.../R8_gakunenreki.pdf`（CELAS＝全学教育推進機構）。
学年暦PDFを使うときは、URLのドメイン・タイトル行の両方で「全学共通」かどうかを確認すること。

---

## 2026-08-28 ｜ マイページ：お気に入りの他学期科目に、次にする操作を書く ｜ 松下(Claude) → 次の人

本人（松下）が本番（https://rakuhan.nocode-sol.co.jp/mypage）を開いて
「お気に入りの授業に、時間割へ追加するボタンが無い」と報告したところから始まった項目。
**機能は正しく動いていて、文言だけの問題だった。**

### 1. 何が動く状態か

`web/assets/mypage.js` の `renderFavorites()` の1行（文言）＋コメント2箇所。
ブランチ `fix/mypage-fav-term-note`（コミット済み・**未push／PR未作成**）。

    python -m http.server 8123 --directory web
    # → http://localhost:8123/mypage.html

お気に入りに「いま見ていない方の学期」の科目があるとき、これまでは

    【総合】カーボンニュートラルと私たちの未来   金1   春・夏学期の科目です

とだけ出ていた。これは**状態の説明で、次に何をすればいいかを言っていない。**
学期タブは必ず「秋・冬」から始まる（`let term = "aki"`）ので、春・夏の科目しか
星を付けていない人は、開いた瞬間ボタンが1つも無い画面を見ることになる。

    【総合】カーボンニュートラルと私たちの未来   金1   春・夏学期に切り替えると入れられます

に変更。両方向（秋・冬タブ↔春・夏タブ）とローカルで確認ずみ。
タブを切り替えると「時間割に入れる」ボタンが出るところまで確認した。

### 2. 何をしていないか

- **タブの初期値（`let term = "aki"`）は変えていない。** 今日の日付から決める案（8月に開いたら
  春・夏を初期選択にする等）は、「いつ開いた人がどちらの学期を組みたいのか」を決める話で、
  9月末に秋の時間割を組みたい人と食い違う。wang に確認してから
- 文言を押したら該当タブに切り替わる案（B案）は採らなかった。触る範囲が増えるわりに
  得られるものが文言変更とほぼ同じだったため
- **`web/CLAUDE.md`（232行・松下の担当範囲と越えてはいけない線の正本）は、いまだに
  未コミットのまま手元にしかない。** 他の人・他の環境からは読めない。今回も触っていない
- テストは追加していない（文言のみの変更のため）。`tools/test_mypage.mjs` はこの文言を見ていない

### 3. 次の人が最初に打つコマンド

    git fetch origin && git log --oneline origin/main -3
    git checkout fix/mypage-fav-term-note   # この修正の続きを見るとき

PR は wang からの依頼2件（① カレンダー連携の祝日・振替授業日対応、
② 各授業の情報パネルから「私の時間割」に追加）とまとめて出す方針。

### 4. 踏んだ罠

- **「ボタンが無い」は、たいてい「条件を満たしていない」。** 実装漏れだと決める前に、
  その画面がどの状態で描かれているか（ここでは学期タブ）を先に見ること
- **wang が 8/28 に依頼した「お気に入り→時間割に直接入れる」は、8/27 の作業で実装ずみ。**
  ブラウザで確認した（押すと上の時間割に入り、表示が「時間割に入っています」に変わる）。
  作る前に画面で確かめること
- **`python -m http.server` はJSを強くキャッシュする。** HTML に `?v=2` を付けても
  `assets/mypage.js` は古いままで、直したはずの文言が出ない。ページ側で
  `fetch('/assets/mypage.js', {cache:'reload'})` を1回叩いてキャッシュを更新してから
  読み込み直すと確実（クエリ付きで fetch すると別物扱いになり効かない）
- Git Bash で `git commit -m @'...'@`（PowerShell のヒアストリング）は通らない。
  そのまま `@` が本文の先頭に入る。`git commit -F -` にヒアドキュメントを渡すこと

---

## 2026-08-27 ｜ マイページ：カレンダー連携の時刻・学期範囲を公式資料に合わせて修正 ｜ 松下(Claude) → 次の人

直前の項目（下の「② 本番実装」）で「1〜6限の時刻は想定値・未確認」と書いていたところに、
本人（松下）が全学共通教育の公式資料（授業開始・終了時間の表／令和8年度学年暦）を
提示してくれたので、それに合わせて直した。

### 1. 何が動く状態か

`web/assets/mypage.js` の変更のみ。手順は直前の項目と同じ
（`python -m http.server 8123 --directory web` → `/mypage.html`）。

- **1〜6限の時刻を公式の表どおりに修正。** 3〜6限が正午休みの分ずれていた
  （旧: 13:00-14:30 → 新: 13:30-15:00 など、4限まで全部30分ずつ後ろ倒し）
- **学期の開始日・終了日（`TERM_RANGE`）を令和8年度の学年暦から追加。**
  「秋・冬学期」＝10/1〜翌3/31、「春・夏学期」＝4/1〜9/30。これに伴い2つ直った：
  - カレンダーに追加したとき、**学期が始まる前の日付を最初の予定にしてしまうバグを修正。**
    今日（8/27）に秋・冬学期の科目を追加すると、直すまでは「次の月曜＝8/31」（学期開始前）が
    最初の予定になっていた。学期開始日（10/1）を下限にしたことで「学期が始まってから最初に
    来るその曜日」（10/5月曜など）に直った
  - 毎週のくり返しに **終了日（`RRULE:UNTIL`）を設定。** 前回までは学期が終わっても
    永遠にくり返る作りだった
- **モーダルの説明文に「祝日や大学祭による休講・振替授業日には対応していません。」を追加。**
  下記「何をしていないか」の内容を、コードのコメントだけでなく使う人にも見える形にした

### 2. 何をしていないか

- **祝日・大学祭による休講日、「金曜だけど月曜の時間割で授業」のような振替授業日には
  対応していない。** 本人と相談し、今回は保留と決めた（[3] 参照）。理由は、
  (a) 学年暦の画像1枚から全ての例外日を正確に拾いきれる自信が無い、
  (b) 年度が変わるたびに作り直しが必要になる、の2点
- **`TERM_RANGE` は令和8年度（2026年度）の日付を直書きしている。** 2027年度の学年暦が
  出たら `mypage.js` の `TERM_RANGE` を書き換える必要がある（次の年度の学年暦が出た時点で
  誰かが気づけるように、この HANDOFF と `mypage.js` 側のコメント両方に書いた）
- オリエンテーション期間中の最初の授業日（例：春学期は4/1開始でも実際の初回授業は
  4/10・4/13から）までは反映していない。「学期開始日以降でその曜日が最初に来る日」を
  最初の予定にしているだけなので、学期の最初の1〜2週は実際の初回授業日より早い日付に
  なることがある
- 実機（スマホ）確認・build.py・test_mypage.mjs・shots.mjs は前回から変わらず未実行
  （理由は直前の項目を参照）
- git commit はこれから行う。push・PR作成はまだ

### 3. 次の人が最初にやること

祝日・振替授業日への対応（上記「何をしていないか」1点目）をやるかどうかは保留のまま。
必要になったら、学年暦の例外日をリスト化して `mypage.js` に持たせる作業になる
（先に本人に確認してから着手すること。勝手に決めない）。

それ以外は直前の項目（PERIOD_TIMES確認）が完了したので、実機確認 → PR前チェック → PR作成へ進める。

---

## 2026-08-27 ｜ マイページ：カレンダー連携（追加・全部追加・削除）を本番実装／外すときに確認を追加 ｜ 松下(Claude) → 次の人

ブランチ `feat/mypage-calendar-sync` で作業。**まだ commit していない**（作業ツリーに変更が残っている）。
下の「① モックアップ」の続きで、ユーザー承認を得て本番の `web/` 側に実装した。モックHTML
（`tools/mockup_calendar.html`）は役目を終えたので削除ずみ。

### 1. 何が動く状態か

```bash
python -m http.server 8123 --directory web   # または .claude/launch.json の "web-static"
# http://localhost:8123/mypage.html → 空きマスをタップして科目を1つ入れる
```

- マスの右上に小さいカレンダーのアイコンが出る。タップすると iCal/Outlook個人/Outlook365/Google の
  4択モーダル（添付いただいた画像と同じ構成）。選ぶとアイコンがチェック印に変わり、
  もう一度タップすると「カレンダーから削除」の案内モーダルに切り替わる
- 見出し右の「全てカレンダーに追加」で、埋まっている科目をまとめて同じモーダルに渡せる
  （iCalは1ファイルにまとめてダウンロード、Outlook/Googleは科目の数だけタブが開く）
- **マスをタップして時間割から外すとき、今までは確認なしで即座に外れていたが、
  「ブラウザの確認ダイアログ（`confirm()`）」を挟むようにした**（今回の依頼どおり）

動作確認は Browser pane から `javascript_tool` で、ICS本文の中身・Google/OutlookへのURL・
連続コマ（金4金5金6の実験など）が1つの予定にまとまること・全部追加時の件数表示・
外す確認のキャンセル/OKの両方・390px幅でのレイアウト崩れ無しを確認した
（`git log` に載る前提のコードなので、スクリーンショットではなく実際にDOMを操作して確認）。

### 2. 何をしていないか（ここが一番大事）

- **1〜6限の時刻（`mypage.js` の `PERIOD_TIMES`）は「一般的な阪大の想定値」で、
  公式教務の時間割と突き合わせていない。** 8:50/10:30/13:00/14:40/16:20/18:00 開始という
  よくある区切りを仮置きしただけ。**違っていたら学生が実際の授業と違う時間の予定を
  カレンダーに入れてしまう。**PRを出す前に、正しい時刻を知っている人（wang？政岡？）に
  確認してもらってから公開してほしい
- **学期の開始日・終了日がこのアプリのデータに無い。** そのため「次にその曜日が来る日」を
  起点に、終わりを指定しない毎週くり返しにしてある。学期が終わっても消えないので、
  使う側が自分でカレンダーから消す前提（「サイト上の「追加ずみ」の印だけ消す」ボタンは
  あくまでサイト側の記録を消すだけで、実際のカレンダーの予定は消えない）
- **Outlookの簡易リンクは繰り返し予定に対応していない。** 次の1回だけが追加される
  （Googleとの違いはモーダルの説明文で断ってはいるが、目立たせてはいない）
- **実際にダウンロードした .ics ファイルを Google/Outlook/Apple のカレンダーアプリに
  取り込んで正しく表示されるかまでは確認していない。** 確認したのはURLの組み立てと
  ICSのテキストの形（`DTSTART`/`DTEND`/`RRULE` 等）だけ
- **実機（スマホ）は未確認。** ブラウザ幅390pxでの崩れは無いことだけ確認した
- **`python build.py` は今回も実行していない。** 前回（8/27の検索機能追加時）と同じ理由で、
  手元の `data/courses.json`（1,112件）が `courses.built.json`（7,877件）より少なく、
  安全装置で止まる。今回の変更は `courses.built.json` に触れていないので実害は無い
- **`node tools/test_mypage.mjs` と `tools/shots.mjs` は未実行。** playwright 未インストール
  （前回と同じ既知の制約）
- git commit / push / PR作成は、していない

### 3. 次の人が最初にやること

```bash
git status   # store.js / mypage.html / mypage.css / mypage.js の変更を確認
```

1. **`PERIOD_TIMES`（`web/assets/mypage.js` 内）の時刻が正しいか確認する。** 正しい値が
   分かればそこの6行を差し替えるだけで直る
2. 実機（iPhone・Android）で一度触ってみる
3. 問題無ければ commit → `python3 build.py` 等のPR前チェック → PR作成

### 4. 踏んだ罠

- **`<button>` の中に `<button>`（カレンダーアイコン）を入れると、スクリーンリーダー的に
  おかしくなる（ネストした対話要素）。** `.mpCellWrap` という `<div>` を挟んで、
  「外すボタン」と「カレンダーアイコンのボタン」を兄弟要素にすることで解決した
  （マス本体のクリック判定とカレンダーアイコンのクリック判定が別物になり、
  `stopPropagation()` も不要になった）
- Google カレンダーの「予定を追加」URLは `recur` パラメータで毎週くり返しに対応できるが、
  Outlookの簡易リンク（`deeplink/compose`）には同等のパラメータが無い。無理に付けても
  Outlook側が何をするか保証できないので、**Outlookは「次の1回だけ追加される」と
  正直にモーダルの説明文に書いた**
- カレンダーから削除する予定を「開く」ボタンは、確度の低いURL（Outlookの特定の日を
  ピンポイントで開くURL）を作るのをやめ、Googleは実在が確実な「日別表示」URLへ、
  Outlookは週表示のトップへ、と誠実さを優先して案内先を下げた
- 本番の `web/CLAUDE.md` の「app.css / mypage.css に裸の色を書かない」ルール
  （`tools/test_tokens.py` が見張っている）に引っかからないよう、追加した色は
  すべて既存の `var(--brand)` `var(--brand-text)` `var(--band-light-*)` 等の
  トークンだけで組んだ（新しい色トークンは1つも足していない）

---

## 2026-08-27 ｜ マイページ：カレンダー連携UIのモックアップ（デザイン検討中・未実装） ｜ 松下(Claude) → 松下自身（次回続き）

本番コードへの変更なし。`tools/` にモックHTMLを1枚作っただけの段階。

### 1. 何が動く状態か

```bash
python -m http.server 8124   # リポジトリ直下で（.claude/launch.json の "repo-root" でも可）
# http://localhost:8124/tools/mockup_calendar.html を開く
```

`web/assets/tokens.css` `app.css` `mypage.css` を読み込んで本番と同じ見た目で、
①1コマだけ追加 ②時間割まるごと追加 ③追加ずみからの削除 の3導線をクリックで試せる。
ボタンを押しても実際のファイル生成・外部サイトへの遷移は起きない（画面内の状態が変わるだけ）。

### 2. 何をしていないか

- **iCal生成・Google/Outlookの実際の連携リンクは未実装。** ボタンは全部モック（alertとトースト表示のみ）
- **「全部まとめて追加」で表示する回数（例：5回）は今のサンプルデータに合わせた固定文言。** 本番では
  実際に埋まっているコマ数を数えて出す必要がある
- カレンダーからの削除は、サイト側にOAuth連携が無い前提で「削除は各カレンダーアプリ側でやってもらう」
  設計にしている。**これで良いか、本人（松下）の判断待ち。** Google/Outlook APIで直接削除する方向に
  するなら設計から見直しが必要（OAuth同意画面が増える等、影響が大きいので提案のみに留めた）
- スマホ幅（390px）での見た目は未確認。PCの1280pxでのみ確認した
- モックは `tools/` 配下（web/ には置いていない＝直下 CLAUDE.md の「開発者用ファイルはtools/へ」に合わせた）

### 3. 次の人（＝次回の自分）が最初にやること

上記URLを開いて実際に触り、①②③のUI・文言・削除の設計方針（「サイト側では消せない」で良いか）に
OKが出たら、`web/mypage.html` `web/assets/mypage.css` `web/assets/mypage.js` へ本実装として反映する。

### 4. 踏んだ罠

- `.claude/launch.json` の既存 `web-static` は docroot が `web/` なので、`tools/` 配下から
  `../web/assets/...` を読むモックはそのままでは404になる。リポジトリ直下を配信する
  `repo-root`（ポート8124）を launch.json に追加して回避した
- 削除確認モーダルの文言で「『月2 ◯◯』の予定を削除してほしい」の `◯◯` を科目名に置換するJSを
  書き忘れ、`◯◯` のまま出ていた。Browser paneでの動作確認（get_page_text）で発見して修正した
  ―― 見た目の確認だけでなく実際にモーダルを開いてテキストを読むまで気づかなかった

---

## 2026-08-27 ｜ マイページ：時間割ピッカーに検索・背景クリックで閉じるを追加 ｜ 松下(Claude) → 次の人

PR #78 で `main` にマージ・push 済み（マージコミット `e1be70b`）。

### 1. 何が動く状態か

```bash
python -m http.server 8123 --directory web   # または .claude/launch.json の "web-static"
# http://localhost:8123/mypage.html を開き、時間割の空きコマ（候補が多い月1がおすすめ・97件）を押す
```

- `web/mypage.html`：ピッカーの `<dialog id="mpPicker">` に `<input id="mpPickerSearch">` を追加
- `web/assets/mypage.js`：
  - `openPicker`/`renderPickerList` に分割し、検索欄に1文字打つたびに科目名（`c.title`）で
    即座に絞り込む。空文字なら全件、該当0件なら「検索語に一致しない」旨のメッセージに出し分け
  - `boot()` に、`<dialog>` 自身をクリック（＝背景／中身の無い余白をクリック）したときだけ
    `close()` する処理を追加（`e.target === e.currentTarget` で判定。`::backdrop` はDOMノードでは
    ないため、背景クリックは dialog 要素自身がターゲットになる、という仕様を利用）
- `web/assets/mypage.css`：`#mpPickerSearch` と `#mpPickerClose` を追加。閉じるボタンは
  今までブラウザ標準の見た目のままだったので、口コミフォームの `.fbCancel`（`feedback.css`）と
  同じ枠線・角丸8px・`--soft` 文字色に揃えた

動作確認は Browser pane から `javascript_tool`／`get_page_text` で、検索の絞り込み・0件表示・
検索欄クリアで全件に戻る・科目選択で時間割に反映されモーダルが閉じる・別コマを開き直すと検索欄が
リセットされる・背景クリックで閉じる／中身クリックでは閉じない、を確認済み。

### 2. 何をしていないか

- **`python build.py` は実行していない。** 手元の `data/courses.json`（1,112件）が現在の
  `web/data/courses.built.json`（7,877件）より大幅に少なく、build.py 自身が
  「上書きすると6,765件減る」と警告して停止した。今回の変更は courses.built.json に触れて
  いないので実害は無いが、**手元の courses.json は古い／一部データの可能性が高い。**
  次に build.py を回す人は、まず最新の courses.json を揃えてから
- **`node tools/shots.mjs` は未実行。** playwright 未インストール（`node_modules/playwright` 無し）
  に加え、このスクリプトの撮影対象（`VIEWS`）に `/mypage` が入っていないため、走らせても
  今回の変更は写らない
- **実機（スマホ）での見た目・タップ操作は未確認**
- `tools/test_reviews.py` は失敗中（`受講年が全件埋まっている` ／ id `137199`）だが、
  **`git stash` して main の状態でも同じ失敗を確認済み。今回の変更とは無関係の既存不具合**
  （口コミ集計データ側。担当は しゅんや／wang）

### 3. 次の人が最初にやること

特に無し。上記「何をしていないか」の build.py・shots.mjs・実機確認・test_reviews は
残作業として認識だけしておく。

### 4. 踏んだ罠

- **`build.py` は入力件数が今の built.json より大きく減ると安全装置で止まる**
  （`--allow-fewer-courses` で強行できるが、今回は「手元データが古いだけ」と判断して見送るのが正解）
- **Windows のターミナルは既定 `cp932`。** `✗` 等の記号を `print` する Python が
  `UnicodeEncodeError` で落ちる（`test_reviews.py` がこれで初見は失敗内容が読めなかった）。
  `PYTHONIOENCODING=utf-8` を前に付けて再実行すると中身が読める
- **Claude Browser の `javascript_tool` はページ内で `const` 宣言した変数が次回実行にも残る**
  （別スクリプトとして分離されない）。2回目以降で `Identifier ... has already been declared`
  になったら `(function(){...})()` で包む
- **`tabId` を省略すると、複数タブがある状態で存在しないタブに実行されることがあった。**
  毎回 `tabId` を明示する
- **この項目自体、区切り時に指示なしで書く決まりだったのに、最初は口頭（チャット）で
  出すだけで終えて HANDOFF.md への追記を忘れた。** ユーザーの指摘で気づいて追記。
  「区切りがついたら」の判定を自分でしたつもりでも、実際に書き終えるまでは区切りにしない

---

## 2026-08-27 ｜ フィルタUI改善：学部セレクトを拡大／卒業要件チップを折りたたみ ｜ 松下 → 次の人

しゅんやさんの Discord 指摘（フィルタの並び順・学部ボタンが小さい）に対応。
並び順は「しゅんやさんに先に確認してから」の方針だったが、本人（松下）の判断で
**確認前に実装まで進めた**（下記「何をしていないか」参照）。

### 1. 何が動く状態か

```bash
python -m http.server 8123 --directory web   # または .claude/launch.json の "web-static"
# http://localhost:8123 を開き、レールの並びが 学年→卒業要件/学部→学期 になっていること、
# 「学部を選ぶ」セレクトが押しやすい大きさになっていること、
# 「卒業要件の区分でしぼる」が既定で閉じていることを確認
```

- `web/index.html`：「学期」セクションを「学年」セクションの下に移動。
  `buildFaculty()`（app.js）が `years.parentNode.insertBefore(sec, years.nextSibling)`
  で「学年」の直後に卒業要件/学部セクションを差し込む仕組みを利用し、
  index.html側の並び替えだけで見た目の順序を **学年→卒業要件/学部→学期** にした
  （app.js側の変更は不要だった）
- `web/assets/app.css`：`#facSec select`（`#facSel` 学部・`#trackSel` トラック）を
  幅いっぱい・パディング11px14px・枠線ありに拡大（旧: margin-bottomのみでブラウザ既定の細いまま）
- `web/assets/app.js`（`buildFaculty()`）：「卒業要件の区分でしぼる」のチップ本体
  (`#divs`) を既定で閉じ、`#divsTog` ボタンを押すと開く形に変更。
  既存の `#divTog`/`#divsOff`（卒業要件外の区分の開閉）と同じ `hidden` 属性パターンを流用。
  すでに区分を選んだ状態で作られた場合は開いた状態で始まる（`state.division.size > 0` 判定）
  ―― ただし今の実装には区分をURL等から復元する経路が無いので、この分岐は現状常に「閉じる」側を通る

動作確認は Browser pane から `javascript_tool` で `#divsTog.click()` → `#divs.hidden` の
true/false 切り替え、学年チップ押下後も選択中の区分チップと開閉状態が保持されること、
`aside`内の `h2` の並びが `学年→卒業要件の区分でしぼる→学部からさがす→学期` になっていることを確認済み
（`load()` の再描画で状態が壊れない）。

### 2. 何をしていないか

- **並び順「学年→学部→学期」は、しゅんやさんの原文を松下＋Claudeで解釈した結果であり、
  しゅんやさんご本人の確認はまだ取れていない。** 原文「学年→学部→学年」は学年が
  2回出て矛盾していたため、学年→学部→**学期**（使用頻度が低い学期を最後に送る）と
  解釈して実装した。**しゅんやさんから別の意図だと返答があれば、並び順は再調整が必要。**
  index.html の「学期」セクションを動かすだけで直せる仕組みなので、修正自体は軽い
- **`web/CLAUDE.md` の app.js を今回直接編集した。** 同ファイルの担当表では
  「カードと詳細のHTML以外のapp.jsはwang担当・松下は編集しない」となっているが、
  今回は本人が「その担当ファイルの話はどっか行ったので全部実装してOK」と明言したため実施。
  ドキュメント側（web/CLAUDE.md 1章・オーナー表・7章）も同じ会話内で実態に合わせて更新ずみ
- **PR前チェック（`build.py` → `tools/test_*.py` → `node tools/shots.mjs`）は未実行。**
  今回はローカル静的サーバ＋ブラウザのJS実行で見た目と挙動だけ確認した
- git commit / push はしていない。作業ツリーに変更が残っている状態
- **最初、この作業を origin/main を fetch/pull せずに始めてしまった。** 気づいた時点で
  26コミット遅れており（マイページ・お気に入り・LINEログインの Phase 1 マージ含む）、
  下の「踏んだ罠」に手順を残した

### 3. 次の人が最初にやること

```bash
git status   # app.css / app.js / index.html / HANDOFF.md の変更を確認
python3 build.py
for t in web_split tokens layout shell_inject scoring_gate reviews; do python3 tools/test_$t.py; done
node tools/shots.mjs /tmp/rk
```

しゅんやさんに並び順（学年→学部→学期で実装した旨）を確認してもらう。
違う意図だった場合は `web/index.html` の「学期」セクションの位置を
動かすだけで直せる（`buildFaculty()` が「学年」の直後に差し込む仕組みなので、
「学期」をどこに置くかだけで並びが決まる）。

### 4. 踏んだ罠

- **作業に入る前に `git fetch origin && git log --oneline origin/main -3` をやらず、
  26コミット遅れた状態のまま編集してしまった。** web/CLAUDE.md 3章に書いてある
  手順そのものだったのに、最初は踏まなかった。気づいたのはユーザーからの
  「最新のリポジトリ状態にしてから編集した？」という確認がきっかけ。
  復旧手順：`git stash push -- <編集した追跡ファイルだけ>`
  （web/CLAUDE.md など今回のセッション中に追加した未追跡ファイルは対象に含めない）→
  `git merge --ff-only origin/main` → `git stash pop`。
  app.css・app.js・index.html は編集した行が upstream の変更と重ならず自動マージできたが、
  **HANDOFF.md は「ルールの直下に追記する」という同じ場所に両者が挿入していたため
  コンフリクトした。** `git checkout --ours -- HANDOFF.md` でupstream版に戻し、
  自分のエントリを手で先頭に挿し直した
- **Browser pane が非表示だと `computer`（クリック・スクリーンショット）が
  タイムアウトする。** `javascript_tool` で `element.click()` を直接呼ぶ・
  `getComputedStyle` で確認する形に切り替えたら通った。見た目のピクセル単位の
  最終確認はまだ本物の画面で見ていないので、次の人は一度目視してほしい
- `.chips[hidden]{display:none}` が既にCSS側にあったので、`#divs` にも新しいCSSを
  足さずに `hidden` 属性だけで開閉できた。もし今後 `.chips` を使わない要素を
  同じ手で開閉したいなら、このルールが無いので別途CSSが要る
- **（今回とは無関係・未確認のまま残す）** pull 後の初回読み込みで1度だけ
  `Uncaught ReferenceError: rkStore is not defined at app.js:1415` をコンソールで見た。
  store.js は defer無しで app.js より先に読み込まれる並びなので通常は起きないはず。
  同じタブで何度リロードしても再現せず、画面（一覧・チップ・facSecの中身）は
  正常に描画されていたので、今回のBrowser pane環境固有の一過性の現象の可能性が高い。
  wangさんの Phase 1 マージとは無関係な今回の変更では触っていない箇所なので直していない。
  **実機・別ブラウザで再現するようなら報告してほしい**

---

## 2026-08-27 ｜ マイページ・お気に入り・開屏の問診（Phase 1）を main にマージ ｜ wang

### 1. 何が動く状態か

**本番に入っている**（`27caceb`）。ログインは一切要らない。状態は全部ブラウザの localStorage。

- **6限がグリッドに出る** ―― `PERIODS` が 1..5 だったため、**6限にしか開かれない29件**が
  空きコマグリッドから永久に辿れなかった。`server.py:81` / `app.js` の2箇所に散っていたので
  `tools/test_periods.mjs` で3箇所の一致を見張る
- **お気に入り**（☆/★）―― 一覧のカードと詳細パネル。絞り込みにも並び替えにも効かない、ただのしおり
- **開屏の問診** ―― 学部・学年を一生に一度だけ聞く。**降りるのは問診そのもので、設問ごとではない**
- **/mypage** ―― プロフィール／私の時間割（5×6・学期ごとに独立）／お気に入り。
  星＝候補、コマに入れて確定、の2段構え
- **LINE bot** ―― 学年 → 学部 → 優先度。学年の設問から「答えたくない」を外し、
  降り口を greeting の1箇所に揃えた（サイト側と同じ線）

```bash
git pull
cd web && python3 -m http.server 8140 &
for f in tools/test_*.mjs; do node "$f" http://localhost:8140 || echo "FAIL $f"; done
for f in tools/test_*.py; do python3 "$f" >/dev/null || echo "FAIL $f"; done
kill %1
```

### 2. 何をしていないか

- **Phase 2（LINE ログインと端末間の同期）は未着手。** 設計だけ在る
  （`docs/plans/2026-08-26-line-login-mypage-design.md` の4章）。
  方式は「署名リンク＋リンクコード」で、**LINE Login チャネルの新規申請は不要**。
  ただし前提が2つ未了 ―― **プライバシーポリシーが全サイトに1つも無い**（4.1）と **D1 未接続**
- **`docs/plans/…-plan-phase1.md` の参考コードは初版のまま。** 実装中に**12件の欠陥**が
  そこで見つかり、コード側だけ直した。**この plan から写経しないこと。**
  実際に落ちた版はコードそのものが正
- **口コミ投稿ページの時間割とはデータを共有していない**（意味が違う：マイページ＝これから受ける／
  kuchikomi＝もう受けた）。共有しているのは `osaka_u_settings`（学部・学年）だけ
- **既存の赤2件は直していない**（このブランチ由来ではない・main でも赤）：
  `tools/check_division_ui.mjs` の NG 2件、`tools/shots.mjs` が消えた `/progress.html` を撮っている

### 3. 次の人が最初にやること

```bash
git pull                       # 本体の checkout は 6c925eb のままなので必ず
python3 tools/test_index_gate.mjs   # ページを足したら必ずここを通る（一覧は自動導出に変えた）
```

新しいページを足すときは `templates/shell.html` だけ直して注入を流す:
```bash
python3 -c "
import build
parts = build.read_shell()
print('注入:', [p.name for p in build.PAGES if build.inject_shell(p, parts)])"
```

### 4. 踏んだ罠

- **plan に書いた参考コードを信じすぎた。** レビューが12件の欠陥を見つけ、うち3件は
  実害があった ―― スマホで星が押せない（重なって pointer events を奪っていた）、
  「相性」の数字を押すと詳細でなくお気に入りが切り替わる、
  `requirements.json` の取得に失敗すると問診が**リロードしても抜けられない**行き止まりになる。
  **全部レビューで見つかった。書いた本人には見えていなかった**
- **dispatch する「必ず走らせるテスト」の一覧を絞ると回帰が抜ける。** 4本だけ挙げていたため
  `test_sort.mjs`（問診の幕が pointer events を奪う）と `test_tokens.py`（裸の色）の
  2件の回帰が3タスク分すり抜けた。**`tools/test_*` は全部走らせる**
- **UI を駆動するスクリプトは全部 `rk_onboarded` を立ててから goto する。**
  とくに `tools/shots.mjs` ―― PR のスクショ差分 CI が使うので、忘れると
  **全ページのスクショが問診の幕になり、差分レビューが静かに無意味になる**（エラーは出ない）
- **生成ページの衝突を `git checkout --ours` で片付けてはいけない。** 自動マージ済みの
  main 側の変更（canonical・OGP・description・hero）まで捨てる。`git merge-file` で三方マージし、
  そのあと `inject_shell()` を流す。しかも **`全学部の科目` は `<title>` と description の本文に居る**ので、
  canonical だけ見ても取り違えに気づけない
- **`main` は作業中に4回進んだ**（`eaf4f9b`→`3e42d25`→`eaf4f9b`→`10d939c`→`6c925eb`）。
  設計を書く前と書き終えた後の2回 `git log` を見ること

---

## 2026-08-26 ｜ スマホのヘッダを2段に組み直した（ロゴ行と menu 行）｜ 次の人へ

`main` へ直接入れた（見た目だけの変更で、データにも API にも触っていない）。
触ったのは `web/assets/app.css` の狭い画面ブロックと `web/assets/tokens.css` のトークン2本だけ。

### 1. 何が動く状態か

**スマホで「ロゴ＋阪大 全学部の科目＋Designed by GUILD」が1行に収まり、
ナビはその下の別の帯になった。** ヘッダの高さは 390px 幅で 183px → 139px。

```bash
python3 -m http.server 8142 --directory web &
python3 tools/test_layout.py && python3 tools/test_tokens.py && python3 tools/test_shell_inject.py
node tools/test_index_gate.mjs && node tools/test_feedback.mjs
```

やったこと2つ。

- **`.lockup` を `flex-wrap:nowrap` に。** 以前は GUILD だけが2行目に落ち、
  ロゴ／GUILD／ナビの3段だった。折らない代わりに **519px 以下でロゴを
  `clamp()` で画面幅に追従**させる（`h1 .wm` は clamp(17px,5.7vw,28px)）。
  clamp の上限＝等倍の値なので 520px 側との境目で段差が出ない
- **ナビを一段下の帯にした。** `margin` を負にして header の左右 padding を
  打ち消し、画面幅いっぱいに `--on-dark-band`（白 6%）＋上罫 `--on-dark-band-line`。
  399px 以下は 4項目が1行に入らないので **2×2 のグリッド**に組む
  （flex の折り返し任せだと 3＋1 になり、余った1つが迷子に見えた）

幅ごとの実測（`.h1 + .by` が親に収まるか、添え書きが折れないか）：
240/280/300/320/360/375/390/412/428/430/480/520/600/639 の全部で横スクロール無し。
**319px 以下は1行に入らないので、そこだけ以前どおり2段に戻す**（`max-width:319px`）。

### 2. 何をしていないか

- **640〜900px（タブレット）は直していない。** この幅は**前から**同じ壊れ方をする
  ―― `.hd` が横並びのまま lockup が内部で折れ、GUILD が2行目に落ちてヘッダが 124px になる。
  `git stash` して測っても同じ数字だったので、今回の変更が原因ではない。
  直すなら「2段に組む」処理を 639px から ~915px まで引き上げることになり、
  タブレットのヘッダの形が変わる決定になるので手を付けなかった
- **添え書き「阪大 全学部の科目」も一緒に縮んでいる**（13px → 428px 幅で 12.4px、
  390px 幅で 11.3px）。ロゴだけ縮めて添え書きを 13px 固定にすると、360px 幅の端末で
  ロゴを 18px まで落とさないと入らない。両方を少しずつ譲る形にしてある
- **PC（640px 以上）は1行も触っていない。** 変更は全部 `max-width` のメディアクエリ内

### 3. 次の人が最初に打つコマンド

```bash
curl -s https://rakuhan.nocode-sol.co.jp/assets/app.css | grep -c 'on-dark-band'   # 2 なら反映ずみ
node tools/shots.mjs shots/hdr http://127.0.0.1:8142   # 01/07/12/14 がヘッダの確認用
```

### 4. 踏んだ罠

- **`app.css` に裸の `rgba()` は書けない。** `tools/test_tokens.py` が落とす。
  帯の色は `tokens.css` にトークンとして足す（今回 `--on-dark-band` 系2本を追加）。
  文字ではないのでコントラスト表には載せない、という既存の `--shadow-*` と同じ扱い
- **「1行に収まるか」は目視では分からない。** 390px では収まって 375px で添え書きが
  2行に折れる、という差が出た。`h1` と `.by` の `getBoundingClientRect()` を
  幅ごとに出して数字で確かめること。playwright は `node_modules/` に入っている
  （リポジトリ直下で実行しないと `ERR_MODULE_NOT_FOUND`）
- **`flex-wrap:nowrap` ＋ `min-width:0` は、入らなくなっても黙って重なる。**
  280px で「ラ」が左に切れ、添え書きと GUILD が重なっていたのに
  `scrollWidth === clientWidth` のままで、はみ出し検査では捕まらなかった

## 2026-08-26 ｜ 宣伝リンク /l/<slug> から開くと一覧が出なかった（本番の事故・修正ずみ） ｜ 次の人へ

`main` へ直接入れた（利用者から「開いても科目が出ない、何かボタンを押すと出る」と報告）。

### 1. 何が動く状態か

**14本の計測リンクから開いても、トップと同じように一覧が出る。**

```bash
node tools/test_index_gate.mjs   # OK 33件（相対パス fetch の検査を3件追加）
```

原因は **`/l/<slug>` は転送しないので、ページの基準URLが `/l/` になる**こと。
app.js がデータを相対パス（`fetch("data/courses.built.json")`）で取っていたため
`/l/data/courses.built.json` を叩き、Worker がそれを「知らない slug」と見て 404 を返す。
404 の本文 `not found` を `.json()` に食わせて例外 → 起動処理ごと止まり、
一覧が「読み込み中…」のまま固まっていた。**トップから開いた人には起きない**ので、
公開から気づくまで時間がかかった。宣伝で配ったリンクだけが壊れているという最悪の形。

直したのは **app.js 側（3本の fetch を絶対パス `/data/…` に）** だけ。Worker では直さない
―― `/l/` 配下で「slug かデータファイルか」を判定する仕組みを入れると、slug を足すたびに壊れる。

### 2. 何をしていないか

- **kuchikomi.js など他ページのスクリプトは元から絶対パス。** 検査は index.html が
  読む `<script src="/assets/…">` 全部を見るので、今後どれかが相対に戻れば落ちる
- **`/l/<slug>` 以外の配信経路は触っていない。** noindex・no-store・転送しない方針もそのまま

### 3. 次の人が最初に打つコマンド

```bash
curl -s https://rakuhan.nocode-sol.co.jp/assets/app.js | grep -c 'fetch("/data/'   # 3 なら反映ずみ
```

### 4. 踏んだ罠

- **「転送しないURL」を足したら、そのページが使う相対パスは全部道連れになる。**
  script/css は元から `/assets/…` だったので画面は出た。出たぶん「壊れている」と
  見えず、データだけが静かに落ちていた。**画面が出ることは、動いていることではない**
- 再現は wrangler なしでできる。web/ を配る素の HTTP サーバに
  「`/l/<既知slug>` は index.html、`/l/` の他は 404」を足すだけで本番と同じ形になる

---

## 2026-08-26 ｜ おすすめ順を「検証ずみが先」に変えた（公開基準②の未達を解消） ｜ wang → 次の人

ブランチ `feat/wang-verified-first`（作業ツリー `../rakutan-verified`）。
**ランキングの並び順を変えたので、サービスの見え方が変わります。**

### 1. 何が動く状態か

**おすすめ順の第1キーが「テストの難しさが確認できているか」になった。** 相性はその次。

```bash
python3 tools/test_recommend_order.py     # 27件（サーバ不要）
cd web && python3 -m http.server 8201 &
node tools/test_sort.mjs http://localhost:8201        # 13/13
node tools/test_conditions.mjs http://localhost:8201  # 18/18
```

| | 前 | 後 |
|---|---|---|
| おすすめ上位（重複除く） | 371件 | 176件 |
| うち検証ずみ | **0件（0%）** | **176件（100%）** |
| 1年・とにかく軽い の先頭 | 97.4点「拘束は軽い」口コミ0件 | 82.9点「軽め」口コミ3件 |

**これで ROADMAP 5章の公開基準②「おすすめ上位100件が検証ずみで埋まっている」を満たす。**
8/18 の項に書いてあった「一番目立つ場所が一番あやしい」（検証していないから
薦めている状態）が、ここで解消された。ROADMAP 自身が「収集ではなく表示で解く」
と書いていたとおりの手当て。当時の在庫は158件、いまは556件ある。

**先頭の点数は下がる**（97→83前後）。これは劣化ではなく、**根拠のある科目に入れ替わった**
ということ。点数の高い未検証の科目は消えたわけではなく、検証ずみの後ろに並んでいる。

### 2. 何をしていないか

- **「楽単度順」「口コミの多い順」などの他の並び替えは触っていない。** 利用者が
  自分で選んだ順序を勝手に組み替えないため。変えたのは既定の「おすすめ順」だけ
- **口コミを増やす手当てではない。** 門（同じ科目に中身の違う口コミ3件・
  `reviews.py` の `MIN_FOR_SCORING`）を通ったのは今も2科目だけ。
  144件が120科目に散っているため（1件だけ＝108科目／2件＝10／3件＝1／4件＝1）。
  **同じ科目に3件揃わないと門は開かない** ―― 量ではなく集中が要る
- **`data/courses.json`（全所属7,877件の生データ）は手元に無い。** 手元にあるのは
  8/20 の1,112件版。だから `build.py` を普通に流すと科目が減る（安全弁が止めてくれる）

### 3. 次の人が最初に打つコマンド

```bash
git pull
python3 tools/test_recommend_order.py
```

**生データを持っていない人が並び順だけ直したいとき**は、焼き済みの JSON から
preset_top だけ組み直せる:

```bash
python3 build.py --represet     # courses は触らない。順位だけ焼き直す
```

### 4. 踏んだ罠

- **順序を直す場所は3つある。** `build.py` の `preset_key()`（＝正本。LINE が読む
  `preset_top`）、`server.py` の `search()`、`web/assets/app.js` の `byFit`。
  **本番は静的配信なので、app.js を直さないと利用者には何も変わらない**
- **`build.py` が流せなかった。** 全所属ぶんの生データが手元に無く、1,112件で
  上書きしかけて安全弁に止められた（`--allow-fewer-courses` を付けてはいけない場面）。
  → `--represet` を足して、焼き済みの JSON から順位だけ組み直せるようにした。
  順序のロジックは `rank_presets()` の1か所のまま
- **テストは「わざと壊して落ちること」まで確かめた。** 未検証の科目を上位に
  差し込んだら 2件落ちて、戻したら通った。落ちないテストは無いのと同じ
- **`str.replace()` を count 無しで使って自分の関数を再帰にした。** 切り出した
  関数の中身と呼び出し側が同じ文字列だったため。`RecursionError` で気付いた

---

## 2026-08-26 ｜ 🚨 301 で本番を2分止めた／独自ドメインは Cloudflare を向いていない ｜ wang → 次の人

旧ドメインを独自ドメインへ 301 で寄せる変更（PR #70）を入れたら**本番が壊れた**ので
revert した（PR #71）。**同じことを試す前に、この項を必ず読むこと。**

### 1. 何が動く状態か

**元に戻っている。**（17:19:44 に復旧を確認。壊れていたのは 17:17:27〜17:19:44 の約2分20秒）

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://rakuhan.nocode-sol.co.jp/   # 200
curl -sSI https://rakuhan.nocode-sol.co.jp/l/kasai | grep -i x-robots-tag      # noindex（意図どおり）
curl -sS https://rakutan-db.wjy20050815.workers.dev/line/health                # ok
node tools/test_index_gate.mjs                                                # 22件
```

### 2. 何が起きたか ── 独自ドメインは Cloudflare を向いていない

```
dig +short rakuhan.nocode-sol.co.jp   → 162.43.39.4                    ← Cloudflare ではない（nginx の VPS）
dig +short rakutan-db.…workers.dev    → 104.21.54.33 / 172.67.223.27   ← Cloudflare
```

**利用者 → nginx（162.43.39.4）→ 旧ドメイン（Cloudflare・Worker）** という経路。
nginx が Host を書き換えずに渡しているので、**Worker から見た Host は常に旧ドメイン**。
だから「Host が旧ドメインなら独自ドメインへ 301」が独自ドメインのアクセスにも当たり、
転送先がまた nginx を通って**ループ**した。独自ドメインの全ページが 301 を返す状態。

**ここから出る結論を3つ、必ず覚えておくこと:**

1. **Worker のコードでは2つのドメインを区別できない。** ホスト名で分岐する仕組み
   （301・ドメイン別の noindex・出し分け）は、いまの構成では全部この罠を踏む。
   `worker/index.js` の `CANONICAL_HOST` が「Worker が走る経路」でしか効かないのは
   そのままにしてあるが、**あれもホスト判定なので当てにしないこと**
2. **`workers_dev = false` は絶対にやってはいけない。** 旧ドメインは「LINE の Webhook 用に
   残してある予備」ではなく、**独自ドメインの上流そのもの**。消すとサイトごと落ちる
3. **旧ドメインを検索から外す手段は canonical だけ。** 実際それは効いている
   （両ドメインとも `<link rel="canonical">` が独自ドメインを指している）

### 3. 次の人が最初にやること

301 をやり直したいなら、**先にインフラ側**。リポジトリだけでは解けない。

- **案A（おすすめ）**: 独自ドメインを Cloudflare の Custom Domain として Worker に直付け
  （DNS を Cloudflare へ向ける）。nginx の1段が消え、Host も正しく届く。
  アクセス元IPも正しくなる（**いまは全リクエストが nginx の IP に見えている**）
- **案B**: nginx 側に `proxy_set_header Host $host;` を入れてもらい、Worker 側の判定を戻す
- どちらも `nocode-sol.co.jp` を持っている側（吉村さん）の作業。
  **9/2 の履修登録が終わるまでは触らないほうが安全**

### 4. 踏んだ罠

- 🚨 **「本物のランタイムで確かめた」でも足りなかった。** `wrangler dev` に `Host:` を付けて
  4パターン検証し、テスト29件を通し、`--dry-run` も通してからマージした。
  **それでも壊れたのは、本番のリクエストが nginx を1段挟むことを知らなかったから。**
  ローカルで再現できるのは「自分が想定した経路」だけ
- **見るべきだったのは `dig` 1発だった。** 最初の調査で `server: nginx/1.28.3 (Ubuntu)` という
  レスポンスヘッダを見ていたのに流した。**Cloudflare の Worker のはずなのに
  `server: cloudflare` でない**時点で、構成が想定と違う
- **80秒デプロイのおかげで巻き戻しは速い。** 気づいてから revert PR → マージ → 復旧まで
  2分20秒。**原因の切り分けより先に戻す**判断でよかった（宣伝の最中だった）
- **revert は HANDOFF ごと巻き戻る。** PR #70 の引き継ぎ記録も一緒に消えたので、
  この項で書き直している。**記録を残したいなら revert とは別コミットで書く**

---

## 2026-08-26（追記）｜ 旧ドメインの noindex は効いていなかった（本番実測） ｜ wang → 次の人

ブランチ `fix/wang-index-gate-truth`。**サイトの挙動は変えていない**（コメントとテストの訂正）。

### 1. 何が動く状態か

公開は成立している。本番で確かめた結果:

```
https://rakuhan.nocode-sol.co.jp/          x-robots-tag なし   ← 検索に載る
https://rakuhan.nocode-sol.co.jp/l/kasai   noindex, nofollow  ← 計測リンクは載せない
https://rakutan-db.…workers.dev/           x-robots-tag なし   ← ★効いていない
https://rakutan-db.…workers.dev/l/kasai    noindex, nofollow
```

★の行が、直前の変更で意図していたものと違う。**旧ドメインのページを検索から
外しているのは、いま `<link rel="canonical">` だけ**（本番のHTMLに出ていることは確認ずみ）。

### 2. 何をしていないか

- **`run_worker_first` を入れていない。** これを入れればページも Worker を通り、
  ホスト判定が効く。9/2 のピークを前に配信経路を変えたくないので今日は見送り。
  入れるなら `wrangler.toml` の `[assets]` に
  `run_worker_first = ["/", "/about", "/ads", "/kuchikomi", "/partners"]`
  （ページ表示1回につき Worker が1回走る。JSON・CSS・JS はアセットのまま）
- 実害は小さいと判断した。旧ドメインはどこにも貼っていない（宣伝リンクは全部
  独自ドメイン、`worker/index.js` の `SITE_URL` も独自ドメイン）ので、
  クローラが辿り着く経路自体がほぼ無い

### 3. 次の人が最初に打つコマンド

```bash
git pull
node tools/test_index_gate.mjs
curl -sI https://rakutan-db.wjy20050815.workers.dev/ | grep -i x-robots-tag   # 出ないのが現状（canonical で守っている）
```

### 4. 踏んだ罠

- 🚨 **Workers の静的アセットは Worker スクリプトより先に配られる。**
  `export default { fetch }` に書いたヘッダ操作は、**アセットが存在するパスには届かない**。
  `/l/<slug>` には効いて `/` には効かなかったのはこれが理由（`/l/` はアセットが無いので
  Worker が走る）。8/18 から noindex が効いていたのも `_headers`＝アセット側の仕組みだったから。
  **「Worker に書いたのに効かない」ときは、まず同名のアセットが無いか疑う**
- **テストが通っても本番が同じとは限らない。** `test_index_gate.mjs` は Worker の関数を
  直接呼ぶので、アセットが先に配られる経路を再現しない。**通ったあとに本番を curl したから
  見つかった** ―― ヘッダ回りは deploy 後の実測までやること

---

## 2026-08-26 ｜ noindex を外して公開した（＋重複URLの後始末） ｜ wang → 次の人

ブランチ `feat/wang-open-index`（作業ツリー `../rakutan-open`）。

### 1. 何が動く状態か

**検索エンジンに載る状態になった。** 8/18 から付けていた `noindex` を外し、
外した瞬間に生まれる「同じ本文の重複URL」を同じ変更で塞いである。

```bash
node tools/test_index_gate.mjs      # 23件（サーバ不要・Worker を直接呼ぶ）
```

| URL | 検索 | なぜ |
|---|---|---|
| `https://rakuhan.nocode-sol.co.jp/` ほか5ページ | **載る** | ここが正本 |
| `/l/<slug>` 14本 | 載らない | トップと同じ本文を14個のURLで返しているため |
| `rakutan-db.wjy20050815.workers.dev` 全部 | 載らない | 独自ドメインと同じ本文。LINE の Webhook 用に生かしてある |

入れたもの:

- `web/robots.txt` ── 全 Disallow をやめ、`Sitemap:` 行を足した
- `web/_headers` ── `X-Robots-Tag` を削除（ここにはもう規則が無い。コメントだけ）
- `web/sitemap.xml`（新規）── 5ページ。手書き
- 5ページに `<link rel="canonical">` ── クエリ付きURL（`?year=2&sem=haru…`）も正本へ寄る
- `worker/index.js` ── `/l/` と 旧ドメインに `X-Robots-Tag: noindex` を付ける。
  ルータを `route()` に切り出し、`fetch()` はホスト名を見て包むだけにした

### 2. 何をしていないか

- ★**Cloudflare Web Analytics のビーコンが本番の HTML に入っていない。**
  13:07 に入れた計測リンク14本（`/l/<slug>`）は、**いま何も数えていない**。
  `wrangler.toml` に `[observability]` も無いのでサーバ側の経路別集計も出ない。
  ダッシュボードでサイトを登録してトークンを取り、`templates/shell.html` に
  `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"…"}'></script>`
  を足せば全ページに入る。**今夜の宣伝の効果は、これが入るまで測れない**
- **旧ドメインを 301 で寄せてはいない。** LINE Developers に登録した Webhook URL が
  旧ドメインの可能性があり、確認せずに転送を入れると Bot が止まるため。
  確認できたら 301 に変えたほうが検索上はきれい（`GET` だけ転送し `/line/webhook`・`/api/*` は残す）
- **科目の個別URL（`/?c=<id>` 7,877件）は sitemap に入れていない。** 中身は JS で
  組み立てるので、全部レンダリングしに来るとは限らない。やるなら `build.py` で生成する
- **Search Console への登録はしていない**（sitemap を出しただけ）。インデックス状況を
  見たいなら登録が要る。ドメインの所有権確認は `nocode-sol.co.jp` 側の権限が要る

### 3. 次の人が最初に打つコマンド

```bash
git pull
node tools/test_index_gate.mjs
curl -sI https://rakuhan.nocode-sol.co.jp/        | grep -i x-robots-tag   # 何も出なければ公開できている
curl -sI https://rakuhan.nocode-sol.co.jp/l/kasai | grep -i x-robots-tag   # noindex が出るのが正しい
```

### 4. 踏んだ罠

- **`web/_headers` に `/l/*` の規則を書いても効かない。** `/l/<slug>` は
  `env.ASSETS.fetch("/")` でトップの本文を引いているので、付くヘッダは「`/`」のもの。
  パス規則はアセットの側で解決されるため、Worker が作ったURLには届かない。
  → noindex は Worker のコードで付けている
- **robots.txt で `/l/` を Disallow するのは逆効果。** 取りに来なくなると
  noindex ヘッダが読まれず、URL だけが検索結果に残る。「取りに来させて、載せるなと言う」が正しい
- **`/data/` も Disallow してはいけない。** 画面の中身は `courses.built.json` を
  読んでから組み立てるので、塞ぐと Google からは空のページに見える
- **worktree には `node_modules` が無い**ので `test_sort.mjs` / `test_conditions.mjs` /
  `smoke.mjs` が `ERR_MODULE_NOT_FOUND` で落ちる。`ln -s ../rakutan-db/node_modules node_modules`
  で借りれば動く（終わったら消す。3本とも通ることは確認ずみ）

---

## 2026-08-26 ｜ 学部を変えても前の学部の区分が効き続けていたのを直した ｜ wang → 次の人

ブランチ `feat/wang-division-scope`。

### 1. 何が動く状態か

**学部を変えると、その学部だけの区分（`only` 付き）の選択が外れる。**
共通の区分（情報教育科目など）は残る ―― 学部は「どの区分が自分に必要か」を
並べるための軸でしかないので、外す理由が無い。

```bash
cd web && python3 -m http.server 8151 &
node tools/check_division_ui.mjs http://localhost:8151 390   # 41項目（13a〜13d を追加）
```

直前の状態（9学部の区分を入れた直後）はこうなっていた:

1. 経済学部を選ぶ →「必修科目」を押す（7,877 → 45件）
2. 理学部へ変える → **chip は画面から消えるのに、条件だけ効き続ける**
3. 理学部の画面なのに、出ているのは経済学部の必修45件

押した覚えのない絞り込みが残り、**その原因が画面のどこにも出ていない**のが問題。
外国語学部と工学部しか無かったころは、2つの学部を行き来する人が少なく目立たなかった。

### 2. 何をしていないか

- **URL からの復元は元々していない**（復元しているのは `?c=`＝科目IDだけ）。
  なので「共有リンクに他学部の区分が入っている」経路は今のところ無い。
  LINE から絞り込み付きのリンクを返す話（HANDOFF 2026-08-26「既定の絞り込み」項の
  ★1つめ）を実装するときは、**復元側にも同じ捨て方が要る**
- `server.py` 側は触っていない。API は画面が送ったものを絞るだけなので、
  画面の state を直せば両モードとも直る

### 3. 次の人が最初に打つコマンド

```bash
git pull
cd web && python3 -m http.server 8151 &
node tools/check_division_ui.mjs http://localhost:8151 390
node tools/check_division_ui.mjs http://localhost:8151 1280
```

### 4. 踏んだ罠

- **`load()` の「0件になった区分は捨てる」処理では間に合わない。**
  `division_facets` は**区分で絞る前**に数えているので、他学部の区分も
  件数を持っていて 0 にならない。学年・学期を変えたときは効くが、
  学部を変えたときは効かない ―― 別の入口が要る
- **`.chip.on` を全部クリックして選択を外すテストは、学年・学期・プリセットの
  chip まで押す。** あちらには `data-d` が無いので `#facSec .chip.on[data-d]` に
  絞る。11 の既存コードも同じ書き方に直した（通ってはいたが、たまたま）

---

## 2026-08-26 ｜ 外国語学部・工学部以外の9学部に「必修／選択必修／専攻科目」を付けた ｜ wang → 次の人

ブランチ `feat/wang-faculty-divisions`（作業ツリー `../rakutan-wang-senmon`）。

### 1. 何が動く状態か

**学部を選ぶと、その学部の履修表の行がそのまま chip になる。** これまで下段に
区分が出たのは外国語学部（14区分）と工学部（1区分）だけで、残り9学部の
**2,850件は全部「その他」に入っていた**。いまは「その他」が 103件。

```bash
cd web && python3 -m http.server 8143 &
open http://localhost:8143      # → 学部を選ぶ → 理学部
python3 tools/test_senmon.py                       # 9学部の区分・学科
node tools/check_division_ui.mjs http://localhost:8143 390   # 37項目
```

| 学部 | 必修 | 選択必修 | 専攻科目 | 学科セレクタ |
|---|---:|---:|---:|---|
| 文学部 | 1 | ― | 476 | ― |
| 人間科学部 | 92 | 4 | 235 | ― |
| 法学部 | 165 | 1 | 293 | 法学科／国際公共政策学科 |
| 経済学部 | 45 | 12 | 50 | ― |
| 理学部 | 323 | 68 | 272 | 数学／物理学／化学／生物科学科 |
| 医学部 | 195 | ― | 20 | 医学科／看護学／放射線技術科学／検査技術科学 |
| 歯学部 | 35 | ― | 7 | ― |
| 薬学部 | 124 | ― | 39 | ― |
| 基礎工学部 | 152 | 48 | 199 | 電子物理／化学応用／システム／情報科学科 |

出所は**大阪大学の学部規程の別表**（規程集）で、CELAS の卒業要件表とは別系統。
`tools/fetch_senmon.py` が別表を `data/senmon_tables.json` に落とし、
`tools/senmon.py` が実行時にそれを引く。**HTML（`data/raw/`）は git に無いので、
生成物のほうを追跡している**（`data/faculty_requirements.json` と同じ扱い）。

**選択必修の chip は、紙に選択必修の段がある5学部にだけ出る。** 学部ごとに
chip の枚数が違うのは仕様（紙の行に合わせているため）。

### 2. 何をしていないか

- ★**単位数のバッジを出していない**（chip は「○」扱いで数字なし）。別表が持っている
  のは科目1件ずつの単位数で、区分ごとの必要単位は本文に散っている
  （法学科は必修4単位、国際公共政策学科は16単位）。**数字を猜うと卒業要件の捏造**なので
  入れていない。入れるなら学部ごとに本文を読むこと
- ★**文学部の必修は1件だけ。** 規程に科目の別表が無く、本文が名指しするのは
  「文学部共通概説」と「卒業論文」の2つ（卒業論文は課網に無いので実データでは1件）。
  残りの必修28単位は「所属する専修の講義及び演習」＝**学生の属性**なので割れない。
  専修まで割るなら文学部の履修案内が要る
- **別表に名前が無い科目は「専攻科目」に入っている**（人科48・理104・基礎工70・
  経済29・薬28・医11・法9・歯6件）。一致率は 82〜98%（文学部を除く）。
  ずれの多くは表記（経済学部の「上級マクロ経済１ 【旧→上級マクロ経済Ⅰ】」＝
  ローマ数字と算用数字）。**救っても行き先は同じ**（別表側も選択科目）なので
  今回は追っていない。必修に化ける可能性があるものは無い
- **学科・コースで扱いが変わる科目は必修にしていない。** 基礎工「応用数理Ｃ」は
  機械科学コースだけ選択必修で他6コースは選択、薬学部は3コースの指示が
  揃わない9件。工学部で必修を付けなかったのと同じ判断
- **人間科学部の「人間科学コース（英語プログラム）」の別表4は使っていない**
  （KOAN の科目名と2件しか一致しない）。使ったのは別表3
- **`build.py` は流していない。** `data/courses.json` は共通教育1,112件しか手元に
  無く、全所属7,877件を持っている人しか流せない（護りが正しく止める）。
  今回変えたのは区分の付け方だけなので `tools/redivide.py` で
  `web/data/` の3ファイルだけを焼き直した。**全所属を持っている人は
  `python3 build.py` を流せばよい。結果は同じ**

### 3. 次の人が最初に打つコマンド

```bash
git pull && git checkout feat/wang-faculty-divisions
python3 tools/test_senmon.py && python3 tools/test_engineering.py
cd web && python3 -m http.server 8143 &
node tools/check_division_ui.mjs http://localhost:8143 390
```

別表を取り直したいとき（規程が改正されたとき）だけ:

```bash
python3 tools/fetch_senmon.py --fetch   # 9学部ぶん取得（2秒間隔）→ JSON 再生成
python3 tools/redivide.py               # web/data/ を焼き直す
```

### 4. 踏んだ罠

- ★**ナンバリングは1件とは限らない。** `09CSSS3F206,09MASC3F206,…` のように
  **カンマ区切りで複数**入る科目が全体で551件ある（基礎工130／工学部151／法89／人科72）。
  先頭だけ見ると、7学科に開いている科目が1学科の科目に化ける。
  **`tools/engineering.py` が実際にそうなっていた**ので直した ――
  工学部の学科の内訳が `shizen 201→165` などと動いたのはこれが理由で、
  データが変わったからではない。またがる44件は学科を None にした
  （app.js は学科を持たない科目を必ず通すので、学科を選んでも消えない）
- **規程集の別表は rowspan と colspan が縦横に効く。** 展開しないと「必修科目」が
  科目名の**後ろ**の列に来て、列の位置で意味を引けない。`tools/kitei.py` の
  `grid()` が展開する。展開の添字を1つ間違えると静かにずれるので
  `tools/test_senmon.py` の `test_grid_expands_rowspan_and_colspan` を残してある
- **同じ学科名の表が3回出る**（高度教養／専門基礎教育科目／専門教育科目）。
  節の見出しは節の先頭の表の直前にしか無いので持ち回る必要がある。
  さらに1つの本文に節名が複数出るので、**最後に現れたもの**を採る
  （最初にしていて理学部が2学科ぶんしか取れなかった）
- **歯学部の「選択」の印は科目名の後ろに付く**（「口腔科学演習(＊)」）。
  括弧を落とす正規化を先に通すと印ごと消えるので、印の判定は生の字面でやる
- **`check_division_ui.mjs` の chip 数の期待値が壊れていた。** 上段に出るのは
  `only` の無い区分だけなのに全区分を数えていて、外国語学部の14区分が入った
  2026-08-25 から2項目が落ちたままだった（`main` でも落ちる）。今回直した
- **worktree には `node_modules` も `data/courses.json` も無い**（どちらも gitignore）。
  `ln -s ../rakutan-db/node_modules .` と `data/` の3つを symlink して動かした

---

## 2026-08-26 ｜ 常に0件だった条件チップ3つを直した ｜ wang → 次の人

ブランチ `feat/wang-fix-conditions`。

### 1. 何が動く状態か

**「出席なし」「レポートのみ」「集中講義」が、押せるのに1件も出ない状態だった。**
判定のほうが間違っていて、データは正しかった。

```bash
python3 tools/test_conditions.py                      # 件数を検算
cd web && python3 -m http.server 8144 &
node tools/test_conditions.mjs http://localhost:8144  # 画面の数字どおり絞れるか
```

| チップ | 前 | 後 | 判定 |
|---|---|---|---|
| 出席なし | 0件 | **1,536件** | 内訳が最後まで分かっている ＋ attendance キーが無い ＋ 毎回小テストも無い |
| レポートのみ | 0件 | **482件** | 同上 ＋ report>0 ＋ exam も attendance も無い（実データでは全件 report 100%）|
| 集中講義 | 0件 | **191件** | `term === "集中"` |

**原因**：`scrape/parse.py:152` が
`{k: v for k, v in buckets.items() if v > 0}` で **0% の項目をキーごと落としている**。
つまり `attendance == 0` や `exam == 0` は構造上ありえない。0% は「キーが無い」として表れる。
集中講義のほうは、`class_format` の実値が 演習科目/講義科目/実習科目/実験科目 の4種だけで、
**"集中講義" という値がそもそも存在しない**。

### 2. 何をしていないか

- **`eval_unclassified` が残っている411件と、内訳が取れていない152件は、
  「出席なし」「レポートのみ」に入れていない。** 未分類の残りに出席や試験が
  隠れている可能性があるため。**黙って「なし」と名乗らせない**、という判断
- **「レポートのみ」なのに「出席なし」でない科目が1件ある**（083119 海事政策論）。
  レポート100%だが本文に毎回小テストの記述があり、成績には効かないが毎週の拘束はある。
  `tools/test_conditions.py` がこの例外ごと固定してある
- **`day_period` が「他」の1,060件を集中講義とは見なしていない。** あれは
  「曜限が決まっていない」であって別物（通年305・秋冬210 を含む）。
  最初これで判定しようとして、データを見て取りやめた
- **集中講義191件は全部が学部の専門科目で、共通教育には1件も無い。**
  `data/courses.json` が共通教育1,112件ぶんしか無い環境で `server.py` を動かすと、
  このチップは**正しく0件になる**。`tools/test_conditions.mjs` は母数7,000件未満なら
  「0件でないこと」の判定を飛ばす
## 2026-08-26 ｜ 専攻語を選ぶと学部共通科目が消えていたのを直した ｜ 次の人へ

ブランチ `feat/fs-track-scope`。

### 1. 何が動く状態か

**外国語学部＋スペイン語を選んでも、学部共通・高度教養・兼修語学が消えなくなった。**

```bash
cd web && python3 -m http.server 8143 &
open http://localhost:8143      # 学部＝外国語学部 → 専攻語＝スペイン語
```

| 区分 | 直す前（スペイン語） | 直した後 |
|---|---|---|
| 学部共通 地域系 | **2 / 121** | 121 |
| 高度教養 | 7 / 75 | 75 |
| 兼修語学 | 16 / 157 | 157 |
| 兼修語学（高度国際性） | 4 / 84 | 84 |
| 学部共通 特設 | 16 / 19 | 19 |
| 専攻科目 講義・演習／専攻語／教職 | そのまま絞る | 変えていない |

**25専攻すべてで同じ**（1専攻だけ直したのではない）。学部共通は科目の側から
トラックを外したので、どの専攻を選んでも通る。
`test_shared_divisions_are_visible_from_every_track` が25専攻ぶん検算する。

### 1-b. main を取り込むときに見つけた build.py のバグも直した

`build.py` の時間割の投影が `timetable_rows(courses)` ―― **built ではなく元データ**を
見ていて、`track` は `base` にしか入れていなかった。つまり **build.py は
timetable.json に track を一度も書いたことが無い**。それまで値が入っていたのは
手で当て直していたぶんで、`0b17580`（KOANリンクの焼き直し）で**2,525件が丸ごと
null になった**。口コミ画面（`web/kuchikomi.html`）の学科・専攻語の絞り込みが
黙って全通しになる。

`base["track"] = c["track"] = track(c)` の1行で直した。すぐ上の `c["tags"]` と
同じ書き戻し方。**`tools/test_timetable.py` の①がこれを見張っていて、
origin/main はいま実際に落ちる**（2,525行が食い違う）。マージ後は通る。

原因は `foreign_studies.track_of()` が**ナンバリング9文字目の言語コードだけ**を
見ていたこと。このコードは専攻に縛られない科目にも入っている ――
`（学共-地域系）アメリカ史概論a` は `10FOST3BL02` で L（英語）を持つが、
学部共通科目なので全専攻が履修できる。同じ `3B?02` に【専攻科目】もいるので、
**ナンバリングだけでは絶対に割れない。名前の接頭マーカーでしか割れない。**

直し方は「トラックは区分から決める」。`TRACK_BOUND_DIVISIONS`
（専攻語実習・演習／【専攻科目】／教職）に入る区分だけがトラックを持ち、
それ以外は言語コードがあっても `None`。`division.track()` が科目名も
渡すようになったので、`engineering.track_of()` も第2引数を受ける（見ない）。

`courses.built.json` と `timetable.json` の `track` を **435件 → null** にした。
`division` / `division_source` は1件も動いていない（HEAD と全フィールド比較ずみ）。

### 2. 何をしていないか

- ★**`build.py` で焼き直していない。** この機械の `data/courses.json` は
  1,112件しか無く（全所属は 7,877件）、`build.py` が護りで止める。
  2026-08-25 と同じやり方で、**`track` フィールドだけ**を build.py が呼ぶのと
  同じ `tools.division.track()` で当て直した。**政岡さんの焼き直し待ち**
- **教職（〜語科教育法）はトラックを残した。**【専攻科目】マーカーは無いが、
  科目名の言語がそのまま専攻語で、他専攻の学生に出しても選べない。
  マーカー基準で機械的に外すと 49件が全専攻に出る。判断が要るので明示しておく
- **兼修語学はトラックを外した。** 兼修語学は専攻語の「ほかに」学ぶ言語で、
  専攻で絞ると自分の専攻語だけが残り、選ぶ意味が反転する。
  チェックシートの【同一言語で修得】の行があるので「自分の専攻語の兼修」も
  在り得る ―― どちらにせよ絞らないのが正しい
- **画面には何も足していない。** 「専攻を選んでも学部共通は消えません」と
  書くかどうかは決めていない

### 3. 次の人が最初に打つコマンド

```bash
git pull
python3 tools/test_conditions.py
cd web && python3 -m http.server 8144 &
node tools/test_conditions.mjs http://localhost:8144
python3 tools/test_foreign_studies.py    # 2,016件の内訳＋トラックの付き方
python3 tools/test_engineering.py
python3 tools/test_division.py
cd web && python3 -m http.server 8143 &
```

### 4. 踏んだ罠

- **`CONDITIONS` は `server.py` と `web/assets/app.js` の両方にある。**
  本番は静的配信なので、実際に絞り込んでいるのは app.js のほう。
  server.py だけ直すと本番は0件のまま、という直し漏れが起きる。
  それを見張るのが `tools/test_conditions.mjs`（チップの数字と、押した結果の
  件数を突き合わせる。期待値は書かない ―― 書くと .py と二重管理になる）
- **「0件のチップは異常」は、全所属ぶんのデータがあるときだけの話。**
  母数で判定を分けないと、データ不足を不具合として落としてしまう
- 件数を検算するテストで `import server` すると、ダミーデータの警告が
  テスト出力に混ざる。`contextlib.redirect_stdout` で飲み込んでいる
- `tools/test_foreign_studies.py` の `main()` が**ファイル途中**にあり、
  その後ろで定義した `test_track_of_language` などが `globals()` に無く
  **走っていなかった**。`main()` を末尾へ移した。テストを足すときは位置に注意
- `courses.built.json` は `json.dumps(..., separators=(",", ":"))` で
  **末尾改行なし**。手で当て直すときに `+ "\n"` を付けると全文が差分になる
- worktree には `data/courses.json` が無い（gitignore）。本体から symlink すると
  テストの実データ検算が通る
- **`tools/test_tokens.py` は main 由来で落ちている**（私の変更ではない）。
  `app.css` に裸の hex `#06C755`（LINE緑）`#6228D7 / #EE2A7B / #F9CE34`
  （Instagram グラデ）が入った。SNS のブランド色はトークンに寄せられないので、
  テスト側に除外を足すのが筋。手を付けていない
- **この機械では `build.py` の検算ができない。** `data/courses.json` が1,112件で、
  しかもその中に外国語学部・工学部の科目が1件も無い（所属13だけ）。
  `--allow-fewer-courses` で流しても track は0件のままなので、
  build.py の修正は `tools/test_timetable.py` で確かめること

---

## 2026-08-26 ｜ 既定の絞り込みを「すべての学年・すべての学期」にした ｜ wang → 次の人

ブランチ `feat/wang-default-all`。

### 1. 何が動く状態か

**サイトを開いた瞬間に 7,877件が出る**（それまでは 1年・秋冬 で 319件）。

```bash
cd web && python3 -m http.server 8142 &
open http://localhost:8142        # 件数が 7,877、学年も学期も「すべて」が選択中
```

最初に見た人へ、まず**扱っている量**を見せるため。空きコマグリッドの数字も
全部入りになる（月1が 6件 → 160件）。絞り込みはそこから始めてもらう。

`web/assets/app.js` の `state` と `server.py` の `search()` の**両方**を変えてある。
片方だけだと、手元（API モード）と本番（静的）で初期表示が違う。

`index.html` の学年ラベルも直した ―― 「履修できない科目は出しません」は
既定で絞っていない状態と噛み合わないので「選ぶと履修できない科目を外します」。

### 2. 何をしていないか

- ★**LINE から来た人の既定は未対応。** サイトへ直接来た人＝すべて、
  **LINE 公式アカウントから来た人＝あちらのアンケートの回答を既定に**、
  というのが本来やりたいこと。絞り込みは全部クエリ文字列
  （`?year=2&sem=haru&…`）なので、`worker/index.js` が返すリンクに
  クエリを載せれば済むはず。**ユーザーから「後でやる」と明示されている**
- ★**条件チップのうち3つが、全7,877件に対して常に0件になる。**
  既定が全件になったぶん目立つようになったが、**前からこうだった**（私の変更が
  原因ではない）。直すには意味の決めが要るので手を付けていない:

  | チップ | 判定 | 実態 |
  |---|---|---|
  | 出席なし | `eval_ratio.attendance === 0` | キーが在る 6,045件のうち **0 は1件も無い**（採点に出席が入る科目だけキーが付くので、0 にはならない）。本当に出したいのは「キーが無い＝出席が評価に入らない」科目のはず |
  | レポートのみ | `eval_ratio.exam === 0` | 同じ。キーが在る 3,655件のうち 0 は1件も無い |
  | 集中講義 | `class_format === "集中講義"` | `class_format` の実値は 演習科目/講義科目/実習科目/実験科目 の4種だけ。**"集中講義" という値は存在しない**。集中講義は `day_period` が「他」（1,060件）のほうに出ている |

  **`CONDITIONS` は `server.py` と `app.js` の両方にある。直すなら両方**
- 初回描画は 899ms（iPhone 相当・静的配信・実測）。7,877件をなめて内積を取るが、
  描画は PAGE_SIZE=24 なので体感は変わっていない

### 3. 次の人が最初に打つコマンド

```bash
git pull
cd web && python3 -m http.server 8142 &
node tools/test_sort.mjs http://localhost:8142
```

### 4. 踏んだ罠

- 学年・学期のチップはトグルではなく**ラジオ**（押した値がそのまま state になる）。
  既定を変えても `tools/shots.mjs` や `tools/test_sort.mjs` の
  `click('[data-y="all"]')` は空振りせずそのまま通る
- `?c=<科目id>` の共有リンクは、既定が全件になったことで
  **「共有された科目が一覧に無い」ケースが減った**（app.js の該当コメントは
  まだ「普通に起きる」と書いてあるが、頻度は下がっている）

---

## 2026-08-26 ｜ 口コミの件数で並べ替えられるようにした（＋科目名順のバグ修正） ｜ wang → 次の人

ブランチ `feat/wang-review-sort`。

### 1. 何が動く状態か

**「口コミあり」を押しているときだけ、並び替えに「口コミが多い順」「口コミが少ない順」が出る。**

```bash
cd web && python3 -m http.server 8140 &     # 静的＝本番と同じ経路
node tools/test_sort.mjs http://localhost:8140
python3 server.py --port 8181 &             # API モードでも同じテストが通る
node tools/test_sort.mjs http://localhost:8181
```

- 押していないと6,000件以上が0件で並び、「少ない順」はほぼ全科目が同点になって
  並び替えとして意味を持たないので、選択肢ごと出さない
- **チップを外したら並び替えも `fit` に戻す。** 戻さないと、意味を失った並び順のまま
  一覧が残り、しかも選択中の値がドロップダウンから消えて
  「何順で並んでいるのか画面から読めない」状態になる
- 同じ件数のときは相性順に落とす（「口コミあり」でも1件の科目が一番多いので、
  同点が大量に出る）

★**ついでに「科目名順」のバグを直した。** `web/assets/app.js` に `title` の分岐が
無く、選んでも相性順のままだった。**本番は静的配信で server.py を通らない**ので、
ドロップダウンにあるのに何も起きない状態が続いていた。

### 2. 何をしていないか

- ★**「科目名順」は server.py と app.js で並びが揃っていない。** わざと。
    - app.js … `localeCompare("ja")`＝ICU。ラテン→かな→漢字、【人文】等は重みが低い
    - server.py … Python 既定＝コードポイント順（標準ライブラリに日本語の照合順序が無い）

  **本番＝静的配信なので利用者に見えるのは app.js のほう。** 揃えるために app.js を
  コードポイント順へ落とすと、本番の並びを悪くして開発用サーバに合わせることになる。
  差があること自体を `tools/test_sort.mjs` がモード別に固定してある
- **「口コミが多い順」を LINE Bot からは使えるが、UIは無い**（`/api/courses?sort=reviews_many`）
- **「あなたに合う N件」の枠は並び替えに追従しない**（従来どおり）。
  追従させると「科目名順」のときに “名前が前の5件” を「あなたに合う5件」と呼ぶことになる

### 3. 次の人が最初に打つコマンド

```bash
git pull
cd web && python3 -m http.server 8140 &
node tools/test_sort.mjs http://localhost:8140
```

### 4. 踏んだ罠

- **一覧の先頭には `.picks`（あなたに合う N件）が別枠で出る。** 並び順を確かめる
  テストは `#list > .card` に限定しないと、追従しないこの5件を数えて必ず落ちる
  （最初これで落ちた）
- **`server.py` だけ見ていると並び替えのバグに気付けない。** 本番は静的配信で
  `app.js` の `queryLocal()` が並べている。片方にだけ分岐を足すと、
  開発中は正しく動いて本番だけ動かない
- チップの `onclick` では `load()` より**先に**並び替えを戻すこと。
  後だと、外した直後の1回だけ意味を失った並び順のまま描いてしまう

---

## 2026-08-26 ｜ 口コミ投稿の学年を「いまの学年」に確定した（#38 の意味を戻す） ｜ wang → 次の人

ブランチ `feat/wang-kuchikomi-gakunen`。**同じ日に #38 で一度「受講した学年（西暦）」に変えたが、意味が違っていた。**

### 1. 何が動く状態か

`/kuchikomi` は**2つの時間**を別々に持つようになった。

| 場所 | 何を聞くか | 送信 JSON | 例 |
|---|---|---|---|
| ①「いまの学年」 | **書いた人の現在の学年** | `grade` | `"4年"` |
| ②モーダル「2 受講年度」 | **その科目を受けた年度**（科目ごと） | `yearTaken` | `"2023年度"` |

**なぜ①が「いまの学年」なのか**：口コミを読む人が「自分より上の学年の人が先に受けている」と
分かると、同じ内容でも効き方が違う。書いた人の現在地はそのための情報で、
「いつ受けたか」とは別に要る。ラベルを「学年」ではなく**「いまの学年」**にしてあるのは、
半分の人が反対の質問に答えると、この値が全部使えなくなるから。

### 2. 何をしていないか

- ★**この「いまの学年」はサイトに出ていない。出す経路がまだ無い。**
  GAS のシートには入るが、`tools/ingest_reviews.py` は `grade` 列を読んでおらず、
  `reviews.py` の `_PUBLIC` / `public_rows()` にも入っていない。
  **「先輩が受けている」を画面に出すには、この5か所を通す必要がある**:
  シートの列 → `ingest_reviews.normalize()` → `data/reviews.json` →
  `reviews._PUBLIC` → `build.py` → `app.js` の詳細パネル。
  しゅんやさんのシートに `grade` 列が出ているかの確認が最初
- **学年での科目の絞り込みは復活させていない**（#38 で外したまま）。理由は2つ:
  ①ここに来る人はもう受け終わった科目を探している ―― 1年配当を隠すと
  1年のときに受けた科目に口コミを書けない。②そもそも聞いているのが
  **いまの学年**なので、履修可能かの判定には使えない値。
  一覧は長い（文学部・春夏で 1,672件）が、探しに来た科目が出ないほうが悪い
- **`app.js`（科目をさがす側）の学年フィルタはそのまま。** あちらは
  「これから履修できるか」で目的が違う

### 3. 次の人が最初に打つコマンド

```bash
git pull
python3 server.py     # → /kuchikomi。①で学年、②で年度、両方が別々に入ることを見る
```

### 4. 踏んだ罠

- **`localStorage` に一時的に `grade:"2024年度"` を保存した版が本番に出た**（#38、同日）。
  いまは選択肢に無い値なので未選択で開き、送信ボタンは押せないまま
  ―― 黙って壊れないことは実機で確認ずみ。**選択肢に無い値を `select.value` に
  代入しても例外は出ず、無言で未選択になる**。復元時は必ず在ることを確かめる
- **「学年」は日本語として二通りに読める**（何年生か／どの年度か）。
  ラベルを「いまの学年」まで書き切らないと、集まる値が混ざる

---

## 2026-08-26 ｜ 口コミ投稿の「学年」を「受講した学年（西暦）」に変えた ｜ wang → 次の人

ブランチ `feat/wang-kuchikomi-year`。

### 1. 何が動く状態か

`/kuchikomi` の1つめの入力が **「学年（1年〜博士）」から「受講した学年（2026年度〜2021年度以前）」** になった。

```bash
python3 server.py     # → localhost:8000/kuchikomi
```

- 選択肢は `takenYears()` が**今年から作る**。モーダルの「2 受講年度」も同じ関数から作るので、
  年が変わったときに片方だけ古くなることが無い（べた書きに戻さないこと）
- モーダルの受講年度は、上で選んだ年が**初期値として入る**。科目ごとに違うならその場で変えられる
- 送信 JSON の `grade` は `"2024年度"` の形になった（キー名と列はそのまま）

### 2. 何をしていないか

- ★**学年（`eligible_years`）での科目の絞り込みをやめた。** これは意図した変更。
  ここに来る人は**もう受け終わった科目**を探しているので、「4年」を選んだ人から
  1年配当の科目を隠すと、1年のときに受けた科目に口コミを書けなくなっていた。
  一覧は長くなる（文学部・春夏で 1,153 → 1,672件）が、探しに来た科目が出ないほうが悪い。
  **`app.js`（科目をさがす側）の学年フィルタはそのまま** ―― あちらは
  「これから履修できるか」なので目的が違う
- **しゅんやさんに連絡していない。** シートの `grade` 列の中身が
  「2年」から「2024年度」に変わる。`yearTaken` 列と同じ値が入ることになるので、
  片方を落とすかどうかは本人の判断（`ingest_reviews.py` はどちらも読んでいない）
- **古い localStorage（`grade: "2年"`）が残っている人**は、その値が選択肢に無いので
  未選択で開く。送信ボタンは押せないまま（＝黙って壊れない）ことを実機で確認ずみ

### 3. 次の人が最初に打つコマンド

```bash
git pull
python3 server.py     # → /kuchikomi で年を選び、モーダルに引き継がれるか見る
node tools/test_feedback.mjs http://localhost:8000
```

### 4. 踏んだ罠

- **選択肢に無い値を `select.value` に代入しても、例外は出ない。** 無言で未選択のままになる。
  「選んだはずなのに送れない」になるので、`localStorage` から戻すときは
  **選択肢に在ることを確かめてから**代入する（学部の復元でも同じ対処をしている）
- **年をべた書きにすると必ずずれる。** 上の「受講した学年」とモーダルの「受講年度」で
  一覧が違うと、上で選んだ年がモーダルの選択肢に無い、という状態が起きる。
  同じ関数から作ること

---

## 2026-08-26 ｜ LINEログインとマイページの設計（実装はまだ） ｜ wang

### 1. 何が動く状態か

**動くコードはまだ無い。設計が1枚決まった状態。**
`docs/plans/2026-08-26-line-login-mypage-design.md`（未コミット）。

決まったこと（再提案しないために要点だけ。理由は本文6章）：

- **2フェーズに分ける。** Phase 1（9/2まで・開屏の問診／お気に入り／私の時間割／
  マイページ）は**全部 localStorage で、バックエンドも LINE の設定変更も要らない**。
  Phase 2（9/2以降・端末間の同期）だけが D1 とプライバシーポリシーを待つ
- **ログイン方式は署名リンク＋リンクコード。LIFF も OAuth も採らない。**
  LINE Login チャネルの新規申請は不要
- **グリッドは2枚のまま**（左のレール＝空きコマ探し／マイページ＝自分の時間割）。
  kuchikomi の時間割とも共有しない。共有するのは `osaka_u_settings` だけ

**調査の途中で見つかったバグが1つ。設計とは独立に先へ出せる：**

```bash
python3 -c "
import json,collections
d=json.load(open('web/data/timetable.json'))
only6=[c for c in d if (c.get('slots') or []) and all(s[1:]=='6' for s in c['slots'])]
print('6限にしか出ない科目:', len(only6))"
# → 29
```

`PERIODS` が `1..5` なので、**6限にしか開かれない29件が空きコマグリッドから
永久に辿れない**（6限のコマを持つ科目は72件、うち29件が6限のみ。
9学部にまたがる。博物館学・理科教育法Ⅲ/Ⅳ・実践血液学など）。
`CLAUDE.md` が「入口は空きコマグリッド」と書いている、その入口から届かない。

### 2. 何をしていないか

- **実装は1行もしていない。** Phase 1 の plan は書いた
  （`docs/plans/2026-08-26-line-login-mypage-plan-phase1.md`・8タスク64ステップ、
  各タスクが「失敗するテストを書く → 落ちるのを確かめる → 実装 → 通す → commit」）。
  **Phase 2 の plan はまだ**（D1 とプライバシーポリシーが要るので急がない）
- **6限の修正もまだ。** `PERIODS` は3箇所（`server.py:81`／`app.js:3`／`app.js:762`）に
  ばらばらに在り、1箇所漏らすと片方のモードでだけ壊れる。
  修正には `tools/test_periods.mjs`（3箇所の一致を見る）を必ず添える
- **`line.me/R/oaMessage/{basicId}/?{text}` が「友だちでない相手」に
  どう振る舞うか未実測。** スマホのログインを1タップにできるかがこれ次第。
  駄目なら「友だち追加 → コードを貼る」に落とす（設計4.4に代替を書いてある）
- **公式アカウントの basic ID を誰も控えていない。** 設計4.7の表に、
  人が用意する4つ（basic ID／`LINK_SIGNING_SECRET`／D1／プライバシーポリシー本文）をまとめた
- **プライバシーポリシーが全サイトに1つも無い。** Phase 2 の最初の一歩はこれ

### 3. 次の人が最初に打つコマンド

```bash
git pull
sed -n '1,60p' docs/plans/2026-08-26-line-login-mypage-design.md   # 設計を読む
grep -n 'PERIODS' server.py web/assets/app.js                      # 6限バグの3箇所
```

### 4. 踏んだ罠

- **この設計を書いている最中に main が3回進んだ**（`b1e3152` → `3e42d25` → `eaf4f9b`）。
  読んだ時点のコードで設計すると、`web/kuchikomi.html` の存在も新ドメインも見落とす。
  **設計を書く前と書き終えた後の2回 `git log` を見ること**
- **`osaka_u_settings` は既に在り、`{grade, semester, faculty, department}` が入っている。**
  問診の保存先を新設しかけたが、kuchikomi が先に作っていた。
  新しい鍵を切る前に `grep -rn localStorage web/assets/` を打つ
- **署名リンクをスマホで押すと LINE の内蔵ブラウザが開く。**
  cookie はそこに置かれるが、その人のお気に入りは Safari の localStorage に在る。
  「ログインしたのにデータが合流しない」。リンクコード（設計4.4）は
  この一点のために向きを逆にしてある

---

## 2026-08-25 ｜ 意見箱（サイトへのご意見・改善要望）を足した ｜ wang

しゅんやさんの「意見箱的なのって一番下にあるイメージ」への実装。
外部フォームへ飛ばさず、**サイトの中で書いて閉じられる**形にした。

### 1. 何が動く状態か

**フッタの一番下 ―― GUILD の運営表記の“さらに下”に入口がある。**

```
footer
 ├ 免責（KOAN で確認してください）
 ├ 学生団体 GUILD が運営しています。大阪大学の公式サービスではありません。
 └ 💡 サイトへのご意見・改善要望     ← ここ。押すとモーダルが開く
```

```
モーダル（本文 必須 / 返信先 任意 / 送信元URL 自動）
  → POST /api/feedback   worker/index.js
  → Discord webhook       env.FEEDBACK_DISCORD_WEBHOOK
  → 「サイトへのご意見」チャンネルに流れる
```

- **入口の正本は `templates/shell.html` ひとつ。** ボタンも `<dialog>` も
  `<script>` もフッタ部品に入れてあるので、index / about の両方へ build.py が注入する
- `<head>` の資源にも正本が要ったので、**`PART:HEAD` を新設**した
  （`build.py` の `read_shell()` が読む部品名に `"HEAD"` を足し、
  両ページの `</head>` 直前に `<!--SHELL:HEAD-->` を置いた）
- 見た目は `web/assets/feedback.css`、動きは `web/assets/feedback.js` に独立させてある。
  **`app.css` / `app.js` は一切触っていない**（1ファイル1オーナー）
- **Worker はクライアントを信じない。** 本文1000字・返信先200字・送信元URL200字で
  自分で切る。空なら 400、honeypot が埋まっていれば 200 を返して黙って捨てる
  （400 を返すと bot に検知を教えることになる）
- **webhook 未設定なら 503。** 画面には「いまは受け取れませんでした」と出る。
  受け取ったふりをして捨てるのが一番たちが悪いので、そこだけは黙らせていない
- 本文に `@everyone` と書かれても飛ばない（`allowed_mentions: {parse: []}`）

```bash
node tools/test_feedback.mjs      # 27件（配線・境界値・honeypot・503・405）
python3 tools/test_shell_inject.py # 22件（正本が1つであること）
```

### 2. 何をしていないか

- ★**Discord 側の webhook をまだ作っていない。** これが無いと 503 のまま。
  チャンネル → 設定 → 連携サービス → ウェブフック → 新規ウェブフック で URL を作り、
  `npx wrangler secret put FEEDBACK_DISCORD_WEBHOOK` で登録する。**登録するまで公開しても意味がない**
- **投稿を保存していない**（D1 未接続）。Discord に流すだけなので、
  チャンネルを消したら履歴も消える。集計や再読み込みが要るようになったら D1 へ
- **レート制限を入れていない。** honeypot 1個だけ。同じ人が連投すればそのまま全部流れる。
  荒らされたら Cloudflare 側の Rate limiting rules か Turnstile を足すのが先で、
  Worker にカウンタを持たせるのは（KV が要るので）最後
- **返信の導線が無い。** 返信先を書いてもらっても、こちらから返す手段は人力
- **`courses.built.json` は焼き直していない**（前項と同じ理由。全所属の `courses.json` がこの機械に無い）。
  `build.py` は外殻注入の関数だけを呼んだ

### 3. 次の人が最初に打つコマンド

```bash
cd ~/Developer/rakutan-wang-feedback     # ブランチ feat/wang-feedback の worktree
node tools/test_feedback.mjs
python3 -m http.server 8151 --directory web   # 画面だけ見るなら
# ↑ 静的配信には /api/feedback が無いので「いまは受け取れませんでした」が正しい挙動
npx wrangler dev                          # Worker ごと動かすならこちら
```

本番に出す前に **必ず** webhook を登録する:

```bash
npx wrangler secret put FEEDBACK_DISCORD_WEBHOOK
```

### 4. 踏んだ罠

- **`build.py` をそのまま流してはいけない。** 外殻注入と同時に `courses.built.json` を
  焼き直そうとするが、この機械には全所属の `courses.json` が無い。
  外殻だけ入れたいときは `read_shell()` / `inject_shell()` を直接呼ぶ
- **`read_shell()` の部品名はハードコードだった**（`("HEADER", "FOOTER")`）。
  ページ側にマーカーを置くだけでは増えない。build.py 側にも部品名を足す
- **失敗メッセージを赤にしなかった。** tokens.css は色の役割を
  「押せるもの(--brand)」「データ目盛り(--scale-*)」に割り振ってあり、
  ここで4つ目の赤を足すと `--scale-heavy`（重い科目）と見分けがつかなくなる
- **共有の作業ツリーで作業していない。** `~/Developer/rakutan-db` は main のまま。
  この作業は `git worktree add ~/Developer/rakutan-wang-feedback -b feat/wang-feedback` で分けた

---

## 2026-08-25 ｜ 口コミ投稿を別サイトからサイト内へ取り込み、全学部・全学年に対応 ｜ wang → 次の人

ブランチ `feat/wang-kuchikomi-inline` → **main にマージして本番へ出しました**。

### 1. 何が動く状態か

**ナビの「口コミを書く」が外部サイトへ飛ばなくなり、`/kuchikomi` で完結する。**
科目は「1年生用テンプレート 2,157件」ではなく、**全学部・全学年 6,808件**から選ぶ。

```bash
git checkout feat/wang-kuchikomi-inline
python3 server.py                # → http://localhost:8000/kuchikomi
python3 tools/test_faculty.py    # 全7,877件の学部内訳
python3 tools/test_timetable.py  # timetable.json が courses.built.json と一致するか
```

| | 前（Netlify） | 後（/kuchikomi） |
|---|---|---|
| 科目データ | app.js に直書き 2,157件・1年生のみ | `web/data/timetable.json` 6,808件・全学部全学年 |
| 学部 | 9（コード内の固定表） | 11（`requirements.json` が正本） |
| 学科 | 学部ごとに1つのダミー | 工学部5学科・外国語学部25専攻語は**科目まで絞る**。他は名前のみ |
| 見た目 | 独自CSS・ライトのみ | `tokens.css`。暗地と reduced-motion が効く |
| 集中講義・土曜 | 入口なし | **第3セクション「時間割に無い科目」1,069件** |
| 保存先 | GAS | **同じ GAS**（変えていない） |

判定の正本は `tools/faculty.py` 1本。**共通教育はナンバリング頭2桁（13・14）で採る** ――
`category` を先に見ると、KOAN が検索フォームを返した12件（「年度」に化けている）が
どの学部にも属さず消える。逆に学部の判定は `category` を採る ―― 教職課程（`63`）の21件は
ナンバリングだと存在しない学部「63」に落ちるが、`category` は開講学部を正しく持っている。

`build.py` が `web/data/timetable.json` を焼く。`courses.built.json` は 12MB あり、
時間割に要るのは科目名・担当・曜限・学部・学年だけ（**gzip 531KB → 135KB**）。
`reviews.built.json` を分けたのと同じ理由。

### 2. 何をしていないか

- ★**`build.py` を流していない。** この worktree に `data/courses.json` が無い（.gitignore）ので、
  **`build.py` が使うのと同じ関数 `build.timetable_rows()`** を `courses.built.json` に当てて
  `timetable.json` を作った（2026-08-25 の `division` と同じ手）。
  **全所属の `courses.json` を持っている人は一度 `python3 build.py` を流して、
  `tools/test_timetable.py` が通ることを確認してほしい**（ずれたらこのテストが落ちる）
- ★**しゅんやさんへの連絡が済んでいない（人がやること）。** README 7章の担当表では
  口コミ収集はしゅんやさん（フォーム運用）。**GAS もスプレッドシートも変えていない**が、
  送信 JSON のうち次の2点でシートの見え方が変わる。**取り込みに影響が無いか見てもらうこと**
  （`ingest_reviews.py` が読むのは科目コードなど別の列なので、取り込み自体は無傷のはず）:
    - `faculty` / `department` が内部キー（`'let'` `'eng-all'`）ではなく
      **表示名（`'工学部'` `'電子情報工学科'`）**になった。学部の一覧を卒業要件表ベースに
      変えて、以前のキーが存在しなくなったため
    - 時間割に無い科目の行は `day` が KOAN の原文（`'他'` `'土3'`）で **`period` が `null`**。
      曜限の数字をでっち上げないため
- **同じ科目に何度でも投稿できる。** 送信済みの記憶は localStorage だけなので、
  別の端末・別のブラウザからは何も知らない状態で入れる。重複は
  `ingest_reviews.py` 側の重複判定に任せている（元の別サイト版と同じ）
- **修士・博士を選んでも学部科目が出る。** データが学部科目しか無いため、
  学年での絞り込みを掛けていない（0件にはしない、という判断）
- **`index.html` の隠し投稿フォーム（`#sheet` / `#fab` / `CAN_POST=false`）は触っていない。**
  D1 を待っている別物。**サイト内に投稿フォームが2つある状態**なので、
  D1 を繋ぐ人はどちらを残すか決めること
- **時間割のグリッドは月〜金×1〜6限のまま。** 土曜9件は第3セクション側に出る
  （グリッドに土曜の列は足していない。9件のために全学生の画面を1列広げない）
- **`term_group` が `unknown` の科目**は、時間割のグリッドでは出ない（6件・app.js と同じ扱い）。
  一方で**第3セクションでは276件すべてを両方の学期に出している** ―― こちらで落とすと
  その科目は永久に投稿できないため。選択肢は optgroup「学期が分からない科目」で分けてある
- **公開時の noindex 解除は未対応。** `/kuchikomi` も `web/_headers` の
  `X-Robots-Tag` を被る。8/26 に2行消すときに一緒に効く

### 3. 次の人が最初に打つコマンド

```bash
git checkout feat/wang-kuchikomi-inline
python3 build.py                    # ★全所属の courses.json を持っている人だけ
python3 tools/test_timetable.py     # ↑を流したあと必ず。ずれたら落ちる
python3 tools/test_faculty.py
python3 server.py                   # → /kuchikomi を実機の幅で触る
```

### 4. 踏んだ罠

- **`.hidden{display:none}` は CSS の最後に置かないと効かない。** `.timetable-grid{display:grid}`
  のような後勝ちの `display` に負ける。`.chips[hidden]` で踏んだのと同じ事故。
  ただし `.modal-overlay.hidden` と `.toast.hidden` は消え方を見せたいので、
  そこだけ `display` を明示して除外している
- **`courses.built.json` に `faculty` を足す案は捨てた。** 7,877件に1フィールド足すと
  raw +162KB。**トップページが毎回背負う**ことになるので、時間割だけが読む
  別ファイルに寄せた。判断（`tools/faculty.py`）は共有し、データは共有しない
- **worktree では `tools/smoke.mjs` が必ず落ちる。** `data/courses.json` が無く
  ダミー30件になり、既定の絞り込み（1年・秋冬）で0件 → `.card` が出ないため。
  README の罠⑥そのもの。**本体から `data/courses.json` をコピーすれば通る**
  （確認後に消すこと）。`/kuchikomi` 自体は `timetable.json` しか読まないので
  worktree でも CI でも本番と同じ中身が出る
- **`「金3,金4,金5」のように複数コマの科目**は、1つ埋めると該当する全マスが埋まる。
  これは別サイト版からの仕様。いまは科目が自分の曜限（`slots`）を持っているので、
  全データを舐めて探す必要が無くなった

---

## 2026-08-25 ｜ 絞り込みを3段にし、専攻語・学科のセレクタを足した ｜ wang

### 1. 何が動く状態か

**画面が3段になった。**

```
上  卒業要件の区分でしぼる   ← 全学部に共通の区分（only の無いもの）
中  学部からさがす [▾]      ← ＋トラック [専攻語▾ / 学科▾]
下  ○○学部だけの区分        ← only 付きの区分。学部を選ぶまで丸ごと隠れる
```

**トラック**は「これが決まると科目の顔ぶれが変わる」軸で、区分とは別。
外国語学部＝専攻語25、工学部＝学科5。ナンバリング由来で、`"軸:値"` の形で
`courses.built.json` の `track` に焼いてある（例 `fs_lang:K` `eng_dept:denshi`）。

- **専攻語**：ナンバリング9文字目。専攻語実習594件で実測し、**25コードすべてが
  1言語に定まり混在0件**。専攻科目（3B）も同じ位置なので、ドイツ語を選ぶと
  専攻語と専攻科目が一緒に絞れる（2年秋冬で 161→8件、講義 55→4件）
- **学科**：ナンバリング3〜6文字目。履修案内の「学科目分属」章と各学科の
  課程表ページに KOAN の科目名が載っているか1件ずつ突き合わせて確認（708/711一致）。
  略称からの推測ではない

**トラックは同じ軸を持つ科目の中でだけ効く。** トラックを持たない科目
（共通教育・学部共通科目など）は必ず通す ―― 落とすと上段の共通区分が
まるごと0件になる。

**工学部の区分は「専門教育科目」1つだけ。これが正しい状態。**
教育課程表は列がコースになっていて、同じ科目が電気工学コースでは ◎必修、
通信工学コースでは ―（履修不可）。**必修か選択かは科目の属性ではなく学生の属性**で、
第2外国語と選択外国語について division.py が書いているのと同じ理由で割れない。
区分を1つ置いたのは、無いと700件が画面上「その他」に入ってしまうため。

**「学年を変えると結果が空になる」バグも直した。** 選んでいた区分が0件になっても
選択が残り、chip は disabled なのに条件だけ効き続けていた（「専攻語 1年実習」を
選んだまま2年へ切り替える等）。0件になった選択は自動で外す。

```bash
python3 tools/test_foreign_studies.py   # 専攻語コードの一意性も検算する
python3 tools/test_engineering.py       # 学科の内訳
python3 server.py
```

### 2. 何をしていないか

- ★**今回も `courses.built.json` を `build.py` で焼いていない**（前項と同じ理由。
  全所属の `courses.json` がこの機械に無い）。`division` / `division_source` / `track`
  の3つだけを、build.py が呼ぶのと同じ関数で当て直した。**政岡さんの焼き直し待ち**
- **工学部の授業形態（講義／演習／実験）は区分にしなかった。** 課程表のあの列は
  行を読みやすくするための grouping であって卒業要件の単位ではなく、
  711件中543件（76%）が講義科目で絞り込みとしても効かない。
  科目が重いかどうかは4軸の点数がすでに答えている
- **履修案内PDFの ★☆◆ を取り込んでいない。** 突き合わせは検証ずみ（668/695＝96%一致）で、
  KOAN側に実在するのは **★高度国際性涵養38件／◆卒業要件外18件／☆高度教養14件**。
  668件に対して薄いので区分（chip）にはせず、
  **◆はカードのタグ、☆は既存の kodo_kyoyo へ合流**が妥当だと判断した。未着手
- **応用自然科学科の PRST と APPH** は、課程表で4コースが同じページに列で並ぶため
  どちらが物理工学でどちらが応用物理学か確定できなかった。**学科はどちらも
  応用自然科学科なので学科単位では影響しない。** コースまで割るならここを先に

### 3. 次の人が最初に打つコマンド

```bash
git pull
for f in tools/test_*.py; do python3 "$f" >/dev/null || echo "FAIL $f"; done
python3 build.py          # ★全所属の courses.json を持っている人だけ
```

### 4. 踏んだ罠

- **トラックで「持たないもの」を落としてはいけない。** 最初 `track` が一致しない
  科目を全部落としたら、ドイツ語専攻を選んだ瞬間に上段の共通区分が全部0件になった。
  同じ軸を持つ科目の中でだけ比べる（`c.track.startsWith(axis)` を先に見る）
- **トラックの値は軸名を前に付ける。** 外国語学部の `L`（英語）と工学部の学科キーが
  同じ空間に入ると衝突する。`fs_lang:L` / `eng_dept:denshi` の形にしてある
- **工学部の教職8件は `08` ではなく `63TECS` で始まる。** 工学部所属だが
  ナンバリングの入口に来ない。`08` で数えると711ではなく700件
- **PDFの記号は行ではなく「コース列の数」だけ印字される。** ◆を数えて
  「卒業要件外が93件」と読んだが、1行がコース4列に ◆ を4つ出しているだけで、
  実際は39行だった。記号を数えるときは行で数えること

---

## 2026-08-25 ｜ 外国語学部をチェックシートの区分で絞れるようにした ｜ wang → 政岡

### 1. 何が動く状態か

**外国語学部を選ぶと、学部チェックシートの行がそのまま chip として出る。**
これまで学部の専門科目は区分が1件も無く、外国語学部の学生には
2,016件が全部「その他」の1個に入っていた。

```bash
python3 tools/test_foreign_studies.py   # 2,016件の内訳を1件単位で検算する
python3 server.py                       # → 学部を選ぶ → 外国語学部
```

| chip | 件数 | 判定の根拠 |
|---|---|---|
| 専攻語 1年実習 / 2年実習 / 演習 | 162 / 161 / 271 | 科目名の数え方（〇〇語1〜5／11〜15／ローマ数字） |
| 専攻科目 講義 / 演習 | 299 / 427 | `【専攻科目】` ＋ 名前の講義・演習 |
| 学部共通 方法論 / 地域系 / 特設 | 71 / 121 / 19 | 科目名の `（学共-…）` |
| 兼修語学 / 同（高度国際性） | 157 / 84 | 科目名の `＜兼修＞` `＜兼修（高度）＞` |
| 高度教養教育科目 | 75 | 科目名の `（高度教養）`（共通教育と同じ区分キー） |
| 研究外国語 / 卒業論文 / 教職 | 49 / 50 / 49 | ナンバリング `001` / `4B002` / 末尾 `03` |

**専攻語の3分割は出所の違う2つの信号が594件すべてで一致している**
（科目名 ↔ `eligible_years`）。`test_senkogo_agrees_with_eligible_years` が
それを毎回検算するので、どちらかの取得が壊れたら落ちる。

`「卒業要件外の区分を隠す」が効かないバグも直した`。原因は CSS で、
`.chips{display:flex}` がブラウザ既定の `[hidden]{display:none}` に勝っていた
（`.slotBar[hidden]` と同じ対処を `.chips[hidden]` にも入れた）。

### 2. 何をしていないか

- ★**`courses.built.json` を `build.py` で焼き直していない。**
  この機械の `data/courses.json` は共通教育1,112件ぶんしか無く（gitignore）、
  流すと6,765件が消える（build.py が止めてくれた）。なので
  **焼き上がりの `division` / `division_source` だけを `tools.division.divide`
  で当て直した**。build.py が使うのと同じ関数なので、全所属の
  `courses.json` を持っている人が `python3 build.py` を流せば同じ値になる。
  **次に誰かがビルドしたとき、上の表と件数が合うか見てほしい**（テストが落ちれば分かる）
- **他の10学部はまだ手つかず。** 外国語学部だけ科目名に
  `【専攻科目】`『（学共-…）』が入っていて、工学部711件・理学部667件・文学部490件は
  科目名に何の印も無い。同じ手は使えないので、各学部の教育課程表かナンバリングから
  別途起こす必要がある。仕組みの側（`only` 付きの区分・`tools/<学部>.py`）は
  もう入っているので、足すのはファイル1枚
- **`【専攻科目】` の21件は区分を付けていない**（「ハンガリー研究入門」「書道」
  「日本語教育実習」など）。名前に講義とも演習とも書いていないものを
  「入門なら講義だろう」で倒すと必ず外れる。画面では「その他」に入る
- **チェックシートの3行は作らなかった**：国際交流科目（7,877件のどこにも該当が無い）、
  選択科目（他大学・他学部）（科目の属性ではない）
- **`category` が「年度」に化けている12件を直していない**（`scrape/` は政岡さん担当）。
  詳細は下の「4. 踏んだ罠」

### 3. 次の人が最初に打つコマンド

```bash
git pull
python3 tools/test_foreign_studies.py    # 2,016件の内訳
python3 tools/test_division.py           # 共通教育1,112件（回帰していないこと）
python3 build.py                         # ★全所属の courses.json を持っている人だけ
```

### 4. 踏んだ罠

- **`category` は信用できない。** KOAN が検索フォームを返した科目が12件あり、
  `shozoku` に表のラベル「年度」が入っている（`day_period_raw` は所属の
  ドロップダウン全部を飲み込んでいる）。実体は全部共通教育で、
  1,100 + 12 = 1,112 が合う。`shozoku_cd` は正しく `13` のままなので、
  `scrape/parse.py:170` が `shozoku` 文字列を無条件に信じているのが原因。
  **幸い壊れているのは `category` だけ**で、`day_period`・`term_group`・
  `eligible_years`・`division` は全部正常（1件ずつ確認した）。
  なので今回の外国語学部の判定は `category` ではなく
  **ナンバリングの `10FOST`** を入口にしてある（2,016件すべてが持ち、
  他学部には1件も現れない）
- **`卒業論文（教務係テスト２)`** が卒業論文50件に混ざっている。KOAN 側の
  教務のテストデータ。落とすなら `scrape/` 側で
- **ナンバリングは1科目に複数入ることがある**（カンマ区切り。全体で385件、
  最多9個）。外国語学部では「〜語科教育法」49件が
  `10FOST2BB03,63TECS1U000` で外語＋教職の二重所属。
  いまの `division` は単値なので先頭のコードしか見ていない。
  「教職課程の科目としても出したい」なら、区分を複数持てるようにする別の話
- **`高度教養教育科目` の chip が全学部で 75件 になった。** 中身は全部
  外国語学部の科目だが、CELAS の注記どおり高度教養は他学部でも開講され、
  他学部の学生も履修できる（外国語学部のチェックシート自身が
  「高度教養教育科目（他学部・他研究科等）」と書いている）。
  これまでは0件で押せない chip だったので、実質これが初めて中身が入った

---

## 2026-08-25 ｜ 全所属 7,877件をビルドしてサイトに載せた ｜ 政岡 → wang

### 1. 何をしたか

**KOAN の学部ぶん全所属 7,877件を取得・統合し、`courses.built.json` を焼き直しました。**

```bash
# 取得（12学部・約5時間。共通教育と語学は取得ずみ）
python3 scrape/fetch.py --shozoku "0:00" --out data/raw/f00      # 学部ごとに12回

# 統合（14ディレクトリ）
python3 scrape/parse.py --raw data/raw --raw data/raw/lang   --raw data/raw/f00 --raw data/raw/f01 ... --raw data/raw/f10

# 学年（14所属・約20分）
python3 scrape/years.py --shozoku "0:13" --shozoku "0:14"   --shozoku "0:00" ... --shozoku "0:10"

python3 build.py
```

```
科目数        1,112 → 7,877件
              （共通教育 1,112 ／ 語学 1,160 ／ 学部専門 5,605）
充足率        98.1%
判定できた科目   560 → 3,591件
情報不足       552 → 4,286件

1年が履修できる  1,015 → 2,175件（2.1倍）
2年            4,310件
3年            6,685件
4年            7,533件
```

**口コミは減っていません**（89科目/112件 → 120科目/144件）。#25 のマージ後に流したためです。

| 所属 | 件数 | | 所属 | 件数 |
|---|---|---|---|---|
| 13 全学教育推進機構 | 1,112 | | 07 薬学部 | 163 |
| 14 マルチリンガル（語学） | 1,160 | | 08 工学部 | 711 |
| 00 文学部 | 490 | | 09 基礎工学部 | 402 |
| 01 人間科学部 | 333 | | 10 外国語学部 | 2,016 |
| 02 法学部 | 459 | | 05 医学部（医） | 48 |
| 03 経済学部 | 107 | | 0A 医学部（保） | 167 |
| 04 理学部 | 667 | | 06 歯学部 | 42 |

### 2. 何をしていないか ── ⚠️ 転送量が6.5倍になっています

| | 従来 | 今回 |
|---|---|---|
| `courses.built.json` | 1.7MB | **11.29MB** |
| gzip 後（実際に流れる量） | **83KB** | **536KB** |

8/18 に「1,496,620 → 83,637 bytes（gzip で −94.4%）」と最適化された部分が、**件数7倍に伴って 536KB まで戻っています。**

**利用のほとんどがスマホなので、初回表示が体感で重くなる可能性があります。**

ただし **データは正しいので、表示側の工夫（ページング・分割・遅延読み込み）で後から解決できます。** 取り直しは不要です。

`build.py` と `web/assets/app.js` は担当外なので**触っていません。** 軽くするかどうか、するとしていつやるかの判断をお願いします。

その他：

| 項目 | 状況 |
|---|---|
| `METHOD_RULES` | 学部専門ぶんの未分類が増えています（担当は wang） |
| 学科の対照表 | 未作成（8/24 の項の略称一覧が材料） |
| `web/data/requirements.json` | `build.py` が新規に生成しました。中身は未確認 |
## 2026-08-24（2） ｜ 語学科目を取り込み、2,272件にした ｜ 政岡 → wang

### 1. 何をしたか

**語学（`0:14` マルチリンガル教育センター）1,160件を取得し、共通教育と統合しました。**

```bash
python3 scrape/fetch.py --shozoku "0:14" --out data/raw/lang     # 約45分
python3 scrape/parse.py --raw data/raw --raw data/raw/lang
python3 scrape/years.py --shozoku "0:13" --shozoku "0:14"        # 約5分
```

```
総件数            2,272件（共通教育 1,112 ＋ 語学 1,160・コード重複0）
充足率            99.5%（2,260/2,272）
eligible_years が空   0件
1年生が履修できる    1,015 → 1,808件（+793・78%増）

英語 608 ／ ドイツ語 185 ／ 中国語 145 ／ フランス語 116 ／ スペイン語 14
```

**しゅんやさんが指定した CELAS のページ**（https://www.celas.osaka-u.ac.jp/education/syllabus/）と突き合わせたところ、**教養教育系・専門教育系はすでに全部入っていて、欠けているのは国際性涵養教育系＝語学だけ**でした。今回でその範囲がそろいます。

### 変えたファイル（`scrape/`）

| ファイル | 変更 |
|---|---|
| `fetch.py` | `--shozoku` を追加。所属を指定して取得できる |
| `parse.py` | `--raw` を**複数指定できる**ように。取得先を並べると1つの `courses.json` に統合される |
| `years.py` | `--shozoku` を**複数指定できる**ように ＋ **encoding のバグ修正**（下記） |

所属コードは `koan.py` の docstring 参照。`0:13`＝共通教育、`0:14`＝マルチリンガル。

### 2. 何をしていないか

| 項目 | 状況 |
|---|---|
| `build.py` の実行 | **未実施。`courses.built.json` は触っていません。** wang が口コミ取り込みのたびに作り直しているファイルなので、タイミングを合わせたい |
| `METHOD_RULES` | 語学ぶんの未分類が新たに出ています（`MSチームズの…投稿` 13件、`Research Log evaluation` 11件 など）。担当は wang |
| 学部の専門科目（5,617件） | **取得だけ先に走らせています**（`data/raw/f00`〜`f10`・約3時間）。方針が決まったときに待たなくて済むように。使うかどうかは別判断 |
| 学科の対照表 | 未作成（前の項参照） |

### 3. 次の人が最初に打つコマンド

```bash
git checkout main && git pull
python3 build.py        # data/raw/ が手元に無くても courses.json があれば流せる
```

`data/courses.json`（7,877件・約12MB）と `data/raw/`（HTML 7,877件・約1GB）は **`.gitignore` なので git では運ばれません。** 手元で作り直すには `fetch.py` から必要で、**合計6時間ほどかかります。**

### 4. 踏んだ罠

**罠⑩：`parse.py` を流し直すと `eligible_years` が全件消える。**

既知の注意書きどおりですが、**7,877件が一度に0になる**ので影響が大きいです。

```
parse.py 実行後   eligible_years が空: 7,877件 ／ 1年が履修できる: 0件
years.py 実行後   eligible_years が空:     0件 ／ 1年が履修できる: 2,175件
```

`eligible_years` が空だと `server.py` と `web/assets/app.js` の学年フィルタで**全部弾かれます**（画面の既定は1年）。つまり **`parse.py` だけ流して終えると、7,877件に増やしても画面には1件も出ません。** エラーも警告も出ないので、**`parse.py` と `years.py` は必ずセットで流してください。**

**罠⑪：長時間の取得中に `git checkout` すると、走行中のスクリプトが別のコードに入れ替わる。**

12学部の取得（約5時間）を回している最中に、別件の検証のため `git checkout main` しました。その瞬間 `scrape/fetch.py` が `--shozoku` を持たない main の版に戻り、**残り7学部が全部これで落ちました。**

```
fetch.py: error: unrecognized arguments: --shozoku 0:0A
```

f00〜f04（2,056件）は取得ずみだったので実害は再実行だけで済みましたが、**長時間ジョブ中はブランチを触らない**か、**別ディレクトリに clone して検証する**のが安全です。
`fetch.py` は取得ずみを飛ばすので、やり直しは残りぶんだけで済みます。

---

## 2026-08-25 ｜ PR #25 の衝突を解いて main に合わせられる状態にした（政岡さん依頼③） ｜ wang

政岡さんの 8/25 01:03 の依頼「③ #25 をマージして `data/reviews.agg.json` を最新にしてください」への対応。
生データ `data/reviews.json` は gitignore なので、agg を焼けるのは wang だけ、というのが依頼の理由。
## 2026-08-24（15） ｜ main を取り込み、口コミ表示を「見た目の側だけ」全部入れた ｜ 松下

`feat/matsushita-kuchikomi-panel` に `origin/main`（UI 作り直し後）を取り込み、
口コミ表示の CSS とマークアップを入れた。**`app.js` は wang さんの担当なので1行も触っていない**
（「app.js を誰が書くか」は wang さんが出す、で決着）。app.js に必要なことは
仕様書にまとめて Discord へ渡した。

### 1. 何が動く状態か

```bash
git checkout feat/kuchikomi-batch2      # 9591aef（main 0433220 を取り込みずみ）
python3 build.py && python3 server.py   # → http://localhost:8000
for t in web_split tokens layout shell_inject scoring_gate reviews division requirements eligibility; do python3 tools/test_$t.py; done
python3 -m http.server 8141 --directory web & node tools/smoke.mjs http://localhost:8141
node tools/check_division_ui.mjs http://localhost:8141
```

- **`data/reviews.agg.json` は生データ 144 件から焼き直して差分ゼロ**を確認した
  （`reviews.dump_agg(reviews.aggregate(reviews.load()))` の出力が、ブランチにコミット済みのものと1バイトも違わない）。
  main 側は 32 科目／36 件のままなので、**この PR を合わせた瞬間に素と産物が揃う**
- 衝突は3本。`HANDOFF.md`（両側の追記 → 日付順に並べ直しただけ・欠落なし）、
  `web/data/courses.built.json`（build.py の産物 → 手で直さず焼き直し）、
  `web/assets/app.js`（自動マージで解決。担当教員＝main 側と「その他（…）」の原文表示＝本ブランチ側は別の箇所）
- python テスト9本すべて OK。`smoke.mjs` 319件・コンソールエラーなし。`check_division_ui.mjs` 19項目すべて OK

### 2. 何をしていないか

- **`shots`（スクショ差分）の失敗は直していない。**`05-search-mobile` で `.card` を 30 秒待って落ちる。
  これは #25 のせいではなく**開いている PR 全部で落ちている**既知の穴で、
  直しは **PR #27（`feat/wang-shots-koma`）にある**（そのブランチでだけ success）。
  #27 を先に main へ入れれば以後の PR から緑になる
- **`Workers Builds` の fail も #25 由来か未確認**（main の同ジョブは success）。マージ後のデプロイで確認が要る
- build.py の警告2本は前からの穴で今回も残る：口コミ 144 件のうち **31 科目分が科目DBに無い**
  （全部 `191xxx` 台＝語学。KOAN の所属 `0:13` に語学が入っていないため。政岡さんが取得中の所属 `0:14` が入れば埋まる）、
  回答が割れている科目 4 件（`135349`／`135357`／`135093`／`191111`）

### 3. 次の人が最初に打つコマンド

```bash
gh pr view 25 && gh pr merge 25 --merge     # 合わせたら約80秒で本番へ自動デプロイ
```

マージが済んだら政岡さんに「③ 完了」と伝える。政岡さん側の④（`git pull` → `build.py` → PR）が動き出せる。

### 4. 踏んだ罠

**産物の衝突を手で解こうとしない。** `web/data/courses.built.json` は 1.7MB の build.py の出力で、
衝突マーカーごと手で直すと素（`courses.json` ＋ `reviews.agg.json`）と食い違った産物が残る。
`git checkout --theirs` で main 側を採ってから `build.py` で焼き直すのが正解。
`HANDOFF.md` の 2026-08-24（追記）の項と同じ罠で、**2回目**。

---

## 2026-08-25 ｜ 全科目に担当教員名を出した ｜ wang

`feat/wang-instructor`（`main` から分岐）。**`web/index.html` と `web/assets/app.css`
は1行も触っていない**――松下さんの担当なので、既存クラス（`.meta`）を使い回している。
触ったのは `web/assets/app.js` と `data/courses.sample.json` の2つだけ。

データ側はもともと入っていた（`courses.json` の `instructor`、1,112件すべて充足、
`build.py` の `KEEP` にも `worker/index.js`（LINE）にも既にある）。
**出していなかったのは画面だけ**だったので、画面に出した。

### 1. 何が動く状態か

```bash
git checkout feat/wang-instructor
python3 build.py
python3 -m http.server 8141 --directory web
node tools/smoke.mjs http://localhost:8141
```

- **一覧のカード**：曜限のとなりに担当教員（`.meta` の2項目め）。
  これで「電磁気学通論 金1」が3つ並んでも、木村／横田／田之上 で行を選び分けられる。
  「日本国憲法」4コマも同様。**教員名を出す理由そのもの**（README「教員名の扱い」）
- **詳細**：`担当教員：…` の行で全員。複数担当は KOAN が最大16名・94文字持っている
- 3名以上のカードは「先頭 ほかN名」に畳む。1〜2名はそのまま並べる

| 確認 | 結果 |
|---|---|
| `tools/smoke.mjs` 静的8141 / API8142 | 両方コンソールエラーなし・319件 |
| `tools/check_division_ui.mjs` 390px | 19項目すべて OK（「9 横はみ出しなし 0px」含む） |
| python テスト8本（`test_layout` `test_web_split` `test_tokens` `test_division` `test_requirements` `test_scoring_gate` `test_reviews` `test_eligibility` `test_shell_inject`） | 全 OK |
| 390px / 1280px の `document.body` 横はみ出し | 0px |

### 2. 何をしていないか

- **検索・並び替え・集計に `instructor` を足していない。足さないこと。**
  README「教員名の扱い」の禁止事項①。`queryLocal()` の検索対象は今まで通り `title` だけ。
  「この先生の他の科目」も作っていない。`app.js` の該当箇所にコメントで残してある
- 禁止事項②（**口コミ本文に教員個人への言及を書かせない**投稿ガイドライン）は**未対応**。
  投稿フォームの注意書きは松下さんの担当ファイル。今回の変更で教員名が画面に出た分、
  「〇〇先生は〜」と書かれる確率は上がる。**次に投稿導線を触る人が入れてほしい**
- 表記ゆれは直していない。KOAN の姓名区切りは全角空白と半角空白が混在している
  （`堀 一成` と `中原　理沙`）。**事実として来た文字列をそのまま出している**。
  正規化すると別人判定の材料を1つ捨てることになるので、直すなら別タスクで
- `app.css` を触っていないので、教員名だけの色分け・省略記号（`…`）は無い。
  長い行は折り返す（390px でカードの `.meta` が2行になる科目がある）
python3 scrape/parse.py --raw data/raw --raw data/raw/lang
python3 scrape/years.py --shozoku "0:13" --shozoku "0:14"
python3 build.py        # ← ここは要相談
```

`data/raw/` は `.gitignore` なので **git では運ばれません。** 手元に無い人は `fetch.py` から必要です（共通教育45分＋語学45分）。

### 4. 踏んだ罠

**罠⑧：`eligible_years` を入れ忘れると、取り込んでもサイトに1件も出ない。**

`server.py:128` と `web/assets/app.js:292` が
`if (state.year !== "all" && !(c.eligible_years || []).includes(+state.year)) continue;`
となっていて、**`eligible_years` が空の科目は学年フィルタで全部弾かれます。**
そして**画面の既定は「1年」**です。

つまり `fetch` → `parse` だけで終えると、**1,160件を取り込んだのに画面は何も変わりません。**
エラーも警告も出ないので、原因が分かりにくいところです。**`years.py` まで回して初めて出ます。**

**罠⑨：`years.py` にも encoding のバグがありました（罠⑦と同型・3ファイル目）。**

```python
doc = json.loads(COURSES.read_text())                     # encoding 無し
COURSES.write_text(json.dumps(doc, ensure_ascii=False))   # encoding 無し
```

Windows の既定は cp932 なので、UTF-8 の `courses.json`（日本語）を読み書きすると壊れます。
両方に `encoding="utf-8"` を足しました。

**`tools/eligibility_survey.py`（罠⑦）と合わせて2件目です。ファイルを読み書きする箇所は
`encoding` を明示するのが安全だと思います。** 他にも残っている可能性があります。

---

## 2026-08-24 ｜ 履修対象（学部・学科）を全1,112件から抽出 ｜ 政岡 → wang

### 1. 何をしたか

**キャッシュ済みの詳細HTML 1,112件から履修対象を抽出しました。KOANには1回もアクセスしていません。**

```bash
python3 tools/eligibility_survey.py
```

```
詳細ページ 1112 件 ／ 欄が見つからなかったもの 0 件

  661  全学部
  446  学部の指定あり     ← 全体の 40%
    5  （空）

学部ごと（446件）
  171 工 ／ 91 基 ／ 56 理 ／ 36 医 ／ 11 外 ／ 10 経 ／ 9 法 ／
  8 外１ ／ 8 経・薬 ／ 8 人・文 ／ 8 医・歯 ／ 7 薬 ／ 7 外２ ／
  6 人 ／ 5 歯 ／ 2 文・外 ／ 1 文 ／ 1 薬・医 ／ 1 歯２８〜・薬

学科の略称（対照表の材料）
  55 工（理） ／ 40 工（然） ／ 29 基（シ） ／ 28 基（電） ／
  25 工（電） ／ 19 工（地） ／ 14 工（環） ／ 12 医（医） ／
  11 基（情） ／ 9 基（化） ／ 9 基（化・シ・情） ／ 8 工（電・地） ／
  8 理（化） ／ 8 理（数・化・生） ／ 7 工（自・環） ／ 7 医（看）
```

16件サンプルでの見積もり「3割ほどに学部の制限」に対し、**実測は 40%（446/1,112）**でした。

### 2. 何をしていないか

| 項目 | 状況 |
|---|---|
| `parse.py` への統合 | **未着手。** `courses.json` にはまだ入っていません。足すかどうかの判断待ち |
| 学科の対照表 | **未作成。** 上の略称一覧が材料です（実際に出た値だけ、という方針どおり） |
| 語学科目（`0:14`）の取得 | **未着手。** 1,160件・40〜45分の見込み。方針確認待ち |
| 学籍番号の範囲 | 絞り込みには使わない方針のまま（raw をそのまま表示） |

### 3. 次の人が最初に打つコマンド

```bash
git checkout feat/wang-instructor && python3 build.py
python3 -m http.server 8141 --directory web &
node tools/smoke.mjs http://localhost:8141
# 3コマ並ぶ科目で効果を見る：検索窓に「電磁気学通論」「日本国憲法」
```

`main` へのマージは `web/assets/app.js` の `card()` / `detailHtml()` / `showDetail()`
の3か所。松下さんの `feat/matsushita-kuchikomi-panel` とは**別の行**を足しているので、
衝突しても両方残せば解決する。

### 4. 踏んだ罠

- **`.meta span+span::before{content:"・"}` と `white-space:nowrap` を同時に使うと行が突き抜ける。**
  人名は姓と名の間が全角空白なので、素で出すと「モ／ハーチ　ゲルゲイ」のように
  人名の途中で折り返す。氏名ごとに `nowrap` を掛けたら、今度は CSS が入れる「・」が
  `nowrap` の内側に入り、**「・」は行頭に来られない文字（行頭禁則）なので直前でも改行できず**、
  16名の科目で `scrollWidth 821px / clientWidth 346px` まではみ出した。
  → 入れ物を `<bdi>`（`span+span` に当たらない）にして「・」は自分で書き、
  さらに**「・」の後ろに `<wbr>`** を置いた。`nowrap` の外に改行機会を作らないと
  Chromium は要素の境目でも折り返さない。ここは3回作り直している
- **`data/courses.sample.json` に `instructor` が無かった。**
  `data/courses.json` は `.gitignore` 対象なので、`git pull` しただけの人が見るのは
  サンプルの方。そのままだと「実装したのに画面に出ない」に見える。
  ダミー教員A〜を30件に足した（S003=2名、S019=4名、S026=6名で「ほかN名」も確認できる）
- 教員名が無い科目では `<span>` ごと出さないこと。空文字の span を置くと
  CSS が「・・」を作る。「担当教員なし」と書くのも駄目 ―― 取れていないだけなのに
  「担当がいない」という事実に見える
- **本番の自動デプロイを「無い」と誤診した。**`.github/workflows/` に deploy 系が
  無いのを見て「手動デプロイが要る」と判断し、`npx wrangler deploy` を打った。
  実際は Cloudflare の **Workers Builds（GitHub App）** が `main` を拾って
  自動デプロイしていて、私の手動デプロイはその**51秒後**（＝無駄打ち。
  `No updated asset files to upload` はその証拠）。
  マージ直後に `curl` して古かったのは、**ビルド完了前に見に行っただけ**だった。
  → **リポジトリ内の workflow だけ見て「自動デプロイは無い」と判断しないこと。**
  確認は `gh api repos/<owner>/<repo>/commits/<sha>/check-runs`。README 冒頭に追記した

---

## 2026-08-25 ｜ 第1外国語を総合英語・実践英語に分けた／所属14が丸ごと未取得と判明 ｜ wang

「学部ごとの卒業要件が足りない」という指摘を受けて各学部の一次資料を当たった。
結果、**いちばん大きいのは要件表ではなくデータの穴**だった。②を先に読んでほしい。

### 1. 何が動く状態か

```bash
git checkout feat/wang-lang1-split          # 7bd7324
python3 tools/fetch_requirements.py          # CELAS 11学部（約22秒）
python3 tools/fetch_lang_split.py            # 各学部規程から第1外国語の内訳（約18秒）
python3 build.py
python3 -m http.server 8140 --directory web
node tools/check_division_ui.mjs http://localhost:8140 390
```

区分が14→16になった（総合英語・実践英語を追加）。学部を選ぶと
「総合英語 6単位」「実践英語 2単位」がバッジで出る。

テストは Python 9本、受け入れ19項目 ×（静的390/1280・wrangler390/1280）＋smoke が OK。

### 2. 何をしていないか ―― ここが本題

- **所属14「マルチリンガル教育センター」1,165件が丸ごと未取得。**
  `scrape/koan.py` は `jShozokucdSubjects=0:13`（共通教育科目）だけを見ている。
  KOAN で確認すると 0:13 の総数はちょうど1,112で、**外国語科目は1件も含まれない**。
  漏れではなく、取得範囲がもともと含んでいない。内訳（KOAN一覧から実測）：

  | | 件数 | 区分 |
  |---|---|---|
  | 総合英語 | 589 | `lang1_sogo` |
  | ドイツ語185・フランス語116・中国語144・ロシア語44 | 316 | `lang2` |
  | 国際コミュニケーション演習・地域言語文化演習・多文化コミュニケーション | 193 | `global` |
  | 英語選択・スペイン語・イタリア語・朝鮮語・ギリシャ語・ラテン語 | 43 | `lang_opt` |
  | 実践英語 | 4 | `lang1_jissen` |
  | 特別外国語演習・専門日本語・総合日本語 | 20 | 判定できず |

  取れば科目数は1,112→2,277とほぼ倍になる。**第1外国語・第2外国語・選択外国語・
  グローバル理解のチップが0件なのは全部これが原因。**
- **判定規則は先に入れてあるので、取得できた瞬間に効く。** `tools/division.py` の
  `_divide_multilingual()`。ナンバリングが `14CMLE` で始まる科目にだけ当たる。
- **専門教育科目・専攻語科目・第Ⅰ/第Ⅱ選択科目などは入れていない。** 学部が開講する
  科目で、課網の共通教育にもマルチリンガルにも無く、ラクハンが持ちようがないため
  （方針：課網に実在する区分とだけ重ねる）。
- 高度教養教育科目・アドヴァンスト・セミナー・高度国際性涵養教育科目は
  **どこの所属にあるか未確認**。いまも0件のまま
- PR は出していない。本番にも入れていない

### 3. 次の人が最初に打つコマンド

```bash
git fetch origin && git checkout feat/wang-lang1-split
PYTHONIOENCODING=utf-8 python3 tools/test_division.py
python3 tools/division_survey.py | head -20
```

**政岡さんへ：** `scrape/koan.py` の `Koan.search(shozoku=...)` はもう引数で
所属を切り替えられる。`"0:14"` を足すだけで一覧は取れる（実測ずみ・1,165件）。
詳細ページも同じ `detail()` で取れた（`jikanwariShozokucd` は `14`）。
2秒間隔なので詳細まで含めて40分ほど。取れたら `division` は自動で入る。

### 4. 踏んだ罠

- **KOAN の「共通教育科目」は外国語科目を含まない。** 1,112という数字が
  CELAS の公表値と一致していたので、全部取れているとずっと思っていた。
  実際は所属が13と14に分かれていて、14を一度も見ていなかった
- **総合英語と実践英語はナンバリングが同じ**（どちらも `14CMLE1BLB3`）。
  所属13 ではナンバリングで区分を判定できたので同じ手が使えると思ったが使えない。
  題名で分けるしかない
- **第2外国語と選択外国語は科目の属性ではない。** 同じドイツ語の科目でも、
  その学生が第2外国語として選んだかどうかで区分が変わる（人間科学部規程ほか）。
  絞り込みの入口としては「名指しの4言語＝第2外国語」に寄せてあるが、
  **単位計算に使ってはいけない**
- **卒業要件の一次資料は学部ごとに形式がバラバラ。** 理学部は1枚の行列表、
  人間科学部は履修方法つきの階層リスト、工学部は学科×コース、
  外国語学部は Excel の計算シート。統一スキーマは作れない。
  一方で**学部規程（規程集の HTML）は11学部でほぼ同じ書き方**なので、
  マルチリンガルの内訳はそこから機械的に取れた
- **検索結果に大阪経済大学（osaka-ue.ac.jp）が混ざる。** 「人間科学部 124単位」
  などと出てくるが別の大学。`osaka-u.ac.jp` 以外は捨てること
- 内訳の合計が CELAS の第1外国語と一致するかを `fetch_lang_split.py` が検算する。
  ここを外すと単位事故なので、合わなければ止まる

---

## 2026-08-24 ｜ 学部を選ぶと卒業要件の区分でしぼれるようにした ｜ wang

しゅんやさんの指摘②「学部学科を選べない」への答え。`feat/wang-division-filter`
（`main` から分岐）。**`web/index.html` と `web/assets/app.css` は1行も触っていない**
――松下さんの担当で、`feat/matsushita-kuchikomi-panel` が同じ場所を触っているため。
セクションは `app.js` が作って rail に差し込み、CSS は既存クラスを使い回している。

> このブランチは `main` から分岐しているので、松下さんの口コミ表示（`feat/matsushita-kuchikomi-panel`）
> はまだ入っていない。マージ時に `app.js` の先頭（`state` の定義）と `queryLocal()` で
> 小さく衝突する。**どちらも追記なので、両方残せば解決する。**

### 1. 何が動く状態か

```bash
git checkout feat/wang-division-filter
python3 tools/fetch_requirements.py     # 要件表（約22秒。すでに JSON は入っている）
python3 build.py
python3 -m http.server 8140 --directory web
node tools/check_division_ui.mjs http://localhost:8140 390
```

rail の「学年」の下に **「学部からさがす」** が出る。学部を選ぶと、
自分の卒業要件にある区分が単位数バッジ付きで上に並び、要件外は折りたたまれる。
区分は複数選択（OR）。

| | |
|---|---|
| `e8810c2` | 要件表パーサ（`tools/requirements_parse.py`・テスト7件） |
| `f26bec1` | CELAS 11学部の取り込み（`tools/fetch_requirements.py`） |
| `326f936` | 科目→区分の推定（`tools/division.py`・テスト8件） |
| `9452adc` | `build.py` に区分と要件表を通す |
| `a667b99` | `server.py` の区分絞り込み |
| `addf6ae` | 画面（`app.js`）＋受け入れ確認19項目 |
| `6320bf4` | 「その他」の調査ツール（`tools/division_survey.py`） |

テストは `test_requirements` `test_division` `test_layout` `test_web_split`
`test_tokens` `test_scoring_gate` が OK。
受け入れ確認は **静的390px / 静的1280px / API 390px の3通りで19項目すべて一致**。

### 2. 何をしていないか

- **マルチリンガル教育科目（総合英語・実践英語・第2外国語）が1件も無い。**
  いまの1,112件に含まれていない。だから `第1外国語` `第2外国語` `選択外国語` の
  チップは**必ず0件**で押せない。**ここが政岡さんへの最優先の依頼。**
  区分の枠だけ先に用意してあるので、データが入れば画面は自動で埋まる
- **区分は推定であって取得ではない。** 1,112件中1,063件を科目名の接頭辞
  （【人文】等）とナンバリングから推定し、49件は `null`（画面では「その他」）。
  `division_source` に `title` / `numbering` / `scrape` が入っている。
  政岡さんの取得フィールド（`division_scraped`）が来れば**自動で優先される**ので、
  推定規則を消す作業は要らない
- **「その他」49件の内訳は `python3 tools/division_survey.py` で出る。**
  35件が `1V`（キャリアデザイン系）、残りが `1A/1D/1E/1P/1B`。
  高度教養教育科目・グローバル理解のどちらかだと思われるが**確かめていない**
- **学科の段は作っていない。** CELAS を実測したら、同じ学部の中では
  必要な区分の集合が学科間で同じで、違うのは数字だけだった
  （理学部の専門基礎 25/25/25/24）。だから数字は `24〜25単位` と幅で出している
- **単位の合計・不足数の計算はしていない。** 「あと何単位」を出すには
  履修済みの入力が要り、「ログイン不要」と衝突する。要件表は読み物として出すだけ
- **アドヴァンスト・セミナーと高度教養教育科目は `＊`（便覧参照）**なので、
  バッジは「便覧で確認」と出る。数字は出せない（CELAS が出していない）
- **ブラウザのアドレス欄に絞り込みは出ない。** いまの絞り込み（学期・学年・条件・
  コマ）がどれも出していないので、ここだけ変えると挙動が揃わないため
git checkout feat/matsushita-kuchikomi-panel   # 44d6f54
python -m http.server 8123 --directory web
```

コミット6本：

| | |
|---|---|
| `4c1d7b7` | main の取り込み（コンフリクト2ファイルを解決） |
| `fc692dd` | 注意帯（`tokens.css` に `--alert-face`/`--alert-ink`、`app.css` に `.card.unscored`/`.rvAlert`/`.bandNote`） |
| `d56e7ce` | HANDOFF |
| `f090ebf` | 1件ずつのブロック（`.pEntry`/`.pYear`/`.pOld`/`.pLine`/`.pNote`/`.pEmpty`） |
| `5969be3` | 置き場所（`.panelBtn`/`.pList`/`.panelHead`/`.panelClose`、`index.html` に `#panel`） |
| `44d6f54` | 投稿フォームの設問を正典へ（`.row4` 追加） |

- main の取り込みで解決した2ファイル
  - `web/index.html` … main 側を丸ごと採用。旧枝の432行は `git show ab99da7:web/index.html`
  - `HANDOFF.md` … 両方の項目を残した
- テストは `tokens` `web_split` `layout` `shell_inject` `scoring_gate` が OK

### 2. 何をしていないか

- **`app.js` を変えていないので、画面を開いても注意帯も1件ずつのリストも出ない。**
  CSS とマークアップだけが先に入っている状態。必要な差分は仕様書（352行）にある
- **投稿フォームは半分だけ新しい。** `index.html` は正典6問になったが、`app.js` の
  `checkSend()` はまだ `workload`/`grading` を見ているので**送信ボタンは永久に disabled**。
  `CAN_POST=false` なので実害は無い
- **手順8（`?c=<科目id>` と `history.pushState`）は未着手。** app.js だけの話。
  目的は Android の戻るボタンで、いまはシートが開いていても戻るでページごと離脱する
- **注意帯の強さは松下が「少し強い」と感じている。** 今回は変えずに置いた。
  全部そろってから wang さんと相談する。強さの正体は色ではなく面積で、
  390px 実測で帯はカードの高さの30%・4行。文言を1行にすると 17%・36px まで落ちる
  （色は動かさずに済む）
- `tools/test_tokens.py` の CONTRAST に `--alert-face`/`--alert-ink` の行を足していない
  （tools/ は担当外）。足すまでこの組み合わせは自動検査されない。wang さんへ依頼ずみ
- `.pReport`（通報リンク）は移していない。通報フォームの URL が無く、
  `web/CLAUDE.md` にも「通報導線は廃止か書き漏れか未確認」とあるため
- `.rvAlert .go` の文言「タップして中身を見る ↓」は PR #24 のまま。PC と噛み合っていない
- PR は出していない

### 3. 次の人が最初に打つコマンド

```bash
git fetch origin && git checkout feat/wang-division-filter
PYTHONIOENCODING=utf-8 python3 tools/test_division.py
python3 -m http.server 8140 --directory web &
node tools/check_division_ui.mjs http://localhost:8140 390
```

**政岡さんへ：** 取れたら科目に `division_scraped` を入れてください。
値は14個のうちのどれか（`tools/requirements_parse.py` の `DIVISIONS`）。
入れば `tools/division.py` が最優先で拾い、推定を上書きします。
優先順位は ① マルチリンガル教育科目そのもの ② `division_survey.py` の49件。

### 4. 踏んだ罠

- **CELAS の要件表は `rowspan` の結合が「合計単位数」を意味する。**
  `人文科学系/社会科学系/自然科学系/総合型` の4行が1セルに結合されていて、
  値 `6` は「人文が6単位」ではなく「**4区分あわせて6単位**」。
  工学部・医学部はアドヴァンスト・セミナーまで巻き込んだ5行結合。
  **設計中に LLM へこの HTML を読ませたら、外国語学部でここを外した**
  （「人文6・社会/自然/総合は表記なし」と出た）。卒業要件の数字を外すのは
  単位事故なので、`tools/requirements_parse.py` を通すこと。**目視転記も禁止**
- **ナンバリング `1V` を一律で「健康・スポーツ教育科目」に倒してはいけない。**
  接頭辞なし179件のうち35件が `キャリアデザインと公共哲学`
  `オン・キャンパス・インターンシップ` `アカデミック・リテラシー入門` で、
  倒すとこの35件が卒業要件の計算に混ざる。スポーツ・健康系の語を含むものだけ
  採り、残りは `null` にした。`METHOD_RULES` の「未分類が満点に化けていた」
  （2026-08-20）と同じクラスの話
- **`server.py` は `build.py` を通さず `data/courses.json` を直接読む。**
  だから `build.py` に区分を足しただけでは **API 側は全件が「その他」になる**。
  起動時に `COURSES` へ焼く必要がある（`server.py` 57行目付近）。
  実装中にこれで一度 0 件になった
- **python.org 版 Python の `urllib` は証明書を持たず SSL 検証に失敗する。**
  `curl` は通るのに Python だけ落ちる。`requests` を使えばよい
  （`scrape/koan.py` が既に使っている。新規依存ではない）
- **`server.py` を起動しっぱなしで API を叩くと、古いコードの応答が返る。**
  検証前に `pkill -f server.py` すること。これで一度「実装が効いていない」と
  誤診した
- 受け入れ確認で**件数を絶対値で書かないこと**。画面の既定は `year=1 / sem=aki`
  なので、API を `year=all` で叩いた数（76件）とは違う（画面では8件）。
  チップに出ている件数と突き合わせる形にしてある

---

## 2026-08-24（追記）｜ main を取り込んで PR #25 の衝突を解いた ｜ wang
git fetch origin && git checkout feat/matsushita-kuchikomi-panel
PYTHONIOENCODING=utf-8 python tools/test_tokens.py
python -m http.server 8123 --directory web
```

`app.js` を書く人へ：Discord の仕様書のとおり。CSS とマークアップはもう存在するので、
クラスを吐く・データを取ってくる・置き場所を `isDesktop()` で分ける、の3つだけ。

### 4. 踏んだ罠

- **`python build.py` は Windows で落ちる。** 警告の `⚠` が cp932 で出力できず
  `UnicodeEncodeError`。**落ちる前に `web/data/*.built.json` を上書きしてしまう。**
  回避は `PYTHONIOENCODING=utf-8 python build.py`（`build.py` は担当外なので直していない）
- **そもそも build.py を流す必要が無い。** main に入っている `courses.built.json` が
  本番ビルドそのもので、1,112科目／口コミ付き89／`scored:true` 2／`scored:false` 87 と
  本番の実測に一致する。**手元でビルドし直すと逆に壊れる**
  （手元の `data/reviews.json` はダミー1件・112バイト。ビルドすると口コミ1件まで落ちる）
- `tools/test_reviews.py` は1件落ちる（「実データの受講年が全件埋まっている」）。
  原因は上のダミー。gitignore 対象なので本物を持っていない人は必ず落ちる。**元から**
- **PR #24 のコードには古い箇所が3つある。**そのまま写すと事故る
  - `--warn` / `--warn-soft`（新しい色相）は決定Bで却下ずみ → `--alert-*` の地の反転
  - `@media (min-width:900px)` の固定パネル（`.panel` + `body.panelOpen`）は決定Aで捨てる。
    1280px の実測で `.inspector` に隙間なく重なり、「口コミを見る」ボタンごと覆う
  - `.row2/.row4 button.on` の `color:#fff` … オレンジの面に白は 3.64:1 で足りない。
    `--brand-ink`（黒）が正
- **サイト内の投稿フォームは、直す前から `server.py` に受け取ってもらえない状態だった。**
  `do_POST` は 2026-08-21 に正典のキーへ移り、`workload`/`grading` を捨てていたので、
  従来のフォームから送っても 400（missing choice）。`CAN_POST=false` で塞がっていて
  露見しなかっただけ。**フォームのキーを変えるときは `server.py` と一緒に変えること**
- Browser ペインが開いていないとスクリーンショットが撮れない。代わりに計算後のスタイルと
  座標を JS で実測すれば、コードを読まずに確認できる形になる。
  なお `scrollIntoView` は滑らかスクロールで直後の採寸に間に合わない ――
  `scrollTo({behavior:'instant'})` ＋強制レイアウトで測ること

### 5. CI が全 PR で落ちている（こちらの変更が原因ではない・担当外なので直していない）

PR #24 を出したら `shots`（スクショ差分）と `Workers Builds` の両方が落ちた。
調べたところ**開いている PR 全部**（#23 #24 #25 #26）で同じ2つが落ちていて、
`shots` は 2026-08-21 まで遡って**10回中10回失敗**している。誰の変更のせいでもない。

`web/CLAUDE.md` には「PR を出すと before/after が自動で並びます。見た目の変更は
そこで確認します」と書いてあるが、**その画像は一度も出来ていない。**

**`shots` の原因は特定した。**

`data/courses.json` は .gitignore 対象なので CI には無く、`server.py` は
`data/courses.sample.json`（30件）へ落ちる。ところがサンプルの30件は
**`eligible_years` を1件も持っていない。** `/api/courses` の既定は `year=1` で
`int(year) in c["eligible_years"]` を要求するので、30件すべてが弾かれる。

手元で CI と同じ状態（`git clone` はまさに gitignore 済みファイルが無い状態）を作って確認：

```
/api/health           → {"courses":30,"is_sample":true}
/api/courses          → count 0     ← ここ
/api/courses?year=all → count 30
```

結果 `#list` が空になり、`tools/shots.mjs` の6枚目
（`06-detail-desktop`・`waitForSelector(".card")`）が30秒でタイムアウトして落ちる。
1〜5枚目は `.card` を待たないので撮れてしまい、失敗が6枚目まで見えない。

直し方は2つ。どちらも担当外なので手を付けていない。
- `data/courses.sample.json` に `eligible_years` を入れる（データ側）
- `tools/shots.mjs` が `/?year=all` を開く（CI 側）

**ついでにもう1つ。** `tools/shots.mjs` の11枚目は `/progress.html` を開くが、
`progress.html` は `tools/` へ移動ずみで `web/` に無い（直下 CLAUDE.md の
「開発者用のファイルを web/ に置かない」に従った移動）。ここも古い。

`Workers Builds` の失敗理由は Cloudflare のダッシュボード側にあり、こちらからは読めない。
main では成功、開いている PR では全滅、PR #19（wrangler.toml を直した回）だけ成功、
という分布だった。

### 6. データについて1件、報告（データ担当へ）

`135327`【総合】カーボンニュートラルと私たちの未来 の口コミに
**「誰かに出席カードの記入頼めば行かなくていいです」** が入っている。
代返のすすめなので、公開前の一次スクリーニングで落とす対象だと思う。

もう1つ。`135093`【社会】行動学の考え方 は集計が 出席「たまに」だが、
1件ずつ読むと「なし」と「毎回」で、**たまにと言った人は1人もいない**
（`conflicts:["attendance"]` が立っている）。これはバグではなく、
1件ずつ読める場所が要る理由そのもの。

---

## 2026-08-23（14） ｜ 口コミパネルの作り直し（3件の門・注意喚起・詳細パネル・投稿フォーム正典化） ｜ 松下

wangさんの `feat/kuchikomi-panel`（データ側）を受けて、依頼txt【1】〜【8】を実装。
方針変更（口コミ3人分そろうまで採点に使わない）の受け皿を画面側に作る作業。
`web/index.html` のみ変更。データ側（`build.py` `reviews.py` `server.py`）は触っていない。

### 1. 何が動く状態か

```bash
git checkout feat/kuchikomi-batch2      # 51e7468
python3 build.py && python3 server.py   # → http://localhost:8000
for t in web_split tokens layout shell_inject scoring_gate reviews; do python3 tools/test_$t.py; done
```

PR #25 が CONFLICTING だったので `origin/main` を取り込んだ。衝突は
`web/data/courses.built.json` の1本だけで、build.py の出力なので手で直さず焼き直した。
テストは6本とも通る。口コミは **144 件／120 科目**のまま。

**取り込みが必要だった理由**：分岐後に main へ入った学期フィルタ（779211a／27c62b5）が
built JSON に `term_group` を足していた。分岐側の古い産物のまま合わせると
`web/assets/app.js` の `state.sem` による絞り込みが**黙って効かなくなる**。
焼き直した産物には `term_group` と `exam_bring_raw` が同居する（`137157` で両方確認）。

### 2. 何をしていないか

**PR #25 はまだマージしていない。** レビューは通していないので、合わせるかは読んだ人の判断。

`build.py` が出す警告2本は今回も残っている（前からの穴、今回の変更とは無関係）：

- **口コミ 144 件のうち 31 科目分が科目DBに無い**（全部 `191xxx` 台＝語学科目）。
  KOAN の所属 `0:13` に語学が入っていないため。`reviews.built.json` には載るが、
  科目ページには結び付かない
- 回答が割れている科目 4 件（`135349`／`135357`／`135093`／`191111`）

### 3. 次の人が最初に打つコマンド

```bash
git fetch && gh pr view 25
```

### 4. 踏んだ罠

**新しい口コミは、マージ前にもう本番へ出ていた。**

`243ef07`「KOAN 公式シラバスへ直リンク」（8/24 00:45）が、汚れた作業ツリーで焼かれていた
`web/data/reviews.built.json`（7,144 → 31,117 バイト）と `courses.built.json` を巻き込んで
コミットしていた。それが `89b9a6b` で main に入り、そのまま自動デプロイされた。
本番の `reviews.built.json` は 8/23 時点ですでに 120 科目／144 件だった。

**より悪いのはこちら**：産物だけが main にあり、その素である `data/reviews.agg.json`
（main では 32 科目のまま）と `data/sonota.json` は main に無かった。
つまり **main 上で `build.py` を一度流すだけで、口コミが 36 件へ黙って巻き戻る**状態だった。
この PR を合わせると素と産物が揃うので、そこで解消する。

**教訓：産物（`web/data/*.built.json`）を無関係なコミットに混ぜない。**
コミット前に `git status` ではなく `git diff --cached --stat` を見る。

## 2026-08-24 ｜ 口コミ108件を取り込み・「その他（…）」を台帳にした ｜ wang

### 1. 何が動く状態か

```bash
git checkout feat/kuchikomi-batch2
python3 build.py && python3 server.py     # → http://localhost:8000
for t in web_split tokens layout shell_inject scoring_gate reviews; do python3 tools/test_$t.py; done
```

口コミ **36 → 144 件／32 → 120 科目**。しゅんやさんのフォームの
08-19（med）・08-20（econ）・08-21（es/econ/hum/med）分です。テストは6本とも通ります。

3件の門を越えて**採点に効くのは 135327・135349 の2科目だけ**です。
`135851`／`135889`／`137717` は3件ありますが中身が1バイト違わず同一（`n_distinct=1`）なので
門は開いていません。8/21 に入れた名寄せがそのまま効いています。

**受講年**：6件だけ 2025 です（`137643`／`137553`／`137717`×3／`137661`）。
2026年度秋冬は10月開始なので、8月に「1年 autumn」を答えられるのは前年度の履修者だけです。
しゅんやさん本人に確認ずみ（「48〜53行は2025年度秋冬を医学部の生徒が答えてくれた」）。

**新しく `data/sonota.json`（「その他（…）」の台帳）を置きました。**
自由記述なので、選択肢のように既定値へ寄せず、1件ずつ人が判断して残す形にしています。

```bash
python3 tools/ingest_reviews.py <export.tsv>   # 未登録の言い回しは value:null で追記＋警告
# data/sonota.json に value と why を書いてから ↓
python3 tools/ingest_reviews.py x --renorm     # 取り込みずみの行にも遡って効く
```

原文は `attendance_raw` ／ `exam_bring_raw` に必ず残るので、判断は何度でもやり直せます。
この回は8件が変わりました（例：`137157` の「その他（持ち帰り形式）」が**持込不可→可**、
`135249` の「その他（分からない）」が**毎回→未回答**）。

**畳んだ値の横に原文を添えて画面に出します** ―― `持ち込み: 可（持ち帰り形式）`。
持ち帰りかオンラインかは学生の判断材料になるので、`可`／`不可` に畳んだままだと情報が落ちます。
集計に `exam_bring_raw` を足し（`可`／`不可` と答えた行は対象外＝添えるものが無い）、
`web/assets/app.js` の `reviewHtml()` が `その他（…）` の中身だけ取り出して括弧で足します。
実データでの表示は `137157 → 可（持ち帰り形式）`／`135139 → 可（cle上で実施）`。

**note を後から直すときは ingest を流し直さないこと。** 重複判定キーが
`(course_id, at, note)` なので、直した note は「新しい行」として増えます。
`data/reviews.json` を直接直してから `python3 -c "import reviews; reviews.dump_agg(...)"`
（または `--renorm`）で agg を焼き直してください。今回もその手順で4行を差し替えています
（**切れていた文が全文の先頭と一致することを確かめてから**差し替える ―― 同じ科目の
別人のコメントを踏み潰さないため）。

### 2. 何をしていないか

- ~~note が3件、途中で切れたまま~~ → **2026-08-24 にしゅんやさんから全文をもらい、埋めました。**
  マージを止める理由はもう無くなっています。
- **`191xxx` の穴が 8 → 31 科目に広がりました。** 語学の口コミが集まり始めたのに
  `courses.json` にID帯ごと無いので画面に出せません。件数が増えた分、優先度も上がっています → 政岡さん

### 3. 次の人が最初に打つコマンド

```bash
python3 tools/ingest_reviews.py <export.tsv> --dry-run
```

**PDF ではなく TSV でもらってください**（ファイル → ダウンロード → タブ区切り）。
今回 PDF から起こしたせいで note が3件欠けました。

### 4. 踏んだ罠

- **`ingest_reviews.py` が生データを書いた直後に `ModuleNotFoundError: No module named 'reviews'`
  で落ちていました。** `python3 tools/xxx.py` で起動すると `sys.path[0]` が `tools/` になるためです。
  質が悪いのは**落ちる前に `data/reviews.json` は書けている**こと ―― 失敗したと思って流し直すと、
  重複判定のおかげで行は増えないのに**コミット対象の agg だけ古いまま**残ります。直しました。
- **「その他」を既定値へ寄せると必ず事故ります。** 出席は一律 `2`（毎回）に寄せていたので
  「その他（分からない）」＝未回答が**最大の拘束**として数えられ、持ち込みは `可` 以外を全部
  持込不可にしていたので「その他（持ち帰り形式）」―― 持込可より緩い ―― が**持込不可**でした。
  どちらも「聞いていないことを答えたことにする」側の間違いです。
git checkout main && git pull
python3 tools/eligibility_survey.py                  # 手元に data/raw/detail/ が要ります
python3 tools/eligibility_survey.py --csv out.csv    # 一覧が要るとき
```

`data/raw/detail/` は `.gitignore` なので **git では運ばれません。** 手元に無い人は先に `scrape/fetch.py`（約45分）が必要です。

### 4. 踏んだ罠

**罠⑦：`Path.read_text()` に `encoding` を書かないと、Windows では静かに0件になる。**

`tools/eligibility_survey.py` の54行目が `f.read_text(errors="replace")` で、**encoding の指定がありませんでした。**

Windows の既定は **cp932** なので、UTF-8 で保存された HTML を読むと文字化けし、「履修対象」の文字列が見つからず **1,112件すべてが「欄が見つからない」** になります。`errors="replace"` のせいで**例外も出ません。静かに0件になります。**

```
修正前  詳細ページ 1112 件 ／ 欄が見つからなかったもの 1112 件
修正後  詳細ページ 1112 件 ／ 欄が見つからなかったもの    0 件
```

macOS / Linux は既定が UTF-8 なので **そちらでは再現しません。** 手元で 16/16 通っていたのはそのためです。`encoding="utf-8"` を足して直しました（本PR）。

**同種の箇所が他にもあるはずです。** ファイルを読むところは `encoding` を明示するのが安全です。
python -m http.server 8123 --directory web   # 静的＝本番と同じ。ここでは投稿は押せない
python server.py --port 8140                 # API＝投稿まで一通り試せる
```

`http://localhost:8123`（または `8140`）を開いて：

- 【1】口コミがあるのに数字に入っていない科目（`scored:false`）は、カードの枠が
  オレンジになり「口コミ N件 ― まだ数字には入っていません」の帯が出る。
  band の下に「※ テストの難しさは誰も確認していません」が出る科目もある
- 【2】カードを開いて「口コミを見る」→ パネルが開く（390px未満は下から全画面、
  900px以上は右380px固定カラム）
- 【3】パネルの中身は1人1ブロック。`null` は「―」、3年以上前の回答には
  「n年前の情報」
- 【4】カードの一言リストは無くなり、パネルだけで読める。`conflicts` が
  立っている項目は該当チップがオレンジ＋⚠になる（実データには無いので
  未確認、下記「していないこと」参照）
- 【5】「口コミを書く」フォームは `in_class`/`out_class`/`taken_year` を聞く形に
  変更。テスト・レポートは「あった？」で分岐する
- 【6】パネルを開くと URL に `?c=<科目id>` が付く。閉じ方（✕・幕・Esc・
  ブラウザの戻る）はどれでも同じように閉じ、戻るボタンでサイトごと
  抜けることは無い。`?c=<id>` 付きURLを直接開くとそのパネルが自動で開く
- 【7】パネルの1件ずつに「報告」リンク（`REPORT_FORM_URL` が空文字の間は
  出ない。URLができたら `web/index.html` 内でこの定数に入れるだけ）
- 【8】口コミ0件の科目にも「口コミを見る」が出るようになった。パネルの中身は
  受け皿の有無で分かれる：無ければ「まだ誰も書いていない」だけ、あれば
  「一緒に投稿しよう」＋ボタン
- おまけ：「口コミを書く」ボタン（画面下固定）を常時表示に変更（松下指示）。
  受け皿がまだ無いときに送信を押すと「まだ投稿を受け付けていません」と出て、
  答えた内容は消えない
- 見た目の座り（角丸・余白・フォントサイズ・色のコントラスト等）は
  **松下さんが目視確認ずみ**（Claude側はスクリーンショットが撮れない環境
  だったため、`javascript_tool` での数値・DOM確認までしかしていない）

### 2. していないこと

- `conflicts`（⚠・回答の割れ）は実データに1件も無いため、本物のデータでは
  未確認です。ブラウザ上で一時的にデータを書き換えて表示だけ確認しました
  （ファイルは触っていません）。試すなら `data/reviews.json` に食い違う行を
  1つ足して `build.py` を流してください（下の「踏んだ罠」を読んでから）
- `taken_year_before:true` のケース、3年以上前のケース（「n年前の情報」表示）
  も実データに無く未確認です
- `CAN_POST` を `true` にする本体（D1連携）自体には着手していません。今回は
  「常時ボタン表示＋受け皿が無ければ安全に断る」設計にしただけです
- `tools/test_reviews.py` `tools/test_scoring_gate.py` は実行していません
  （`data/` `reviews.py` を触っていないので対象外と判断しましたが、実行しての
  確認はしていません）
- コミット・push・PR はまだです。区切りとして今ここに置いています

### 3. 次の人が最初にやること

```bash
python -m http.server 8123 --directory web
```

ブラウザで `http://localhost:8123` を開く（**`file://` ではなく
`http://localhost` で始まっていることを確認** ―― 下の罠参照）。
「口コミ」の欄の「口コミあり」チップを押すと、口コミ付き科目だけ24件に絞れます。
投稿まで試したいときは `python server.py --port 8140` → `http://localhost:8140`。

### 4. 踏んだ罠

- **`data/reviews.json` に旧キー（`workload`/`grading`）のテスト投稿が1件、
  最初から残っていました。** `build.py` を実行すると、これが
  `reviews.agg.json`（24科目分の集約）を押しのけます。0件では無いので
  `build.py` の安全弁（`n_rv == 0` で止める処理）が効かず、**黙って23科目分の
  口コミが消えます。** 今回は `build.py` を一度も実行していません。実行する
  前に、このファイルを一旦どかすかどうか確認してください
- **`file://` で `index.html` を直接開くと、データの `fetch` がブラウザに
  ブロックされて「読み込み中…」のまま止まります。** カードが1件も出ないので
  「口コミを見る」ボタンにもたどり着けません。必ず `http://localhost` 経由で
  開いてください
- APIモード（`server.py`）で `/api/courses?year=1` が0件を返す既知の不具合に
  遭遇しました。**`HANDOFF.md` に既に記録済み・wang担当・今回の変更とは無関係**
  です。確認中は `state.year = "all"` にするか、学年チップで「すべて」を
  選んでください
- 「口コミを書く」ボタンを常時表示にする指示を受けたとき、送信ボタンの
  `if (!CAN_POST) return;` を直さずにボタンだけ表示すると、**5問答えて
  送信しても何も起きず、答えた内容も見えなくなる**という事故になるところ
  でした（受け皿が無いのに送信ボタンを出さない、という元の設計判断が
  避けていた失敗そのもの）。ボタンの常時表示とセットで、押したときの
  フィードバックも直しています

---

## 2026-08-22 ｜ UI 作り直し v2 を実装した（9タスク・ブランチ上） ｜ wang

### 1. 何が動く状態か

```bash
git checkout feat/wang-redesign-v2
python3 build.py && python3 server.py     # → http://localhost:8000
```

**PC で開くと3カラムになります。** 左：絞り込み／中：一覧／右：詳細。
About ラクハン（`/about`）が増えました。初回だけロゴを筆順で書き出す演出が入ります。

テストは6本、全部通ります。

```bash
for t in web_split tokens layout shell_inject scoring_gate reviews; do python3 tools/test_$t.py; done
```

| コミット | 内容 |
|---|---|
| `refactor:` | index.html から CSS と JS を外出し（スクショ5枚が MD5 一致＝見た目ゼロ変化） |
| `feat:` トークン | 色を「操作色」と「データ目盛り」に分離（旧 B-1 解消） |
| `fix:` 検索窓 | 最上部 → 一覧直上のツールバーへ |
| `feat:` 3カラム | 768 / 1024 / 1440 の3段 |
| `feat:` ページング | 無限スクロール撤去、24件ずつ |
| `feat:` 外殻 | shell.html を build.py が注入。ナビ・GUILD 表記（旧 B-2 解消） |
| `feat:` About | 7節の新ページ |
| `feat:` 演出 | 筆順オープニング＋ヒーロー |
| `test:` | スクショを11枚（4段＋About＋ダーク）へ |

**実測して分かった色の話**（`web/assets/tokens.css` のコメントに残してあります）

- `#DB6209` は明地で **3.35〜3.64:1** しかなく、**小さい文字には使えません**。
  文字用に `--brand-text #A84A06` を分けました
- **白をオレンジの面に載せると 3.64:1** で足りません。`--brand-ink` は白ではなく `#1A1A1A` です。
  ブランド色は変えられないので、載せる文字のほうを変えました
- 条件タグの緑は**作り直し以前から 4.34:1** で足りていませんでした。`--scale-light-text` を分けて解消

### 2. 何をしていないか

- ~~松下さんの合意待ち~~ → **2026-08-22 に合意をもらい、main へマージ・本番反映ずみです。**
  本番 https://rakutan-db.wjy20050815.workers.dev/ で3カラムとオープニング演出が見られます。
  `noindex` は**まだ付いたまま**です（外すのは 8/26。`web/robots.txt` と `web/_headers`）
- **推薦枠（あなたに合うN件）は現状 出ません。** 門（口コミ3件）を越えた科目が0件だからで、
  これは正しい状態です。経路が生きていることは、`scored` な科目を3件でっち上げて確認ずみ
- **About の GUILD 紹介文は最小限**です。メンバーの実名は載せていません（全員の同意が未取得）
- **口コミフォームの URL は `magnificent-scone-0d2071.netlify.app`** を
  `templates/shell.html` と `web/about.html` の2箇所に書いています。変わったら両方直すこと
- **スマホ実機での確認をしていません。** `python3 server.py --host 0.0.0.0` で見てください。
  Playwright の 390px では通っていますが、実機は別です
- `score.py` / 並び順 / 4軸の重みは**一切触っていません**。
  ROADMAP 1章の「おすすめ順を検証ずみ優先に」は**未決定のまま**です

### 3. 次の人が最初にやること

```bash
git checkout feat/wang-redesign-v2 && python3 build.py && python3 server.py
node tools/shots.mjs /tmp/rk    # 11枚。4段＋About＋ダークが見られます
```

松下さんの返事待ち。合意が取れたら PR を出してスクショ差分をチームで見る。

### 4. 踏んだ罠

- **`renderPage` が初回描画でも `scrollIntoView` を呼んでいて、
  ページを開いた瞬間にヘッダが画面外へ流れていました。**
  スクショを撮って初めて気づきました。ページ送りのときだけ動かすよう直しています。
  **「動くはず」と思って書いたコードほど、目で見るまで信用しないこと**
- **`tools/test_web_split.py` が Task5 以降ずっと落ちていました。**
  ページング化で消した `renderMore` をまだ探していたのに、
  そのタスクで別のテストしか流していなかったので気づきませんでした。
  **タスクごとに毎回テストを全部流すこと。** 1本だけ流すと、
  自分が壊した場所以外は見えません
- **日本語の段落で、HTML の改行がそのまま空白として見えていました**
  （「を、 シラバスに」のような隙間）。英語では起きないので気づきにくい。
  `<p>` と `<li>` の中の改行＋字下げは畳んでください
- **`app.js` はワークベンチ専用で、`#list` が無いページでは途中で落ちます。**
  About に読み込ませたら、そこから下（ナビの現在地）が全部動きませんでした。
  ページ共通のものは `web/assets/shell.js` へ置いてあります
- **オープニング演出を横並びにするまで、「ラ」がただの絵に見えていました。**
  縦に積むと「ラ」＋「クハン」が1語に見えず、筆順で書く意味が消えます
- **デプロイ設定がリポジトリのどこにも入っていません。**
  `wrangler.toml` も `.github/workflows/deploy.yml` も無く、`.wrangler/` は空です。
  main への push を Cloudflare 側（ダッシュボード）が拾って建てている、という状態です。
  そのため「新しく増えた `web/assets/*` や `about.html` がちゃんと配られるか」を
  **push するまで確認できませんでした**（結果は全部 200 で問題なし。
  `/about.html` は `/about` へ 307 で寄せられます）。
  設定がダッシュボードにしか無いので、**誰かが消したら復元手順が誰にも分かりません。**
  wrangler の設定をリポジトリに置くことを、公開後の宿題にしてください

---

## 2026-08-22 ｜ UI 作り直し v2 の設計を決めた（実装はまだ0行） ｜ wang

### 1. 何が動く状態か

**コードは1行も変えていません。決まったのは設計です。**

```bash
git checkout feat/wang-redesign-v2
sed -n '/^## 8\./,$p' ROADMAP.md      # 設計の全文（8.0〜8.11）
```

- `ROADMAP.md` に **8章「UI 作り直し v2」** を追加。決定事項8つ、レイアウト段組、
  デザイントークン、ページ構成、一覧のページング、オープニング演出、ファイル構成、検証方法まで
- `CLAUDE.md` の「動かしてはいけない前提」を**2つ書き換え**（下記「踏んだ罠」参照）

**なぜやるか：** PC で開くと 560px の1列のままです。`web/index.html` に
**幅ベースの `@media` が1つも無い**（あるのは `prefers-color-scheme` の2つだけ）。
PC 用のレイアウトはこれまで一度も作られていません。
ラクハンを GUILD の第1号サービスとして外に出すので、ここで土台を作り直します。

**ついでに片づく既知の宿題：** 旧 B-1（主色が2つある）、旧 B-2（フッターに GUILD の記載が無い）。

### 2. 何をしていないか

- 🚨 **松下さんの合意がまだ取れていません。** `web/index.html` は担当表（README 7章）で
  松下さんのファイルです。今回はほぼ全面書き換えになるので、**本人の返事が来るまで着手しません。**
  `feat/matsushita-mobile-ui` は main と差分ゼロなので、コード上の衝突はありません
- **実装は0行。** `web/` は1文字も触っていません
- **About の本文が未執筆。** 構成7節は決めましたが中身はこれから。
  メンバーの実名は載せない方針（全員の同意が取れていないため）
- **「あなたに合う5件」の選定ロジックが未定。**「検証ずみの科目から選ぶ」とだけ決まっています
- **`#DB6209` の明地コントラストを実測していません。** 「オレンジの小さい文字は使わない」で
  回避する方針ですが、数値は実装時に測ります（暗地は 5.1:1 と既存コメントに記録あり）
- **本一覧の並び順は触りません。** ROADMAP 1章の「おすすめ順を検証ずみ優先に」は**未決定のまま**です。
  今回足すのは視覚的に独立した推薦枠だけで、並び順の決定を先取りしていません

### 3. 次の人が最初にやること

```bash
git checkout feat/wang-redesign-v2 && sed -n '/^## 8\./,$p' ROADMAP.md
```

読んだうえで、**松下さんへの依頼（Discord）の返事を待つ。** 合意が取れてから実装計画を作ります。

### 4. 踏んだ罠

- **`CLAUDE.md` の前提を読んだまま作業すると、PC 対応そのものが規約違反に見えます。**
  「モバイルファースト ―― 履修登録はスマホでやる。**PCで綺麗でも意味がない**」と書いてありました。
  前半は正しいが後半は間違い。**先に前提のほうを直しました。**
  規約に合わない作業をするときは、黙って破らずに規約を直すこと
- **実装が自分の規約を破っていました。** 「空の検索窓を最上部に置かない」と `CLAUDE.md` にあるのに、
  `web/index.html` の `.wrap` の**先頭**が検索窓でした。今回あわせて直します
  （消さずに、一覧直上のツールバーへ移す。具体的な科目名で調べたい人は実在するため）
- **`tools/shots.mjs` は22日間ずっと 1280px の PC スクショを撮っていました。**
  「PC が 560px の縦棒」は毎 PR の画像に写っていたのに、誰も壊れていると言わなかったので直りませんでした。
  **スクショを撮ることと、それを見て指摘することは別の作業です**

---

## 2026-08-21（12） ｜ 口コミが採点に効き始める人数の門を入れた（3件） ｜ wang

### 1. 何が動く状態か

```bash
python3 tools/test_scoring_gate.py    # 21件 通過
python3 build.py
```

**1件の口コミで総合値が半分になっていたのを止めました。**
実測: 「力学詳論I」が1人の回答で **78.0 → 41.6（拘束は軽い → やや重め）**。
テストの難易度は load に最大44点効くので、証言1本が総合値の半分を左右します。

方針（8/21）: **いまの我々に大量の口コミを集める力は無い**（全1,112科目に対し
36件、1科目あたり最大3件）。だから採点で薄く効かせるのではなく、
**数字には触れず「口コミがあります、中身を見て自分で判断してください」と出す。**
判断を学生に返します。

- `reviews.MIN_FOR_SCORING = 3` ―― 門。集まってきたら**上げる方向で**見直す
- `c.reviews.scored` が False の間、`score.py` は口コミを一切読まない
  （テスト難易度・持ち込み可否・レポート語数の3つとも）
- **表示は今まで通り全部出ます。** 件数・数値・一言・1件ずつ、全部。
  消えるのは採点への影響だけ
- 重複は人数に数えません（`n_distinct`）。1人が3回送っても3人分にはならない。
  実際 135851 は3件→実質1人、135581 は2件→実質1人でした

`needs_review: true` と band「拘束は軽い」は既存の仕組みで、そのまま使っています。
試験軸の根拠欄に「口コミN件あり ― 人数が足りず数字には未反映」が出ます。

### 2. 何をしていないか ―― 🚨 ここを読まずに公開しないでください

- 🚨 **門の副作用で、12科目が「前より軽く見える」ようになりました。**
  「力学詳論I」は 41.6 → **73.5 に戻ります**。1人が「テスト難しい（6/10）」と
  言っているのに、人数が足りないので数字に入らないためです。
  band は「拘束は軽い」（＝「軽め」とは言っていない）、`needs_review` も
  立っていますが、**「とにかく軽い」で並べ替えると上位に来ます。**
  → **カード上の「口コミを確認して」の出し方が弱いと、この方針は事故になります。**
     松下さんへの依頼で最優先にしてあります
- 門を越えた科目は**現時点で0件**です。つまり今この瞬間、口コミは採点に
  1ミリも効いていません。これは意図した状態です
- 3という数字に強い根拠はありません。2だと1組の食い違いで平均が真ん中に
  寄るだけ、という理由で3にしています。運用しながら見直してください
- `score.py` の重み・軸そのものは触っていません。門を足しただけです

### 3. 次の人が最初に打つコマンド

```bash
git checkout feat/kuchikomi-panel && python3 build.py
python3 tools/test_scoring_gate.py && python3 tools/test_reviews.py
```

### 4. 踏んだ罠

- **`reviews.agg.json` を焼き直す必要があります。** `scored` / `n_distinct` が
  入ったので、古い agg を持っている人（生データ無しの人）は門が効きません。
  `python3 -c "import reviews; reviews.dump_agg(reviews.aggregate(reviews.load()))"`
- **門を `n` で判定しないこと。** 重複投稿が実在するので `n_distinct` で見ます。
  `n` で見ると、同じ人が3回送るだけで門が開きます

---

## 2026-08-21（11） ｜ 口コミを1件ずつ読める形にした（データ側）／投稿フォームのキー不一致を直した ｜ wang

科目カードの中に集計値と一言を全部積む今の形は、件数が増えると破綻します。
「口コミを見る」で1件ずつ読む詳細パネルに移すことにしました。
**この回はデータ側だけです。画面（`web/index.html`）は松下さんに渡します。**

### 1. 何が動く状態か

```bash
python3 tools/test_reviews.py     # 25件 通過
python3 build.py                  # web/data/reviews.built.json が出る
python3 server.py --port 8000     # /data/reviews.built.json が同じ形で返る
```

**① 口コミ1件ずつを別ファイルに焼くようにした** ―― `web/data/reviews.built.json`

```json
{"135851": [
  {"taken_year":2026, "taken_year_before":false,
   "attendance":2, "in_class":2, "out_class":null,
   "exam_hard10":null, "exam_bring":null, "report_words":null,
   "note":"…"}
]}
```

新しい順に並べて渡します（画面側でのソートは不要）。7.0KB／32科目。

`courses.built.json` に混ぜなかったのは、あれが1,614KBあって絞り込みのたびに
全件なめているからです。**件数に比例して伸びるものをそこに置かない。**
詳細パネルを最初に開いた時だけ取りに行けば足ります。

`server.py` も**同じURL** `/data/reviews.built.json` で返します。画面側が
「APIモードならこっち、静的ならあっち」と分岐しなくて済むように。
分岐を作ると、片方でしか再現しないバグの置き場所ができます。

**② 平均が消していた「意見の食い違い」を拾うようにした** ―― `c.reviews.conflicts`

出席「なし」と「毎回」の平均は「たまに」です。**誰も経験していない値**が出ます。
CLAUDE.md が禁じている「単一の数字に潰す」そのものでした。
割れた項目名を `conflicts: ["attendance"]` として集計に添えます。平均は今まで通り
出るので**採点は1ミリも変わりません**。画面はここに⚠を出してください。

しきい値は「隣り合う回答は割れとしない」で引いています（`reviews.py` の `_SPREAD`）。
3段階は両端が揃ったときだけ、10段階の難易度は4以上開いたときだけ。1段の違いまで
拾うと、複数件ある科目のほとんどに⚠が付いて意味を失います。

**③ 🚨 投稿フォームのキーが集計と一致していなかったのを直した**

```
server.py が保存していたキー : attendance / workload / grading
reviews.py が読んでいたキー  : attendance / in_class / out_class / exam_hard10
```

**サイトのフォームから入った口コミは、attendance と note 以外まるごと
集計から落ちていました。** テストの難易度（一番効く軸）ごと消えます。
`CAN_POST=false` で投稿口が閉じていたので露見していなかっただけで、
D1 を繋いだ瞬間に事故になる状態でした。

`workload`（課題の量）と `grading`（成績の付き方）は**捨てました**。前者は
`in_class`／`out_class` の2軸に対応が付かず、後者は正典側に該当項目がありません。
無理に寄せると「聞いていないことを答えたことにする」ことになります。
**フォーム側を正典（＝しゅんやさんのフォーム＝`data/reviews.json`）に合わせます。**

**④ 受講年（`taken_year`）を持つようにした**

口コミが増えたとき、学生が最初に知りたいのは「これは何年の話か」です。
2023年の「過去問が出回ってる」は2026年には成り立ちません。
既存36件は**全て 2026 として backfill 済み**（8/18-19 に集めた分なので確実）。

### 2. 何をしていないか

- 🚨 **`web/index.html` は1行も触っていません。** 詳細パネル・カードの分割・
  フォームの5問目・⚠の表示、全て松下さん待ちです。今の画面は今まで通り動きます
  （smoke 静的／API 両方 ✓）
- 🚨 **APIモードで投稿ボタンを押すと今は失敗します。** フォームが旧キーを送るので
  サーバが 400 で弾きます。松下さんがフォームを直すまでこのままです。
  **静的配信（本番）は `CAN_POST=false` なので影響ゼロ。** 黙って2項目捨てる
  以前の挙動より、見えて失敗する方が正しいと判断しました
- **⚠が実データで確認できません。** 複数件ある科目は3つだけ（135581／135327／
  135851）で、どれも割れていません。松下さんは `data/reviews.json` に手で
  食い違う行を足して確認してください
- **重複投稿・スパム対策なし。** D1 待ち
- **`口コミ1件で相性が出る` 問題は放置。** `score.py` が1件でも `exam_hard` が
  入れば総合値を出します。1人の証言で「軽め」が付くのは件数が増えると危ういですが、
  採点の正本を触る話なので今回は分離しました
- **通報の飛び先が無い。** Google フォームを誰かが作る必要があります

### 3. 次の人が最初に打つコマンド

松下さん（`web/index.html`）:

```bash
git fetch && git checkout feat/kuchikomi-panel
python3 build.py
python3 -m http.server 8140 -d web    # → localhost:8140（静的＝本番と同じ）
curl -s localhost:8140/data/reviews.built.json | head -c 400   # 受け取る形
python3 tools/test_reviews.py         # データ側を触ったら必ず
```

やることの一覧は Discord に投げた依頼を見てください。優先順は
パネル本体 → カードの分割 → 5問目 → ⚠ → 受講年の表示 → URL反映 → 通報 → 0件。

### 4. 踏んだ罠

- **`at` を "2026-08-18" に正規化しかけた。** `tools/ingest_reviews.py` の重複判定
  キーが `(course_id, at, note)` なので、書き換えると次のインジェストで36件が
  全部「新しい行」として重複します。**`at` は触らないこと。**
  そもそも投稿日≠受講時期なので、公開形には `at` を入れていません
- **`data/reviews.json` は .gitignore です。** backfill した `taken_year` は
  **自分の手元にしかありません。** 古いコピーで `build.py` を回すと受講年が
  黙って消えます。気付けるよう build.py が警告を出すようにしました：
  `⚠ 受講年が入っていない口コミ N 件`。**これが出たら焼かずに止めてください**
- **`191xxx` の8科目分の口コミが宙に浮いています**（191169／191265／191289／
  191330／191469／191610／191731／191872）。`courses.json` にこのID帯が丸ごと
  無く、画面には出しようがありません。**散発的な誤番号ではなくID帯ごと欠けている**
  ので、取得側の穴だと思います → 政岡さん
- **135851 の3件が1バイト違わず同一です**（同日08-19・全項目一致・一言なし）。
  `ingest_reviews.py` の重複判定は**既存データとしか比べておらず、同じ取り込み
  バッチの中の重複を見ていません**（105行目）。同じ回答が3人から来ただけの
  可能性もあるので**消していません。しゅんやさんにフォームの生ログの確認を
  お願いしたい。** 現状「口コミ3件」と表示され、パネルには同じカードが3枚並びます
## 2026-08-21 ｜ 口コミを持っていない人でも再現できるようにした＋未決事項の棚卸し ｜ wang

### 1. 何が動く状態か

**口コミの生データを持っていない人でも、wang と同じ数字が出せます。**

```bash
git pull && python3 build.py     # 口コミの生データは要りません
```

`data/reviews.json`（生データ・gitignore）が無くても
`data/reviews.agg.json`（集約ずみ・追跡する）から同じ結果になります。
**両者から作った `built.json` が sha256 まで一致することを確認ずみ。**

### 2. 直した問題（実際に再現した）

`data/reviews.json` は gitignore なので、**取り込んだ本人以外が `build.py` を
流すと、口コミ入りの `built.json` を口コミ抜きで黙って上書きしていました。**

```
口コミが載った科目  24 → 0
判定できた科目     558 → 555
警告              なし
```

3段構え：① 集約ずみを追跡する（中身は `built.json` に載せているものと同じ）
② `reviews.resolve()` が出どころを決める（生データ → 無ければ集約）
③ それでも0件になるなら **`build.py` が中止する**（`--allow-no-reviews` で強行可）

⚠️ `dump_agg()` で `sort_keys=True` を使うとキー順だけ変わり、
「中身は同じなのに差分が出る」状態になります。使わないこと。

### 3. 次の人が最初に打つコマンド

```bash
git checkout main && git pull && python3 build.py
node tools/smoke.mjs http://localhost:8140     # 静的
```

---

## 🔴 未決事項（ここから再開する）

**公開まであと5日（8/26）／履修登録まで12日（9/2）。**

### A. いますぐ判断が要るもの

**A-1. 学則に触れうる口コミ3件が本番で公開中**

```
135327  誰かに出席カードの記入頼めば行かなくていいです   ← 代返
135316  オープンチャットに入れば勝ち確です              ← 答案の共有
134157  他の学部の問題入手出来れば簡単
```

8/21 14:25 の PR #20 マージで本番に出ました。`noindex` 中かつ未宣伝なので
見た人はまだ少ないはずですが、**公開リポジトリの git 履歴には既に残っています。**

**学生団体が運営するサイトにこれを載せるのは、大学から止められる典型例です。**
取り下げる場合は `data/reviews.json` の該当行に `"publish": false` を立てるだけ
（`reviews.py` が対応ずみ）。**本文だけ落ち、件数と数値は採点に効いたまま**です
――「その口コミが無かったこと」にはしません。

**A-2. 口コミが36件。判定線は100件**

ROADMAP v6 の 8/25 Go/No-Go は「口コミ100件以上」。いま36件。
残り5日。**催す・基準を下げる・公開を遅らせる のどれか。**

**A-3. 語学科目がデータベースに1件も無い**

口コミ36件のうち**8件（25%）が語学**で挂けられていません（`191xxx` 台）。
共通教育（所属 `0:13`）ではなく別の所属。**1年生の必修の多くが語学なので、
穴としては学年の次に大きい。** 取り方は `scrape/years.py` と同じ要領でいけます。

### B. 決まっていない設計判断

**B-1. サイト全体のアクセント色が緑のまま**
ロゴは `#DB6209`（ブランドオレンジ）、UIは `--go` `#0e7c66`（緑）。
主色が2つある状態。`--go` を差し替えれば全部変わる（14箇所）。

**B-2. フッターに GUILD の記載が無い**
ブランド資料では **Timeline資料のレッドライン「学生団体であることを明記」**
への対応として、フッター／About に「学生団体 GUILD が運営しています」を出す、
と決まっています。**いま入っていません。公開前に必須。**

**B-3. ブランド資料（rk-plan）と実装がズレている**
資料は「濃色の上ではマークも白抜き」「lockup は横並び」ですが、
実装は「濃色帯・縦組み・ラだけオレンジ・文字は白」です。
**実装のほうが後の決定**なので、資料を追従させないと第2の「v4 過期PDF」になります。

### C. 人に投げてある・返事待ち

| | 状態 |
|---|---|
| **しゅんや** 口コミの追加収集 | 36件で止まっている。フォーム自体は動いている |
| **笠井 → きむら** LINEチャネル | 最終ライン 8/19 を過ぎたまま音沙汰なし |
| **きむら** `preset_top` の構造変更 | 学年が1段入った（`preset_top["1"][プリセット名]`）。**既定は "1"**。伝わっているか未確認 |
| **松下** `web/index.html` | wang が何度も触っています（FAB・学年チップ・ロゴ）。見た目の調整は本人待ち |
| **政岡** データ品質チェック | 8/20 に指摘あり、対応ずみ（PR #16） |

### D. 覚えておくこと

- **8/26 公開当日、最初にやること**: `web/robots.txt` を削除し、
  `web/_headers` の `X-Robots-Tag` の行を消す。**忘れると検索に一切載りません。**
- `parse.py` を流し直すと `eligible_years` が消えます。流したら `scrape/years.py` も。
- サイト内の4タップ投稿フォーム（`server.py` の `POST /api/reviews`）は
  実際に使っているフォームと設問が違います（3問 vs 6問）。

---

## 2026-08-20（10） ｜ 口コミが「絞り込めるのに中身が見えない」のを直した ｜ wang

### 1. 何が動く状態か

`web/index.html` は `c.reviews` を**一度も表示していませんでした**。使っていたのは
絞り込みの判定（`口コミあり`）と投稿の POST だけです。だから「口コミあり」で24件に
絞れるのに、絞った先のカードは他の科目と見た目が同じでした。

```bash
python3 build.py
python3 -m http.server 8140 -d web     # → localhost:8140
```

**足したもの2つ**

- **カード頭に「口コミ N件」のバッジ** ―― 絞り込んだ結果が一目で分かる
- **詳細を開くと「口コミ」ブロック** ―― 出席／授業中の課題／授業外の課題／
  テストの難易度（x/10）／持ち込み／レポートの語数、そして**一言**

**一言（本文）も公開するように方針を変えました。** それまで `build.py` が
`courses.built.json` から `notes` を落としていたので、本文はサイトに一切
届いていませんでした。数字だけでは「なぜ楽なのか」が伝わらず、口コミの一番効く
部分（「理解はしないときついです」など）が学生に見えていませんでした。

現在: 24科目・**一言15件**が公開されます（20件のうち、共通教育に無い科目ぶん5件は
載る先が無いため）。

### 2. 何をしていないか ―― ここが一番大事

- 🚨 **審査（censorship）は入れない、という判断です（2026-08-20）。いま20件すべて
  そのまま出ます。** 一度 `publish: false` で1件止めた状態にしましたが、方針として
  外しました。
  **止める口だけは残してあります** ―― `data/reviews.json` の行に `"publish": false` を
  足すと本文だけ落ちます（既定は載せる）。止めても行は残るので、その口コミの出席や
  テスト難易度は件数にも採点にも効き続けます。使うかどうかは運用の判断。
- **20件すべてに目を通しました。教員名への言及は0件です**（README 5章の禁止事項2）。
  持ち込み可の科目で「持ち込み用紙に丸写し」は合法、「レポートを通じてテスト問題を
  教えてくれる」は教員側の行為なので、どちらも問題なしと判断しています。
- **ただし1件、性質が違うものが出ます。** 135327 の
  「誰かに出席カードの記入頼めば行かなくていいです」は**代返の指南**です。
  学生団体が運営する公開サイトに載る以上、大学から止められうる種類のものだという
  認識だけは残しておきます（`CLAUDE.md` の「過去問そのものは載せない」と同じ族）。
  **止めない判断をしたのは wang です。** 後で問題になったときにこの行を見ればよいように、
  判断そのものを記録として置いておきます。
- ⚠️ **投稿フォームに「教員個人への言及を書かないでください」の注意書きがまだありません。**
  README 5章の禁止事項2が要求しているものです。**本文を公開するようになった以上、
  投稿を開ける前に必ず入れてください。** シートの説明文は PR #18 が同じ行を
  触っているので、コンフリクトを避けてこちらでは入れていません。**#18 に足すのが筋です。**
- **審査は人の目だけです。** NGワードも通報導線もありません。36件だから読めただけで、
  400件になったら回りません。
- 語学科目など**共通教育に無い科目の口コミ（5件）は表示されません**。科目データが
  無いので載る先がないだけで、`reviews.json` には残っています。

### 3. 次の人が最初に打つコマンド

```bash
git checkout feat/wang-review-display && python3 build.py
python3 -m http.server 8140 -d web
# → 「口コミ」枠で絞る →「力学詳論I」を開く
```

**いまは1件も止めていません。** 将来止めたくなったら `data/reviews.json` の該当行に
`"publish": false` を足して `python3 build.py` を流し直すだけです。

### 4. 踏んだ罠

- **`data/reviews.json` は gitignore です。** つまり `publish: false` を将来使っても、
  **その審査結果は git に乗りません。** ファイルを持っている人（いまは wang と政岡さん）が
  build.py を流したときだけ効き、**別の人が流すと止めたはずの本文が出ます。**
  審査を始めるなら、まず結果の持ち方を決めること。いまは審査していないので実害はありません。
- **公開した本文は git 履歴に永久に残ります。** `courses.built.json` は追跡対象で、
  リポジトリは public です。**後から消しても履歴からは消えません。** 本文を出す判断は
  一度きりで取り消せない、という前提で扱うこと。
- **`n` と一言の数は一致しません。** 本文を止めても件数は残る設計なので、
  「口コミ2件」なのに一言が1件、という表示は正常です。
- 画面の集計値は**複数件なら平均**です（出席1.5なら「たまに」寄り）。
  1件のときだけその1件の値そのものになります。

---

## 2026-08-20（7） ｜ 絞り込みに「口コミあり」を足した ｜ wang

### 1. 何が動く状態か

絞り込みに **「口コミあり」** が増えました。現在 **24件**。API・静的サイトの
どちらでも同じ数字が出ます。

**置き場所は「条件」ではなく、その下の新しい「口コミ」枠です。**
「条件」は科目の属性（出席なし・持ち込み可…）を並べる場所で、「口コミあり」は
**データの出所**の話なので種類が違います。同じ列に混ぜると、学生には
「出席なしの隣にある、もう1つの科目の特徴」に見えてしまいます。

```bash
python3 server.py                                  # → localhost:8000
python3 -m http.server 8140 -d web                 # → 静的（Cloudflare相当）
node tools/smoke.mjs http://localhost:8140         # コンソールエラーなしを確認済み
```

判定は `reviews.n > 0`。口コミが1件でも入っている科目だけが残ります。
KOAN から取れない5つ（定員／レポート本数／字数／時間外学習／毎回小テスト）が
埋まっているのはこの科目だけなので、**「シラバスの形だけで出した数字」と
「人が確認した数字」を学生が区別できる**ようになります。

ブラウザで実際にチップを押して確認しました（1015件 → 24件、コンソールエラーなし）。
API側の facet と静的側の facet が全チップで一致することも確認済み
（`出席なし0 / レポートのみ0 / 持ち込み可4 / 1限以外881 / 集中講義0 / 小テストなし755 / 口コミあり24`）。

### 2. 何をしていないか

- ⚠️ **`web/index.html` を触りました（松下さんの担当ファイル）。** 足したのは
  `CONDITIONS` の1行だけです。**このオブジェクトは `server.py` の `CONDITIONS` と
  同じ内容でなければならず、ファイル内のコメントにも「片方だけ足さないこと」と
  書いてあるため、server.py 側だけ足すと静的サイトでチップが機能しません。**
  松下さん、消したい・書き方を変えたい場合は遠慮なく言ってください。
  チップのHTML・CSS・並び順のロジックには一切触れていません（チップは
  `META.conditions` から自動生成されるので、追加のUI実装は不要でした）。
- 見出しは「口コミ」＋サブ「シラバスの形だけで出した数字か、人が確認した数字か」に
  しました。**`.bar`（件数と並び替えの行）に置く案も考えましたが採りませんでした** ――
  あの行は「結果の見せ方」で、これは「どの結果を出すか」なので性質が違うのと、
  390px 幅だと件数＋トグル＋並び替えセレクトで横が詰まるためです。
  CSS は既存の `.chips` / `.chip` をそのまま使っていて、**新しいスタイルは1行も
  足していません**（松下さんが後から見た目を変えるときに邪魔をしないため）。
- `/api/openapi.json` に `cond` パラメータの記述がそもそもありません（今回とは
  無関係の既存の抜けです）。触っていません。

### 3. 次の人が最初に打つコマンド

```bash
git fetch && git checkout feat/wang-cond-reviews
python3 -m http.server 8140 -d web &
node tools/smoke.mjs http://localhost:8140
```

口コミが増えたら件数も自動で増えます（`build.py` が `data/reviews.json` を
読んで焼くので、口コミ追加後は `python3 build.py` を流し直すこと）。

### 4. 踏んだ罠

- **`CONDITIONS` は `server.py` と `web/index.html` の2箇所にあります。**
  片方だけ足すと、API モードでは動くのに Cloudflare 上の本番（静的モード）では
  チップが出ない、という気づきにくい壊れ方をします。`web/index.html` 側の
  コメントにもその旨が書いてあります。
- **チップ自体は `META.conditions` から自動生成されます**（`#conds` / `#trust` は
  空の `<div>` で、中身は JS が描く）。条件を1つ足すのに必要なのは
  `server.py` と `web/index.html` の `CONDITIONS` に1行ずつだけです。
  どちらの枠に出すかは `web/index.html` の `TRUST_CONDS` に名前を入れるかで決まります
  ―― **`CONDITIONS` から抜いてはいけません**。抜くと `cond=` の値として
  API が受け付けなくなり、API モードで絞り込みが効かなくなります。

---

## 2026-08-20（6） ｜ 未分類の評価方法を拾えるようにした ｜ wang

政岡さんの「データ品質チェック 8/20分」への対応です。**指摘された数字はこちらでも
全部そのまま再現しました**（評価割合が欠けたまま点数が出ている科目 21件、うち
おすすめ11件、合計が100%未満 65件）。対応しました。

### 1. 何が動く状態か

```bash
python3 tools/rebucket.py && python3 build.py
```

これで `web/data/courses.built.json` が作り直されます（このブランチには結果もコミット済み）。

**何が変わったか**

| | before | after |
|---|---|---|
| 振り分けられない評価方法名 | 61種類・延べ74箇所（64科目） | **0** |
| 評価割合が100%未満なのに点数が出ている科目 | **21件**（うちおすすめ11件） | **0件** |
| 判定できた科目 | 560 | **554**（−6） |
| 1年生おすすめの母集合 | 132 | 133 |

**点数が上がった科目は0件です。** ズレが「実際より楽に見える」方向にだけ出ていた、
という政岡さんの見立てのとおりでした。影響を受けたのは65科目だけで、
残り1,047科目の採点結果は1ビットも動いていません（差分で確認済み）。

政岡さんが挙げたおすすめ11件のうち **6件がおすすめから外れ**、5件は点数が下がって残りました。

```
93.5 → 情報不足   【人文】日本語・日本文化を考えるB     作問・投稿・発問・解説 50%
89.7 → 情報不足   【社会】政治の世界                （※後述。原因が別）
89.0 → 情報不足   学問への扉（かけひきの科学）        成果物 50%・文献紹介 30%
89.0 → 情報不足   学問への扉（ものづくり＆ロボコン初級） 取組の姿勢 40% ほか
89.5 → 73.4      【総合】共生学の話題               授業後のコメントシート 40%
74.4 → 60.2      【社会】現代文化論                 リフレクションシート 30%
94.1 → 82.4      【自然】生命科学の世界              毎回のノート 40%
93.5 → 82.5      【人文】欧米の文化と社会を知るF      各回コメントシート 50%
90.8 → 87.4      【人文】欧米の政治・経済事情         各回のコメントシート 30%
90.8 → 87.4      【社会】マクロ経済学の考え方         練習問題 30%
89.5 → 88.3      統計学Ｃ-II                       対面での演習 20%
```

逆に1件、**新たに判定できるようになりました**：学問への扉（持続可能な開発のための経済学）
= 50.5「やや重め」。

**やったことは2つです。**

**① `METHOD_RULES` に2ルール追加**（`scrape/parse.py`）。61種類すべてを
attendance 42／report 19 に振り分けます。**既存ルールの後ろに足したので、
今まで分類できていた152種類の行き先は1件も変わっていません**（旧ルールと突き合わせて確認済み）。

**② 欠けたまま採点しないようにした**（`score.py`、`EVAL_TOTAL_MIN = 99.9`）。
成績評価の内訳の合計が100%に届かない科目には総合値を出さず「情報不足」にします。
`COVERAGE_MIN`（4軸のうちいくつ測れたか）とは別物で、**こちらは「軸の重み自体が
正しいか」**を見ています。あわせて、落とした項目を捨てずに
`eval_unclassified` に名前と%を残すようにしました（`courses.built.json` にも入ります）。

**②が本体です。** ①だけだと、KOAN に新しい書き方が出てきた瞬間に同じ事故が
また静かに起きます。②があれば、次からは「点数が出ない」という**見える形**で止まります。

### 2. 何をしていないか

- **`137135【社会】政治の世界` の原因が未確定です。** これだけ他の20件と原因が違います。
  `eval_raw` が `{期末試験: 80, 視聴覚資料についての小レポート: 10}` で
  **合計90%**、つまり振り分けの問題ではなく **KOAN の表そのものが90%なのか、
  `grading()` が行を1つ取りこぼしているのか**のどちらかです。
  `data/raw/detail/137135.html` はこちらの手元に無い（gitignore）ので確認できていません。
  **政岡さん、この1件だけ実物のシラバスと突き合わせてもらえますか。**
  いまは②の効果で「情報不足」になっているので、公開しても嘘は出ません。
- **61種類の振り分け先は、こちらの判断です。レビューを受けていません。**
  迷ったのは次の4つ。おかしいと思ったら言ってください。
  - `練習問題` → attendance（毎回提出の想定。課題＝report とも読める）
  - `作問・投稿・発問・解説` → report（成果物と読んだ。毎回投稿なら attendance）
  - `プログラミングの実施` → report（授業内実施なら attendance）
  - `感想文`（数回に一度実施） → attendance
- **画面での見え方は確認していません。** `web/index.html` は松下さん担当なので触っていません。
  確認したのは API（`/api/courses/137135` が `情報不足` を返すこと）と静的JSONの数字までです。
- 口コミ由来の項目（`reviews`）には一切触っていません。

### 3. 次の人が最初に打つコマンド

**政岡さん（`data/raw/` を持っている人）** ―― こちらの `tools/rebucket.py` ではなく、
本筋の方を流してください。結果は同じになるはずです。

```bash
git fetch && git checkout feat/wang-eval-unclassified
python3 scrape/parse.py && python3 scrape/years.py && python3 build.py
git diff --stat web/data/courses.built.json     # 差分が出なければ一致
```

最後に「振り分けられなかった評価方法」の一覧が**空で出ること**を確認してください。

**もう一度品質チェックを回すなら**、確認してほしいのはこの2つです。

```bash
python3 - <<'EOF'
import json
d=json.load(open("web/data/courses.built.json",encoding="utf-8"))
MIN=80.0   # score.py の EVAL_TOTAL_MIN と同じ値にすること
bad=[c for c in d["courses"] if c.get("eval_ratio")
     and sum(c["eval_ratio"].values())<MIN and c["rakutan"]["overall"] is not None]
left=[c for c in d["courses"] if c.get("eval_unclassified")]
print("大きく欠けたまま点数が出ている:", len(bad), "件（0であること）")
print("振り分けられない項目が残る:", len(left), "件（0であること）")
print("内訳が100%に満たない科目:", [(c["id"], c["rakutan"]["eval_captured"])
      for c in d["courses"] if (c["rakutan"]["eval_captured"] or 100) < 99.9])
EOF
```

### 4. 踏んだ罠

- **追加ルールは必ず `METHOD_RULES` の末尾に置くこと。** `bucket_of()` は最初に
  当たったルールで確定するので、先頭に入れると「小テストは試験より先に判定する」
  という既存の順序依存が壊れます。末尾に足す限り既存の分類は動きません。
- **`scrape/parse.py` を流し直すと `eligible_years` が消えます**（parse.py の docstring）。
  `scrape/years.py` を続けて流す必要があり、KOAN をもう一度叩くことになります。
  `data/raw/` は gitignore なので**持っていない人はそもそも parse.py を実行できません**。
  そのために `tools/rebucket.py`（`eval_raw` から振り分けだけやり直す）を足しました。
  振り分けの規則は `scrape.parse.bucket_of` を import して使っているので、正本は1つのままです。
- **「61種類を分類しても判定は 543→546（+3件）」という以前の数字を、
  やらない理由に使わないこと。** あれは「新しく判定できるようになる科目の数」で、
  今回のは「すでに判定されているが数字が間違っている科目の数」です。別の軸です。
  実際、今回の対応で判定できる科目は **560→554 と6件減りました**。
  README の「欠損を平均で埋めない」に照らせば、この −6 は正しい方向の −6 です。
- **`COVERAGE_MIN` と `EVAL_TOTAL_MIN` を混同しないこと。** 前者は「4軸のうち
  いくつ測れたか」、後者は「その軸の重みが実物と合っているか」。
  今回の21件は `COVERAGE_MIN` を**通過していました**（coverage は足りていた）。
  重みの元になる `eval_ratio` の方が間違っていたので、前者だけでは止まりません。
- **`match()` の「口コミが1件入ると出ます」は嘘になる場合があります。** 内訳が
  欠けている科目は口コミでは直らない（シラバス側の問題）ので、文言を分けました。

### 追記（同日）── しきい値を 100% ではなく 80% にした

上の②を入れた直後、`EVAL_TOTAL_MIN` を **99.9 → 80.0** に緩めました。
`137135【社会】政治の世界`（内訳の合計が90%）は**判定を出します**。

**理由。** 軸の重みは残った内訳から正規化して決まる（`dynamic_weights`）ので、
90% 読めていれば科目の形はもう決まっています。残り10%がどの軸に乗っても
順位はほとんど動きません。1割の不足で判定ごと捨てるのはやり過ぎでした。
実際に害があったのは **20〜70% しか読めていない**科目に 89.0（かなり楽）が
付いて1年生のおすすめに載っていた方で、そこは 80% のしきい値でも止まります。

**影響は1科目だけです**（口コミ36件を取り込んだ現在の main と比較）。

```
137135 【社会】政治の世界   情報不足 → 89.7「拘束は軽い」  captured 90%
判定できた科目             557 → 558
1年おすすめ                133 → 133（政治の世界が入り、宇宙地球科学IIが100位から押し出された）
```

`eval_raw` の合計が100%未満なのは **1,112件中この1件だけ**なので、
しきい値を80にしても他の科目には一切触りません（差分で確認済み）。

なお この科目は 期末試験80% ＋ 小レポート10% で、**レポート中心ではなく試験中心**です。
それでも「軽め」ではなく **「拘束は軽い」** が付きます ―― 試験の難しさは
KOAN に書いていないので断言しない、という既存の `pending` の扱いがそのまま効いています。

**これに伴い、上の「2. 何をしていないか」の 137135 の件を下げます。** 判定は
出るようになったので、政岡さんへのお願いは **「急ぎではないが、`grading()` が行を
取りこぼしていないかだけ実物と突き合わせてほしい」** に変わります。取りこぼしなら
他の科目にも出うるパーサのバグ、KOAN の表が本当に90%ならこのままで問題ありません。

---

## 2026-08-20 ｜ 口コミを初めて採点に流した ｜ wang

### 1. 何が動く状態か

**実データの口コミ36件が入りました。24科目に反映されています。**

```bash
python3 tools/ingest_reviews.py <フォームの書き出し.tsv>   # data/reviews.json に取り込む
python3 build.py                                        # 採点し直す
```

### 2. 一番大事なこと ── 口コミは実際に判定をひっくり返した

```
力学詳論I    78.0「拘束は軽い」 →  41.6「やや重め」   難易度 8/10
統計学Ｃ-I   74.4「拘束は軽い」 →  55.4「標準」      難易度 7/10
化学基礎論Ａ  86.9「拘束は軽い」 →  77.9「軽め」      難易度 2/10
```

力学詳論I の口コミは「**理解はしないときついです**」。
**シラバスだけでは 78点で1年生に薦めていた科目です。** 口コミ1件で止まりました。
「テストの形は軽いが難しさは未検証」を `拘束は軽い` として保留しておいた判断が、
実データで正しかったことになります。

判定できた科目 554 → 557、うち3件は「情報不足」から抜けました。

### 3. これまで繋がっていなかった配線

**`data/reviews.json` は書かれるだけで、一度も読み戻されていませんでした。**
`score.py` は `course["reviews"]` を見る作りなのに、それを入れるコードが
どこにも無く、口コミ→採点の経路は最初から通っていません。

`reviews.py` を追加して、そこに集約と合流を閉じ込めました。
`build.py` と `server.py` の**両方**で、採点の前に合流させています
（順番が逆だと反映されない。片方だけだと2モードで数字がズレる）。

フォームの10段階（1:簡単〜10:難しい）は `score.py` の `exam_hard`（0〜2）に
換算しています。**シラバスに書いてある事実は口コミで上書きしません。**
口コミが埋めるのは「シラバスに載っていないもの」だけです。

### 4. 決めてほしいこと・気づいたこと

**① 語学科目がデータベースに1件も入っていません。**
口コミ36件のうち**8件（25%）が語学**で、時間割コードは `191xxx` 台。
これは共通教育（所属 `0:13`）ではなく別の所属です。
**1年生の必修の多くが語学なので、穴としては学年の次に大きい。**

**② 口コミの本文は公開物に入れていません。**
`web/data/courses.built.json` には件数と難易度だけを載せ、`notes` は落としています。
理由は下の③。載せるかどうかは判断が要ります。

**③ 内容に問題のある口コミが混じっています。**
```
「誰かに出席カードの記入頼めば行かなくていいです」   ← 代返
「オープンチャットに入れば勝ち確です」              ← 答案の共有
「他の学部の問題入手出来れば簡単」
```
**学生団体が公開するサイトにこれを載せるのは、大学から止められる典型例です。**
採点には影響しません（本文は数値化していない）が、**公開前に方針が要ります。**

**④ `data/reviews.json` は gitignore されています。**
つまり**このファイルを持っている人しか再ビルドできません。**
いま本番の数字を出せるのは wang のPCだけです。運用として要検討。

**⑤ サイト内の4タップ投稿フォームは、実際のフォームと設問が違います。**
`server.py` の `POST /api/reviews` は attendance/workload/grading の3問ですが、
実際に使っているフォームは出席・授業中課題・授業外課題・テスト（持込・難易度）・
レポート（語数）の6問です。**サイト内投稿を作るときは実フォームに合わせること。**

---

## 2026-08-18（5） ｜ ロゴを入れた ｜ wang

### 1. 何が動く状態か

ヘッダがテキストの「ラクハン」から**ロゴ（マーク＋ロゴタイプ）**になりました。
**ファビコンも入れました**（それまでは無地でした）。

ブランド案の資料 https://rk-plan-8f3a2c.vercel.app/#s4 に合わせています。

### 2. ブランドの決まりごと（勝手に変えないところ）

- **色は `#DB6209`（ラクハン オレンジ）の単色。グラデーション禁止。**
  阪大公式カラー（青系）を意図的に避けて、**公認誤認のリスクを色の段階で断つ**という
  理由で決まった色です。`--brand` トークンに入れてあります。
- **ロゴ本体はコンテナを持ちません。** 角丸の四角に白いグリフを入れる形は
  資料側で明確に否定されています（既視感の正体はその型そのもの、という理由）。
  ベタ地＋白抜きは**アプリアイコン適用形**で、ファビコンだけがこれです。
- マークはカタカナの「ラ」。線幅一定・2ストローク・丸端。

### 追記（同日）── マークを「ラ」の字形として組んだ

**マークがカタカナの「ラ」そのものなので、マーク＋「クハン」で1語として読ませます。**
位置は元どおり、ヘッダ左の横組み。マーク以外は白なので、地は濃色
（ブランド資料の SUMI `#1A1A1A`）です。

実装で気をつけたところ：

- **マークの `viewBox` をインクの外周に切り直しました**（`0 0 64 64` → `11 10 41 45`）。
  元の viewBox は上下左右に余白があり、そのままだと「ラ」と「ク」の間だけ空いて
  1語に見えません。
- **読み上げは `h1` の `aria-label` にまとめました。** マークを画像として置くと
  「ラ」が飛ばされて「クハン」だけ読まれます。

⚠️ **ここはブランド資料と違います。** 資料の「濃色の上・写真の上」の適用形は
**マークも白抜き**（`markRaku(64, "#FFFFFF")`）で、
「マークだけオレンジ、文字は白」という組み合わせは資料に載っていません。
また資料の `lockup()` は**マークと「ラクハン」を並べる**形で、
**マークを「ラ」として使い回す**形ではありません。
**意図的な判断であれば問題ありませんが、食い違いは記録しておきます。**

免責バーはヘッダの下に移しました（濃色帯の上に淡いバーが乗ると、
帯が浮いて見えるため）。表示内容は変えていません。

### 3. 何をしていないか

- **サイト全体のアクセント色は緑（`--go` `#0e7c66`）のままです。**
  ロゴだけオレンジで、チップ・FAB・相性の数字は緑。**ここは未決定**（下記）。
- フッターの「学生団体 GUILD が運営しています」は入れていません（下記）。

### 4. 気づいたこと ── 2つ、決めてほしいことがある

**① アクセント色が2色ある状態です。**
ロゴ `#DB6209` とUIの `--go` `#0e7c66` が別系統。
ヘッダのバッジだけは色を外して衝突を避けましたが、
スクロールするとチップもFABも緑です。**ブランド色に寄せるかは要判断。**
`--go` を差し替えれば全部変わりますが、見た目が大きく変わるので勝手にやっていません。

**② フッターに GUILD の記載がありません。**
ブランド資料には「Timeline資料のレッドライン＝**学生団体であることを資料に明記**」
への対応として、**サイトフッター／About に『学生団体 GUILD が運営しています』を出す**
と書かれています。サービスロゴには入れない、出す場所を分ける、という整理です。
**いまのフッターにその一文がありません。** 公開前に入れておくべき項目だと思います。

---

## 2026-08-18（4） ｜ 履修できる学年を取得・既定を1年生に ｜ wang

### 1. 何が動く状態か

**学年で絞り込めるようになりました。既定は1年生です。**

```bash
python3 scrape/years.py     # 学年データを取り直す（約2分半）
python3 build.py && python3 server.py
curl 'localhost:8000/api/courses?year=1'    # 1015件
curl 'localhost:8000/api/courses?year=all'  # 1112件
```

画面は検索窓のすぐ下に「1年 / 2年 / 3年 / 4年 / すべて」のチップ。

### 2. 何をしていないか

- **LINE 側は未対応です。** `preset_top` の構造が変わりました（下記）

### 3. 次の人が最初に打つコマンド

```bash
git checkout main && git pull && python3 build.py
```

**きむらさんへ：`preset_top` の形が変わりました。** 学年で1段深くなっています。

```
旧  preset_top["とにかく軽い"]         → [id, ...]
新  preset_top["1"]["とにかく軽い"]     → [id, ...]   ← "1" は学年
                 "1"〜"6" の6学年ぶん入っています（医・歯学部は6年制）
```

**既定は "1"（1年生）を読んでください。** 1年生が履修できない科目を薦めないためです。

### 4. 踏んだ罠 ── 1年生が取れない科目が97件、しかも上位に食い込んでいた

**取得時の検索条件で学年（`nenji`）が空だったため、全学年の科目が入っていました。**

```
学年指定なし（これまでのDB）   1,112 件
1年生が履修できる               1,015 件   ← 97件（8.7%）が取れない
2年生                          1,077 件
3年生・4年生                    1,110 件
```

しかも**おすすめ上位134件のうち7件が1年生には履修できない科目**でした。
「熱学・統計力学要論 90.7」「電磁気学詳論II 91.2」など、**点数が高いので上位に来る。**
1年生が見て選ぼうとすると KOAN で弾かれます。公開後に必ず指摘される類のバグでした。

**シラバス詳細には `年次／Student Year` があるのに `courses.json` に取り込んでいませんでした。**
ただし詳細を1,112件取り直すと2秒間隔で37分かかるので、
**KOAN の検索の学年絞り込みを使い、学年ごとの一覧に出るかで判定**しています
（6学年 × 約11ページ ＝ 約66リクエスト、2分半）。これが `scrape/years.py` です。

⚠️ **`parse.py` を流し直すと `eligible_years` が消えます。** 流したら `years.py` も流してください。
`parse.py` の冒頭にも書いておきました。

### 5. ついでに直したバグ ── 開講所属が12件壊れていた

`category` が「年度」になっている科目が12件ありました（`138531` GIS入門 など）。

原因は `koan.py` の `list_rows`。**検索フォームと結果表を丸ごと含む外側の `<tr>` にも
`referW(` が入っている**ため、それをデータ行として拾い、`tds[1]` がフォームのラベル
「年度」になっていました。**各ページの先頭科目1件 × 12ページ ＝ 12件。**

本物のデータ行は9列（No.〜参照）なので、列数で弾くようにしました。実測で
1ページ100行・壊れ0件・先頭が `138531 / 全学教育推進機構` に戻ることを確認済みです。

`courses.json` 側の12件は、生HTMLが10件しか残っておらず `parse.py` を流し直せないため、
値が全件同一（全学教育推進機構）であることを根拠に直接補正しました。

---

## 2026-08-18（3） ｜ サービス名を「ラクハン」に確定・口コミ方針の転換 ｜ wang

### 1. 何が動く状態か

**サービス名が「ラクハン」に決まりました。** サイト・README・`server.py`・API のタイトルを一括で変更ずみ。
`楽単DB（仮）` はもうどこにも出ません。

```bash
git checkout main && git pull
python3 server.py     # → ヘッダが「ラクハン」になっていること
```

### 2. 何をしていないか

**おすすめ順の変更は、まだしていません（未決定）。** 理由は下の4番。

### 3. 次の人が最初に打つコマンド

日程・担当・判定基準は [ROADMAP.md](ROADMAP.md)（**v6 が最新**）。

**しゅんやさんへ：口コミは科目を選ばず、とにかく量を集めてください。**
「上位134件を狙う」方針は公開後にまわしました。自分が取った科目を書いてもらうのが最優先です。

### 4. 踏んだ罠 ── 量を増やしても「一番目立つ場所」は直らない

v5 では「おすすめ上位134件を埋める」を目標にしていましたが、**取り下げました。**
書いてくれる人数が読めない段階で「この科目を書いて」と指定できないためです。

ただし、科目を選ばずに集めると上位134件に当たる確率は **134/1,112 = 12%** しかありません。

```
口コミ 100件 → 上位134件に当たるのは期待値 12件
口コミ 200件 → 期待値 24件
口コミ 300件 → 期待値 36件
```

**量では上位が埋まりません。** 一方で **すでに検証ずみの科目が158件** あり、Top100 を埋めるには十分です。

→ **収集ではなく表示で解くべき**という結論になりました。
おすすめ順を「検証ずみ → 未検証」にすれば、どの科目に口コミが来ても最初の画面は常に根拠のあるものになります。

**ただしランキングの並び順はサービスの核なので、勝手に変えていません。**
決まってから実装します。触る場合は `score.py` ではなく `build.py` の `preset_top` と
`web/index.html` の `queryLocal()` の両方に同じ順序を入れる必要があります
（片方だけ直すと API モードと静的モードで並びがズレます）。

---

## 2026-08-18（2） ｜ 本番公開・6人体制への再配分 ｜ wang

### 1. 何が動く状態か

**本番が公開されました。** https://rakutan-db.wjy20050815.workers.dev

```
データ転送量  1,496,620 → 83,637 bytes （gzip で −94.4%）
配信エッジ    KIX（大阪）
noindex       効いている（8/26 に外す）
自動デプロイ  main にマージすると約80秒で反映
```

松下さんが残していた「デプロイ後に gzip を要確認」はこれで解決です。
**1.4MB が実際には 83KB しか流れません。**

**まだ学内に拡散しないでください。** 中身が揃うまで検索エンジンにも載せていません。

### 2. 何をしていないか

- **口コミの実データは0件**（`data/reviews.json` はダミー1行のまま）
- サイトからの投稿はできません。入口（FABボタン）ごと隠してあります。
  D1 ができたら `web/index.html` の `CAN_POST` を `true` にするだけで戻ります
- `METHOD_RULES` の61種類は未分類のまま（公開後に着手すると決めました。理由は下）

### 3. 次の人が最初に打つコマンド

```bash
git checkout main && git pull
```

**日程と担当は [ROADMAP.md](ROADMAP.md) を見てください。** v4以前のPDFは古いです。

### 4. 踏んだ罠 ── 数えてみたら想定と桁が違った

**「口コミ待ち916件」は、実際に埋めるべき数ではありませんでした。**

サイトが最初に薦める科目は、4プリセットの上位100件を重複除いて **134件だけ**です。
そのうち **130件が「テストの難しさ」だけ足りない**状態で、**「情報不足」は0件**。

→ 目標を「1,112件を埋める」から **「134件を埋める」** に変えました。6人×20科目で届きます。

**ただし副作用があります。** 上位に来ている科目は「試験はあるが難しさが未検証だから
重いと判定されていない」科目です。つまり**検証していないから薦めている**状態で、
一番目立つ場所が一番あやしい。ここを埋めずに公開しないでください。

**`METHOD_RULES` を `report` に分類すると、判定できる科目はむしろ減ります。**
レポート軸は本数・字数が要るのに、それはシラバスに載っていません。
重みだけ `report` に移って軸が測れず、`COVERAGE_MIN` を割ります。
実測：`attendance` だけ足す → +3件、`report` だけ足す → ±0件。**分類するなら `attendance` 側から。**

**61種類を全部分類しても判定は 543→546（+3件）です。** 王立明さんの離脱で
人を補充しなかったのはこの数字が根拠です。

---

## 2026-08-18 ｜ PR #1〜#4 マージ・Cloudflare 公開準備 ｜ wang

### 🚨 8/26 の公開当日、最初にやること

**`web/robots.txt` を削除し、`web/_headers` の `X-Robots-Tag` の2行を消す。**
これを忘れると、公開してもGoogleに一切載らない。公開前だけの措置です。

```bash
git rm web/robots.txt
# web/_headers から「X-Robots-Tag」の行を削除
```

### 1. 何が動く状態か

`main` に PR #1・#2・#3・#4 が全部入りました（8/14から止まっていたのが解除）。

```bash
python3 build.py && python3 server.py     # → http://localhost:8000
node tools/smoke.mjs http://localhost:8000   # APIモード
node tools/smoke.mjs http://localhost:8140   # 静的モード（cd web && python3 -m http.server 8140）
```

両モードとも 1,112件・先頭科目・相性の値まで一致、コンソールエラー0で確認済み。

### 2. 何をしていないか

- **Cloudflare Pages にはまだ繋いでいません。** 繋ぐ前の下ごしらえだけ済ませた状態。
- **口コミの実データは0件です。** `data/reviews.json` はダミー1行のまま。
  **1,112件中916件（82%）がこれ待ち**（情報不足552 ＋ テストの難しさ未評価364）。
  これは技術の問題ではなく、集まるかどうかの問題です。
- **静的サイトからは口コミを投稿できません**（`CAN_POST=false`）。
  投稿にはPages Functions＋D1が要りますが未着手。8/26に「準備中」のまま出すかは未決。

### 3. 次の人が最初に打つコマンド

```bash
git checkout main && git pull
```

きむらさんへ：LINE用のデータは `web/data/courses.built.json` の `preset_top` にあります。
4つのプリセット×上位100件のIDが入っているので、**LINE側に採点ロジックは一切要りません**。
Cloudflareに繋いだらHTTPSのURLを渡します。

### 4. 踏んだ罠

**PR #3 がGitHub上だけ「コンフリクト」と出て、手元では綺麗にマージできた。**
原因はコードではなく履歴の形です。#3 が #1 と #2 の両方の上に乗っていたため
**merge base が2つ**（交差履歴）になり、手元のgit（ort戦略）は仮想baseを作って解決できるのに、
GitHubの自動マージは2つのbaseを見た時点でコンフリクト判定していました。

→ 手元で `git merge origin/main` して push し直したら通りました。
**松下さんのコミットは書き換えていません**（rebaseもforce pushもしていない）。普通に `git pull` できます。
今後も「分岐の上にさらに分岐」を作ると同じことが起きます。

**`web/` に置いたものは全部そのまま公開されます。**
`progress.html` は開発者用の進捗ダッシュボードなのに `web/` にあったので、
そのままだと公開URLに晒され、しかも `/api/progress` が静的環境に無いので
永久にエラーを出すページになるところでした。`tools/progress.html` に移動済みです。
**ローカルでのURL（`localhost:8000/progress.html`）は変わりません。**

---

## 2026-08-16 ｜ ③ スマホ対応・表示速度・UI改善（タスク1） ｜ 松下

### ⚠️ 先に読む ── マージ順：**#1 → #2 → #3。#1と#2は Squash ではなく Merge で**

この作業は PR [#3](https://github.com/jiayi-ThE-CREATOR/rakutan-db/pull/3)（`feat/matsushita-mobile-ui`）です。
**#3 は #2 に依存しています。** 単独ではマージできません。

| PR | 中身 | 担当 |
|---|---|---|
| [#1](https://github.com/jiayi-ThE-CREATOR/rakutan-db/pull/1) | HANDOFF.md の②（全件取得・充足率） | 政岡 |
| [#2](https://github.com/jiayi-ThE-CREATOR/rakutan-db/pull/2) | 静的ビルド層（`build.py`・`courses.built.json` 他） | wang |
| [#3](https://github.com/jiayi-ThE-CREATOR/rakutan-db/pull/3) | 今回のスマホ対応・UI一式 | 松下 |

**なぜ依存するか：** `origin/main` には `build.py` も `web/data/courses.built.json` も無く、
`web/index.html` は API しか見ません（静的モードが存在しない）。#3 が変更している
`boot()` の静的フォールバックと `queryLocal()` は、**#2 が作った土台の上にあります。**
だから #3 を `origin/main` から切り直すことはできません（衝突するうえ、動きません）。

**Squash を避ける理由：** #3 のブランチは #1・#2 のコミットを含んだ状態のローカル `main` から
切られています。#1・#2 を **Merge**（コミットIDが保たれる）でマージすれば、#3 の差分は
GitHub側で自動的に `HANDOFF.md` と `web/index.html` の2ファイルだけに縮みます。
**Squash するとコミットIDが変わるため差分が縮まず、逆に衝突します。**

> #3 の差分が今10ファイルに見えるのはこのためで、松下が他人の担当ファイルを
> 触ったわけではありません。#3 自身のコミットは上記2ファイルのみです。

### 0. 最重要 ── 体感の遅さの原因は `server.py` 側。**まだ直っていない（担当外）**

**症状：空きコマを選ぶのは速いが、もう一度押して「解除」すると1秒弱かかる。**

原因は `server.py`（APIモード）が、絞り込み結果を**全件・`indent=2` で整形したJSON**で
返していること。`/api/courses` にページングが無い。

| 操作 | 応答時間(localhost) | 転送量 |
|---|---|---|
| 絞り込み（金5・51件） | 68ms | 142 KB |
| **解除（全件1,112件）** | **214ms** | **3,049 KB** |

解除だけ転送量が21倍になる。**これが「選択は速い・解除だけ遅い」という非対称の正体。**

**オーナーは wangさん（`score.py`・集計）か 政岡さん（本番環境）** ―― README 7章の担当表に
`server.py` の記載が無いため確定できず、松下の担当は `web/index.html` のみなので手を付けていない。
実測した選択肢:

| 案 | 全件レスポンス | 内容 |
|---|---|---|
| 現状 | 3,049 KB | `_send_json()` の `json.dumps(..., indent=2)` で整形して全件返す |
| 整形をやめる | 1,910 KB（−38%） | `indent=2` を外す1行変更 |
| **整形やめ＋先頭50件** | **81 KB（−98%）** | 画面は最初50件しか描画しない。残りは要求されていない |

**本番（Cloudflare Pages＝静的モード）では起きない**ことは実機で確認済み。
ただし LINE Bot も同じ `/api/courses` を使うので、**きむらさんの応答速度には直結する。**

### 1. 何が動く状態か

```bash
python -m http.server 8123 --directory web
```

変更したのは `web/index.html` のみ。新しい依存ライブラリは追加していない。
390px幅で確認。**すべて実測してから直した**（推測で直して2回外したため。下記4）。

**表示速度**

- 一覧を初回50件だけ描画し、スクロールで50件ずつ追加（無限スクロール）
- **本命：詳細パネル（4軸バー＋信頼度）を、開くまで作らない。** 閉じたままの `.detail` の中身が
  全DOMノードの56%（36,064中20,211）を占めており、誰も見ていない中身の分だけ重くなっていた
  → `card()` は空箱だけ出し、`detailHtml(c)` を初回オープン時に流し込む（`dataset.filled` で再利用）
- 口コミの科目プルダウンを、開いた時だけ組み立てる
  （以前は絞り込みのたび・検索窓の1文字ごとに最大1,112個の `<option>` を生成）
- 追加読み込み時、新しく増えたカードにだけクリック判定を付ける（以前は毎回全件走査＝雪だるま式）

| 指標 | 修正前 | 修正後 |
|---|---|---|
| DOMノード数 | 36,064 | 15,853（−56%） |
| 全件描画 | 95.9ms | 32.0ms（−67%） |
| レイアウト1回 | 413.6ms | 183.3ms（−56%） |
| 全部見た後に空きコマを押す（JS+レイアウト） | 39.7ms | 28.7ms（−28%） |

**UI**

- 選択中のコマが、下にスクロールしても画面上部に貼り付いて見えるバー（✕で解除、グリッドも連動）
- 詳細欄に「この科目の口コミを書く」ボタン。押すとその科目が選択済みでシートが開く
- 画面下の「口コミを書く」も、直前に詳細欄を開いた科目を自動選択
  （一度も開いていなければ従来どおり先頭の科目）
- フッター文言を実態に合わせて修正。「この画面は `/api/courses` を叩いているだけ」→
  「採点は `build.py` が確定させたもの」。API-first原則は変えておらず、静的配信での実装を言い換えただけ

**実機確認済み（2026-08-16・スマホ実機・松下）**

- 一覧・詳細パネル・投稿シートの**表示崩れが無い**ことを目視
- 今回足したUI（選択中コマの貼り付きバー、詳細欄の「この科目の口コミを書く」）が**実機で動く**
- スクロール・絞り込みが**引っかからない**

ただし**体感での確認であって、実機で描画時間の数値は測っていない**（下記2）。
どちらのモード（`:8123` 静的／`:8000` API）で見たかは記録していない。

### 2. 何をしていないか

- **体感の遅さ（上記0）は未修正。担当外。次の人が最初にやるのはここ**
- **実機で描画時間の数値は測っていない。** 上の表はすべてPCブラウザ上のJS計測で、実機換算
  （CPU約5倍遅い）の 28.7ms→約150ms は**見積もりであって計測値ではない**。
  実機で確かめたのは「引っかからない」という体感まで（上記1）
- **静的モードが「修正前から速かったのか」は不明。** 修正前を実機で測っていないため、
  上記の描画改善が体感に効いたのかは**証明できていない**。数値上の改善であることは確か
- **絞り込み時に結果リストの先頭へスクロールする変更は未実装。** 本人が採用を選択済み。
  390pxでは結果バーが `docY≈806` にあり、空きコマを押しても**画面内に結果が出ない**ため依然必要
- **通報導線（通報メールリンク）は未実装。** バグではなく元から無い。タスク3（8/23）の範囲
- **投稿の保存先（D1等）は未着手。** 送信は `CAN_POST=false` で無効のまま。タスク2（8/23）の範囲
- **デプロイ後に `Content-Encoding: gzip`（またはbr）が付いているかだけ要確認。**
  `courses.built.json` は gzip で 1,462KB→83KB（−95%）になり、初回表示は問題にならない見込み
- 未着手：`buildGrid()`・`buildConds()` の毎回の作り直し（実測 0.2〜0.4ms。放置でよい）

### 3. 次の人が最初に打つコマンド

**まず、どちらのモードで見ているかを確認する。**

```bash
python server.py
```

→ `http://localhost:8000` は**APIモード**。空きコマを1つ押してから**もう一度押して解除**し、
1秒弱かかるのを再現する。DevTools の Network で `/api/courses` が **3MB** 返していれば上記0の通り。
**直すのは `server.py` の `_send_json()` と `search()`（担当外）。**

```bash
python -m http.server 8123 --directory web
```

→ `http://localhost:8123` は**静的モード（本番と同じ）**。通信しないので解除も速いはず。
表示崩れの目視はスマホ実機で実施済み（上記1）なので、**やり直す必要はない。**
未確認なのは実機での描画時間の数値（上記2）。

### 4. 踏んだ罠

- **見ている画面と、直している画面が違った。** 本人は `:8000`（server.py＝APIモード）で
  見ていたのに、こちらは `:8123`（静的モード）で計測して直していた。**同じ `index.html` が
  モードによって全く違う経路で動く**（`boot()` が `/api/health` の応答で切り替える）ため、
  静的モード側をいくら速くしても体感は1mmも動かない。
  **速度の相談を受けたら、最初に「どのURLで見ていますか」を聞く。**
  `Get-NetTCPConnection -State Listen` でどのポートが上がっているかが分かる
- **症状の非対称性が一番の手がかりだった。** 「選択は速いが解除だけ遅い」は処理の重さでは
  説明できず、**データ量の差**でしか説明できない（51件=142KB vs 1,112件=3MB）。
  遅さを聞いたら「どちら向きの操作か」「何が増える方向か」を先に確認する
- **「無駄な処理を見つけた」＝「体感の原因を見つけた」ではない。** 最初にコードを読んで
  見つけた無駄を先に直したが、体感は変わらなかった。**測ってから直すべきだった。**
  犯人は「閉じた詳細パネルが全ノードの56%」という、読んでも気づけない場所だった
- **再現できた「遅い状況」が、実機では起きない状況だった。** `scrollY` を手で深い位置
  （143,185px）に置くと絞り込みが597msかかり犯人に見えたが、**390pxでは空きコマ・条件チップ・
  並び替えがすべて `docY≤806` にあり、押すには `scrollY≈0` でないと届かない。**
  **計測値を採用する前に、その状況が実機で起きるかを確認する**
- **キャッシュ：編集後に `force:true` で navigate しても古いコードが動く。
  URLにクエリ（`?v=2`）を足すまで直らない。** 同じセッション中に2回踏んで、
  `typeof buildReviewSelect` が `undefined` になり「実装が反映されていない」と一瞬誤診断した。
  次の人も必ず踏むと思ってほしい
- **この検証環境ではブラウザのペインが表示されず、スクリーンショットが撮れない／
  `requestAnimationFrame` が発火しない。** rAFで測ろうとすると30秒でタイムアウトするだけなので、
  速度は `document.body.offsetHeight` を読んで**強制レイアウトを同期的に走らせて測る**。
  見た目やクリック結果の確認も、`getComputedStyle`／`getBoundingClientRect` や
  `.click()` をJS実行で直接読む方法で代替できる

---

## 2026-08-14 ｜ ② 全件取得・充足率 ｜ 政岡 → 王力明・松下

### 0. 8/16 Go/NoGo ── **Go**（前倒しで確定させたい）

評価割合(%)の充足率 **1,110/1,112 = 99.8%**。判定ライン50%を大きく上回った。

8/16まで待っても数字は動かない。`METHOD_RULES` を拡張しても充足率は**上がる方向にしか
動かず**（今まで判定できなかった科目が判定できるようになるため）、取れなかった2件も
パーサ側の問題なので同じく上がる方向。**99.8% は下限**で、50%を割る筋が無くなった。

### 1. 何が動く状態か

KOAN 共通教育科目 **1,112件を全件取得**し、`data/courses.json` を生成済み。
取得 1,112/1,112・**失敗 0**。`--delay` は既定の2秒のまま、所要 約42分。

```bash
git pull
python3 scrape/fetch.py     # 全件・約42分。取得済みは飛ばすので再実行は数秒
python3 scrape/parse.py     # courses.json を再生成＋充足率を表示
python3 server.py           # courses.json を読んで起動
```

`data/raw/detail/` に1,112件のHTMLを保存済み（手元のみ・gitignore対象）。
**parse だけなら KOAN を叩かずに何度でもやり直せる。**

| 項目 | 充足率 |
|---|---|
| **評価割合(%)** | **1,110/1,112 = 99.8%** |
| 曜日・時限 | 1,112/1,112 = 100% |
| 授業形態 | 1,112/1,112 = 100% |
| 時間外学習の時間 | 16/1,112 = 1.4% |
| 持込可否 | 7/1,112 = 0.6% |

下2つが低いのは、KOANに無い項目として口コミで聞く設計になっている分。

### 2. 何をしていないか

| 項目 | 状況 |
|---|---|
| **`METHOD_RULES` の拡張** | **未着手。v4で王力明の担当のため意図的に触っていない**。振り分けられなかった評価方法は **61種類 / 74件**。⚠️ `parse.py` の表示は `most_common(20)` なので画面には上位20件しか出ない（見た目20種類・実数61種類）。未表示だった41種類に `エッセイ` `翻訳` `輪読` `積極性` `相互評価` `グループワーク` `Homework exercises` 等。既存ルールに寄せられそうなものが混じるので、61件そのままが新規追加ぶんではない |
| **評価割合が取れなかった2件** | **「取れない」ではなく「パーサが見つけていない」**。`131737 学問への扉（ものづくり工学入門III）` / `131533 学問への扉（水曜午後の工学系物理）`。2件とも `eval_raw` が空で、割合が空欄なのではなく成績評価テーブル自体が見つかっていない。**両方とも「学問への扉」**なので、この科目区分だけページ構造が違う可能性がある。未調査 |
| 定員・レポート本数・字数 | KOANに存在しないため未取得（口コミで聞く前提） |
| campus | 詳細ページに無いため未取得 |
| 全件でのエラー時リトライ強化 | 未実施（今回は失敗0で発動せず） |

#### 本番環境まわりの未解決 ── 3点セット（Discordで質問中・8/15の接続前に要判断）

**この3つは繋がっている。①だけ解いても②③が残る。**

**① `data/courses.json` がリポジトリに入らない。**
`.gitignore` 対象（「本番データ（口コミを含むため）」）。今日の1,112件はKOANのシラバスの
事実だけで口コミは1件も入っていないが、除外されている。**他の6人の手元に届かない。**

**② `courses.json` が無いと、黙って30件のダミーに切り替わる。**
`server.py` 27〜29行目。`courses.json` が無ければ `courses.sample.json` を読む。
**エラーが出ないので「動いているのに中身がダミー」に気づけない。**
①の結果、政岡以外の6人は現在この状態。

**③ `web/index.html` は `/api/courses` を叩いている＝Pythonサーバー前提。**
Cloudflare Pages は静的ホスティングなので `server.py` は動かない。そのまま繋ぐと
`/api/courses` が404になるはず。`functions/` `_worker.js` `wrangler.toml` いずれも無く、
`package.json` のスクリプトも `shots` のみで、ビルドの仕組みが存在しない。
v3にあった「スコア済みJSONを静的書き出しする方式にするかを週の頭に決める」が、
Cloudflare接続が政岡→wangに移った際に一緒に移ったのか未確定。

### 3. 次の人（王力明・松下）が最初に打つコマンド

```bash
git pull
python3 scrape/parse.py     # 手元に data/raw/ が無ければ先に fetch.py（約42分）
```

**王力明へ**：`METHOD_RULES` への追加は `parse.py` の再実行だけで反映される。
**`fetch` は不要**（KOANを叩き直さずに済む）。
未振り分けの**全61種類**を見るには、`parse.py` の `most_common(20)` を `most_common()` に変える。

### 4. 踏んだ罠

**罠③：Windows で `python` / `python3` が動かないPCがある。**
Microsoft Store のダミーが応答し、**エラーも出さずに終了コード49を返す**。
何も実行されないのに失敗にも見えないので原因が分かりにくい。
実体のあるPython（Anacondaなど）のパスを直接指定して解決した。
**まず `python --version` がバージョンを返すか確認すること。**

**罠④：全件を回す前に `--limit 10` を必ず一度通す。**
10件なら30秒で終わり、`fetch` は取得済みを飛ばすので全件実行時に無駄にならない。
45分回してから環境の問題に気づくのが一番高くつく。

**罠⑤：`parse.py` の未振り分け一覧は上位20件で打ち切られる。**
`most_common(20)` のため、実際に61種類あっても20種類しか表示されない。
最初この20件を全体だと思って報告しかけた。
wang の罠①（充足率10%）と同じ構造で、**表示された数字をそのまま結論にすると
次の人の作業量を見誤る。**

**罠⑥：`courses.json` が無いと、黙って30件のダミーに切り替わる。★次の人が確実に踏む**
`server.py` 27〜29行目で、`courses.json` が無ければ `courses.sample.json` を読む。
**エラーも警告も出ない。** `courses.json` は `.gitignore` 対象なので、
**`git pull` しただけの人は必ずこの状態になる。**
画面は普通に動くので、30件のダミーを本物だと思ったまま作業が進む。

起動したらまず件数を確認すること：

```bash
curl http://localhost:8000/api/health
```

`"courses": 1112` なら本物、`"courses": 30` ならダミー。
30だった場合は `scrape/fetch.py`（約42分）→ `scrape/parse.py` を先に実行する。

---

## 2026-08-13 ｜ ① スクレイパ v0 ｜ wang → 政岡

### 1. 何が動く状態か

KOAN の共通教育科目を、検索から詳細まで**通しで取得して JSON にするところまで動く**。
10件で実行し、成績評価の内訳（%）の充足率は **10/10 = 100%**。

```bash
python3 scrape/fetch.py --limit 10   # 一覧→詳細HTMLを data/raw/ に保存
python3 scrape/parse.py              # data/courses.json を生成＋充足率を表示
python3 server.py                    # courses.json があればそれを読む
```

`fetch` と `parse` は**意図的に分けてある**。抽出ロジックは必ず直すことになるが、
HTML がローカルにあれば `parse` は何度でもやり直せて、KOAN を叩き直さずに済む。
`fetch` は保存済みを飛ばすので、中断しても再実行で続きから。

### 2. 何をしていないか

| 項目 | 状況 |
|---|---|
| **全件（1,112件）での実行** | **未実施。10件は検索結果1ページ目の先頭なので偏っている可能性がある** |
| 全件での充足率 | 未確認。**これが 8/16 Go/NoGo の判定材料そのもの** |
| `METHOD_RULES` の網羅 | 不十分。評価方法は固定語彙ではない（「態度（積極性や協調性等）」「Class debate」「理解」が実在した）。未知の名前は `parse.py` が最後に一覧表示するので、それを見て足す |
| 定員・レポート本数・字数 | **KOAN に存在しない**。取れないので口コミの4タップで聞く |
| 持込可否・時間外学習の時間 | 本文中の書き方が一定でなく、10件では 0/10 |
| campus | 詳細ページに無い。後日ほかの手段で補う |
| エラー時のリトライ | `detail()` で1度だけフローを張り直す最低限のみ。全件で回すなら要強化 |

### 3. 次の人（政岡）が最初に打つコマンド

```bash
git pull
python3 scrape/fetch.py            # --limit なし＝全件。delay 2秒で約45分
python3 scrape/parse.py            # 充足率が出る ← これを Discord に貼る
```

`fetch` は途中で落ちても、もう一度同じコマンドで続きから。
**`--delay` を短くしないこと。** 45分を惜しんで失うものの方が大きい。

そのあと `parse.py` の出力末尾に「振り分けられなかった評価方法」が並ぶので、
`scrape/parse.py` の `METHOD_RULES` に足して `parse` を再実行（`fetch` は不要）。

### 4. 踏んだ罠

**罠①：成績評価テーブルの見出しは1行目とは限らない。**
最初 `trs[0]` を見出し行だと決め打ちして書いたら、充足率が **10%** と出た。
危うくその数字を「KOANが埋めていない」という結論にして Plan B を発動させるところだった。
**バグ由来の数字で重大判断をしかけた。** 行の位置ではなく、1セル目の文言（`評価方法` / `評価割合`）で探すのが正解。

**罠②：入れ子テーブルの外側を拾うと中身を全部含む。**
①を直したら今度は 0% になった。外側の大きい `<table>` にも「評価方法」「評価割合」の
文字が含まれるため、そちらにマッチして「授業サブタイトル」などを評価方法として拾っていた。
**これ以上 `<table>` を含まない一番内側だけを見る**ようにして解決（`parse.py` の `grading()`）。

どちらもコード中のコメントに残してある。抽出ロジックを触るときは先に読むこと。

### おまけ：確認済みの KOAN 仕様

`scrape/koan.py` の docstring に、検索パラメータ・ページング・詳細URLの実測値を全部書いてある。
ここは調べ直さなくてよい。
