/**
 * Grok CLI session storage: ~/.grok/sessions/<encoded>/<uuid>/
 *
 * Per-session directory (the inner <uuid>/). Two-level nesting like cursor.
 * ~/.grok/logs/unified.jsonl is append-only and lives outside this provider
 * scope on purpose — we do not enumerate it.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listSessionDirs, dirStats } from "../utils/fs.mjs";

export const name = "grok";

export function sessionsDir() { return join(homedir(), ".grok", "sessions"); }

export async function detected() {
  return existsSync(sessionsDir());
}

export async function scan(cutoff) {
  const out = [];
  for (const dir of await listSessionDirs(sessionsDir(), 2)) {
    const { size, latest } = await dirStats(dir);
    if (!latest) continue;
    if (latest < cutoff) {
      out.push({ path: dir, kind: "directory", lastWriteTime: latest, size, root: sessionsDir() });
    }
  }
  return out;
}

export async function totalSize() {
  let total = 0;
  for (const dir of await listSessionDirs(sessionsDir(), 2)) {
    total += (await dirStats(dir)).size;
  }
  return total;
}

export async function ageRange() {
  let oldest = Infinity;
  let newest = 0;
  for (const dir of await listSessionDirs(sessionsDir(), 2)) {
    const { latest, oldest: o } = await dirStats(dir);
    if (latest && latest.getTime() > newest) newest = latest.getTime();
    if (o && o.getTime() < oldest) oldest = o.getTime();
  }
  return {
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
    newest: newest ? new Date(newest) : undefined,
  };
}
