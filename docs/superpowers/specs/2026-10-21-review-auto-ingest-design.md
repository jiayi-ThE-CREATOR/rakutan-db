# 口コミの取り込みの自動化（設計）

2026-10-21 wang 決定：自動化する／一言は**先に公開して、問題があれば下げる**。

## 1. 今までの問題

- 口コミはサイト → Worker → しゅんや の GAS → スプレッドシート に入るだけで、サイトには出ない。
  誰かがシートを CSV にして `tools/ingest_reviews.py` に通し、`build.py --rescore` して PR を出す必要があった
- 生データ（`data/reviews.json`）は公開できない（`publish:false` の一言を含む）ので gitignore。
  持っているのは取り込んだ人の手元だけ ―― 自動化しようにも置き場が無かった

## 2. 形

```
投稿 → Worker ─→ GAS／シート（そのまま残す）
         ├─→ D1 review_inbox（科目ごとに1行・原文のまま）     … PR ①
         └─→ Discord：一言の本文＋「不公開にする」リンク       … PR ①
毎朝 05:00（GitHub Actions）                                   … PR ②
  review_inbox の done=0 → ingest_reviews.py の normalize で整える → D1 reviews へ、done=1
  D1 reviews の全行 → reviews.json（hidden=1 は publish:false）→ 集計 → build.py --rescore
  → web/data と data/reviews.agg.json を main へ直接 commit（データだけ・版には載せない）→ 自動デプロイ
```

- **口コミの正本は D1 の `reviews`**（今までの `data/reviews.json` の1行が `row` に JSON で入る）
- 整える処理は Python の `normalize` 1つだけ（Worker に JS で書き写さない）
- 「不公開にする」は `GET /review/hide?r=&s=`（確認のボタンだけ）→ `POST` で `review_inbox.hidden` と
  `reviews.hidden`（`src` が同じ行）を 1 に。リンクは HMAC（`SESSION_SECRET`）で署名。画面から消えるのは翌朝
- Discord の webhook は押せるボタンを載せられないので、リンクにした

## 3. 重複

- 引っ越し（§4）の行は中身から作った id（`j…`）、受け箱から来た行は `i<受け箱の id>`
- 受け箱から来た行は、`ingest_reviews.py` と同じ鍵（科目・日付・一言）で既存の行と突き合わせ、同じなら入れない
  （引っ越しのときシートに入っていた分と、受け箱の分が重なっても二重にならない）

## 4. 引っ越し（1回だけ）

1. PR ① をマージ（この時点から受け箱に溜まり始める）
2. シートを CSV にして `ingest_reviews.py` で手元の `data/reviews.json` を最新に
3. `python3 tools/reviews_to_d1.py > /tmp/reviews.sql` → `wrangler d1 execute … --file=/tmp/reviews.sql`
4. PR ② をマージ（毎朝の取り込みが始まる）

## 5. 前提

- D1 に `review_inbox`・`reviews` の表（`db/schema.sql`）
- GitHub の Secrets：`CF_ACCOUNT_ID` と、**D1 の読み書きだけ**の API トークン（PR ② で使う）

## 6. 受け入れたこと

- 一言は先に公開される。問題があっても、誰かが「不公開」を押して翌朝の更新が終わるまでは出る
- 口コミがサイトに出るのは翌朝
- 毎朝のデータ更新は PR を通さない（データだけ）
