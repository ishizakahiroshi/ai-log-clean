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

export const name = "copilot";

export function logsDir() { return join(homedir(), ".copilot", "logs"); }
export function sessionStateDir() { return join(homedir(), ".copilot", "session-state"); }

export async function detected() { return false; }
export async function scan(_cutoff) { return []; }
export async function totalSize() { return 0; }
export async function ageRange() { return {}; }
