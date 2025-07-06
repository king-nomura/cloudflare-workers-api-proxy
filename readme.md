# 匿名トークンAPI プロキシシステム

**（注）このレポジトリは（このreadmeも含めて）claude.aiを使って作成した実験的なプロジェクトです。**

React PWAから外部APIを安全に呼び出すためのCloudflare Workersベースのプロキシシステムです。ユーザー登録不要で、初回アクセス時に匿名トークンを発行し、APIキーを安全に管理します。

## 概要

このシステムは以下の問題を解決します：

- **APIキーの露出リスク**: クライアントサイドにAPIキーを埋め込む必要がない
- **不正利用の防止**: ユーザー毎のレート制限とトークン管理
- **コスト管理**: 匿名ユーザーでも適切な利用制限を実装

## アーキテクチャ

```
React PWA → Cloudflare Workers → 外部API
    ↑              ↑                ↑
匿名トークン    プロキシ・認証     APIキー管理
LocalStorage   レート制限        環境変数
```

## 特徴

### 🔒 セキュリティ

- **APIキーの完全隠蔽**: 外部APIキーはCloudflare Workers環境変数で安全に管理
- **JWT認証**: 改ざん防止機能付きの匿名トークン
- **トークン有効期限**: 30日間の自動期限切れ
- **署名検証**: HMAC-SHA256による署名の完全性チェック

### 👤 匿名ユーザー管理

- **ユーザー登録不要**: 初回アクセス時に自動的に匿名IDを生成
- **永続化**: LocalStorageでトークンを保持
- **自動更新**: 期限切れ時の自動トークン再発行
- **一意性**: タイムスタンプ + ランダムバイトによるID生成

### 📊 レート制限・統計

- **ユーザー毎制限**: 1時間あたり100リクエスト
- **使用統計記録**: 日次・累計リクエスト数の追跡
- **自動データ削除**: 30日経過後の古いデータ自動削除
- **リアルタイム制限**: KV Storageを使用した高速レート制限

### ⚡ パフォーマンス

- **エッジ配信**: Cloudflare Workersによる世界中での高速レスポンス
- **KV Storage**: 分散キーバリューストレージによる高可用性
- **CORS対応**: PWAからのクロスオリジンリクエストに完全対応

## 必要な環境

- Node.js 16+
- Cloudflare アカウント
- Wrangler CLI

## セットアップ手順

### 1. Cloudflare Workers環境の準備

```bash
# Wrangler CLIのインストール
npm install -g wrangler

# Cloudflareアカウントにログイン
wrangler login
```

### 2. KV Namespaceの作成

```bash
# レート制限用KVストレージ
wrangler kv:namespace create "RATE_LIMIT_KV"

# ユーザー統計用KVストレージ
wrangler kv:namespace create "USER_STATS_KV"
```

**出力例:**
```
🌀 Creating namespace with title "api-proxy-worker-RATE_LIMIT_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "RATE_LIMIT_KV", id = "abc123def456" }
```

### 3. 設定ファイルの更新

`wrangler.toml`ファイルのKV Namespace IDを更新：

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "YOUR_RATE_LIMIT_KV_ID"  # ステップ2で取得したID

[[kv_namespaces]]
binding = "USER_STATS_KV"
id = "YOUR_USER_STATS_KV_ID"  # ステップ2で取得したID
```

### 4. 環境変数の設定

```bash
# 外部APIキー（必須）
wrangler secret put EXTERNAL_API_KEY

# JWT署名用シークレット（必須）
wrangler secret put JWT_SECRET

# 外部APIのURL（wrangler.tomlでも設定可能）
wrangler secret put EXTERNAL_API_URL
```

### 5. デプロイ

```bash
# 本番環境にデプロイ
wrangler deploy

# または開発環境にデプロイ
wrangler deploy --env development
```

### 6. React PWAの設定

環境変数ファイル（`.env.local`）を作成：

```env
REACT_APP_API_BASE_URL=https://your-worker.your-subdomain.workers.dev
```

## React PWAでの使用方法

### 基本的な使用例

```javascript
import { useApi, useAnonymousUser } from './api-client';

function MyComponent() {
  const { tokenInfo, isInitialized } = useAnonymousUser();
  const { loading, error, callApi, apiClient } = useApi();
  const [data, setData] = useState(null);

  const fetchData = async () => {
    try {
      const result = await callApi(
        apiClient.callExternalService.bind(apiClient),
        { query: 'your query' }
      );
      setData(result);
    } catch (error) {
      console.error('API call failed:', error);
    }
  };

  if (!isInitialized) {
    return <div>Initializing user session...</div>;
  }

  return (
    <div>
      <p>User ID: {tokenInfo?.userId}</p>
      <button onClick={fetchData} disabled={loading}>
        {loading ? 'Loading...' : 'Fetch Data'}
      </button>
      {error && <p>Error: {error.message}</p>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
```

### トークン情報の表示

```javascript
import { TokenStatus } from './api-client';

function App() {
  return (
    <div>
      <header>
        <TokenStatus />
      </header>
      <main>
        <MyComponent />
      </main>
    </div>
  );
}
```

## API エンドポイント

### POST /api/token

匿名トークンを生成します。

**レスポンス:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "anon_1701234567890_a1b2c3d4e5f6",
  "expiresAt": 1704123456789,
  "rateLimit": {
    "maxRequests": 100,
    "windowMs": 3600000
  }
}
```

### POST /api/external-service

外部APIへのプロキシリクエストを送信します。

**リクエストヘッダー:**
```
Authorization: Bearer <anonymous-token>
Content-Type: application/json
```

**リクエストボディ:**
```json
{
  "query": "your query data",
  "filters": { "category": "example" }
}
```

## 設定オプション

### wrangler.toml

```toml
name = "api-proxy-worker"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
ALLOWED_ORIGIN = "https://your-pwa-domain.com"
EXTERNAL_API_URL = "https://api.external-service.com/v1/data"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "your-rate-limit-kv-id"

[[kv_namespaces]]
binding = "USER_STATS_KV"
id = "your-user-stats-kv-id"

# 本番環境設定
[env.production]
name = "api-proxy-worker-prod"
[env.production.vars]
ALLOWED_ORIGIN = "https://your-production-domain.com"

# 開発環境設定
[env.development]
name = "api-proxy-worker-dev"
[env.development.vars]
ALLOWED_ORIGIN = "*"
```

### 環境変数

| 変数名                | 必須 | 説明                   |
|--------------------|----|----------------------|
| `EXTERNAL_API_KEY` | ✅  | 外部サービスのAPIキー         |
| `JWT_SECRET`       | ✅  | JWTトークン署名用のシークレットキー  |
| `EXTERNAL_API_URL` | ❌  | 外部APIのエンドポイントURL     |
| `ALLOWED_ORIGIN`   | ❌  | CORS許可オリジン（デフォルト: *） |

## セキュリティ考慮事項

### トークン管理

- トークンは30日間有効
- 期限切れ時の自動再発行
- LocalStorageでの安全な保存
- JWT署名による改ざん検知

### レート制限

- 1時間あたり100リクエスト/ユーザー
- KV Storageによる分散制限管理
- 制限超過時の適切なエラーレスポンス

### CORS設定

- 特定ドメインからのみアクセス許可
- プリフライトリクエストの適切な処理
- セキュアヘッダーの設定

## 監視・運用

### ログ確認

```bash
# リアルタイムログの確認
wrangler tail

# 特定環境のログ確認
wrangler tail --env production
```

### KVストレージの確認

```bash
# レート制限データの確認
wrangler kv:key list --binding RATE_LIMIT_KV

# 特定ユーザーのデータ確認
wrangler kv:key get "rate_limit:anon_xxx" --binding RATE_LIMIT_KV
```

### 統計データの分析

ユーザー統計は以下の形式でKVに保存されます：

```json
{
  "createdAt": 1701234567890,
  "totalRequests": 42,
  "lastRequestAt": 1701234567890,
  "dailyRequests": {
    "2024-01-15": 15,
    "2024-01-16": 27
  }
}
```

## トラブルシューティング

### よくある問題

**1. トークン生成エラー**
```
Error: Token generation failed
```
- `JWT_SECRET`環境変数が設定されているか確認
- KV Namespaceが正しく作成されているか確認

**2. CORS エラー**
```
Access to fetch blocked by CORS policy
```
- `ALLOWED_ORIGIN`が正しく設定されているか確認
- PWAのドメインがCORS許可リストに含まれているか確認

**3. レート制限エラー**
```
Rate limit exceeded
```
- 1時間以内のリクエスト数が100を超えている
- `Retry-After`ヘッダーの時間後に再試行

### デバッグ方法

1. **Cloudflare Workers ダッシュボード**でエラーログを確認
2. `wrangler tail`でリアルタイムログを監視
3. ブラウザの開発者ツールでネットワークタブを確認

## 貢献

このプロジェクトへの貢献を歓迎します！

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/new-feature`)
3. 変更をコミット (`git commit -am 'Add new feature'`)
4. ブランチにプッシュ (`git push origin feature/new-feature`)
5. Pull Requestを作成

## ライセンス

MIT License

**（注）このレポジトリは（このreadmeも含めて）claude.aiを使って作成した実験的なプロジェクトです。**

## サポート

問題や質問がある場合は、GitHubのIssuesページでお知らせください。

---

**注意**: 本番環境での使用前に、セキュリティ設定とレート制限を適切に調整してください。