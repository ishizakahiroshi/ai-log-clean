/**
 * Cursor Agent session storage: ~/.cursor/chats/<hash>/<uuid>/
 *
 * No built-in retention. Two-level nesting — clean by session directory
 * (the inner <uuid>/), then prune any empty <hash>/ directories.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "cursor_agent";

export function chatsDir() { return join(homedir(), ".cursor", "chats"); }

export async function detected() {
  return existsSync(chatsDir());
}
export async function scan(_cutoff) { return []; }
export async function totalSize() { return 0; }
export async function ageRange() { return {}; }
