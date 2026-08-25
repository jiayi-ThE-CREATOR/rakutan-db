# LINE Bot（きむら担当）

実体は `worker/index.js`。既存の静的サイトと同じ Cloudflare Worker（`rakutan-db`）に
1ルートとして同居させている（A案・2026-08-23 決定）。理由・経緯は
`HANDOFF.md` の該当エントリと `wrangler.toml` のコメントを参照。

## デプロイ

```bash
npx wrangler login              # 初回のみ（wang の Cloudflare アカウントに招待してもらう）
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler deploy
```

シークレットは `wrangler.toml` にもリポジトリにも書かない。

## ローカルでの動作確認

```bash
cp .dev.vars.example .dev.vars   # このファイルは無いので自分で作る（下記参照）
npx wrangler dev --port 8787
```

`.dev.vars`（gitignore済み・コミットしない）:

```
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
```

```bash
curl http://localhost:8787/line/health          # ok が返ること
curl http://localhost:8787/                     # 既存の静的サイトが変わらず200で返ること
```

Webhook本体（`POST /line/webhook`）は `X-Line-Signature` の検証があるため、
素の curl では叩けない。署名付きリクエストを送る簡易スクリプトは
`HANDOFF.md` の該当エントリに残してある。

## LINE Developers 側の設定（8/24 21:00 までにやること）

1. Messaging API チャネルの Webhook URL に
   `https://rakutan-db.wjy20050815.workers.dev/line/webhook` を登録し、有効化
2. 応答モード: Bot
3. あいさつメッセージ・自動応答メッセージ: オフ（Bot の応答と二重に返ってしまう）

## 応答仕様（現状）

- プリセット名（`バイト優先` / `GPA重視` / `とにかく軽い` / `テストが苦手`）を含む文言
  → 学年（例:「2年」、省略時は1年）を読み取り、その学年の `preset_top` TOP5を返す
- それ以外の文字列 → 科目名の部分一致検索。ヒットをスコア降順でTOP5
- ヒット0件 → 「見つかりませんでした」の文言のみ（案内文は未実装・改善余地あり）

## データについて

`preset_top` / `courses` は `web/data/courses.built.json` を **`env.ASSETS` 経由で
同一オリジンから毎回取得**（5分キャッシュ）。bot 側にデータを同梱していないので、
`build.py` が焼き直すたびに反映される。
