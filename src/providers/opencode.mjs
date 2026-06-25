/**
 * opencode session storage (XDG-aware):
 *   $XDG_DATA_HOME/opencode/log/*.log
 *   $XDG_DATA_HOME/opencode/storage/session_diff/*.json
 *
 * XDG_DATA_HOME resolution per OS:
 *   Linux   -> $XDG_DATA_HOME or ~/.local/share
 *   macOS   -> ~/Library/Application Support
 *   Windows -> %APPDATA% (with %LOCALAPPDATA% and ~/.local/share fallbacks
 *              for users who installed via WSL / scoop / bun).
 */

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export const name = "opencode";

export function candidateRoots() {
  const roots = [];
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) roots.push(join(xdg, "opencode"));
  switch (platform()) {
    case "win32":
      if (process.env.APPDATA) roots.push(join(process.env.APPDATA, "opencode"));
      if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, "opencode"));
      roots.push(join(homedir(), ".local", "share", "opencode")); // WSL / Git Bash users
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
export async function scan(_cutoff) { return []; }
export async function totalSize() { return 0; }
export async function ageRange() { return {}; }
