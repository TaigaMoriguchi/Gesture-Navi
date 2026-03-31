# Gesture Ops MVP

Webカメラで手の動きを認識し、Chromeのブラウジング操作へ変換する Manifest V3 拡張機能です。

## 概要

- 目的: 空中ジェスチャー操作のMVP検証
- 方針: ローカル推論のみ（映像データの外部送信なし）
- 実装: TypeScript + DOM操作（React不使用）

## 主な機能

- popupで拡張機能の ON / OFF
- popupで感度調整と操作モード切替
  - デフォルト: 仮想カーソル + ピンチ
  - オプション: スワイプ
- 4方向スワイプ判定（戻る/進む/上下スクロール）
- 仮想カーソル（ページ内）
- ピンチクリック（短時間・短距離）
- ピンチドラッグで縦横スクロール
- ピンチ維持 + 横引っ張りホールドで戻る/進む（円形ゲージUI）
- overlay表示
  - CAMインジケーター
  - ジェスチャー矢印
  - 仮想カーソル
  - ナビゲーションチャージ円形ゲージ

## 対応ジェスチャー一覧

### スワイプモード

- 左→右（RIGHT）: 戻る（`history.back()`）
- 右→左（LEFT）: 進む（`history.forward()`）
- 上→下（DOWN）: 上スクロール
- 下→上（UP）: 下スクロール

### 仮想カーソル + ピンチモード

- 短いピンチ: クリック
- ピンチしながら移動: 縦横スクロール
- ピンチ維持 + 右へ引っ張りホールド: 戻る
- ピンチ維持 + 左へ引っ張りホールド: 進む

## 技術スタック

- Chrome Extension Manifest V3
- TypeScript
- esbuild
- `@mediapipe/tasks-vision`（HandLandmarker）

## ライブラリ選定理由

`@mediapipe/tasks-vision` を採用しています。

- HandLandmarker APIがシンプルでMVP向き
- ブラウザ実装の安定性が高い
- wasm資産とモデルを拡張同梱でき、ローカル推論で完結できる

## ローカル実行手順

1. 依存関係をインストール

```bash
npm install
```

2. 型チェック（任意）

```bash
npm run typecheck
```

3. ビルド

```bash
npm run build
```

4. Chromeで読み込み

- `chrome://extensions` を開く
- デベロッパーモードをON
- 「パッケージ化されていない拡張機能を読み込む」
- `dist/` を選択

## 配布用ZIP作成

```bash
npm run package
```

- `release/gesture-ops-mvp-v<version>.zip` を生成します
- source map（`*.map`）はZIPに含めません

## 権限と注意点

- 初回ON時にページ側でカメラ許可が必要です
- `chrome://` やChrome Web Storeなど一部ページでは動作しません
- OFF時はカメラトラックと認識ループを停止します
- 仮想カーソル/ピンチはページ内イベント発火であり、OSカーソル制御ではありません

## 配布準備ドキュメント

- プライバシーポリシー: `docs/privacy-policy.md`
- ストア提出チェックリスト: `docs/chrome-web-store-checklist.md`
- ストア掲載文テンプレート: `docs/store-listing-template.md`

## 今後の拡張案

- サイト単位の有効化制御
- 感度プリセット（低/中/高）
- ナビゲーションチャージ閾値のUI調整
- Windows環境向けパラメータ最適化

## ディレクトリ構成

```text
.
├── assets/
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon32.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   └── models/
│       └── hand_landmarker.task
├── docs/
│   ├── chrome-web-store-checklist.md
│   ├── privacy-policy.md
│   └── store-listing-template.md
├── scripts/
│   ├── build.mjs
│   ├── generate-icons.mjs
│   └── package.mjs
├── src/
│   ├── lib/
│   ├── popup/
│   ├── shared/
│   ├── background.ts
│   ├── content.ts
│   └── manifest.json
└── dist/ (build後)
```
