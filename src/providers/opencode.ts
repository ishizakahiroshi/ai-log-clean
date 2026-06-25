/**
 * opencode session storage (XDG-aware):
 *   $XDG_DATA_HOME/opencode/log/*.log
 *   $XDG_DATA_HOME/opencode/storage/session_diff/*.json
 *
 * XDG_DATA_HOME resolution per OS:
 *   Linux   -> $XDG_DATA_HOME or ~/.local/share
 *   macOS   -> ~/Library/Application Support
 *   Windows -> %APPDATA%
 */

import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { CleanupCandidate } from "./index.ts";

export const name = "opencode" as const;

export function dataRoot(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "opencode");
  switch (platform()) {
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "opencode");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "opencode");
    default:
      return join(homedir(), ".local", "share", "opencode");
  }
}

export function logDir(): string {
  return join(dataRoot(), "log");
}
export function sessionDiffDir(): string {
  return join(dataRoot(), "storage", "session_diff");
}

export async function detected(): Promise<boolean> {
  return false;
}

export async function scan(_cutoff: Date): Promise<CleanupCandidate[]> {
  // TODO
  return [];
}

export async function totalSize(): Promise<number> {
  return 0;
}

export async function ageRange(): Promise<{ oldest?: Date; newest?: Date }> {
  return {};
}
