/**
 * Codex CLI session storage: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * No built-in retention upstream (see openai/codex#6015). This provider
 * walks the YYYY/MM/DD tree, returns rollout-*.jsonl files older than the
 * cutoff, and prunes empty date directories on cleanup.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { CleanupCandidate } from "./index.ts";

export const name = "codex" as const;

export function sessionsDir(): string {
  return join(homedir(), ".codex", "sessions");
}

export async function detected(): Promise<boolean> {
  // TODO
  return false;
}

export async function scan(_cutoff: Date): Promise<CleanupCandidate[]> {
  // TODO: rglob rollout-*.jsonl under sessionsDir(), filter by mtime.
  return [];
}

export async function totalSize(): Promise<number> {
  return 0;
}

export async function ageRange(): Promise<{ oldest?: Date; newest?: Date }> {
  return {};
}
