# ai-log-clean

> **Status: early development (pre-0.1).** API and defaults may change without notice. Use `--dry-run` first.

Trim old session logs from Claude Code, Codex CLI, GitHub Copilot CLI, Cursor Agent, opencode, and Grok. Cross-platform daily auto-clean with configurable retention.

These AI coding CLIs persist every conversation as a "rollout" / session file under your home directory so they can resume past chats. Most of them have **no built-in retention**, so the files accumulate forever — gigabytes after a few months of heavy use. `ai-log-clean` runs once a day, walks the session directories of every supported provider, and **archives** anything older than the configured retention (default 60 days). Actual deletion only happens when you pass `--delete`.

Japanese: [README.ja.md](./README.ja.md)

## Quick start

You don't install this package. Run it straight from GitHub.

```sh
# Try it (does not modify anything)
npx -y github:ishizakahiroshi/ai-log-clean --dry-run

# Bun users — bunx works too, but it caches GitHub specs aggressively
# (see "Distribution model" below if you stop seeing new commits)
bunx github:ishizakahiroshi/ai-log-clean --dry-run

# See current sizes / oldest files per provider
npx -y github:ishizakahiroshi/ai-log-clean list

# Install a daily 12:00 cleanup with 60-day retention
npx -y github:ishizakahiroshi/ai-log-clean install --at 12:00 --retention-days 60

# Pause without losing your config
npx -y github:ishizakahiroshi/ai-log-clean disable
npx -y github:ishizakahiroshi/ai-log-clean enable

# Remove the schedule and (optionally) the config + logs
npx -y github:ishizakahiroshi/ai-log-clean uninstall
npx -y github:ishizakahiroshi/ai-log-clean uninstall --purge
```

`npx -y` is the recommended runner — it fetches the GitHub HEAD on every
invocation, so a fix on `main` reaches you on the next run. `-y` skips the
"download and run" prompt, which matters when the scheduler triggers it.

`install` detects your OS and registers a user-scope scheduled job — no `sudo`, no UAC prompt:

- **Windows** — Task Scheduler entry that invokes `wscript.exe` with a bundled `run-hidden.vbs`, so no console window flashes at noon.
- **macOS** — `LaunchAgent` plist under `~/Library/LaunchAgents/`.
- **Linux** — `systemd --user` timer + service unit.

## Supported providers

| Provider | Session files | Built-in retention | What ai-log-clean does |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/<encoded-cwd>/*.jsonl` | Yes (`cleanupPeriodDays`, default 30 days) | Defers to Claude Code. On `install` we'll ask whether to bump `cleanupPeriodDays` to match your chosen retention; we won't touch `settings.json` without a Y/N confirmation. |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | No ([openai/codex#6015](https://github.com/openai/codex/issues/6015)) | Archive (or `--delete`) by mtime. Empty date directories are pruned. |
| GitHub Copilot CLI | `~/.copilot/logs/process-*.log`, `~/.copilot/session-state/<uuid>/` | No | Per-file for logs, per-session-directory for `session-state/`. |
| Cursor Agent | `~/.cursor/chats/<hash>/<uuid>/` | No | Per-session-directory; empty hash directories are pruned afterwards. |
| opencode | `$XDG_DATA_HOME/opencode/log/*.log`, `.../storage/session_diff/*.json` | No | Per-file. XDG path is resolved per OS (`~/.local/share/`, `~/Library/Application Support/`, `%APPDATA%`). |
| Grok | `~/.grok/sessions/<encoded>/<uuid>/` | No | Per-session-directory. `~/.grok/logs/unified.jsonl` is **excluded** because it is append-only — pruning it mid-stream would corrupt the journal. |

You can disable any provider or set per-provider retention in `~/.ai-log-clean/config.toml` (`npx -y github:ishizakahiroshi/ai-log-clean init` writes a template).

## Safety model

This tool deletes files for a living, so the default is conservative.

- **Default is archive-only.** Files past their retention are moved into `~/.ai-log-clean/quarantine/<YYYY-MM-DD>/` and compressed. Quarantine entries are removed after 30 days.
- **Real deletion requires `--delete`.** Pass it on the CLI, or set `defaults.delete = true` in `config.toml`.
- **`--dry-run` prints the plan** without touching anything.
- **`--max-deletes N`** caps a single run at N file or directory removals — a runaway bug can only damage a bounded number of items.
- **Provider isolation.** A failure cleaning one provider does not stop the others; the run reports per-provider success / failure and exit code reflects the worst case.

## Configuration

`~/.ai-log-clean/config.toml`:

```toml
[defaults]
retention_days = 60
delete         = false   # archive by default; set true (or pass --delete) to remove

[providers.claude_code]
enabled = false          # defer to Claude Code's own cleanupPeriodDays

[providers.codex]
enabled        = true
retention_days = 90      # keep codex sessions longer

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

`npx -y github:ishizakahiroshi/ai-log-clean init` writes this template to `~/.ai-log-clean/config.toml`.

## Distribution model

`ai-log-clean` is **not published to npm**. Both `npx` and `bunx` accept GitHub specs (`github:owner/repo`), so installation is a single command that doesn't leave anything globally on your machine. `main` is the only release channel — push = ship.

**Recommended runner: `npx -y`.** npx hits the GitHub HEAD on every run, so a `git push` to `main` reaches users on their next invocation. bunx caches GitHub specs aggressively — bun users may keep running an older commit until the cache is cleared.

Force-refresh or pin a specific commit:

```sh
# Force bunx to refetch on next run (PowerShell)
Remove-Item -Recurse -Force "$env:TEMP\bunx-*ai-log-clean*"

# Force bunx to refetch on next run (bash / zsh)
rm -rf "${TMPDIR:-/tmp}"/bunx-*ai-log-clean*

# Or pin a specific commit (works with both npx and bunx)
npx -y 'github:ishizakahiroshi/ai-log-clean#<commit-sha>' install
bunx 'github:ishizakahiroshi/ai-log-clean#<commit-sha>' install
```

Trade-off: a bad commit on `main` ships immediately. That's exactly why the default behavior is archive-only with `--max-deletes`.

## Sibling project

For orchestrating **multiple AI CLIs in parallel** (one approval dashboard, shared web UI), see [many-ai-cli](https://github.com/ishizakahiroshi/many-ai-cli). `ai-log-clean` is intentionally independent — single-CLI users benefit just as much.

## License

[MIT](./LICENSE) © ishizakahiroshi
