# Agent Entry Point (ai-log-clean)

このリポジトリの運用ガイダンスは `CLAUDE.md` を正本とする。

- プロジェクト概要・ルール: `./CLAUDE.md`
- ユーザー向けドキュメント: `./README.md`
- ローカル/プライベート追記（存在する場合・コミットしない）: `./CLAUDE.local.md` / `./AGENTS.local.md` / `./docs/local/`

個人/グローバル AI ルールは意図的にこのリポジトリの外に置く。各 AI ツールの
グローバル設定を使うこと。本ファイルは fresh public clone でも有効に保つ。

## Non-negotiables (full detail in CLAUDE.md)

- **既定はアーカイブのみ・削除は `--delete` 明示**。ファイル削除を伴うコードを書くときは、デフォルトコードパスが quarantine への退避であることをテストで強制する
- **管理者権限を要求しない**: スケジューラ登録は全 OS で user-scope。`sudo` / UAC を促す実装を入れない
- 公開 fixture（テストデータ・サンプル設定・例示プロンプト）は実値ではなく **最初から合成データで書く**。動作確認の実値を fixture に化石化しない
- 公開ファイル（README/CLAUDE.md/AGENTS.md/src/**）の新規作成・大改訂時は、**コミット前に外部 KB の表示名列で grep し、ヒットがあればマスク or 一般化する**。手で実行する場合: `node scripts/secrets-scan.mjs --staged --block`。pre-commit hook（layer 2）が自動で走るが、書く瞬間の自問が一次防御
- 本リポジトリへのコミット・ビルド・公開はユーザー指示があるまで実行しない（house 標準）

ガイダンス間で矛盾が出たら `CLAUDE.md` を優先する。

<!-- many-ai-cli の承認マーカーブロックはここに自動注入される。本ファイルでは持たない。 -->
