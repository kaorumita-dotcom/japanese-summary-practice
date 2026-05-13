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

## Deployment Notes

このアプリはGemini APIキーをサーバー側で扱うため、静的ホスティングのみのGitHub Pagesには向きません。Render、Railway、Fly.io、VercelのServerless Function構成など、環境変数をサーバー側に設定できる公開先を使ってください。

公開先では `GEMINI_API_KEY` を環境変数として設定し、必要に応じて `DAILY_REQUEST_LIMIT` を授業規模に合わせて調整します。
