/**
 * Helpers for Claude Code's ~/.claude/settings.json.
 *
 * On `install`, if cleanupPeriodDays is shorter than the chosen retention,
 * we offer to bump it (Y/N unless --yes). We never rewrite unrelated keys.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";

export const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

/** Claude Code's built-in default when the key is absent. */
export const CLAUDE_DEFAULT_CLEANUP_DAYS = 30;

/**
 * @returns {Promise<{ path: string, exists: boolean, settings: object|null, cleanupPeriodDays: number|null }>}
 */
export async function readClaudeSettings(path = CLAUDE_SETTINGS_PATH) {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      settings: null,
      cleanupPeriodDays: null,
    };
  }
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(
      `cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`invalid settings.json shape in ${path}: expected object`);
  }
  const rawDays = settings.cleanupPeriodDays;
  let cleanupPeriodDays = null;
  if (typeof rawDays === "number" && Number.isFinite(rawDays)) {
    cleanupPeriodDays = rawDays;
  } else if (rawDays != null) {
    const n = Number(rawDays);
    if (Number.isFinite(n)) cleanupPeriodDays = n;
  }
  return { path, exists: true, settings, cleanupPeriodDays };
}

/**
 * Write settings back, preserving key order as best-effort via JSON.stringify.
 * Creates parent dir if needed.
 */
export async function writeClaudeSettings(settings, path = CLAUDE_SETTINGS_PATH) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify(settings, null, 2)}\n`;
  await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
}

/**
 * Effective cleanupPeriodDays for comparison: explicit value, or Claude's
 * default of 30 when the file exists but the key is missing. null when the
 * settings file itself is absent (Claude Code not configured here).
 */
export function effectiveCleanupDays(info) {
  if (!info.exists) return null;
  if (info.cleanupPeriodDays != null) return info.cleanupPeriodDays;
  return CLAUDE_DEFAULT_CLEANUP_DAYS;
}

/**
 * Decide whether a bump is needed and optionally apply it.
 *
 * @param {{ retentionDays: number, yes: boolean, ask?: (q: string) => Promise<string>, settingsPath?: string }} opts
 * @returns {Promise<{ action: 'updated'|'skipped'|'declined', from?: number, to?: number, reason?: string }>}
 */
export async function maybeBumpCleanupPeriodDays(opts) {
  const path = opts.settingsPath || CLAUDE_SETTINGS_PATH;
  const info = await readClaudeSettings(path);
  const current = effectiveCleanupDays(info);

  if (current == null) {
    return { action: "skipped", reason: "no-settings-file" };
  }
  if (current >= opts.retentionDays) {
    return {
      action: "skipped",
      reason: "already-sufficient",
      from: current,
      to: opts.retentionDays,
    };
  }

  let doUpdate = false;
  if (opts.yes) {
    doUpdate = true;
  } else if (typeof opts.ask === "function") {
    const answer = await opts.ask(
      `Claude Code cleanupPeriodDays is currently ${current}. ` +
        `Change it to ${opts.retentionDays} to match ai-log-clean retention? [y/N] `,
    );
    const a = String(answer || "").trim().toLowerCase();
    doUpdate = a === "y" || a === "yes";
    if (!doUpdate) {
      return { action: "declined", from: current, to: opts.retentionDays };
    }
  } else if (process.stdin.isTTY) {
    const answer = await promptYesNo(
      `Claude Code cleanupPeriodDays is currently ${current}. ` +
        `Change it to ${opts.retentionDays} to match ai-log-clean retention? [y/N] `,
    );
    doUpdate = answer;
    if (!doUpdate) {
      return { action: "declined", from: current, to: opts.retentionDays };
    }
  } else {
    return { action: "skipped", reason: "non-interactive-without-yes", from: current };
  }

  const base = info.settings && typeof info.settings === "object" ? { ...info.settings } : {};
  base.cleanupPeriodDays = opts.retentionDays;
  await writeClaudeSettings(base, path);
  return { action: "updated", from: current, to: opts.retentionDays };
}

function promptYesNo(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = String(answer || "").trim().toLowerCase();
      resolve(a === "y" || a === "yes");
    });
  });
}
