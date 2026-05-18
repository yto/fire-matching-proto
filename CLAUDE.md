# CLAUDE.md

このリポジトリは「FIREマッチング プロトタイプ」。Cloudflare Pages + Pages Functions + D1 構成の、ビルドステップなしのバニラ HTML/CSS/JS プロト。

本番: https://fire-matching-proto.pages.dev/

## スタック・ファイル構成

- フロント: `public/` 配下のバニラ HTML/CSS/JS（バンドラなし、フレームワークなし、TypeScript なし）
  - `public/index.html`, `public/style.css`, `public/app.js`, `public/questions.json`, `public/favicon.svg`
- API: Cloudflare Pages Functions（`functions/api/answers.js`）— `onRequestGet` / `onRequestPost` を named export
- DB: Cloudflare D1（SQLite）。スキーマは `migrations/0001_init.sql`
- デプロイ: `.github/workflows/deploy.yml`（main push をトリガに D1 migration 適用 → Pages create（初回のみ）→ Pages deploy）
- 設定: `wrangler.toml`（`database_id` 含む）
- 初期要件: `notes/01-initial-prompt.txt`

## DB スキーマ（要点）

2 テーブル、どちらも `uuid` を PRIMARY KEY:
- `users(uuid, username, updated_at)`
- `answers(uuid, answers TEXT, updated_at)` — `answers` は JSON 配列文字列 `["Yes","No",...]`

投稿は `INSERT ... ON CONFLICT(uuid) DO UPDATE`（UPSERT、`env.DB.batch` で 2 テーブル同時）。1 UUID につき最新 1 件のみ。

## 質問データ（`public/questions.json`）

N 問可変。各 question に:
- `number`, `q`, `description`
- `a1`, `a2`: `value` (`"Yes"`/`"No"`), `label`, `description`, `emoji`

質問数を増減したい場合はこのファイルを編集するだけで OK（フロントは長さを動的に扱う）。

## ローカル開発

```bash
npx wrangler d1 migrations apply fire-matching-proto-db --local
npx wrangler pages dev ./public
```

`http://127.0.0.1:8788/` でアクセス。`public/` 配下の編集はブラウザリロードで反映。

DB 確認:
```bash
npx wrangler d1 execute fire-matching-proto-db --local --command "SELECT * FROM users"
```

## デプロイ

`main` ブランチに push するだけ。事前準備:
- D1 作成済み（`npx wrangler d1 create fire-matching-proto-db` → `database_id` を `wrangler.toml` に記入済み）
- GitHub Secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 登録済み

手順詳細は `README.md` を参照。

## コーディング方針

- フレームワーク・ビルドツール・TypeScript は導入しない（プロト維持）
- 認証なし。UUID = 身分（localStorage `fmp_uuid`、`fmp_username`）
- UI ロジックは `public/app.js` 1 ファイルに集約、API は `functions/api/answers.js` 1 ファイルに集約
- 仕様変更時は **README.md の「画面・UX 仕様」セクション** と本ファイルを合わせて更新
- `<dialog>` 要素 + `showModal()/close()` でモーダルを実装（独自モーダルライブラリは入れない）
- フロント側で `[hidden]` を使う場合、対象要素の CSS で `display` が設定されていると上書きされる点に注意（`[hidden] { display: none !important; }` を `style.css` 冒頭に置いてある）
- `functions/api/answers.js` は **Origin/Referer がサーバホストと一致しない場合 403** を返す簡易防御を持つ。新規 API を追加するときは同じ `isAllowedOrigin()` を通すこと
