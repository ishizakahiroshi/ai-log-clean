<!-- このファイルはプロジェクト固有ルールのみを書く。個人/グローバル AI ルール
（言語・確認スタイル・出力フォーマット等）は各 AI ツールのグローバル設定へ。
fresh public clone でも有効な内容に保つこと。 -->

# ai-log-clean 開発ガイド

## プロジェクト概要

ai-log-clean は、各 AI コーディング CLI（Claude Code / Codex CLI / GitHub Copilot CLI / Cursor Agent / opencode / Grok）が無期限に貯めるセッションログを、retention（既定 60 日）で日次自動掃除するクロスプラットフォーム CLI ツール。

ターゲットは「いずれかの AI CLI を 1 つ以上使う開発者」。複数併用していなくても役に立つ単独ツールとして提供する。配布は GitHub から直接 `bunx` / `npx` で実行する形を採り、npm registry には publish しない（バージョン切り運用を持たない・main push が即配布）。

姉妹プロジェクト: [many-ai-cli](https://github.com/ishizakahiroshi/many-ai-cli)（複数 AI CLI の並列承認・ダッシュボード）。本リポは独立。

## やらないこと（スコープ外）

- 単体 `.exe` / `.app` のバイナリ配布（Windows SmartScreen 問題を構造的に回避）
- npm registry への publish（main push を即配布とする運用）
- GUI / Web ダッシュボードの提供（CLI と config.toml のみで完結）
- 任意の log retention 設計（対象は AI コーディング CLI のセッション系のみ）
- システム全体のディスク容量管理・logrotate の代替
- `--delete` を明示しない限りファイルを実消去しない（既定はアーカイブ）

## 技術スタック

| レイヤ | 採用 |
|---|---|
| 言語 | 素の JavaScript（ESM `.mjs`・ビルド不要） |
| ランタイム | Node.js 20+（`bunx` / `bun x` / `npx` のいずれでも動く） |
| パッケージマネージャ | bun（contributors 向け）／ユーザーは何も install しない |
| CLI 引数 | `node:util` の `parseArgs`（依存ゼロ） |
| config | `~/.ai-log-clean/config.toml`（TOML パーサで読む） |
| OS スケジューラ | Windows=schtasks+wscript.exe+run-hidden.vbs / macOS=launchd / Linux=systemd --user timer |
| 配布 | GitHub のみ（`bunx github:ishizakahiroshi/ai-log-clean ...` で直接実行） |

## ディレクトリ構成

```
ai-log-clean/
├─ src/
│  ├─ cli.mjs                # サブコマンドルーター
│  ├─ config.mjs             # ~/.ai-log-clean/config.toml の読み書き
│  ├─ commands/              # サブコマンド本体（install / uninstall / run / list 等）
│  ├─ providers/             # provider ごとの掃除ロジック（claude-code / codex / copilot / cursor-agent / opencode / grok）
│  └─ scheduler/             # OS 別スケジューラ登録（windows / macos / linux）
├─ assets/
│  └─ run-hidden.vbs         # Windows 用コンソール非表示 VBS（install 時に展開）
├─ scripts/
│  └─ secrets-scan.mjs       # secrets-scan 層 2/3/4 共通スキャナ
├─ .husky/pre-commit         # layer 2 hook
├─ .github/workflows/        # layer 3 CI (secrets-scan / type-check)
└─ docs/local/               # 非公開ノート（gitignored）
```

## 主要コマンド

ユーザー向け（README を参照）:

- 試す: `bunx github:ishizakahiroshi/ai-log-clean --dry-run`
- 仕掛ける: `bunx github:ishizakahiroshi/ai-log-clean install --at 12:00 --retention-days 60`
- 状況確認: `bunx github:ishizakahiroshi/ai-log-clean status`
- 止める: `bunx github:ishizakahiroshi/ai-log-clean uninstall`

開発者向け:

- ローカルで実行: `node src/cli.mjs --dry-run` または `bun src/cli.mjs --dry-run`
- secrets-scan 手動実行: `node scripts/secrets-scan.mjs --staged --block`
- **ビルドステップなし**: `.mjs` を直接配布。`main` に push したら次回 `bunx` 起動で反映される

## 運用ルール（このプロジェクト固有）

グローバル `~/.claude/CLAUDE.md` の規約（md 命名・フッター・ビルド/コミット抑制・承認フォーマット等）に従う。加えて ai-log-clean 固有:

- **既定はアーカイブ動作・削除は `--delete` 明示**。サブコマンド・provider 実装はこの原則を必ず満たす（テストで強制する）
- **install の冪等性**: 2 回目以降の install は確認なしで上書き登録（シンプルさ優先）。確認プロンプトを増やさない
- **Claude Code 本体の `cleanupPeriodDays`**: 直接書き換えない。install 時に「現在 30 です。60 に変更しますか？ Y/N」と対話確認する。`--yes` で非対話化
- **管理者権限を要求しない**: 全 OS で user-scope のスケジューラ（schtasks user task / launchd LaunchAgent / systemd --user timer）。UAC / sudo を出さない
- **Windows でコンソール窓を出さない**: `wscript.exe` + 同梱の `run-hidden.vbs` 経由で起動。終了コードは Task Scheduler に伝搬
- **本リポジトリへのコミット・ビルド・公開はユーザー指示があるまで実行しない**（house 標準）

## secrets-scan (kb-first・4 層防御の一次防御)

公開ファイル（`README*` / `CLAUDE.md` / `AGENTS.md` / `src/**` / `dist/**` / packaged tarball）を新規作成・大改訂する瞬間、以下を AI 自身の責務として実行する:

- 親 plan / 設計メモ / 動作確認ログからの文言転記時、外部 KB の表示名列（`companies.short_name` / `people.name` / `servers.host` / `applications.name`）と family display 名を必ず一般化する（「特定の顧客」「ユーザー」「A 拠点」等）
- テスト fixture / 例示 / サンプルには動作確認の実値を貼らない（最初から合成データで書く）
- 不安なら手で `node scripts/secrets-scan.mjs --staged --block` を実行して検証

機械的な層: layer 2 pre-commit hook（husky）/ layer 3 GitHub Actions `secrets-scan.yml` / layer 4 release ゲートが自動で走るが、**書く瞬間の自問が一次防御**。

env (full coverage に必要・未設定なら構造 regex のみで継続): `KB_ROOT` / `FAMILY_ROOT`。設定詳細は `~/.claude/local-accounts.md` または `scripts/secrets-scan.mjs` の冒頭コメント。

参照実装・設計詳細: `worklog-bridge` リポの `docs/local/secrets-scan-design/`（gitignored・公開しない）

## 関連ドキュメント

| 項目 | パス |
|---|---|
| ユーザー向け README | `README.md` / `README.ja.md` |
| Codex/他 AI 用入口 | `AGENTS.md` |
| 設計の経緯（仕様 HTML） | many-ai-cli リポ `docs/local/ai-log-clean-spec/`（参考） |
| 決定経緯（協議シート） | many-ai-cli リポ `docs/local/ai-log-clean-review-sheet/` (参考) |
| ローカル作業ノート（非公開） | `docs/local/`（存在する場合） |
