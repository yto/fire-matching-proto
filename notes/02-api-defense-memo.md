# API 防御策メモ（CORS / Turnstile / ほか）

このメモは、fire-matching-proto の API を外部の悪用から守るための対策について、
過去のチャットでの議論をまとめたもの。あとで実際に対策を入れるときの参考用。

---

## 1. 背景: この prototype の状況

### 構成
- Cloudflare Pages + Pages Functions + D1
- `functions/api/answers.js` の `GET` / `POST` がフロントから呼ばれる
- 匿名で投稿できるのが要件（認証なし）

### 問題意識
- API URL は **物理的に外から見える**
- curl / Postman / 他サーバから直接叩ける
- 認証なしなので、URL さえ知っていれば誰でも書き込める

### 実害シナリオ
- 任意 UUID で投稿してデータ汚染
- 他人の UUID を知っていればその人の投稿を上書き
- GET で全件覗ける
- 大量 POST で D1 のフリー枠を圧迫

---

## 2. すでに導入済みの対策: Origin / Referer チェック

### 実装場所
`functions/api/answers.js` の `isAllowedOrigin()`

```js
function isAllowedOrigin(request) {
  const reqHost = new URL(request.url).host;
  for (const h of ["origin", "referer"]) {
    const v = request.headers.get(h);
    if (!v) continue;
    try {
      if (new URL(v).host === reqHost) return true;
    } catch {}
  }
  return false;
}
```

### 効くシナリオ
- 別ドメインのブラウザ JS から fetch → ブラウザが自動で Origin を入れる → サーバ側でホスト不一致を検知して 403
- Origin / Referer がそもそも無いリクエスト → 403

### 抜けられるシナリオ
- curl などで `-H "Origin: https://fire-matching-proto.pages.dev"` と偽装 → 通る
- 自前サーバから fetch する場合も Origin を自由に設定可能

### 評価
- 「気軽な別ドメイン JS いたずら」は止められる
- 本気の攻撃者には無力
- 実装コスト最小なので入れて損なし

---

## 3. CORS の本質的な誤解について

### CORS は「サーバを守る仕組み」ではない

CORS（Cross-Origin Resource Sharing）はブラウザの **オリジン分離モデル** を実装する仕組み。
守られているのはユーザの **ブラウザ** であってサーバではない。

> CORS の目的: 悪意あるサイト (evil.com) を訪れたユーザのブラウザが、
> 勝手にユーザの Cookie を使って他サイト (bank.com) にリクエストを送って成功してしまうのを防ぐ。

### Origin ヘッダの信頼性

| クライアント | Origin ヘッダ |
|--|--|
| ブラウザ JS | **ブラウザが強制的に正しい Origin を入れる**（JS からは改竄不可） |
| curl / Postman / 自前スクリプト | **何でも入れられる**（偽装し放題） |
| サーバ間通信 | そもそも付けないことが多い |

### 結論
- サーバ側で Origin をチェックする ≒ 「ブラウザの正直さに乗っかった軽い防御」
- 「弱い」のではなく「対象が違う」
- API そのものを守りたいなら別の層が必要

### 参考
- MDN: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- MDN: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin
- OWASP CSRF: https://owasp.org/www-community/attacks/csrf

---

## 4. Cloudflare Turnstile

### 概要
- Cloudflare 製の **CAPTCHA 代替**
- プライバシ重視（ユーザ追跡なし、ほとんどの場合パズル無し）
- reCAPTCHA からの乗り換え促進が目的の戦略商品

### 料金・制限（要再確認）
- **完全無料**
- 月間検証回数 **無制限**
- サイト数 **無制限**
- Cloudflare の Free プランで使える

> ⚠️ 公式 Pricing ページで導入前に最新の制限を確認すること
> https://www.cloudflare.com/application-services/products/turnstile/

### 3 つのウィジェットモード

| モード | 挙動 | UX |
|--|--|--|
| **Managed**（既定） | Cloudflare が判断して必要時のみチャレンジ表示 | ◎ |
| **Non-Interactive** | 強制チャレンジするが操作不要（くるくる回るだけ） | ○ |
| **Invisible** | ウィジェット自体を表示しない | ◎ |

このプロトに入れるなら **Invisible** か **Managed** が良い。

### 仕組み（curl 攻撃にも効く理由）

```
[ブラウザ]                          [Cloudflare]               [自分のサーバ]
   |                                     |                         |
   |--- script: challenges.../api.js --->|                         |
   |    (ブラウザ環境を fingerprint)    |                         |
   |<-------- token ---------------------|                         |
   |                                                               |
   |---------- POST with token --------------------------------> | |
   |                                                               |
   |                                     |<-- siteverify (token) --|
   |                                     |--- success: true ------>|
   |                                                          (処理続行)
```

- トークンは **ブラウザ環境でしか発行されない**（curl では取得不能）
- **1 回しか使えない**（リプレイ防止）
- **5 分で失効**
- サーバはトークンを Cloudflare の `siteverify` API で検証

### 突破できる/できないシナリオ

| 攻撃 | Origin チェックのみ | + Turnstile |
|--|--|--|
| 別サイト JS から | 防げる | 防げる |
| curl 単発 | Origin 偽装で抜ける | **トークン無くて拒否** |
| curl で 1 万回連打 | 通る | **ほぼ不可能** |
| 本気の Puppeteer 自動化 | 通る | 抑止できるが完璧ではない |
| CAPTCHA 解読代行サービス | - | 突破可能だが有料（コスト負担を強いる） |

### セットアップ手順
1. Cloudflare Dashboard → Turnstile → Add Site
2. ドメイン登録 → **Site Key**（公開）と **Secret Key**（非公開）を取得
3. フロントに `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` と Widget DOM
4. Secret Key を `npx wrangler pages secret put TURNSTILE_SECRET` で登録
5. サーバ側で受け取ったトークンを `https://challenges.cloudflare.com/turnstile/v0/siteverify` に POST して検証

### 実装イメージ（このプロトに入れる場合）

**フロント (`public/index.html`)**:
```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<!-- 投稿モーダル内に追加 -->
<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY" data-size="invisible"></div>
```

**フロント (`public/app.js`)**:
```js
const token = document.querySelector('[name="cf-turnstile-response"]')?.value;
fetch('/api/answers', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...payload, turnstileToken: token }),
});
```

**サーバ (`functions/api/answers.js`)**:
```js
async function verifyTurnstile(token, env, ip) {
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: ip || '',
    }),
  });
  const data = await resp.json();
  return data.success === true;
}

export async function onRequestPost({ request, env }) {
  if (!isAllowedOrigin(request)) return forbidden();
  const { turnstileToken, ...body } = await request.json();
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(turnstileToken, env, ip))) return forbidden();
  // ... 既存の保存処理 ...
}
```

### ローカル開発時の注意
- `localhost` を site key に登録するか、Cloudflare の **テスト用ダミー site/secret key** を使う
- テスト key 一覧: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  - 常に成功させる site key / secret key などが用意されている

### 参考リンク
- Turnstile 概要: https://developers.cloudflare.com/turnstile/
- Getting Started: https://developers.cloudflare.com/turnstile/get-started/
- サーバ側検証: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- テスト用ダミーキー: https://developers.cloudflare.com/turnstile/troubleshooting/testing/

---

## 5. 「Workers にすれば外から見えない」は誤解

### Pages Functions と Workers の比較

| 項目 | Pages Functions | Workers |
|--|--|--|
| 静的配信 | Pages | Workers の assets binding 等 |
| API | `functions/api/*.js` | Worker 本体の fetch ハンドラ |
| 公開 URL | `*.pages.dev/api/...` | `*.workers.dev` か独自ドメイン |
| **HTTP 外部公開** | 必ず公開 | 必ず公開 |

→ 違うのは静的配信の方式だけ。「API URL が外から見えるか」は同じ。

### Service Binding で API を private にできるが…
- **URL ルートを持たない Worker** を作って、別の Worker から呼び出すことは可能（Service Binding）
- 構成: `[公開 Worker] ── service binding ──> [private Worker]`
- でも結局 **公開 Worker 側にエンドポイントが必要** で、攻撃面が前段に移るだけ

### 本当に「外から API を叩かれない」構成は SSR

- ブラウザは **HTML ページ** しか要求しない
- 投稿は **HTML フォーム** で POST → サーバが処理してリダイレクト
- 読み込みは **サーバが DB を引いて HTML に埋め込んで返す**
- ブラウザに JSON API を一切露出しない

それでも:
- POST フォームのエンドポイントは公開のまま
- **CSRF トークン**が必要（サーバが発行 → ページに埋め込み → 検証）
- 結局 Turnstile / レート制限は欲しい

### 「HTTP 公開なし」が成立する例外
- **Cron トリガ**: 定時実行のみ、HTTP 公開なし
- **Queue Consumer**: メッセージで起動
- **Cloudflare Access で全 SSO 化**: 全アクセスに認証必須

→ どれも「匿名で使ってもらう」用途には不向き

### 参考
- Pages Functions: https://developers.cloudflare.com/pages/functions/
- Workers Service Bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Queues: https://developers.cloudflare.com/queues/

---

## 6. その他の防御策（参考）

### Cloudflare Rate Limiting Rules
- IP やヘッダ単位で N req/sec 制限
- Cloudflare のダッシュボードで設定（コード変更不要）
- Free プランでも基本機能あり（高度なルールは有料）
- ドキュメント: https://developers.cloudflare.com/waf/rate-limiting-rules/

### Cloudflare WAF (Web Application Firewall)
- 既知の攻撃パターン（SQLi、XSS など）を自動ブロック
- Free プランでマネージドルールの一部利用可
- ドキュメント: https://developers.cloudflare.com/waf/

### Cloudflare Access (Zero Trust)
- サイト全体を SSO 認証で囲う
- 匿名利用とは両立しない
- 社内ツール向け
- ドキュメント: https://developers.cloudflare.com/cloudflare-one/policies/access/

### 自前認証
- セッション Cookie + CSRF トークン
- API キー
- JWT
- いずれも「匿名要件」とは両立しないので、要件側を見直す話になる

### CSRF トークン
- ブラウザのフォーム POST 攻撃対策の伝統的手法
- ただし SPA + JSON API には適合しにくい
- 参考: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

---

## 7. 防御の組み合わせ（推奨レベル別）

| レベル | 内容 | 工数 | このプロトの状態 |
|--|--|--|--|
| Lv0 | 何もしない | - | × |
| **Lv1** | Origin / Referer チェック | 5 行 | **✅ 済** |
| Lv2 | + Turnstile (Invisible) | フロント+サーバ少々 | 未 |
| Lv3 | + Rate Limiting Rules | ダッシュボード設定 | 未 |
| Lv4 | + WAF マネージドルール | ダッシュボード設定 | 未 |
| Lv5 | + 認証導入（匿名要件を捨てる） | 大規模改修 | 要件と矛盾 |

> **推奨**: 公開して数日〜数週間試して、実害が出るなら Lv2 から順番に。
> プロト段階で最初から Lv4 まで入れるのは過剰。

---

## 8. 重要な原則（思想）

### 匿名 API の宿命
- 「全員匿名で投稿できる」要件は本質的に **書き込みを認証で防げない**
- 結果として「弱い対策の積み重ね（多層防御）」しか手段がない
- 本気の攻撃者は止められない前提で、「**割に合わなくする**」のがゴール

### HTTP サーバの根本仕様
- 匿名で使える HTTP サーバを建てる ≒ **誰でも HTTP を投げられる**
- これは HTTP の設計そのもの、回避不能
- 構成（Pages / Workers / SSR / SPA）を変えても変わらない

### Defense in Depth
- 単一の完璧な対策はない
- Origin チェック（軽い） + Turnstile（中重） + Rate Limit（網）
- どれか一つを抜かれても他で食い止める

---

## 9. 次に対策を入れる時のチェックリスト

- [ ] 実害が出ているか確認（D1 のレコード数、不審な UUID パターン）
- [ ] Cloudflare Dashboard で Pages のアクセスログを確認（怪しい IP/UA）
- [ ] Turnstile 導入を検討する場合:
  - [ ] 公式 Pricing で無料枠の現状確認
  - [ ] Site Key / Secret Key 発行
  - [ ] Secret Key を `wrangler pages secret put TURNSTILE_SECRET`
  - [ ] フロント変更（モーダル内に Widget）
  - [ ] サーバ変更（siteverify 呼び出し）
  - [ ] ローカルテスト（ダミーキー使用）
  - [ ] 本番デプロイ後、別ブラウザで動作確認
- [ ] Rate Limiting を入れる場合:
  - [ ] Cloudflare Dashboard → Security → WAF → Rate Limiting Rules
  - [ ] IP あたり 60 req/min とかから始める
  - [ ] False positive がないか数日見る

---

## 10. 参考リンクまとめ

### CORS / Web 基礎
- https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referer

### Cloudflare Turnstile
- https://developers.cloudflare.com/turnstile/
- https://developers.cloudflare.com/turnstile/get-started/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- https://www.cloudflare.com/application-services/products/turnstile/

### Cloudflare その他
- https://developers.cloudflare.com/pages/functions/
- https://developers.cloudflare.com/workers/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://developers.cloudflare.com/waf/rate-limiting-rules/
- https://developers.cloudflare.com/waf/
- https://developers.cloudflare.com/cloudflare-one/policies/access/

### OWASP
- https://owasp.org/www-community/attacks/csrf
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
