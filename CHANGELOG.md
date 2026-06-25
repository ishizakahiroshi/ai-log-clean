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
- Initial project scaffolding (CLAUDE.md, AGENTS.md, LICENSE, README, package.json, src/ skeleton).
- secrets-scan layer 2/3 wiring (husky pre-commit + GitHub Actions backstop).
- Cross-platform scheduler stubs (Windows / macOS / Linux).
- Per-provider cleanup stubs for Claude Code, Codex CLI, GitHub Copilot CLI,
  Cursor Agent, opencode, and Grok.

