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
- **AI に実際のブラウザを操作させる**：デスクトップ上に表示される Chrome ウィンドウを AI が観察・操作します。各ステップを確認でき、重要な操作を承認し、ログインや確認が必要なときは自分で引き継げます。詳しくは[管理ブラウザ自動化](#管理ブラウザ自動化)を参照してください。
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
| **AI が操作する管理ブラウザ** | 実在する可視の Chrome ウィンドウを AI Agent に渡します。サイトを開き、ページを読み、クリックや入力、移動、データ抽出を行い、人による引き継ぎが必要な場所で一時停止します。保存アカウントなしで公開サイトを開け、必要に応じて Tool Account のログイン状態を再利用できます。 |
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

## 管理ブラウザ自動化

aiFetchly には AI Agent が実際に操作できるブラウザが組み込まれています。Agent はデスクトップ上に表示される通常の Chrome/Chromium ウィンドウを開き、ページを観察して依頼された手順を実行します。アプリ側ではセッション状態、承認、進捗、結果を確認できます。

この機能は、自分が所有している、または運用を許可されているサイトとアカウントを対象としています。MFA、ログイン/セキュリティ確認、プラットフォームの安全制御、アクセス制限を回避するものではありません。

### セッションの開始

- **AI Chat**：ブラウザが必要な作業を依頼すると、Agent がブラウザツールを自動で読み込みます。
- **Tool Account → Open managed browser**：保存済みアカウントのログイン状態でそのプラットフォームに接続します。
- **AI ワークスペースのセッションカード**：実行中のブラウザを確認、操作、停止できます。

公開サイトの閲覧にアカウントは不要です。SNS やログイン必須のサイトを含め、保存済み Tool Account なしで開けます。ログインが必要な場合は、開くのを拒否したり HTTP 取得に切り替えたりせず、同じウィンドウをそのままユーザーに引き渡します。保存済みアカウントで開いた場合は、暗号化された Cookie セッションを再利用します。

### 利用できるブラウザツール

| ツール | 用途 |
|--------|------|
| `browser_start_session` | URL または保存済み Tool Account のセッションを開始 |
| `browser_get_status` | セッション状態とサニタイズ済みの現在 URL を取得 |
| `browser_observe` | ページと操作可能要素の有界なセマンティック snapshot を取得 |
| `browser_navigate` | 許可された `http(s)` URL へ移動 |
| `browser_run_actions` | 有界な構造化アクション（クリック、入力、スクロール、待機、抽出、繰り返し）を実行 |
| `browser_screenshot` | 会話用にページのサムネイルを取得 |
| `browser_request_handoff` | 一時停止してユーザーに操作を依頼 |
| `browser_resume_after_handoff` | ユーザーの確認後に再開 |
| `browser_evaluate_script` | 承認後にページ内でレビュー済み JavaScript を実行 |
| `browser_clear_cache` | 確認後に現在のアカウントのキャッシュを削除 |
| `browser_stop_session` | ブラウザを停止して閉じる |

`browser_observe` は `@e1 [button] "Search"` のような参照をページリビジョンとともに返します。移動や再読み込みでリビジョンが変わると古い参照は拒否され、誤った要素をクリックしません。

### 承認と安全性

| リスク | 例 | 動作 |
|--------|----|------|
| 観察 | テキスト読み取り、要素確認、スクリーンショット | セッション単位の承認 |
| 可逆的な操作 | 検索、絞り込み、ページ送り、下書き | セッション単位の承認 |
| 機密入力 | メール、電話番号、DM、アップロード | プレビューと明示的な承認 |
| 重大な操作 | 送信、公開、コメント、フォロー、アップロード、削除、購入、設定変更 | アカウント・対象・影響を示した都度承認 |
| 特権スクリプト | ページ内 JavaScript | スクリプト、オリジン、目的、タイムアウト、期待出力を表示して承認 |
| 認証 | パスワード、MFA、パスキー、セキュリティ CAPTCHA | 常にユーザーが手動で実施 |

ページ内容は信頼できないデータとして扱われるため、Web サイトが Agent に承認を飛ばすよう働きかけることはできません。モデル自身が操作を安全と宣言できず、明示的な拒否は尊重されます。Cookie はレンダラー、モデル、ツール結果、ログ、分析データに渡りません。復号はメインプロセスのみ、適用はブラウザ worker のみが行い、ログイン成功後のセッションは再び暗号化して保存されます。

### 設定とキャッシュ

**System Settings → Managed Browser** で以下を設定できます。

| 設定 | 既定値 | 効果 |
|------|--------|------|
| **Use built-in managed browser** | オン | AI による新しいブラウザセッションを許可 |
| **Use managed browser cache** | オン | アカウント単位で分離した静的リソースを再利用 |
| **Maximum managed-browser cache** | 500 MB | ディスク使用量を制限（100〜2048 MB） |
| **Clear cache when aiFetchly closes** | オフ | 終了時にブラウザキャッシュを削除 |

パネルにはキャッシュサイズ、前回の削除時刻、1 つのアカウントまたはすべての管理ブラウザのキャッシュを削除する操作も表示されます。キャッシュ削除で暗号化 Cookie、保存済みログイン、アカウント、ダウンロードが消えることはありません。

詳細な要件、セキュリティモデル、fingerprint ポリシー、ロールアウト計画は [`docs/prd/puppeteer-managed-social-browser-prd.md`](docs/prd/puppeteer-managed-social-browser-prd.md) にあります。

## ドキュメント

完全なドキュメントは [docs.aifetchly.com](https://docs.aifetchly.com) で確認できます。

AI が操作する管理ブラウザ（可視 Chrome セッション、ブラウザツール、承認、手動引き継ぎ、fingerprint、キャッシュ）：[製品要件](docs/prd/puppeteer-managed-social-browser-prd.md)。

アプリケーションの公式 Web サイトは [aifetchly.com](https://www.aifetchly.com) です。

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
