/**
 * Antigravity CLI (the `agy` command, Google's Gemini CLI successor as of
 * 2026-06-18) session storage lives under ~/.gemini/antigravity-cli/.
 *
 * A single conversation is split across three sub-roots:
 *   brain/<id>/                         — filesystem artifacts (plan.md,
 *                                          scratch, .system_generated/logs/*.jsonl)
 *   conversations/<id>.db (+ -shm/-wal) — SQLite conversation database
 *   log/cli-YYYYMMDD_HHMMSS.log         — CLI process logs (not tied to <id>)
 *
 * We treat brain/<id>/ as a per-session directory (judged by latest
 * descendant mtime), each conversations/<id> SQLite *group* as a unit
 * (`.db` + matching `.db-shm` / `.db-wal` share the same max-mtime so a
 * partially-old triple is never half-archived), and each log/cli-*.log as
 * an individual file. All three are archived under the same provider
 * sourceRoot so the quarantine tree preserves their layout.
 *
 * Out of scope (left alone): bin/, builtin/, updater/, cache/, knowledge/,
 * implicit/, installation_id, settings.json, history.jsonl, cli.log.
 * These are either binaries, user-curated knowledge, or live state the
 * running CLI keeps open.
 *
 * Legacy ~/.gemini/tmp/ residue from the discontinued Gemini CLI is
 * intentionally out of scope — handle separately if it becomes a problem.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { walkFiles, safeStat, listSessionDirs, dirStats } from "../utils/fs.mjs";

export const name = "antigravity";

export function rootDir() {
  return join(homedir(), ".gemini", "antigravity-cli");
}
export function brainDir() { return join(rootDir(), "brain"); }
export function conversationsDir() { return join(rootDir(), "conversations"); }
export function cliLogDir() { return join(rootDir(), "log"); }

/**
 * Map a conversation SQLite path to its group key (the main .db basename).
 *   foo.db      → foo.db
 *   foo.db-shm  → foo.db
 *   foo.db-wal  → foo.db
 *   other       → null
 */
export function conversationGroupKey(path) {
  const b = basename(path);
  if (b.endsWith(".db-shm") || b.endsWith(".db-wal")) {
    return b.replace(/\.db-(shm|wal)$/, ".db");
  }
  if (b.endsWith(".db")) return b;
  return null;
}

function isCliLog(path) {
  const b = basename(path);
  return b.startsWith("cli-") && b.endsWith(".log");
}

export async function detected() {
  return existsSync(rootDir());
}

/**
 * Collect conversation SQLite files, group by conversation id, and decide
 * eligibility by the *max* mtime of the group. That way a recently-touched
 * WAL does not leave an archived `.db` behind (or vice versa).
 */
async function scanConversationGroups(cutoff, out) {
  if (!existsSync(conversationsDir())) return;
  const root = rootDir();
  /** @type {Map<string, { files: { path: string, size: number, mtime: Date }[], maxMs: number }>} */
  const groups = new Map();
  for await (const f of walkFiles(conversationsDir())) {
    const key = conversationGroupKey(f);
    if (!key) continue;
    const s = await safeStat(f);
    if (!s) continue;
    let g = groups.get(key);
    if (!g) {
      g = { files: [], maxMs: 0 };
      groups.set(key, g);
    }
    g.files.push({ path: f, size: s.size, mtime: s.mtime });
    const ms = s.mtime.getTime();
    if (ms > g.maxMs) g.maxMs = ms;
  }
  for (const g of groups.values()) {
    if (g.maxMs < cutoff.getTime()) {
      for (const f of g.files) {
        out.push({
          path: f.path,
          kind: "file",
          lastWriteTime: f.mtime,
          size: f.size,
          root,
        });
      }
    }
  }
}

export async function scan(cutoff) {
  const root = rootDir();
  const out = [];

  // brain/<id>/ — per-session directory
  for (const dir of await listSessionDirs(brainDir(), 1)) {
    const { size, latest } = await dirStats(dir);
    if (!latest) continue;
    if (latest < cutoff) {
      out.push({ path: dir, kind: "directory", lastWriteTime: latest, size, root });
    }
  }

  // conversations/<id>.db (+ -shm / -wal) — group by conversation
  await scanConversationGroups(cutoff, out);

  // log/cli-*.log — per-file
  if (existsSync(cliLogDir())) {
    for await (const f of walkFiles(cliLogDir())) {
      if (!isCliLog(f)) continue;
      const s = await safeStat(f);
      if (!s) continue;
      if (s.mtime < cutoff) {
        out.push({ path: f, kind: "file", lastWriteTime: s.mtime, size: s.size, root });
      }
    }
  }

  return out;
}

export async function totalSize() {
  let total = 0;
  for (const dir of await listSessionDirs(brainDir(), 1)) {
    total += (await dirStats(dir)).size;
  }
  if (existsSync(conversationsDir())) {
    for await (const f of walkFiles(conversationsDir())) {
      if (!conversationGroupKey(f)) continue;
      const s = await safeStat(f);
      if (s) total += s.size;
    }
  }
  if (existsSync(cliLogDir())) {
    for await (const f of walkFiles(cliLogDir())) {
      if (!isCliLog(f)) continue;
      const s = await safeStat(f);
      if (s) total += s.size;
    }
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
  for (const dir of await listSessionDirs(brainDir(), 1)) {
    const { latest, oldest: o } = await dirStats(dir);
    if (latest) consider(latest);
    if (o) consider(o);
  }
  if (existsSync(conversationsDir())) {
    for await (const f of walkFiles(conversationsDir())) {
      if (!conversationGroupKey(f)) continue;
      const s = await safeStat(f);
      if (s) consider(s.mtime);
    }
  }
  if (existsSync(cliLogDir())) {
    for await (const f of walkFiles(cliLogDir())) {
      if (!isCliLog(f)) continue;
      const s = await safeStat(f);
      if (s) consider(s.mtime);
    }
  }
  return {
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
    newest: newest ? new Date(newest) : undefined,
  };
}
