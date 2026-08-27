-- rakutan-favorites D1 データベースのスキーマ
--
-- お気に入り → 検索履歴の順で足す方針（2026-08-25 wangさん決定）。
-- line_user_id はLINEのuserId。学部・学年などの個人情報はここに持たない。
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
