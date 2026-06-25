# ai-log-clean

> **ステータス: 開発初期（0.1 未満）。** API・既定値は予告なく変わります。まず `--dry-run` で試してください。

各 AI コーディング CLI（Claude Code / Codex CLI / GitHub Copilot CLI / Cursor Agent / opencode / Grok）が貯め続けるセッションログを、**指定日数より古いものを日次で自動掃除**するクロスプラットフォーム CLI。

これらの CLI は会話の正本ファイル（resume 用の rollout / session ファイル）をホームディレクトリに書き残しますが、**多くは自動掃除を持たず無期限保持**になっています。数ヶ月使うと GB 単位で貯まります。`ai-log-clean` は 1 日 1 回、対応 provider のセッションディレクトリを巡回して既定 60 日より古いものを **アーカイブ**します（実削除は `--delete` 明示時のみ）。

English: [README.md](./README.md)

## クイックスタート

このパッケージはインストール不要。GitHub から直接実行できます。

```sh
# 試す（何も壊さない）
npx -y github:ishizakahiroshi/ai-log-clean --dry-run

# bun 派の場合（bunx は GitHub spec のキャッシュが強めなので、
# 新版が来ないなと感じたら下記「配布モデル」を参照）
bunx github:ishizakahiroshi/ai-log-clean --dry-run

# 各 provider の現在の容量・最古ファイルを見る
npx -y github:ishizakahiroshi/ai-log-clean list

# 日次 12:00・retention 60 日でセットアップ
npx -y github:ishizakahiroshi/ai-log-clean install --at 12:00 --retention-days 60

# 一時停止（設定は残す）／ 再開
npx -y github:ishizakahiroshi/ai-log-clean disable
npx -y github:ishizakahiroshi/ai-log-clean enable

# 完全に止める（設定・ログも消すなら --purge）
npx -y github:ishizakahiroshi/ai-log-clean uninstall
npx -y github:ishizakahiroshi/ai-log-clean uninstall --purge
```

推奨は `npx -y`。npx は毎回 GitHub HEAD を見に行くので、`main` への push が次回起動から即反映されます。`-y` は「ダウンロードして実行しますか?」プロンプトをスキップする指定で、スケジューラから呼ばれる時に重要です。

`install` は OS を自動判定し、ユーザースコープでスケジュール登録します（`sudo` / UAC 不要）:

- **Windows** — Task Scheduler に登録。同梱の `run-hidden.vbs` を `wscript.exe` 経由で呼ぶので、12:00 に黒い窓が一瞬出ません。
- **macOS** — `~/Library/LaunchAgents/` 配下に LaunchAgent plist を配置し `launchctl` で起動。
- **Linux** — `systemd --user` の timer + service ユニットで登録。

## 対応 provider

| Provider | セッションファイル | ネイティブ retention | ai-log-clean の挙動 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/<encoded-cwd>/*.jsonl` | あり（`cleanupPeriodDays`・既定 30 日） | 本体に任せる。`install` 時に「`cleanupPeriodDays` を選んだ retention に揃えますか？」と Y/N 確認だけ行う。`settings.json` を勝手に書き換えない（`--yes` で非対話化）。 |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | なし（[openai/codex#6015](https://github.com/openai/codex/issues/6015)） | mtime ベースで archive（または `--delete` で削除）。空になった日付ディレクトリも片付ける。 |
| GitHub Copilot CLI | `~/.copilot/logs/process-*.log`, `~/.copilot/session-state/<uuid>/` | なし | logs はファイル単位、session-state はセッションディレクトリ単位。 |
| Cursor Agent | `~/.cursor/chats/<hash>/<uuid>/` | なし | セッションディレクトリ単位。空になった hash ディレクトリも掃除。 |
| opencode | `$XDG_DATA_HOME/opencode/log/*.log`, `.../storage/session_diff/*.json` | なし | ファイル単位。XDG パスは OS 別に解決（Linux `~/.local/share/`、macOS `~/Library/Application Support/`、Windows `%APPDATA%`）。 |
| Grok | `~/.grok/sessions/<encoded>/<uuid>/` | なし | セッションディレクトリ単位。`~/.grok/logs/unified.jsonl` は append-only なので **対象外**（部分削除すると整合性が壊れる）。 |

provider 単位の有効/無効・retention 上書きは `~/.ai-log-clean/config.toml` で設定できます（`npx -y github:ishizakahiroshi/ai-log-clean init` で雛形生成）。

## 安全設計

ファイルを消すツールなので、既定は保守的にしてあります。

- **既定はアーカイブのみ。** retention を超えたものは `~/.ai-log-clean/quarantine/<YYYY-MM-DD>/` に zip 退避され、30 日後に自動消去されます。
- **実削除は `--delete` 明示時のみ。** CLI で渡すか、`config.toml` の `defaults.delete = true` で常時 ON にできます。
- **`--dry-run` は計画だけ表示**して何も触りません。
- **`--max-deletes N`** で 1 回の削除上限を設定。暴走しても N 件で止まります。
- **provider 単位で隔離。** ある provider の掃除失敗が他の provider を巻き込みません。各 provider の成功/失敗が個別に報告され、終了コードは最悪値を反映します。

## 設定

`~/.ai-log-clean/config.toml`:

```toml
[defaults]
retention_days = 60
delete         = false   # 既定はアーカイブ・true または --delete で削除

[providers.claude_code]
enabled = false          # Claude Code 本体の cleanupPeriodDays に任せる

[providers.codex]
enabled        = true
retention_days = 90      # codex だけ長めに残す

[providers.copilot]
enabled = true

[providers.cursor_agent]
enabled        = true
retention_days = 30

[providers.opencode]
enabled = true

[providers.grok]
enabled       = true
exclude_files = ["logs/unified.jsonl"]
```

`npx -y github:ishizakahiroshi/ai-log-clean init` でこの雛形が `~/.ai-log-clean/config.toml` に書き出されます。

## 配布モデル

`ai-log-clean` は **npm registry に publish していません**。`npx` / `bunx` ともに GitHub spec（`github:owner/repo`）を受け取れるので、1 コマンドで実行でき、PC 上にグローバルインストール物が残りません。リリースチャネルは `main` ブランチ 1 本のみ。push = 配布です。

**推奨ランナーは `npx -y`。** npx は毎回 GitHub HEAD を見るので、`main` への push が次回起動時に届きます。bunx は GitHub spec を強めにキャッシュするため、bun ユーザーは古いコミットを掴み続けることがあります。

強制リフレッシュ / 特定コミットへの pin:

```sh
# bunx のキャッシュを消して次回再取得（PowerShell）
Remove-Item -Recurse -Force "$env:TEMP\bunx-*ai-log-clean*"

# bunx のキャッシュを消して次回再取得（bash / zsh）
rm -rf "${TMPDIR:-/tmp}"/bunx-*ai-log-clean*

# 特定コミットを pin（npx / bunx どちらでも同じ書式）
npx -y 'github:ishizakahiroshi/ai-log-clean#<commit-sha>' install
bunx 'github:ishizakahiroshi/ai-log-clean#<commit-sha>' install
```

トレードオフ: `main` への悪い commit は即配布されます。だからこそ既定挙動を「アーカイブ + `--max-deletes`」にしています。

## 姉妹プロジェクト

**複数の AI CLI を並列に動かす** ときの承認操作・ダッシュボードは [many-ai-cli](https://github.com/ishizakahiroshi/many-ai-cli) が担当します。`ai-log-clean` は意図的に独立しています — AI CLI を 1 つしか使わない人にもそのまま役立つ性質のため。

## ライセンス

[MIT](./LICENSE) © ishizakahiroshi
