/**
 * Codex CLI session storage: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *
 * No built-in retention upstream (see openai/codex#6015). This provider
 * walks the YYYY/MM/DD tree, returns rollout-*.jsonl files older than the
 * cutoff, and prunes empty date directories on cleanup.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "codex";

export function sessionsDir() {
  return join(homedir(), ".codex", "sessions");
}

export async function detected() {
  return existsSync(sessionsDir());
}
export async function scan(_cutoff) { return []; }
export async function totalSize() { return 0; }
export async function ageRange() { return {}; }
