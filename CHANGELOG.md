# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
but this project does **not** follow Semantic Versioning. Distribution is
exclusively via `bunx`/`npx` against the GitHub default branch — there are no
versioned releases. Each commit on `main` is effectively the latest. This
changelog therefore tracks dated, human-readable changes rather than semantic
versions.

## [Unreleased]

### Added
- Full OS schedulers (user-scope, no admin): Windows Task Scheduler +
  `run-hidden.vbs`/`run.ps1`, macOS LaunchAgent, Linux systemd `--user` timer.
  Scheduled jobs always invoke `npx -y github:ishizakahiroshi/ai-log-clean run ...`.
- `status` / `disable` / `enable` / `uninstall` wired to the real OS backends.
- `install` prompts to bump Claude Code `cleanupPeriodDays` when shorter than
  retention (`--yes` auto-applies; non-TTY prints a hint).
- Zero-dependency TOML subset loader for `~/.ai-log-clean/config.toml`.
- Antigravity CLI (`agy`) provider (`~/.gemini/antigravity-cli/`).
- many-ai-cli provider (`~/.many-ai-cli/subscriptions/<vendor>/<profile>/`).
  Covers the claude / codex / grok profile HOMEs that many-ai-cli creates,
  reusing each vendor's native matching rules. Enabled by default because
  many-ai-cli has no retention setting of its own; profile roots (config,
  workbench sources, `history.jsonl`, session indexes) are never enumerated.
- Unit tests for config, quarantine safety, CLI routing, scheduler builders,
  Claude settings merge (Node built-in `node:test`).

### Changed
- Recommended runner documented as `npx -y` (bunx GitHub cache is sticky).
- README archive wording matches implementation (no zip compression; empty
  parent dirs are left in place).

### Added (earlier scaffolding)
- Initial project scaffolding (CLAUDE.md, AGENTS.md, LICENSE, README, package.json, src/ skeleton).
- secrets-scan layer 2/3 wiring (husky pre-commit + GitHub Actions backstop).
- Per-provider cleanup for Claude Code, Codex CLI, GitHub Copilot CLI,
  Cursor Agent, opencode, and Grok.

