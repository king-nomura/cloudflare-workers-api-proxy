# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 開発コマンド

### Cloudflare Workers関連
```bash
# Wrangler CLIでのデプロイ
wrangler deploy

# 開発環境にデプロイ
wrangler deploy --env development

# 本番環境にデプロイ
wrangler deploy --env production

# リアルタイムログ監視
wrangler tail

# 特定環境のログ監視
wrangler tail --env production

# KVストレージの管理
wrangler kv:namespace create "RATE_LIMIT_KV"
wrangler kv:namespace create "USER_STATS_KV"
wrangler kv:key list --binding RATE_LIMIT_KV
wrangler kv:key get "rate_limit:anon_xxx" --binding RATE_LIMIT_KV

# 環境変数の設定
wrangler secret put EXTERNAL_API_KEY
wrangler secret put JWT_SECRET
wrangler secret put EXTERNAL_API_URL
```

### 開発環境セットアップ
```bash
# Wrangler CLIのインストール
npm install -g wrangler

# Cloudflareアカウントにログイン
wrangler login
```

## アーキテクチャ

### システム構成
```
React PWA → Cloudflare Workers → 外部API
    ↑              ↑                ↑
匿名トークン    プロキシ・認証     APIキー管理
LocalStorage   レート制限        環境変数
```

### 主要コンポーネント

#### Cloudflare Workers (cf_workers_proxy.js)
- 匿名トークン発行とJWT認証
- レート制限管理 (1時間あたり100リクエスト/ユーザー)
- 外部API呼び出しのプロキシ
- ユーザー統計の記録と管理
- CORS設定とセキュリティ制御

#### React PWA Client (react_api_client.js)
- 匿名トークンの自動管理
- APIクライアントクラス
- React Hooks (useApi, useAnonymousUser, useExternalData)
- エラーハンドリングとリトライ機能
- LocalStorageでのトークン永続化

### データストレージ

#### KV Namespaces
- **RATE_LIMIT_KV**: レート制限データ（時間窓ベース）
- **USER_STATS_KV**: ユーザー統計情報（総リクエスト数、日次データ）

#### 環境変数
- **EXTERNAL_API_KEY**: 外部サービスのAPIキー
- **JWT_SECRET**: JWT署名用シークレット
- **EXTERNAL_API_URL**: 外部APIエンドポイント
- **ALLOWED_ORIGIN**: CORS許可オリジン

### セキュリティ機能

#### 匿名認証システム
- ユーザー登録不要の匿名ID生成
- JWT署名による改ざん防止
- 30日間のトークン有効期限
- 自動トークン更新

#### レート制限
- 1時間あたり100リクエスト/ユーザー
- KVストレージを使用した分散制限管理
- 429エラーでの適切なRetry-After応答

#### データ保護
- APIキーの完全隠蔽
- 古いデータの自動削除（30日経過後）
- CORS設定によるオリジン制限

### API エンドポイント

#### POST /api/token
匿名トークン生成
- レスポンス: トークン、ユーザーID、有効期限、レート制限情報

#### POST /api/external-service
外部APIプロキシ
- 認証: Bearer トークン
- レート制限チェック
- 外部APIへのリクエスト転送

## 設定ファイル

### wrangler.toml
- Worker名とメイン実行ファイルの指定
- 環境別設定（development/production）
- KV Namespaceのバインディング設定
- 環境変数の設定

## 開発時の注意事項

### KV Namespace作成時
コマンド実行後に出力されるIDを `wrangler.toml` に正しく設定する必要がある。

### 環境変数設定
本番環境では必ず `wrangler secret put` を使用してAPIキーを設定する。

### トークン管理
- トークンは30日間有効
- 期限切れ時の自動再発行
- LocalStorageでの安全な保存

### レート制限
- 制限超過時の適切なエラーハンドリング
- Retry-Afterヘッダーによる再試行タイミング制御