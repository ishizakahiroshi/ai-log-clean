/**
 * `uninstall` subcommand: stop the schedule and remove the OS registration.
 * `--purge` additionally removes ~/.ai-log-clean/ (config, quarantine, logs).
 */

import { parseArgs } from "node:util";
import { rm } from "node:fs/promises";
import { CONFIG_DIR } from "../config.mjs";
import { currentScheduler } from "../scheduler/index.mjs";

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      purge: { type: "boolean", default: false },
    },
    strict: false,
    allowPositionals: false,
  });

  const scheduler = currentScheduler();
  let schedulerError = null;
  try {
    await scheduler.uninstall();
  } catch (err) {
    // Don't let an unregistered (or unimplemented) scheduler block --purge.
    // A user purging a half-installed setup, or one that was never installed,
    // should still be able to wipe config + quarantine.
    schedulerError = err instanceof Error ? err.message : String(err);
  }

  if (values.purge) {
    await rm(CONFIG_DIR, { recursive: true, force: true });
    if (schedulerError) {
      process.stdout.write(
        `purged ${CONFIG_DIR} (scheduler uninstall reported: ${schedulerError})\n`,
      );
    } else {
      process.stdout.write(`uninstalled and purged ${CONFIG_DIR}\n`);
    }
    return 0;
  }

  if (schedulerError) {
    process.stderr.write(`scheduler uninstall failed: ${schedulerError}\n`);
    return 1;
  }
  process.stdout.write(`uninstalled (config preserved at ${CONFIG_DIR})\n`);
  return 0;
}
