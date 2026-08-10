<h1 align="center">aiFetchly</h1>

<p align="center">
  <strong>ビジネス自動化のためのデスクトップ AI Agent</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> &middot;
  <a href="./README.zh.md">简体中文</a> &middot;
  <a href="./README.es.md">Español</a> &middot;
  <a href="./README.fr.md">Français</a> &middot;
  <a href="./README.de.md">Deutsch</a> &middot;
  日本語
</p>

<p align="center">
  <img src="docs/images/readme/hero-ai-chat.png" alt="aiFetchly AI agent ワークスペース" width="900">
</p>

---

**aiFetchly** は、ビジネス業務のためのオープンソースなデスクトップ AI Agent プラットフォームです。ローカル知識、ブラウザ自動化、インストール可能なスキル、スケジュールタスク、プラグイン、専門サブエージェントを 1 つのアプリにまとめ、調査、文書処理、Web 情報収集、顧客コミュニケーション、定期業務を自動化します。

aiFetchly は、リード発見、連絡先抽出、メールアウトリーチなどのマーケティング自動化から始まりました。これらのワークフローは現在も含まれていますが、製品の方向性はさらに広がっています。aiFetchly は、ツール、メモリ、ファイル、Web 自動化、制御可能な実行を必要とするビジネスユーザー向けの local-first AI Agent ワークスペースになりつつあります。

## aiFetchly とは？

aiFetchly はビジネス上の意図を実行可能なワークフローに変えます。

- **AI Agent に作業を依頼**：チャット画面から調査、ファイル分析、データ抽出、メッセージ下書き、文書要約、ツール操作を実行します。
- **自社の知識を利用**：文書をローカル知識ライブラリにアップロードし、自分のファイルに基づいた回答や下書きを生成します。
- **ブラウザとデータ作業を自動化**：Web サイトから情報を収集し、構造化データを抽出し、URL リストを処理して結果をエクスポートします。
- **専門サブエージェントに委任**：独自プロンプト、ツール権限、リソース制限、構造化出力を持つバックグラウンド Agent を実行します。
- **ワークスペースを拡張**：スキルとプラグインをインストールし、新しいツール、業務ワークフロー、連携を追加します。
- **制御を維持**：データをローカル SQLite に保存し、ツール活動を確認し、権限を管理して自分のデスクトップで実行します。

## スクリーンショット

### AI Agent ワークスペース

![aiFetchly AI agent ワークスペース](docs/images/readme/hero-ai-chat.png)

### 知識ライブラリ

![aiFetchly 知識ライブラリ](docs/images/readme/knowledge-library.png)

### スキルとプラグイン管理

![aiFetchly プラグイン管理](docs/images/readme/plugin-manager.png)

### AI Provider 設定

![aiFetchly AI Provider 設定](docs/images/readme/ai-provider-settings.png)

## Agent の機能

### AI Agent ワークスペース

| 機能 | 説明 |
|------|------|
| **ツールを使う AI Chat** | 承認されたツールと業務コンテキストを使い、複数ステップのタスクを実行できる AI アシスタントです。 |
| **カスタム AI Provider** | Ollama、LM Studio、OpenAI、OpenRouter、vLLM、LocalAI、カスタムエンドポイントなど OpenAI 互換 Provider を利用できます。 |
| **業務タスク実行** | 調査、抽出、ファイル処理、メッセージ下書き、スケジューリング、自動化を複数 SaaS に移動せず実行します。 |
| **AI 顧客メールアシスタント** | 文書とワークフローデータをコンテキストとして、顧客メールの作成、送信、返信を支援します。 |
| **専門サブエージェント** | 独自システムプロンプト、ツール許可リスト、リソース制限、構造化出力を持つサブエージェントを実行します。 |
| **権限制御された自動化** | 実行できるツール、プラグイン、Hook、サブエージェントを制御します。 |

### ビジネス知識と RAG

| 機能 | 説明 |
|------|------|
| **知識ライブラリ** | PDF、TXT、DOC/DOCX、Markdown、HTML、CSV、Excel をローカル知識ベースにアップロードし、RAG に利用します。 |
| **文書処理** | 重複アップロードを検出し、処理進捗を追跡し、文書を分割して semantic search 用の vector embedding を保存します。 |
| **Embedding モデル設定** | 知識ライブラリで使う embedding モデルを選択・更新し、次元数や利用可否を UI に表示します。 |
| **業務文書に基づく回答** | 自分の文書をコンテキストとして、要約、計画、メール、レポート、運用ガイドを生成します。 |

### スキル、プラグイン、拡張性

| 機能 | 説明 |
|------|------|
| **インストール可能なスキル** | ファイル処理、データ分析、自動化支援、ドメイン固有タスクのための再利用可能なスキルを追加できます。 |
| **スキル管理** | ZIP からスキルをインポートし、組み込み、ユーザーインストール、プラグイン提供スキルを管理します。 |
| **プラグイン管理** | ZIP またはソースフォルダからプラグインをインポートし、有効化、状態、形式、スキル、MCP サーバーを管理します。 |
| **Claude 形式プラグイン互換** | aiFetchly 形式と Claude 形式のプラグインをサポートし、スキルと MCP サーバー定義を追加できます。 |
| **Hook 管理** | セッション開始、プロンプト送信、ツール利用、権限要求、停止など AI/chat ライフサイクル用の Hook を作成します。 |

### ブラウザ、データ、ワークフロー自動化

| 機能 | 説明 |
|------|------|
| **Web 調査自動化** | 複数検索エンジンで検索し、業務情報を収集し、URL リストを処理してタスクエラーから回復します。 |
| **構造化データ抽出** | メール、電話番号、住所、SNS プロフィール、会社情報、ディレクトリレコードなどを抽出します。 |
| **タスクスケジューリング** | cron でタスクを予定し、依存ジョブを連結し、定期ワークフローと実行履歴を管理します。 |
| **ワンクリックエクスポート** | 収集または処理したデータを CSV としてダウンロードし、レポートを生成します。 |
| **プロキシ管理** | HTTP、HTTPS、SOCKS5 プロキシを一括インポート、検証、テストできます。 |

### 組み込みビジネス成長ワークフロー

| ワークフロー | 説明 |
|--------------|------|
| **企業・リード調査** | 検索エンジン、Google Maps、Yandex Maps、Yellow Pages、ディレクトリ系ソースから企業を探します。 |
| **連絡先抽出** | URL リストからメール、電話番号、住所、SNS プロフィールを抽出し、進捗をリアルタイムで追跡します。 |
| **AI メール下書き** | RAG とアップロード済み文書を使って、パーソナライズされた業務メールを生成します。 |
| **顧客メール送信と返信** | 知識ベース、顧客データ、過去のワークフロー結果を使ってメール送信と返信作成を支援します。 |
| **SNS プラットフォーム操作** | ソーシャルアカウントを管理し、対応している SNS ワークフローを自動化します。 |

## はじめに

### 必要環境

- **OS**：Windows 10+、macOS 10.15+、Linux（Ubuntu 20.04+）
- **RAM**：最小 4 GB、推奨 8 GB

### 初回セットアップ

1. aiFetchly を開き、アカウントにサインインします。
2. 自社ファイルに基づく回答が必要な場合は、文書を知識ライブラリにインポートします。
3. 必要なワークフローのためにスキルやプラグインをインストールまたは有効化します。
4. 自分のモデルを AI Chat で使う場合は、System Settings -> AI Provider でカスタム Provider を設定します。
5. Web 情報収集、SNS、メールワークフローを使う場合のみ、プロキシ、SNS アカウント、SMTP 認証情報を設定します。

## 開発

### 必要環境

- **Node.js** 18+
- **Yarn** 1.x classic

```bash
yarn install
cp .env.example .env
yarn init
yarn dev
yarn tsc
yarn vue-check
yarn build
yarn make
```

### テスト

```bash
yarn test
yarn testmain
yarn vitest-googlescraper
yarn testhttpclient
yarn testyoutubeupload
yarn testdownload
```

### アーキテクチャ

aiFetchly は責務を分離した 3 層アーキテクチャを採用しています。

```text
IPC Handler  ->  Module（業務ロジック） ->  Model（データアクセス）
```

- **Models**（`src/model/`）は TypeORM のデータベース操作と SQL クエリを扱います。
- **Modules**（`src/modules/`）は業務ロジック、検証、複数モデルの調整を扱います。
- **IPC Handlers**（`src/main-process/`）は通信のみを担当し、データベースへ直接アクセスしません。

`src/childprocess/` の worker は scraping や AI 処理など重いタスクを実行します。結果は IPC でメインプロセスへ送り、データベースには直接アクセスしません。

## AI Provider 設定

AI Chat は hosted aiFetchly AI またはユーザー設定の OpenAI 互換 Provider を利用できます。**System Settings -> AI Provider** を開いて、ローカルまたはカスタム Provider を保存します。

## ドキュメント

完全なドキュメントは [docs.aifetchly.com](https://docs.aifetchly.com) で確認できます。

アプリケーションの公式 Web サイトは [sellart-online.com](https://www.sellart-online.com) です。

## aiFetchly を支援する

aiFetchly が時間の節約や仕事に役立った場合は、Ko-fi で継続的な開発を支援できます。

<p>
  <a href="https://ko-fi.com/aifetchly">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Ko-fi で aiFetchly を支援する">
  </a>
</p>

## コントリビューション

バグ修正、新機能、ワークフロー改善、スキル、プラグイン、翻訳の貢献を歓迎します。貢献前に [CLAUDE.md](./CLAUDE.md) を読んでください。

## ライセンス

このプロジェクトは [Apache License Version 2.0](./LICENSE) の下でライセンスされています。
