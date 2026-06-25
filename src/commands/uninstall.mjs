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
  await scheduler.uninstall();

  if (values.purge) {
    await rm(CONFIG_DIR, { recursive: true, force: true });
    process.stdout.write(`uninstalled and purged ${CONFIG_DIR}\n`);
  } else {
    process.stdout.write(`uninstalled (config preserved at ${CONFIG_DIR})\n`);
  }
  return 0;
}
