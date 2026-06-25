/**
 * Claude Code session storage: ~/.claude/projects/<encoded-cwd>/*.jsonl
 *
 * Claude Code has its own `cleanupPeriodDays` setting (default 30). The
 * recommended behavior is to defer to the host, optionally prompting at
 * `install` time to bump `cleanupPeriodDays` to match the chosen retention.
 *
 * This provider is therefore disabled by default in config (see config.mjs).
 * When enabled, it falls back to mtime-based cleanup of the .jsonl files.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "claude_code";

export function sessionsDir() {
  return join(homedir(), ".claude", "projects");
}

export async function detected() {
  return existsSync(sessionsDir());
}
export async function scan(_cutoff) { return []; }
export async function totalSize() { return 0; }
export async function ageRange() { return {}; }
