# Chrome Web Store 提出チェックリスト

## 1. リリースファイル作成

1. `npm install`
2. `npm run package`
3. `release/gesture-ops-mvp-v<version>.zip` が生成されることを確認

## 2. ストア登録前チェック

- `manifest.json` の `name` / `version` / `description` を確認
- アイコン（16/32/48/128）が反映されていることを確認
- `chrome://extensions` で `dist` を読み込み、主要機能が動作することを確認
- カメラ許可拒否時にエラー表示が出ることを確認
- OFF時にカメラ停止することを確認

## 3. ストア掲載素材

- ストア用説明文（短文/詳細）
- スクリーンショット（最低1枚、推奨3枚以上）
- 128x128 ストアアイコン
- 連絡先メール
- プライバシーポリシー公開URL
  - このリポジトリの `docs/privacy-policy.md` をWeb公開したURLを設定

## 4. 初回申請時の注意

- 「カメラを使う目的」を審査向け説明に明記する
- 収集データがローカル処理のみであることを説明に明記する
- `host_permissions` が広いため、用途説明を明確に書く

## 5. リリース運用

- 変更時は `package.json` の `version` を更新
- `npm run package` でZIPを再生成
- ストア管理画面で新バージョンをアップロード
