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
