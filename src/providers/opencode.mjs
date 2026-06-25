/**
 * opencode session storage (XDG-aware):
 *   <root>/log/*.log
 *   <root>/storage/session_diff/*.json
 *
 * XDG_DATA_HOME resolution per OS:
 *   Linux   -> $XDG_DATA_HOME or ~/.local/share
 *   macOS   -> ~/Library/Application Support
 *   Windows -> %APPDATA% (with %LOCALAPPDATA% and ~/.local/share fallbacks)
 */

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { walkFiles, safeStat } from "../utils/fs.mjs";

export const name = "opencode";

export function candidateRoots() {
  const roots = [];
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) roots.push(join(xdg, "opencode"));
  switch (platform()) {
    case "win32":
      if (process.env.APPDATA) roots.push(join(process.env.APPDATA, "opencode"));
      if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, "opencode"));
      roots.push(join(homedir(), ".local", "share", "opencode"));
      break;
    case "darwin":
      roots.push(join(homedir(), "Library", "Application Support", "opencode"));
      roots.push(join(homedir(), ".local", "share", "opencode"));
      break;
    default:
      roots.push(join(homedir(), ".local", "share", "opencode"));
  }
  return roots;
}

export function dataRoot() {
  for (const r of candidateRoots()) {
    if (existsSync(r)) return r;
  }
  return candidateRoots()[0];
}

export function logDir() { return join(dataRoot(), "log"); }
export function sessionDiffDir() { return join(dataRoot(), "storage", "session_diff"); }

export async function detected() {
  return candidateRoots().some(existsSync);
}

async function* scanFiles() {
  if (existsSync(logDir())) {
    for await (const f of walkFiles(logDir())) {
      if (!f.endsWith(".log")) continue;
      yield { path: f, root: logDir() };
    }
  }
  if (existsSync(sessionDiffDir())) {
    for await (const f of walkFiles(sessionDiffDir())) {
      if (!f.endsWith(".json")) continue;
      yield { path: f, root: sessionDiffDir() };
    }
  }
}

export async function scan(cutoff) {
  const out = [];
  for await (const { path, root } of scanFiles()) {
    const s = await safeStat(path);
    if (!s) continue;
    if (s.mtime < cutoff) {
      out.push({ path, kind: "file", lastWriteTime: s.mtime, size: s.size, root });
    }
  }
  return out;
}

export async function totalSize() {
  let total = 0;
  for await (const { path } of scanFiles()) {
    const s = await safeStat(path);
    if (s) total += s.size;
  }
  return total;
}

export async function ageRange() {
  let oldest = Infinity;
  let newest = 0;
  for await (const { path } of scanFiles()) {
    const s = await safeStat(path);
    if (!s) continue;
    if (s.mtime.getTime() < oldest) oldest = s.mtime.getTime();
    if (s.mtime.getTime() > newest) newest = s.mtime.getTime();
  }
  return {
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
    newest: newest ? new Date(newest) : undefined,
  };
}
