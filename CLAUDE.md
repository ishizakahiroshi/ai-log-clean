<!-- このファイルはプロジェクト固有ルールのみを書く。個人/グローバル AI ルール
（言語・確認スタイル・出力フォーマット等）は各 AI ツールのグローバル設定へ。
fresh public clone でも有効な内容に保つこと。 -->

# ai-log-clean 開発ガイド

## プロジェクト概要

ai-log-clean は、各 AI コーディング CLI（Claude Code / Codex CLI / GitHub Copilot CLI / Cursor Agent / opencode / Grok / Antigravity CLI (`agy`)）が無期限に貯めるセッションログを、retention（既定 60 日）で日次自動掃除するクロスプラットフォーム CLI ツール。

ターゲットは「いずれかの AI CLI を 1 つ以上使う開発者」。複数併用していなくても役に立つ単独ツールとして提供する。配布は GitHub から直接 `npx -y` / `bunx` で実行する形を採り、npm registry には publish しない（バージョン切り運用を持たない・main push が即配布）。**推奨ランナーは `npx -y`**（bunx は GitHub spec のキャッシュが強めで `main` 即配布が成立しないため・詳細は README の「Distribution model / 配布モデル」節）。

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
| 配布 | GitHub のみ（`npx -y github:ishizakahiroshi/ai-log-clean ...` で直接実行。bunx も可） |

## ディレクトリ構成

```
ai-log-clean/
├─ src/
│  ├─ cli.mjs                # サブコマンドルーター
│  ├─ config.mjs             # ~/.ai-log-clean/config.toml の読み書き
│  ├─ commands/              # サブコマンド本体（install / uninstall / run / list / status / enable / disable / init）
│  ├─ providers/             # provider ごとの掃除ロジック（claude-code / codex / copilot / cursor-agent / opencode / grok / antigravity / many-ai-cli）
│  ├─ scheduler/             # OS 別スケジューラ登録（windows / macos / linux）
│  └─ utils/                 # 共有ユーティリティ（fs 等）
├─ tests/
│  └─ unit.test.mjs          # node --test で走る unit テスト（CI で 3 OS 実行）
├─ assets/
│  └─ run-hidden.vbs         # Windows 用コンソール非表示 VBS（install 時に展開）
├─ scripts/
│  └─ secrets-scan.mjs       # secrets-scan 層 2/3/4 共通スキャナ
├─ .husky/pre-commit         # layer 2 hook
├─ .github/workflows/        # layer 3 CI (secrets-scan.yml / ci.yml = smoke + unit tests)
└─ docs/local/               # 非公開ノート（gitignored）
```

## 主要コマンド

ユーザー向け（README を参照）:

- 試す: `npx -y github:ishizakahiroshi/ai-log-clean --dry-run`
- 仕掛ける: `npx -y github:ishizakahiroshi/ai-log-clean install --at 12:00 --retention-days 60`
- 状況確認: `npx -y github:ishizakahiroshi/ai-log-clean status`
- 止める: `npx -y github:ishizakahiroshi/ai-log-clean uninstall`

> 推奨ランナーは `npx -y`。bunx は GitHub spec のキャッシュが強めで `main` 即配布が成立しないため、README の「Distribution model / 配布モデル」節に bunx ユーザー向けの cache クリア手順を記載している。

開発者向け:

- ローカルで実行: `node src/cli.mjs --dry-run` または `bun src/cli.mjs --dry-run`
- テスト実行: `node --test tests/unit.test.mjs`
- secrets-scan 手動実行: `node scripts/secrets-scan.mjs --staged --block`
- **ビルドステップなし**: `.mjs` を直接配布。`main` に push したら次回 `npx -y` 起動で即反映（bunx は cache のため強制リフレッシュが必要）

## AI 作業共通ルール

ビルド・コミット禁止、secrets-scan 責務、plan/bugfix/pending md の作成ルール等の AI 作業共通ルールは、各利用者のグローバル AI 設定に従う（作者環境の例: `~/.claude/CLAUDE.md` および `~/.claude/guides/`）。

## 運用ルール（このプロジェクト固有）

- **既定はアーカイブ動作・削除は `--delete` 明示**。サブコマンド・provider 実装はこの原則を必ず満たす（テストで強制する）
- **install の冪等性**: 2 回目以降の install は確認なしで上書き登録（シンプルさ優先）。確認プロンプトを増やさない
- **Claude Code 本体の `cleanupPeriodDays`**: 直接書き換えない。install 時に「現在 30 です。60 に変更しますか？ Y/N」と対話確認する。`--yes` で非対話化
- **管理者権限を要求しない**: 全 OS で user-scope のスケジューラ（schtasks user task / launchd LaunchAgent / systemd --user timer）。UAC / sudo を出さない
- **Windows でコンソール窓を出さない**: `wscript.exe` + 同梱の `run-hidden.vbs` 経由で起動。終了コードは Task Scheduler に伝搬

## secrets-scan（このリポの配線）

層 1 の共通責務（固有名詞の一般化・fixture は合成データ）はグローバル `~/.claude/CLAUDE.md` に従う。本リポ固有:

- 手動実行: `node scripts/secrets-scan.mjs --staged --block`
- 機械層: layer 2 = `.husky/pre-commit`（husky）/ layer 3 = GitHub Actions `secrets-scan.yml` / layer 4 = release ゲート
- env（full coverage に必要・未設定なら構造 regex のみで継続）: `KB_ROOT` / `FAMILY_ROOT`。設定詳細は `scripts/secrets-scan.mjs` の冒頭コメント
- 参照実装・設計詳細: `worklog-bridge` リポの `docs/local/secrets-scan-design/`（gitignored・公開しない）

## 関連ドキュメント

| 項目 | パス |
|---|---|
| **どのファイルが何をして、どのテーブルを読み書きするか**（探す前にここ） | `.omitnix/index.json`。全ファイルの索引とテーブル逆引き。**解析できなかったファイルも名前と理由付きで載る**ので「索引に無い」と「読めなかった」を取り違えない。参照 0 件は「未使用」ではない。**`generated.commit` が HEAD と違えば索引はその commit 時点のもの**なので、古いまま断定せず `omitnix` で作り直すか、古いことを添えて答える |
| ユーザー向け README | `README.md` / `README.ja.md` |
| Codex/他 AI 用入口 | `AGENTS.md` |
| 設計の経緯（仕様 HTML） | many-ai-cli リポ `docs/local/ai-log-clean-spec/`（参考） |
| 決定経緯（協議シート） | many-ai-cli リポ `docs/local/ai-log-clean-review-sheet/` (参考) |
| ローカル作業ノート（非公開） | `docs/local/`（存在する場合） |
