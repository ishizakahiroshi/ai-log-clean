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
  const retentionDays = Number.parseInt(String(values["retention-days"]), 10);
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    process.stderr.write(`--retention-days must be a positive integer\n`);
    return 2;
  }

  // TODO: Claude Code cleanupPeriodDays interactive bump (Y/N unless --yes).

  const scheduler = currentScheduler();
  await scheduler.install({
    at,
    retentionDays,
    delete: Boolean(values.delete),
    interactive: !values.yes,
  });

  process.stdout.write(`installed: daily at ${at}, retention=${retentionDays}d\n`);
  return 0;
}
