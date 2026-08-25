# LINE ログインと マイページ ―― 設計（スペック）

> このファイルは**設計**。実装手順は同日付の `-plan.md` を見ること。
> **plan は Phase 1 と Phase 2 で2本に分ける。**
> Phase 1 だけで機能が完結し、Phase 2 は D1 とプライバシーポリシーを待つため。
> 実装は `feat/wang-line-login`（`main` から分岐）で行い、`main` には触らない。

**ゴール：** 学生が「気になる科目」と「自分の時間割」を持ち歩けるようにする。
LINE 公式アカウントから来た人は何もせずその状態になり、
サイトから来た人は**あとから**同じ状態に合流できる。

---

## 0. 動かさない前提（この設計が壊してはいけないもの）

- **ログイン不要**（`CLAUDE.md`）。検索・閲覧・お気に入り・時間割は
  **ログインせずに全部使える**。ログインが増やすのは「端末をまたぐ」ことだけ
- **入口は空きコマグリッド**。開屏の問診はこの入口の前に立つが、
  **1タップで丸ごと降りられる**
- **数字は API の実データから**。この機能は採点に一切触らない
- **1ファイル1オーナー**。`web/assets/kuchikomi.js` には触らない

## 1. 2つのフェーズ

| | 範囲 | 依存 |
|---|---|---|
| **Phase 1**（9/2 まで） | 開屏の問診・お気に入り・私の時間割・マイページ。**全部 localStorage** | 無し。バックエンドも LINE の設定変更も不要 |
| **Phase 2**（9/2 以降） | LINE ログインと端末間の同期 | D1・プライバシーポリシー・`LINK_SIGNING_SECRET` |

Phase 1 だけで機能として完結する。Phase 2 は「同じものが別の端末でも見える」を足すだけ。

---

## 2. データ構造

Phase 1 の状態は全部 localStorage。**既存の鍵を1つ共用し、3つ足す。**
読み書きは必ず `try/catch`（プライベートモードでは例外が飛ぶ。`splash.js` が既にそうしている）。
そのため schema と読み書きは新規 `web/assets/store.js` に集約し、
`app.js` と `mypage.js` の両方がこれを読む。

### 2.1 `osaka_u_settings`（既存・kuchikomi と共用）

```js
{ grade, semester, faculty, department }
```

- 問診が書くのは **`faculty` と `grade` だけ**。`semester` / `department` には触らない（kuchikomi の領分）
- `faculty` の値は `web/data/requirements.json` の `faculties[].key`。
  **JS 側に学部の一覧を持たない**（`kuchikomi.js:150` が既に立てた規則）
- 読むときは**値が選択肢に在ることを確かめてから代入する**。
  他人が先に作った鍵なので、こちらが知らない値が入っている可能性がある
  （`kuchikomi.js:162` が 2026-08-26 に踏んだ罠。無言で未選択になり「選んだのに送れない」になる）

### 2.2 `rk_onboarded`（新規）

`"1"`。開屏の問診カードが一度出たことの印。答えても飛ばしても書く。

**localStorage であること。** `rk_splash_seen` が sessionStorage なのは
「タブを閉じて開き直したらもう一度見たい」から。問診は逆で、
履修登録期に1日何度も開く学生を毎回止めてはいけない。**一生に一度だけ出す。**

### 2.3 `rk_favorites`（新規）

```js
{ v: 1, ids: { "138531": 1756200000000 } }
```

配列ではなく object。削除が O(1) で、追加時刻で「最近のお気に入り」順に並べられる。

### 2.4 `rk_timetable`（新規）

```js
{ v: 1,
  aki:  { slots: { "月2": "138531" }, extra: ["020277"] },
  haru: { slots: {}, extra: [] } }
```

3つの決定と理由：

1. **学期ごとに分けて持つ。** 秋冬と春夏は別の時間割。分けないと
   9月に入れた表が4月には全部間違いになり、しかも学生は消しに来ない
2. **slot の鍵は `"月2"` の曜限文字列。** `timetable.json` が
   `slots: ["水2"]` の形で持っており、`app.js` の `day_period` も同じ形。
   添字にすると読み書きの両端で変換が要る
3. **学期の語彙は `haru` / `aki`。** `timetable.json` の `term_group` と
   `app.js` に合わせる。kuchikomi の `spring` / `autumn` とは違う。
   **この分裂は既に存在しており、ここで広げないだけで、直しはしない**

1科目が複数の曜限を持つときは、同じ id が `slots` に複数回現れる
（`timetable.json` の `slots` がそもそも配列）。
`extra` は曜限がマスに置けない 1,069件（集中講義 1,060 ＋ 土曜 9）用。

`v` は schema のバージョン。Phase 2 でサーバーと合流するときに使う。

---

## 3. Phase 1 ―― 4件

### ⓪ 6限への統一（バグ修正・マイページとは独立に先へ出せる）

**いまグリッドから永久に辿れない科目が 29件ある。**

`web/data/timetable.json` の実測：6限のコマを持つ科目は **72件**、
うち **29件は6限にしか出ない**（春 12・秋 17、9学部にまたがる。
外国語 8／基礎工 5／法 4／工 3 など。`博物館学`『理科教育法Ⅲ/Ⅳ』`実践血液学` の類）。
`CLAUDE.md` が「入口は空きコマグリッド」と書いている、その入口から届かない。

`PERIODS` が **3箇所で定義されている**のが根：

| 場所 | 役割 |
|---|---|
| `server.py:81` | API モードの正本。`/api/meta`（478行）と OpenAPI の enum（285行）と スロット集計（191行）に効く |
| `web/assets/app.js:3` | グリッドの描画 |
| `web/assets/app.js:762` | 静的モードの META フォールバック。ここでもう一度べた書き |

**3箇所すべてを `1..6` にする。曜日は月〜金のまま**（土曜の9件は `他` の桶に居り、
`slots` には現れない）。1箇所でも漏らすと**片方のモードでだけ壊れる** ――
`tools/test_sort.mjs` の冒頭に記録されている種類の事故そのもの。

だから修正と一緒に `tools/test_periods.mjs` を置く：
3箇所の一覧が完全一致すること、`timetable.json` のどの slot も
グリッドの外に落ちないこと。

グリッドが5行から6行になるので CSS の高さと PC 3カラムの収まりが動く。
PR のスクショ差分 CI がそれを写す。

### ① 開屏の問診

新規 `web/assets/onboard.js`。**`index.html` だけが読む**（`/about` や
`/kuchikomi` に直接来た人には出さない）。

`splash.js` は今 `window.rkSplash.skip` しか出していない。
完了の合図が要るので、`end()` の中で `rk:splash-done` を dispatch する。
**splash.js への変更はこの3行だけ。**

流れ：

```
splash（既存の演出）
  → カード1「学部と学年を教えると、あなたが履修できる科目だけを出せます」
       [教える]  [そのまま使う]
                     └→ rk_onboarded=1 を書いて閉じる。1問も聞かない
  → カード2 学部（requirements.json から。べた書きしない）
  → カード3 学年（1〜6）
  → osaka_u_settings.{faculty,grade} と rk_onboarded=1 を書く
  → その場で state.faculty / state.year に反映して再描画する
```

**「答えたくない」は問診という形式そのものへの出口であって、
設問ごとの逃げ道ではない。** カード1で降りたら1問も聞かない。
設問に入ったら学部と学年は両方答える。

> **LINE bot 側も同じ線に揃える。** いま `worker/index.js:180` は
> 「答えたくない」を**学年の設問の中**に入れており、選ぶと `quick_default` へ飛ぶ。
> これを外し、出口は greeting の「とにかく楽単を知りたい」だけにする。
> あわせて**学部の設問を追加**する（学年 → 学部 → 優先度）。
> 学部は quick reply で 11学部＋ で 12項目、上限13に収まる。

再訪では `rk_onboarded` があるので二度と出ない。答えの直しはマイページで。

### ② お気に入りの授業

`app.js` の `card()`（444行〜）に星のボタンを足す。

**`.head` の外に置く。** `.head` は `role="button"` で、押すと詳細が開く。
中に入れると `stopPropagation` が要る。外なら要らない。
イベントは既存の委譲の型（`.panelBtn` / `.reviewBtn`、`app.js:958`）に合わせる。
詳細パネル（inspector）側にも1つ置く。

**お気に入りは絞り込みにも並び替えにも一切効かない。** ただのしおり。

### ③ マイページ

新規 `web/mypage.html` ＋ `web/assets/mypage.js`。
既存の `templates/shell.html` 注入の仕組みに乗る（`build.py` の `PAGES` が自動で拾う）。

- ナビの4項目め「マイページ」は `templates/shell.html` に足し、
  `build.py` を流して3ページに注入する。`tools/test_shell_inject.py` の更新が要る
- `shell.js:12-14` の現在地判定に `/mypage` の枝を足す

3つの節：

1. **プロフィール** ―― 学部・学年の表示と変更。`osaka_u_settings` に書き戻す。
   問診の答えを直す入口はここ
2. **私の時間割** ―― 5×6 のグリッドと学期の切り替え（秋冬／春夏）。
   データは `web/data/timetable.json`。空きマスを押すとその曜限の科目から選ぶ、
   埋まったマスを押すと外す／詳細。下に「時間割に入らない科目」（`extra`）を並べる
3. **お気に入り** ―― 一覧。各項目に「時間割に入れる」と「お気に入りを外す」。
   曜限があるものはマスに入れ、既に埋まっていれば上書きの確認を出す。
   曜限が無いものは `extra` へ

**`kuchikomi.js` は再利用しない。** グリッドの描画は似た形になるが、
意味が違う（マイページ＝これから受ける／kuchikomi＝もう受けた）。
共通部品に括ると2人のファイルが結ばれ、`1ファイル1オーナー` が崩れる。

### やらないこと（Phase 1）

- 絞り込み結果が「自分の埋まっているコマ」を避ける ―― グリッドは2枚で独立と決めた
- 単位数の合計・卒業要件の進捗 ―― `requirements.json` に材料は在るが、
  これはログイン機能ではなく別の製品線
- 時間割の書き出し・共有画像
- `kuchikomi.js` への変更

---

## 4. Phase 2 ―― LINE ログイン

### 4.1 前提（コードでは解決できない2つ）

1. **`web/privacy.html`** ―― 全サイトにいま1つも無い。
   LINE の userId を保存するのは個人情報の取得にあたる。
   何を集めるか（userId・学部学年・お気に入り・時間割）／なぜ／どこに置くか（Cloudflare D1）／
   いつまで／どう消すか／連絡先。**これが先**
2. **D1** ―― `wrangler.toml` に `[[d1_databases]]` を足す。
   ついでに `app.js:1181` の `CAN_POST = false` を `true` に戻せる
   （「D1 が立ったら CAN_POST を true にするだけで戻る」とその行に書いてある）

**LINE Login チャネルの新規申請は要らない。** 採った方式が Messaging API だけで完結するため。

### 4.2 方式 ―― 署名リンクとリンクコード

**方向が2つあり、それぞれ別の場面を受け持つ。**

| 方向 | 誰のためか | 仕組み |
|---|---|---|
| LINE → ブラウザ | 既に公式アカウントを使っている人 | 署名リンク（4.3） |
| ブラウザ → LINE | **サイトで初めて知った人。友だち追加もまだ** | リンクコード（4.4） |

LIFF を採らないので外部 SDK は増えない。OAuth を採らないので画面の飛びも無い。

### 4.3 署名リンク（LINE → ブラウザ）

bot は userId を既に知っている。`withSiteButton()`（`worker/index.js:145`）が作る
「ラクハンで見る」の URL に token を載せる。

```
t = base64url({u:<userId>, e:<exp>, n:<nonce>}) + "." + base64url(HMAC-SHA256(payload, LINK_SIGNING_SECRET))
```

- **鍵は新しく `LINK_SIGNING_SECRET` を切る。** `LINE_CHANNEL_SECRET` を使い回さない。
  1つの鍵に1つの用途。後者は webhook の署名検証で既に露出面を持っている
- **TTL 24時間 ＋ 使い切り**（nonce を D1 に記録し、使ったら失効）。
  24時間なのは、学生が少し経ってから履歴のボタンを押すのが普通だから。
  10分にすると普通の人を締め出す。使い切りなのは、
  転送されたリンクを後から押しても紙屑にするため
- Worker は `?t=` を受けたら：署名検証 → `exp` 確認 → nonce 未使用を確認 →
  使用済みにする → cookie を置く → **`?t=` を落とした同じ URL へ 302**。
  この転送を省くと token がアドレスバー・履歴・学生が何気なく共有するリンクに残る

cookie `rk_sess`：中身は**平文の userId ではなく別の署名 token**。
`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1年`。
ドメインは `rakuhan.nocode-sol.co.jp`（`worker/index.js:24` の `SITE_URL`）。
HttpOnly なので JS からは読めない。ブラウザ側は新設の `GET /api/me` で自分の状態を知る。

### 4.4 リンクコード（ブラウザ → LINE）

**なぜ署名リンクだけでは足りないか。** スマホで bot が返したリンクを押すと、
開くのは **LINE の内蔵ブラウザ**であって Safari / Chrome ではない。
cookie は内蔵ブラウザに置かれるが、その人のお気に入りと時間割は
Safari の localStorage に在る。**ログインしたのにデータが合流しない。**
「サイトで初めて知った人」は必ずこれを踏む。だから向きを逆にする。

Netflix や YouTube TV の端末連携と同じ形。解く問題が同じ
（**cookie は "いま使っているそのブラウザ" に置かれなければならない**）。

```
1. サイトで「LINEでログイン」
     → POST /api/link/new
     → 6文字のコードを発行し D1 の pending_links に置く（TTL 10分）
2. 画面にコード（ABC-DEF）と、友だち追加の QR（PC）／「LINEを開く」（スマホ）
3. 利用者が LINE で友だち追加
     → 既存の greetingMessage() がそのまま走る（本人が「学年などを教える」を
       選べば問診にも入る。選ばなくてもログインは進む）
4. コードを bot に送る
     → handleText() にコード書式の枝を足す
     → pending_links に userId を結び付ける
     → 「ログインしました。ブラウザに戻ってください」
5. 元のブラウザが GET /api/link/status?code=… を見ている
     → 結び付いた応答で Worker が rk_sess の cookie を置く
     → そのブラウザのローカルデータをその場で合流させる
```

- 待ち方は `visibilitychange` を主にする。スマホで LINE から戻った瞬間に
  タブが起きて1回引く。短い間隔で回し続けない
- 文字集合は紛らわしい字を抜いた32文字（`0 O 1 I l` を落とす）。6文字で約 10⁹
- **本当の危険は総当たりではなく、bot に当てずっぽうのコードを送って
  他人の待機中のブラウザを横取りすること。** 成功すると被害者のブラウザが
  攻撃者として login し、被害者のローカルデータが攻撃者の口座へ合流する。
  **userId ごとに「誤ったコード 1時間5回まで」の制限を置く。ここは省けない。**
- スマホでは `https://line.me/R/oaMessage/{basicId}/?{text}` で
  公式アカウントとの対話を開き本文を仕込めるので、
  「送信を押すだけ」にできる。ただし**友だちでない相手にこの URL が
  どう振る舞うかは未実測**。実装時に確かめ、駄目なら
  「友だち追加 → コードを貼る」に落とす

### 4.5 ローカルとサーバーの合流

初回ログイン時、手元にデータが在り、サーバーにも在るかもしれない（別端末）。
**3種類のデータに3つの規則。**

- **プロフィール（学部・学年）** ―― `updated_at` の新しい方。
  ただし**何を変えたか画面に出す**。黙って書き換えない
- **お気に入り** ―― **和集合**。足し算の意味しか持たないので何も失われない
- **時間割** ―― **和集合にしてはいけない**。同じコマに別の科目が入っていたら衝突する。
  規則は「サーバーが空なら手元を上げる／サーバーに在るならサーバーを正とし、
  そのコマが空いている所にだけ手元のものを足す」。
  残った本当の衝突（両方に別の科目）は**サーバー側を残し、
  手元に在った科目をマイページの上部に並べて本人に決めさせる**。
  **1件も黙って捨てない**

合流後も手元に写しを残す（オフラインで読める）。正本はサーバー。
**ログアウトは cookie を消すだけ。ローカルのデータは消さない**
（消すのは利用者への罰にしかならない）。

### 4.6 D1 の表（叩き台）

```sql
CREATE TABLE users (
  line_user_id TEXT PRIMARY KEY,
  faculty TEXT, grade TEXT,
  created_at INTEGER, updated_at INTEGER);

CREATE TABLE favorites (
  line_user_id TEXT, course_id TEXT, added_at INTEGER,
  PRIMARY KEY (line_user_id, course_id));

CREATE TABLE timetable (
  line_user_id TEXT, term TEXT, slot TEXT, course_id TEXT);
-- 1コマに入るのは1科目
CREATE UNIQUE INDEX tt_slot  ON timetable(line_user_id, term, slot)
  WHERE slot IS NOT NULL;
-- 曜限を持たない科目（extra）は slot IS NULL。学期内で重複しない
CREATE UNIQUE INDEX tt_extra ON timetable(line_user_id, term, course_id)
  WHERE slot IS NULL;
-- 1科目が複数コマを持つ場合は slot 違いの行が複数になる
--（timetable.json の slots がそもそも配列。2.4 と揃える）

CREATE TABLE used_tokens  (nonce TEXT PRIMARY KEY, used_at INTEGER);
CREATE TABLE pending_links(code  TEXT PRIMARY KEY, created_at INTEGER,
                           claimed_user_id TEXT);
```

`used_tokens` と `pending_links` は期限切れを定期に掃除する。

---

## 4.7 人が用意するもの（コードでは埋まらない）

| 要るもの | どこで取るか | 使う場所 |
|---|---|---|
| 公式アカウントの **basic ID**（`@` から始まる） | LINE Official Account Manager | 4.4 の `line.me/R/oaMessage/{basicId}/` と友だち追加リンク |
| `LINK_SIGNING_SECRET` | 自分で生成し `npx wrangler secret put` | 4.3 の署名 |
| D1 のデータベース | `npx wrangler d1 create` → `wrangler.toml` | 4.6 |
| プライバシーポリシーの本文 | 書く（4.1） | `web/privacy.html` |

---

## 5. テスト

先にテストを書く。既存の2つの型に合わせる ――
`tools/test_feedback.mjs`（素の node でソースの配線を見る）と
`tools/test_sort.mjs`（Playwright で本物のブラウザの挙動を見る）。

**Playwright のテストは静的配信に当てる**（`cd web && python3 -m http.server`）。
`server.py` だけ見ても分からない ―― 本番で動いているのは `web/assets/*.js` のほう。
`test_sort.mjs` の冒頭にその事故が記録されている。

| ファイル | 種類 | 見るもの |
|---|---|---|
| `tools/test_periods.mjs` | node | `PERIODS` 3箇所の完全一致。`timetable.json` の slot がグリッド外に落ちない |
| `tools/test_store.mjs` | node | `store.js` の読み書き、壊れた値への耐性、localStorage が例外を投げても落ちない |
| `tools/test_onboard.mjs` | Playwright | 初回に出る／「そのまま使う」で settings を書かず二度と出ない／答えると settings に入り一覧が絞られる／再訪で出ない |
| `tools/test_mypage.mjs` | Playwright | お気に入り→マイページに出る→時間割に入る→再読込でも残る／コマの衝突に確認が出る |
| `tools/test_shell_inject.py` | 既存・更新 | ナビが4項目になる |
| `tools/test_link_token.mjs` | node | 署名検証・期限切れ・改竄・使い切り |
| `tools/test_merge.mjs` | node | 合流3規則。とくに時間割の衝突で1件も失われないこと |

---

## 6. 判断の記録（再提案しないために）

- **問診は割り込み型で出す。** splash の直後に全画面。ただし
  **降りるのは問診そのものであって設問ではない**
- **グリッドは2枚のまま。** 左のレール（空きコマ探し）とマイページ（自分の時間割）は
  データを共有しない。結果として**絞り込みが自分の埋まっているコマを避けることは無い**。
  承知のうえで採った
- **kuchikomi の時間割とも共有しない。** 意味が違う（これから／もう受けた）。
  共有するのは `osaka_u_settings`（学部・学年）だけ
- **お気に入りと時間割は2段構え。** 星は候補、コマに入れて確定。
  曜限を持たない 1,069件も星は付けられる
- **LIFF は採らない。** 外部 SDK がこのリポジトリで最初の実行時依存になる
- **LINE Login（OAuth）は採らない。** LINE から来た人に画面の飛びが見える
- **署名リンク＋リンクコードを採る。** 依存ゼロ、チャネルの新規申請も不要、
  そして利用者の言葉（「ログインの入口は LINE の側にある」）にそのまま対応する。
  代償は**自前の身分機構であること**。だからマイページに
  成績・KOAN 連携・他人の投稿履歴のような重いものは載せない。
  載せるなら先に OAuth へ移る。移行は既存利用者のデータを切る
