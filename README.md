# fire-matching-proto

FIRE 状態に関する 6 問の Yes/No 質問に答えて、他のユーザの回答と「一致回答数」で並べて比較できるプロトタイプ。

- Cloudflare Pages（静的配信）
- Cloudflare Pages Functions（API）
- Cloudflare D1（SQLite）
- GitHub Actions でデプロイ

## ファイル構成

```
fire-matching-proto/
├── .github/workflows/deploy.yml    # GitHub Actions: migrations 適用 + Pages デプロイ
├── functions/api/answers.js        # GET (全件) / POST (UPSERT)
├── migrations/0001_init.sql        # users / answers の 2 テーブル
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── questions.json              # 6問の質問データ
├── wrangler.toml                   # database_id は手動で記入
└── .gitignore
```

## セットアップ手順

### 1. Wrangler ログイン

```bash
npx wrangler login
```

ブラウザで Cloudflare の認可ページが開きます。

### 2. D1 データベースを作成

```bash
npx wrangler d1 create fire-matching-proto-db
```

出力に表示される `database_id` を `wrangler.toml` の該当行に貼り付けてください。

```toml
[[d1_databases]]
binding = "DB"
database_name = "fire-matching-proto-db"
database_id = "<ここに貼る>"
migrations_dir = "migrations"
```

### 3. Cloudflare API Token を作成

1. Cloudflare Dashboard → 右上アバター → **My Profile** → **API Tokens** → **Create Token**
2. テンプレ「**Edit Cloudflare Workers**」を選択
3. 権限に以下が含まれていることを確認:
   - Account: Cloudflare Pages: Edit
   - Account: D1: Edit
   - Account: Workers Scripts: Edit
   - User: User Details: Read
4. Account Resources を対象アカウントに限定
5. Token を作成しコピー

### 4. Cloudflare Account ID を取得

Dashboard の右サイドバーに表示されている **Account ID** をコピー。

### 5. GitHub Secrets を登録

リポジトリ → **Settings** → **Secrets and variables** → **Actions** で以下を登録:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### 6. push でデプロイ

```bash
git add -A
git commit -m "init"
git push origin main
```

GitHub Actions が以下を実行します:

1. D1 にリモートマイグレーション適用
2. Pages プロジェクト作成（初回のみ、2回目以降は失敗するが無視）
3. `./public` を Pages にデプロイ

デプロイ後 URL: `https://fire-matching-proto.pages.dev/`

## ローカル動作確認

```bash
# 1. ローカル D1 にマイグレーション適用
npx wrangler d1 migrations apply fire-matching-proto-db --local

# 2. Pages dev 起動（functions と D1 binding 込みで自動起動）
npx wrangler pages dev ./public
```

ブラウザで `http://127.0.0.1:8788/` を開いて動作確認。

DB 中身確認:

```bash
npx wrangler d1 execute fire-matching-proto-db --local --command "SELECT * FROM users"
npx wrangler d1 execute fire-matching-proto-db --local --command "SELECT * FROM answers"
```

## API 仕様

### `POST /api/answers`

Request:

```json
{
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "username": "Yamada Taro",
  "answers": ["Yes", "No", "Yes", "Yes", "No", "Yes"]
}
```

Response: `{ "ok": true }`

同じ `uuid` で再送すると **上書き** されます（1 UUID につき最新 1 件）。

### `GET /api/answers`

Response:

```json
{
  "rows": [
    {
      "uuid": "...",
      "username": "Yamada Taro",
      "answers": ["Yes", "No", "Yes", "Yes", "No", "Yes"],
      "updated_at": "2026-05-18T03:21:00.000Z"
    }
  ]
}
```

## DB スキーマ

```sql
CREATE TABLE users (
  uuid        TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE answers (
  uuid        TEXT PRIMARY KEY,
  answers     TEXT NOT NULL,            -- JSON 文字列: ["Yes","No",...]
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (uuid) REFERENCES users(uuid)
);
```

## 仕様メモ

- 質問カードの Yes/No ボタンは `questions.json` の `emoji + Yes/No`、`label`、`description` を表示
- 質問の最後に「回答を投稿する」ボタン。全問回答するまで disabled
- 投稿時に `crypto.randomUUID()` で UUID を生成し localStorage（`fmp_uuid`）に保存
- 名前は localStorage（`fmp_username`）にも保存し、再訪時のカード表示に使用
- 投稿モーダルで名前未入力なら **ランダムな 8 桁の数字（先頭非 0）** が自動入力
- **identity-card は投稿経験がある時のみ表示**（初回訪問では非表示）。カードのボタンは「みんなの回答を見る」（閲覧モーダルを開くのみ）
- 閲覧モーダルは「自分が先頭行」「以降は一致回答数 DESC」「自分以外は名前後ろに `(一致数)`」
- セル表示は `questions.json` の絵文字付きで `✅Yes` `🌴No` のように表示
- 質問の数 N を増減したい場合は `public/questions.json` を編集するだけで OK（フロントは長さを動的に扱う）

## 既知の制約（プロト）

- GET は全件返却（件数が増えたら pagination が必要）
- 認証なし。UUID = 身分。localStorage を消すと別人扱い
- フロントで一致数を計算しているため大量データには非対応
