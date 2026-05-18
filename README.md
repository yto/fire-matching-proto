# fire-matching-proto

FIREマッチング プロトタイプ。FIRE 状態に関する複数のYes/No質問に答え、他ユーザの回答と「一致回答数」で並べて比較できる。

本番: **https://fire-matching-proto.pages.dev/**

技術スタック:
- Cloudflare Pages（静的配信）
- Cloudflare Pages Functions（API）
- Cloudflare D1（SQLite）
- GitHub Actions でデプロイ

## ファイル構成

```
fire-matching-proto/
├── .github/workflows/deploy.yml    # GitHub Actions: D1 migration 適用 + Pages デプロイ
├── functions/api/answers.js        # GET (全件返却) / POST (UPSERT)
├── migrations/0001_init.sql        # users / answers の 2 テーブル
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── questions.json              # 質問データ（N問、N可変）
├── wrangler.toml                   # database_id を記入
└── .gitignore
```

## 画面・UX 仕様

### TOP（質問ページ）

- `public/questions.json` の `questions[]` を `fetch` し、N 個の **質問カード** を縦に並べて表示
- 各カードの構成（上→下）:
  - `Q{number}` ラベル
  - 質問文（`q.q`）
  - 2 ボタン（左 Yes / 右 No）。ボタンは縦 3 段表示:
    1. `{emoji} Yes` / `{emoji} No`（`q.a1.emoji`, `q.a2.emoji`）
    2. ラベル（`q.a1.label`, `q.a2.label`）
    3. 説明（`q.a1.description`, `q.a2.description`）
- ボタンクリックで選択トグル。選択中は青い枠＋背景でハイライト
- 質問群の下に **「回答を投稿する」ボタン**
  - 全問回答するまで disabled（下に「全ての質問に回答してください」と表示）
  - 押すと投稿モーダルを開く
- 自動オープンはしない（必ずボタンクリック起点）

### identity-card（TOP 上部、条件付き表示）

- localStorage に `fmp_uuid` がある時 **のみ表示**（初回訪問では非表示）
- 内容: 「ようこそ `{username}` さん」 + ボタン **「みんなの回答を見る」**
- ボタンを押すと **閲覧モーダル** を開く（投稿モーダルではない）
- ページ読み込み時に `fmp_uuid` があれば、サーバから前回回答を取得して **回答ボタンを選択済み状態で復元** する

### 投稿モーダル

- 名前入力欄（任意）
  - 初期値: 前回の username があればそれ、無ければ **ランダム8桁の数字（先頭非0）**
- 「回答を投稿する」ボタン
  - 全問回答済みかつ名前が非空の時のみ enabled
  - 押すと `POST /api/answers` で送信
- 投稿成功:
  - 初回なら `crypto.randomUUID()` で UUID を生成 → `fmp_uuid` を localStorage に保存
  - 名前を `fmp_username` に保存
  - 投稿モーダルを閉じて閲覧モーダルを開く
- 再投稿: 同じ uuid で送信 → **上書き保存**（1 UUID につき最新1件）

### 閲覧モーダル

- `GET /api/answers` で全件取得し表形式で表示
- 列ヘッダ: `名前 | A1 | A2 | ... | AN`（A の番号は質問 Q の番号に対応）
- 行:
  - **先頭が自分**（青背景でハイライト）。名前はそのまま
  - 以降は自分以外を **一致回答数 DESC**（多い順 = 近い順）でソート。名前の後ろに ` (一致数)` を付与
- セル:
  - Yes なら `{q.aN.a1.emoji}Yes`、No なら `{q.aN.a2.emoji}No`
  - 自分以外の行で自分と同じ回答のセルは **緑背景でハイライト**

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

- validation: `uuid` 非空文字列、`username` 非空文字列、`answers` は `"Yes"` / `"No"` のみの配列
- `users` と `answers` の両テーブルを `env.DB.batch([...])` で同一バッチで `INSERT ... ON CONFLICT(uuid) DO UPDATE`（UPSERT）
- **Origin / Referer チェック**: リクエストの `Origin` または `Referer` がサーバ自身のホストと一致しない場合は **403** を返す（GET/POST 両方）

Response: `{ "ok": true }` / エラー時 `{ "error": "..." }` (400)

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

- `users JOIN answers` を `updated_at DESC` で全件返却
- 並べ替え（自分先頭・一致数 DESC）はフロント側で実施

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

## 質問データ（`public/questions.json`）

```json
{
  "source": "https://...",
  "questions": [
    {
      "number": 1,
      "q": "仕事・労働をしていますか？",
      "a1": { "value": "Yes", "label": "している",  "description": "仕事・副業・ボランティアあり", "emoji": "✅" },
      "a2": { "value": "No",  "label": "していない", "description": "完全にFIRE状態",            "emoji": "🌴" }
    }
  ]
}
```

- 質問の数 N は `questions[]` の長さで決まる。**増減は JSON 編集だけで OK**（フロントが長さを動的に扱う）

## クライアント状態（localStorage）

| key            | 内容                                          |
|----------------|-----------------------------------------------|
| `fmp_uuid`     | 自分の UUID（投稿成功時に保存、再投稿時に再利用） |
| `fmp_username` | 自分の名前（投稿モーダルの初期値・カード表示）    |

## セットアップ手順

### 1. Wrangler ログイン
```bash
npx wrangler login
```

### 2. D1 データベース作成
```bash
npx wrangler d1 create fire-matching-proto-db
```
出力された `database_id` を `wrangler.toml` に貼り付ける。
```toml
[[d1_databases]]
binding = "DB"
database_name = "fire-matching-proto-db"
database_id = "<ここに貼る>"
migrations_dir = "migrations"
```

### 3. Cloudflare API Token 作成
Dashboard → My Profile → API Tokens → Create Token → テンプレ「**Edit Cloudflare Workers**」をベースに、以下を含む:

- Account: Cloudflare Pages: Edit
- Account: Workers Scripts: Edit
- **Account: D1: Edit**（テンプレに無いので Add more で追加）
- User: User Details: Read

Zone Resources はドメインが無ければ「All zones from an account」でOK。Workers Routes の権限は不要なら削除可。

### 4. Cloudflare Account ID 取得
`npx wrangler whoami` で確認できる（Dashboard 右サイドバーにも表示）。

### 5. GitHub Secrets 登録
リポジトリ → Settings → Secrets and variables → Actions:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

または `gh secret set <name> --repo <owner>/<repo>` で登録可。

### 6. push でデプロイ
```bash
git add -A
git commit -m "init"
git push origin main
```

GitHub Actions が:
1. リモート D1 にマイグレーション適用
2. Pages プロジェクト作成（初回のみ、2回目以降は失敗するが `continue-on-error: true` で無視）
3. `./public` を Pages にデプロイ

## ローカル動作確認

```bash
# 1. ローカル D1 にマイグレーション適用
npx wrangler d1 migrations apply fire-matching-proto-db --local

# 2. Pages dev 起動（functions + D1 binding 込み）
npx wrangler pages dev ./public
```

`http://127.0.0.1:8788/` をブラウザで開く。

DB 中身確認:
```bash
npx wrangler d1 execute fire-matching-proto-db --local --command "SELECT * FROM users"
npx wrangler d1 execute fire-matching-proto-db --local --command "SELECT * FROM answers"
```

リモート DB 確認は `--local` を `--remote` に置き換え。

## 既知の制約（プロト）

- `GET /api/answers` は無条件で全件返却（件数が増えたら pagination が必要）
- 認証なし。UUID = 身分証明。localStorage を消すと別人扱い、別ブラウザでも別人扱い
- 並べ替え・一致数計算はフロント側のため大量データには非対応
- API の防御は Origin/Referer チェックのみ。curl 等で `Origin` ヘッダを偽装されれば突破可能（いたずら抑止レベル）
