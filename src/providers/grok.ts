/**
 * Grok CLI session storage: ~/.grok/sessions/<encoded>/<uuid>/
 *
 * ~/.grok/logs/unified.jsonl is append-only and is EXCLUDED from cleanup
 * (partial deletion would corrupt the journal). Configured via
 * providers.grok.exclude_files in config.toml.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { CleanupCandidate } from "./index.ts";

export const name = "grok" as const;

export function sessionsDir(): string {
  return join(homedir(), ".grok", "sessions");
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
