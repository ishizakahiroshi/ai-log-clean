/**
 * Codex CLI session storage: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * Per-file cleanup. We don't prune empty YYYY/MM/DD directories yet — the
 * dir tree is tiny and reclaimed naturally next time Codex writes a new day.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { walkFiles, safeStat } from "../utils/fs.mjs";

export const name = "codex";

export function sessionsDir() {
  return join(homedir(), ".codex", "sessions");
}

function isRollout(path) {
  const b = basename(path);
  return b.startsWith("rollout-") && b.endsWith(".jsonl");
}

export async function detected() {
  return existsSync(sessionsDir());
}

export async function scan(cutoff) {
  const out = [];
  for await (const f of walkFiles(sessionsDir())) {
    if (!isRollout(f)) continue;
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
    if (!isRollout(f)) continue;
    const s = await safeStat(f);
    if (s) total += s.size;
  }
  return total;
}

export async function ageRange() {
  let oldest = Infinity;
  let newest = 0;
  for await (const f of walkFiles(sessionsDir())) {
    if (!isRollout(f)) continue;
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
