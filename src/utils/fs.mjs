/**
 * Filesystem helpers shared by the provider modules.
 *
 * Two scan shapes are common across providers:
 *   - "per file" — flat or nested files matching a pattern (codex rollouts,
 *     copilot logs, opencode logs, claude_code jsonls).
 *   - "per session dir" — a directory IS one session; we judge it by its
 *     latest-mtime descendant (cursor chats, grok sessions, copilot
 *     session-state). The whole directory archives or deletes as a unit.
 */

import { readdir, stat, mkdir, rename, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname, isAbsolute, extname } from "node:path";

/**
 * Walk a directory recursively and yield absolute file paths.
 * Errors (permission denied, vanished entries) are skipped silently so a
 * single bad subtree does not derail a full run.
 */
export async function* walkFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

/**
 * List direct subdirectories of `dir` at the requested depth.
 *  depth=1 → dir/<child>/
 *  depth=2 → dir/<group>/<child>/   (e.g. cursor chats/<hash>/<uuid>/)
 */
export async function listSessionDirs(dir, depth = 1) {
  if (!existsSync(dir)) return [];
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = join(dir, e.name);
    if (depth === 1) {
      out.push(full);
    } else {
      out.push(...(await listSessionDirs(full, depth - 1)));
    }
  }
  return out;
}

/**
 * Return total bytes + most-recent mtime of all files under `dir`.
 * Used to size a "session directory" candidate.
 */
export async function dirStats(dir) {
  let size = 0;
  let latest = 0;
  let oldest = Infinity;
  for await (const f of walkFiles(dir)) {
    try {
      const s = await stat(f);
      size += s.size;
      if (s.mtimeMs > latest) latest = s.mtimeMs;
      if (s.mtimeMs < oldest) oldest = s.mtimeMs;
    } catch {
      // file vanished between readdir and stat — ignore
    }
  }
  return {
    size,
    latest: latest ? new Date(latest) : undefined,
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
  };
}

/**
 * Stat one file and return {size, mtime}, or null if it can't be read.
 */
export async function safeStat(path) {
  try {
    const s = await stat(path);
    return { size: s.size, mtime: new Date(s.mtimeMs) };
  } catch {
    return null;
  }
}

/**
 * Move a path into the quarantine root, preserving the provider + relative
 * sub-path. e.g.
 *   archivePath = ~/.ai-log-clean/quarantine/2026-06-25/codex/2026/06/01/rollout-foo.jsonl
 *
 * Hardening:
 *   - Refuses to write outside the quarantine subtree: if the relative path
 *     escapes sourceRoot (starts with `..`) or is absolute, throws so a
 *     provider bug or hostile symlink can't redirect us elsewhere.
 *   - Falls back to copy+remove on EXDEV (cross-filesystem rename), which
 *     fires when ~/.ai-log-clean lives on a different volume than the
 *     provider's session directory (e.g. profile on D: with quarantine on C:).
 *   - Avoids clobbering an existing quarantine target by appending `.2`,
 *     `.3`, ... — `fs.rename` cannot atomically replace an existing directory
 *     on either POSIX or Windows, and we'd rather keep the older copy than
 *     fail the whole run.
 */
export async function moveToQuarantine({ source, sourceRoot, provider, quarantineRoot, today }) {
  const rel = relative(sourceRoot, source);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `refusing to quarantine: source ${JSON.stringify(source)} is not inside sourceRoot ${JSON.stringify(sourceRoot)}`,
    );
  }
  const baseTarget = join(quarantineRoot, today, provider, rel);
  const target = await pickFreeName(baseTarget);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try {
    await rename(source, target);
  } catch (err) {
    if (err && err.code === "EXDEV") {
      // Cross-device: fall back to a recursive copy + remove. fs.cp handles
      // both files and directories.
      await cp(source, target, { recursive: true, force: false, errorOnExist: true });
      await rm(source, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return target;
}

async function pickFreeName(basePath) {
  if (!existsSync(basePath)) return basePath;
  const ext = extname(basePath);
  const stem = ext ? basePath.slice(0, -ext.length) : basePath;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}.${i}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`quarantine target already exists and 998 fallback names are taken: ${basePath}`);
}

/**
 * Remove a path (file or directory). Used for --delete mode and for
 * pruning expired quarantine entries.
 */
export async function removePath(path) {
  await rm(path, { recursive: true, force: true });
}

/**
 * Format bytes as a human string.
 */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * YYYY-MM-DD in local time, for naming quarantine subdirectories.
 */
export function todayStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
