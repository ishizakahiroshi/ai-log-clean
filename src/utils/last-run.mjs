/**
 * Last real cleanup run summary (one file, overwrite).
 *
 * Path (parent plan D2): ~/.ai-log-clean/logs/last-run.json
 * I/O is best-effort: failures never throw into the cleanup path.
 *
 * Shape:
 *   {
 *     "finishedAt": "ISO-8601",
 *     "exitCode": 0,
 *     "dryRun": false,
 *     "mode": "archive" | "delete",
 *     "totals": { "files": 0, "bytes": 0, "capped"?: true },
 *     "byProvider": {
 *       "codex": { "files": 0, "bytes": 0, "action": "archive" }
 *     }
 *   }
 */

import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { CONFIG_DIR } from "../config.mjs";

/** Default absolute path for last-run.json. */
export function defaultLastRunPath() {
  return join(CONFIG_DIR, "logs", "last-run.json");
}

export function defaultHistoryPath() {
  return join(CONFIG_DIR, "logs", "history.jsonl");
}

/**
 * Read last-run summary. Missing file / bad JSON / non-object → null.
 * Never throws.
 * @param {{ path?: string }} [opts]
 * @returns {Promise<object|null>}
 */
export async function readLastRun(opts = {}) {
  const path = opts.path ?? defaultLastRunPath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write last-run summary (mkdir -p parent). Failures are swallowed.
 * @param {object} summary
 * @param {{ path?: string }} [opts]
 */
export async function writeLastRun(summary, opts = {}) {
  const path = opts.path ?? defaultLastRunPath();
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const body = JSON.stringify(summary, null, 2) + "\n";
    await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
  } catch {
    // best-effort: do not fail the cleanup run
  }
}

/** Append one real-run summary. I/O failures are intentionally ignored. */
export async function appendHistory(summary, opts = {}) {
  const path = opts.path ?? defaultHistoryPath();
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, JSON.stringify(summary) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch {
    // best-effort: do not fail the cleanup run
  }
}

/** Read the newest valid history entries first. */
export async function readHistory(opts = {}) {
  const path = opts.path ?? defaultHistoryPath();
  const limit = Number.isSafeInteger(opts.limit) && opts.limit > 0 ? opts.limit : 14;
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const entries = [];
    let position = size;
    let remainder = "";
    while (position > 0 && entries.length < limit) {
      const length = Math.min(64 * 1024, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, position);
      const lines = (buffer.toString("utf8") + remainder).split(/\r?\n/);
      remainder = lines.shift() ?? "";
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        const value = parseHistoryLine(lines[i]);
        if (value) entries.push(value);
      }
    }
    if (position === 0 && entries.length < limit) {
      const value = parseHistoryLine(remainder);
      if (value) entries.push(value);
    }
    return entries;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseHistoryLine(line) {
  if (!line) return null;
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
