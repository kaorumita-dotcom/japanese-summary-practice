# 日本語要約練習アプリ

大学1年生向けの日本語要約練習アプリです。学生が教員指定の原文を貼り付け、要約欄に自分で入力すると、Gemini 2.5 Flashが観点別フィードバックと模範回答を返します。

## Features

- 原文欄は貼り付け可能
- 要約欄は通常の貼り付け、ドロップ、右クリック貼り付けを抑止
- 原文文字数、目標文字数、要約文字数を表示
- Gemini 2.5 Flashで観点別フィードバックを生成
- 日次回数制限、連続送信制限、文字数上限で無料枠超過を抑止
- 提出内容やフィードバックは保存しない

## Local Setup

```bash
cp .env.example .env
```

`.env` にGoogle AI StudioのAPIキーを設定します。

```env
GEMINI_API_KEY=your_google_ai_studio_api_key
PORT=3000
DAILY_REQUEST_LIMIT=80
MIN_SECONDS_BETWEEN_REQUESTS=20
MAX_SOURCE_CHARS=800
MAX_SUMMARY_CHARS=500
```

起動します。

```bash
node server.mjs
```

ブラウザで開きます。

```text
http://127.0.0.1:3000
```

## Test

```bash
node --test
```

## Vercel Deployment

このアプリはGemini APIキーをサーバー側で扱うため、静的ホスティングのみのGitHub Pagesには向きません。Vercel Hobbyで公開する場合は、このGitHubリポジトリをVercelにImportしてください。

VercelのProject SettingsでEnvironment Variablesを設定します。

```env
GEMINI_API_KEY=your_google_ai_studio_api_key
DAILY_REQUEST_LIMIT=80
MIN_SECONDS_BETWEEN_REQUESTS=20
MAX_SOURCE_CHARS=800
MAX_SUMMARY_CHARS=500
```

`public/` は静的ファイルとして配信され、`api/status.mjs` と `api/evaluate.mjs` はVercel Functionsとして動作します。

日次回数制限はサーバー実行環境のメモリ上で管理する簡易ガードです。Vercel Functionsではインスタンス再作成時にカウントがリセットされる可能性があるため、厳密な全体上限が必要な場合はVercel KVや外部DBなどの永続ストレージを追加してください。
