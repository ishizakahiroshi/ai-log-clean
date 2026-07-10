/**
 * `install` subcommand: register a daily user-scope scheduled job.
 *
 * Defaults: --at 12:00, --retention-days 60, archive-only (no --delete).
 * Idempotency: re-running `install` always replaces any existing registration
 * without prompting.
 *
 * For Claude Code, prompts to bump ~/.claude/settings.json `cleanupPeriodDays`
 * if it is shorter than the chosen retention (unless --yes).
 */

import { parseArgs } from "node:util";
import { currentScheduler } from "../scheduler/index.mjs";
import { maybeBumpCleanupPeriodDays } from "../providers/claude-code-settings.mjs";

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      at: { type: "string", default: "12:00" },
      "retention-days": { type: "string", default: "60" },
      yes: { type: "boolean", default: false },
      delete: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: false,
  });

  const at = String(values.at);
  if (!isValidAt(at)) {
    process.stderr.write(`--at must be HH:MM in 24h clock (got ${JSON.stringify(at)})\n`);
    return 2;
  }
  const retentionDays = Number.parseInt(String(values["retention-days"]), 10);
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    process.stderr.write(`--retention-days must be a positive integer\n`);
    return 2;
  }

  // Claude Code settings bump (before scheduler so a declined/failed bump
  // still leaves a consistent message order; scheduler is the heavier step).
  try {
    const bump = await maybeBumpCleanupPeriodDays({
      retentionDays,
      yes: Boolean(values.yes),
    });
    if (bump.action === "updated") {
      process.stdout.write(
        `claude: cleanupPeriodDays ${bump.from} → ${bump.to} (wrote ~/.claude/settings.json)\n`,
      );
    } else if (bump.action === "declined") {
      process.stdout.write(
        `claude: left cleanupPeriodDays=${bump.from} (declined bump to ${bump.to})\n`,
      );
    } else if (bump.reason === "non-interactive-without-yes") {
      process.stdout.write(
        `claude: cleanupPeriodDays=${bump.from} is shorter than retention=${retentionDays}; re-run with --yes to bump, or edit ~/.claude/settings.json\n`,
      );
    }
    // already-sufficient / no-settings-file: silent
  } catch (err) {
    process.stderr.write(
      `claude: could not update settings.json — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    // Non-fatal: continue to scheduler install
  }

  const scheduler = currentScheduler();
  await scheduler.install({
    at: normalizeAt(at),
    retentionDays,
    delete: Boolean(values.delete),
    interactive: !values.yes,
  });

  process.stdout.write(
    formatInstallSuccess({
      at: normalizeAt(at),
      retentionDays,
      deleteMode: Boolean(values.delete),
    }),
  );
  return 0;
}

/**
 * Success-only install guide (P4). Not printed on validation or scheduler failure.
 *
 * @param {{ at: string, retentionDays: number, deleteMode?: boolean }} opts
 * @returns {string}
 */
export function formatInstallSuccess({ at, retentionDays, deleteMode = false }) {
  const mode = deleteMode ? "delete" : "archive (not delete)";
  const run = "npx -y github:ishizakahiroshi/ai-log-clean";
  return [
    `Installed  daily at ${at} · retention ${retentionDays}d · ${mode}`,
    ``,
    `  status   ${run} status`,
    `  try now  ${run} --dry-run`,
    `  pause    ${run} disable`,
    ``,
    `Config  ~/.ai-log-clean/config.toml`,
    `Safe    no admin · user-scope task · default = archive only`,
    ``,
  ].join("\n");
}

/** Accept "H:MM" or "HH:MM" with hour 0-23 and minute 0-59. */
export function isValidAt(at) {
  const m = String(at).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/** Canonical "HH:MM" form for scheduler registration. */
export function normalizeAt(at) {
  const m = String(at).match(/^(\d{1,2}):(\d{2})$/);
  const hh = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
