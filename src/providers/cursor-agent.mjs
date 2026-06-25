/**
 * Cursor Agent session storage: ~/.cursor/chats/<hash>/<uuid>/
 *
 * Two-level nesting. Each <hash>/<uuid>/ is one session; clean by directory.
 * Empty <hash>/ parents are pruned naturally by the next listSessionDirs pass.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listSessionDirs, dirStats } from "../utils/fs.mjs";

export const name = "cursor_agent";

export function chatsDir() { return join(homedir(), ".cursor", "chats"); }

export async function detected() {
  return existsSync(chatsDir());
}

export async function scan(cutoff) {
  const out = [];
  for (const dir of await listSessionDirs(chatsDir(), 2)) {
    const { size, latest } = await dirStats(dir);
    if (!latest) continue;
    if (latest < cutoff) {
      out.push({ path: dir, kind: "directory", lastWriteTime: latest, size, root: chatsDir() });
    }
  }
  return out;
}

export async function totalSize() {
  let total = 0;
  for (const dir of await listSessionDirs(chatsDir(), 2)) {
    total += (await dirStats(dir)).size;
  }
  return total;
}

export async function ageRange() {
  let oldest = Infinity;
  let newest = 0;
  for (const dir of await listSessionDirs(chatsDir(), 2)) {
    const { latest, oldest: o } = await dirStats(dir);
    if (latest && latest.getTime() > newest) newest = latest.getTime();
    if (o && o.getTime() < oldest) oldest = o.getTime();
  }
  return {
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
    newest: newest ? new Date(newest) : undefined,
  };
}
