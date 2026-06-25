/**
 * Claude Code session storage: ~/.claude/projects/<encoded-cwd>/*.jsonl
 *
 * Per-file cleanup, gated by .jsonl extension (we don't touch .json indexes
 * or other metadata Claude Code may write). Disabled by default in config
 * since Claude Code has its own `cleanupPeriodDays` (default 30) that the
 * `install` subcommand can offer to bump.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { walkFiles, safeStat } from "../utils/fs.mjs";

export const name = "claude_code";

export function sessionsDir() {
  return join(homedir(), ".claude", "projects");
}

export async function detected() {
  return existsSync(sessionsDir());
}

export async function scan(cutoff) {
  const out = [];
  for await (const f of walkFiles(sessionsDir())) {
    if (!f.endsWith(".jsonl")) continue;
    const s = await safeStat(f);
    if (!s) continue;
    if (s.mtime < cutoff) {
      out.push({ path: f, kind: "file", lastWriteTime: s.mtime, size: s.size, root: sessionsDir() });
    }
  }
  return out;
}

export async function totalSize() {
  let total = 0;
  for await (const f of walkFiles(sessionsDir())) {
    if (!f.endsWith(".jsonl")) continue;
    const s = await safeStat(f);
    if (s) total += s.size;
  }
  return total;
}

export async function ageRange() {
  let oldest = Infinity;
  let newest = 0;
  for await (const f of walkFiles(sessionsDir())) {
    if (!f.endsWith(".jsonl")) continue;
    const s = await safeStat(f);
    if (!s) continue;
    if (s.mtime.getTime() < oldest) oldest = s.mtime.getTime();
    if (s.mtime.getTime() > newest) newest = s.mtime.getTime();
  }
  return {
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
    newest: newest ? new Date(newest) : undefined,
  };
}
