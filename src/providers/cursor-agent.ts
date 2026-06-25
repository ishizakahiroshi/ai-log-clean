/**
 * Cursor Agent session storage: ~/.cursor/chats/<hash>/<uuid>/
 *
 * No built-in retention. Two-level nesting — clean by session directory
 * (the inner <uuid>/), then prune any empty <hash>/ directories.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { CleanupCandidate } from "./index.ts";

export const name = "cursor_agent" as const;

export function chatsDir(): string {
  return join(homedir(), ".cursor", "chats");
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
