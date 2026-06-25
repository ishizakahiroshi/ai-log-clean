/**
 * GitHub Copilot CLI session storage:
 *   ~/.copilot/logs/process-*.log         (per-file)
 *   ~/.copilot/session-state/<uuid>/      (per-session directory)
 *
 * The two roots are walked separately. session-state/<uuid>/ subdirectories
 * are treated as one session each, judged by their latest descendant mtime.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { walkFiles, safeStat, listSessionDirs, dirStats } from "../utils/fs.mjs";

export const name = "copilot";

export function logsDir() { return join(homedir(), ".copilot", "logs"); }
export function sessionStateDir() { return join(homedir(), ".copilot", "session-state"); }

function isProcessLog(path) {
  const b = basename(path);
  return b.startsWith("process-") && b.endsWith(".log");
}

export async function detected() {
  return existsSync(logsDir()) || existsSync(sessionStateDir());
}

export async function scan(cutoff) {
  const out = [];
  if (existsSync(logsDir())) {
    for await (const f of walkFiles(logsDir())) {
      if (!isProcessLog(f)) continue;
      const s = await safeStat(f);
      if (!s) continue;
      if (s.mtime < cutoff) {
        out.push({ path: f, kind: "file", lastWriteTime: s.mtime, size: s.size, root: logsDir() });
      }
    }
  }
  for (const dir of await listSessionDirs(sessionStateDir(), 1)) {
    const { size, latest } = await dirStats(dir);
    if (!latest) continue;
    if (latest < cutoff) {
      out.push({ path: dir, kind: "directory", lastWriteTime: latest, size, root: sessionStateDir() });
    }
  }
  return out;
}

export async function totalSize() {
  let total = 0;
  if (existsSync(logsDir())) {
    for await (const f of walkFiles(logsDir())) {
      if (!isProcessLog(f)) continue;
      const s = await safeStat(f);
      if (s) total += s.size;
    }
  }
  for (const dir of await listSessionDirs(sessionStateDir(), 1)) {
    total += (await dirStats(dir)).size;
  }
  return total;
}

export async function ageRange() {
  let oldest = Infinity;
  let newest = 0;
  const consider = (t) => {
    const ms = t.getTime();
    if (ms < oldest) oldest = ms;
    if (ms > newest) newest = ms;
  };
  if (existsSync(logsDir())) {
    for await (const f of walkFiles(logsDir())) {
      if (!isProcessLog(f)) continue;
      const s = await safeStat(f);
      if (s) consider(s.mtime);
    }
  }
  for (const dir of await listSessionDirs(sessionStateDir(), 1)) {
    const { latest, oldest: o } = await dirStats(dir);
    if (latest) consider(latest);
    if (o) consider(o);
  }
  return {
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
    newest: newest ? new Date(newest) : undefined,
  };
}
