/**
 * GitHub Copilot CLI session storage:
 *   ~/.copilot/logs/process-*.log         (per-file)
 *   ~/.copilot/session-state/<uuid>/      (per-session directory)
 *
 * No built-in retention. The two roots are walked separately because their
 * shapes differ (flat files vs. UUID directories).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { CleanupCandidate } from "./index.ts";

export const name = "copilot" as const;

export function logsDir(): string {
  return join(homedir(), ".copilot", "logs");
}
export function sessionStateDir(): string {
  return join(homedir(), ".copilot", "session-state");
}

export async function detected(): Promise<boolean> {
  return false;
}

export async function scan(_cutoff: Date): Promise<CleanupCandidate[]> {
  // TODO: combine files older than cutoff from logsDir() with session
  // directories under sessionStateDir() whose latest mtime predates cutoff.
  return [];
}

export async function totalSize(): Promise<number> {
  return 0;
}

export async function ageRange(): Promise<{ oldest?: Date; newest?: Date }> {
  return {};
}
