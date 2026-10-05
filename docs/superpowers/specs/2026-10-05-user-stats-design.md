# 利用者の属性を数える（学年・学部・時間割・授業内容タグ）

2026-10-05 ｜ 状態: 設計（未実装・ブランチ `feat/user-stats`）｜ 決めた人: wang（PM 判断。チーム合意は取らない）

## 何をするか

「いまラクハンを使っているのは何年生・何学部で、どんな科目を時間割に入れているか」を数える。
使い道は2つ:

1. **チーム内**の判断材料（どの学部が少ないか、どの授業内容が見られているか）
2. **協賛企業など外部への開示**（「利用者の X% が1年生」）

## いまの状態（なぜ新しくデータを集める必要があるか）

| 情報 | 置き場所 | サーバーで数えられるか |
|---|---|---|
| 学年・学部（サイトの開屏の問診） | localStorage `osaka_u_settings` | ✕ |
| 学年・学部（LINE の問診） | D1 `line_profiles` | ○（LINE で答えた人だけ） |
| 時間割 | localStorage `rk_timetable` | ✕ |
| ログイン | Cookie `rk_sess` のみ（D1 に利用者の行は無い） | ✕ |

つまり、サーバーはほとんど何も知らない。数えるには、ブラウザにあるものを送ってもらうしかない。

**これは2つの既存の方針を変える。** どちらも wang の判断で変える:

- `db/schema.sql` 冒頭「学部・学年などの個人情報はここに持たない」→ ログインした人の学年・学部・時間割は D1 に持つ
- `analytics.js` 冒頭「科目ID・端末IDは送らない」→ 科目ID（時間割の中身）は1日1回だけ送る。**端末IDは引き続き発行しない**

## 用語

- **「選んだ科目」＝時間割に入れた科目**（`rk_timetable` の `slots` と `extra`）。お気に入り（☆）と詳細の閲覧は数えない
- **授業内容タグ**＝科目の `subjects`（31種・AI 付与・1科目に複数）。7,906件中 7,810件に付いている
- **A（匿名）**＝全訪問者。単位は「端末・日」
- **B（ログイン者）**＝LINE ログイン済みの人。単位は「人」（LINE の userId）

## 決めたこと

| 項目 | 決定 | 理由 |
|---|---|---|
| 対象 | A と B の両方 | A は未ログインも含む広さ、B は人単位の正確さ。互いに補う |
| 選んだ科目の定義 | 時間割 | 「履修するつもり」に最も近く、外部に説明しやすい |
| 分類 | 授業内容タグ（`subjects`） | wang 指定 |
| A の送る時機 | **1日1回のスナップショット**（A1） | 端末IDが無いので「いまの状態」は持てない。下の比較を参照 |
| 出力 | コマンド＋CSV | `tools/stats.mjs` と揃える。外部資料は CSV から作る |
| 外部向けの小さい数字 | 5未満は「5未満」と出す | 歯学部4年 2人のような組み合わせで個人が特定されるのを防ぐ |

A の送る時機の比較（A1 を採用）:

| 案 | 内容 | 結論 |
|---|---|---|
| **A1** | **その日の最初の表示で、学年・学部・時間割を送る** | **採用**。UU と同じ考え方で小さく済む |
| A2 | その月の最初の表示で送る | 不採用。新しい人は最初の訪問で問診も時間割もまだ無く、ほぼ「未回答」になる |
| A3 | 追加・削除のたびに送る | 不採用。端末IDが無いので差し引きができず、数字が信用できない |

A1 の代償: よく来る人ほど日数ぶん重く数える。その日の最初の表示より後の変更は翌日まで反映されない。
だから A の数字は「**その期間に動いていた端末の構成（端末・日）**」と書き、人数とは書かない。

## A（匿名・全訪問者）

### 送る側（`web/assets/analytics.js`・`web/assets/app.js`）

- analytics.js に `window.rkSnap({ grade, faculty, ids })` を足す。localStorage の新しい印 `rk_sd`（JST の日付）で
  **その日1回だけ**送る。`rk_nostats` の端末は送らない（`rkTrack` と同じ）
- analytics.js が触る localStorage の鍵は4つになる（`rk_nostats`・`rk_d`・`rk_m`・`rk_sd`）。冒頭の注記を直す
- 学年・学部・時間割を読むのは app.js（`rkStore` 経由）。`rk:app-ready` のあとに `rkSnap` を呼ぶ。
  analytics.js は `osaka_u_settings`・`rk_timetable` を直に読まない（store.js が唯一の窓口、の決まりを守る）
- `ids` は春・秋両方の時間割の科目IDを重複なしで並べたもの。空でも送る（「未回答」「時間割なし」も数の一部）

### 受ける側（`worker/index.js` の `handleHit`）

- `HIT_EVENTS` に `snap` を足す
- 送られた値は検証する: 学年は "1"〜"6"、学部は FACULTIES のキー、ID は数字だけ・最大80件。外れたら空に落とす
- Analytics Engine への書き込み: `blobs: ["snap", "", grade, faculty, ids.join(",")]`・`doubles: [1, 0, 0, 0]`
- 既存の集計を汚さない: `worker/traffic.js` の `STATS_SQL` と `tools/stats.mjs` は event を絞らずに束ねている箇所がある。
  `snap` が速報や stats.mjs に行として出ないよう `blob1 != 'snap'` を足す

### 保存期間の罠

**Analytics Engine は 90日で消える。** 外部に出す月次の数字は、月が明けたら CSV に書き出して保管する。
保管先はリポジトリの外（リポジトリは公開なので、内部用の生の数字を置かない）。

## B（ログイン者・人単位）

### データ（`db/schema.sql`）

- 学年・学部 → 既存の `line_profiles` に書く。LINE とサイトで両方答えた人は、`updated_at` が新しい方を残す
- 時間割 → 新しい表:

      CREATE TABLE IF NOT EXISTS timetables (
        line_user_id TEXT NOT NULL,
        term_group TEXT NOT NULL,        -- 'haru' / 'aki'
        course_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (line_user_id, term_group, course_id)
      );

### API（`worker/index.js`）

- `PUT /api/profile` を足す。本文は `{ grade, faculty, tt: { haru: [ids], aki: [ids] } }`
- userId は `rk_sess` の署名付き Cookie から取る（`linelogin.js` の `verify` を使う）。Cookie が無い・壊れていれば 401 で何も書かない
- 時間割は**丸ごと置き換え**（その人の行を消して入れ直す。D1 の batch で1回に）。追加・削除の差分は送らない（A3 と同じ理由）
- 検証は A と同じ（学年・学部・ID・件数）

### 送る時機（`web/assets/app.js`・`mypage.js`）

- `/api/me` が `loggedIn: true` を返したとき、1回送る
- その後、問診の回答・時間割が変わったら送る（2秒の debounce）
- 未ログインなら送らない。失敗しても画面は止めない

### 告知（`web/about.html`）

ログインした人について、学年・学部・時間割を保存し、**統計として集計し、集計した形で外部に開示する**ことを書く。
個人が分かる形では出さないこと、消してほしいときの連絡先（意見箱）も書く。

## 集計（`tools/users_report.mjs`）

    CF_ACCOUNT_ID=… CF_API_TOKEN=… node tools/users_report.mjs [--days 30] [--public] [--csv <dir>]

- A は Analytics Engine の SQL API、B は D1 の REST API（`/d1/database/<id>/query`）で取る。
  **CF_API_TOKEN に D1 の読み取り権限が要る**（今のトークンは Analytics の読み取りだけの可能性が高い。実装前に確認）
- 出すもの（A と B で同じ切り口）:
  1. 学年の分布
  2. 学部の分布
  3. 学年 × 学部
  4. 時間割に入っている科目 TOP 20
  5. 授業内容タグの分布（全体・学年別・学部別）
- 授業内容タグは集計するときに `web/data/courses.built.json` で引く。タグを集めて送ることはしない
  （タグを付け直しても、過去の時間割をそのまま新しいタグで数え直せる）
- **A と B は別の節に出し、足し合わせない。** 見出しに単位（端末・日／人）を書く
- タグの節には「1科目に複数タグ。合計は100%を超える」と書く
- A は `_sample_interval` を掛けて数える（掛け忘れると間引かれた日だけ少なく出る。traffic.js の注記と同じ）
- `--public`: 5未満のセルを「5未満」にする。比率の分母は伏せる前の数で計算する
- `--csv <dir>`: 上の5つを1表1ファイルで書く。`<dir>` はリポジトリの外を指定する

## テスト

- `tools/test_user_stats.mjs`（新規）:
  - `rkSnap` が1日1回だけ送ること、`rk_nostats` で送らないこと
  - `handleHit` の `snap` の検証（不正な学年・学部・ID が空に落ちること、81件目以降を捨てること）
  - `PUT /api/profile`: Cookie 無しで 401、時間割の丸ごと置き換え、`line_profiles` の新しい方が残ること
  - 集計: `--public` の伏せ方、タグの多重計上、A と B を足さないこと
- 既存の `test_analytics.mjs`・`test_traffic_report.mjs` が通ること（`snap` が速報に出ないこと）

## やらないこと

- 端末IDの発行（A で人数を数えること）
- お気に入り・閲覧履歴の集計
- 管理画面（ブラウザで見るページ）・Discord 速報への追加
- 教員を軸にした集計（既存の禁止事項）

## 実装前に必要なもの

- D1 にスキーマを当てる: `npx wrangler d1 execute rakutan-favorites --remote --file=db/schema.sql`
- CF_API_TOKEN の D1 読み取り権限
- テスト版では LINE ログインが通らないので、B の送信は本番に出してから確かめる（PR に一言書く）
