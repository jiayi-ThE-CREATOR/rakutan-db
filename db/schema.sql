-- rakutan-favorites D1 データベースのスキーマ
--
-- お気に入り → 検索履歴の順で足す方針（2026-08-25 wangさん決定）。
-- line_user_id はLINEのuserId。名前・メール等は持たない。
-- 学年・学部・時間割は 2026-10-05 から持つ（wang 判断。利用者の属性を数えるため。
-- docs/superpowers/specs/2026-10-05-user-stats-design.md）。about の「利用データの扱い」に告知あり。
--
-- 適用:
--   npx wrangler d1 execute rakutan-favorites --remote --file=db/schema.sql

CREATE TABLE IF NOT EXISTS favorites (
  line_user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (line_user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_line_user_id ON favorites (line_user_id);

-- LINE の問診（学年・学部）の回答。2026-08-27 wangさんの依頼
-- 「初回でもらった情報をずっと記憶できるように」への対応。
--
-- これまで回答は postback data と「ラクハンで見る」のURLに載せて
-- 往復させるだけで、どこにも保存していなかった。だから会話が終わると
-- 忘れ、毎回また学年から聞くことになっていた。
--
-- 入れるのは学年（1〜6）と学部キー（FACULTIES の11種）だけ。
-- 名前・メール等は取らない（LINEのプロフィールAPIも叩かない）。
CREATE TABLE IF NOT EXISTS line_profiles (
  line_user_id TEXT PRIMARY KEY,
  grade TEXT,
  faculty TEXT,
  updated_at INTEGER NOT NULL
);

-- ログインした人の時間割（2026-10-05・利用者の属性を数えるため）。
-- PUT /api/profile が本人の行を消して入れ直す（丸ごと置き換え）。
-- term_group は 'haru' / 'aki'。通年の科目は両方に入る（store.js の termsFor と同じ）。
CREATE TABLE IF NOT EXISTS timetables (
  line_user_id TEXT NOT NULL,
  term_group TEXT NOT NULL,
  course_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (line_user_id, term_group, course_id)
);

-- 時間割を端末どうしでそろえるための写し（2026-10-29・docs/superpowers/specs/2026-10-29-timetable-sync-design.md）。
-- timetables は科目 ID だけ（数える用）で、どのコマに置いたか（曜限の無い科目を置いたコマ等）が残らない。
-- こちらはブラウザの rk_timetable をそのまま1行に持つ。GET /api/profile が返し、PUT /api/profile が上書きする。
CREATE TABLE IF NOT EXISTS timetable_docs (
  line_user_id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- メールでログイン（2026-10-19・docs/superpowers/specs/2026-10-19-mail-login-design.md）。
-- アドレスそのものは持たない。数えるのは識別子（HMAC）と時間帯だけで、24時間より古い行は消す。
CREATE TABLE IF NOT EXISTS mail_rate (
  key TEXT NOT NULL,          -- 'site' か 'id:<識別子>'
  hour INTEGER NOT NULL,      -- UNIX 時間 ÷ 3600
  n INTEGER NOT NULL,
  PRIMARY KEY (key, hour)
);

-- 使ったログイン用リンクの記録（1回だけ使えるようにする）。期限を過ぎた行は消す。
CREATE TABLE IF NOT EXISTS mail_nonce (
  n TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);

-- メールでログイン：送った端末が、別の端末でリンクが押されたことを知るための待ち（2026-10-20）。
-- rid は送った端末の Cookie にだけある。sub はリンクが押されたら書く。taken は受け取ったら 1。
CREATE TABLE IF NOT EXISTS mail_wait (
  rid TEXT PRIMARY KEY,
  exp INTEGER NOT NULL,
  sub TEXT,
  taken INTEGER NOT NULL DEFAULT 0
);

-- ログイン方法とアカウントの対応（2026-10-20・LINE とメールを1つのアカウントに）。
-- 行が無い ident はそれ自体がアカウント（今までの LINE の人は行を持たない）。worker/account.js。
CREATE TABLE IF NOT EXISTS identities (
  ident TEXT PRIMARY KEY,      -- LINE の userId か 'm:<識別子>'
  account TEXT NOT NULL,       -- line_user_id 列に入るアカウントの ID
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identities_account ON identities (account);

-- 口コミの受け箱（2026-10-21・取り込みの自動化。docs/superpowers/specs/2026-10-21-review-auto-ingest-design.md）。
-- /api/kuchikomi が GAS へ中継して成功したら、科目ごとに1行ずつ原文（payload）のまま入れる。
-- 毎朝の取り込み（GitHub Actions）が done=0 の行を整えて reviews へ移し、done=1 にする。
-- hidden=1 は Discord の「不公開にする」から（一言だけ伏せる。publish:false と同じ）。
CREATE TABLE IF NOT EXISTS review_inbox (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,          -- 受けた時刻（ms）
  course_id TEXT NOT NULL,
  payload TEXT NOT NULL,        -- 1科目ぶんの投稿（JSON）
  hidden INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_review_inbox_done ON review_inbox (done);

-- 整えた後の口コミ（今までの data/reviews.json の1行＝row）。これが口コミの正本。
-- src は受け箱の id（受け箱から来た行だけ）。hidden=1 なら取り込みで publish:false にする。
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  row TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  src TEXT
);
CREATE INDEX IF NOT EXISTS idx_reviews_src ON reviews (src);
