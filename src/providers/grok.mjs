/**
 * Grok CLI session storage: ~/.grok/sessions/<encoded>/<uuid>/
 *
 * ~/.grok/logs/unified.jsonl is append-only and is EXCLUDED from cleanup
 * (partial deletion would corrupt the journal). Configured via
 * providers.grok.exclude_files in config.toml.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const name = "grok";

export function sessionsDir() { return join(homedir(), ".grok", "sessions"); }

export async function detected() { return false; }
export async function scan(_cutoff) { return []; }
export async function totalSize() { return 0; }
export async function ageRange() { return {}; }
