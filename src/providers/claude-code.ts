/**
 * Claude Code session storage: ~/.claude/projects/<encoded-cwd>/*.jsonl
 *
 * Claude Code has its own `cleanupPeriodDays` setting (default 30). The
 * recommended behavior is to defer to the host, optionally prompting at
 * `install` time to bump `cleanupPeriodDays` to match the chosen retention.
 *
 * This provider is therefore disabled by default in config (see config.ts).
 * When enabled, it falls back to mtime-based cleanup of the .jsonl files.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { CleanupCandidate } from "./index.ts";

export const name = "claude_code" as const;

export function sessionsDir(): string {
  return join(homedir(), ".claude", "projects");
}

export async function detected(): Promise<boolean> {
  // TODO: stat the sessions dir.
  return false;
}

export async function scan(_cutoff: Date): Promise<CleanupCandidate[]> {
  // TODO: walk sessionsDir(), return *.jsonl older than cutoff.
  return [];
}

export async function totalSize(): Promise<number> {
  // TODO
  return 0;
}

export async function ageRange(): Promise<{ oldest?: Date; newest?: Date }> {
  // TODO
  return {};
}
