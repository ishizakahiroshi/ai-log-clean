#!/usr/bin/env node
/**
 * ai-log-clean CLI entrypoint.
 *
 * Hand-rolled router: find the first non-option argument (the subcommand)
 * and pass everything else through to that subcommand's parser. The
 * top-level deliberately does NOT use parseArgs for subcommand option
 * parsing, because parseArgs would consume `--retention-days` etc. before
 * the subcommand sees them.
 *
 * Side-effect note: `main()` only runs when this file is the process entry
 * point. Importing helpers (e.g. `findSubcommandIndex`) from unit tests
 * must not invoke the router or call `process.exit`.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SUBCOMMANDS = {
  install: (rest) => import("./commands/install.mjs").then((m) => m.run(rest)),
  uninstall: (rest) => import("./commands/uninstall.mjs").then((m) => m.run(rest)),
  disable: (rest) => import("./commands/disable.mjs").then((m) => m.run(rest)),
  enable: (rest) => import("./commands/enable.mjs").then((m) => m.run(rest)),
  status: (rest) => import("./commands/status.mjs").then((m) => m.run(rest)),
  run: (rest) => import("./commands/run.mjs").then((m) => m.run(rest)),
  list: (rest) => import("./commands/list.mjs").then((m) => m.run(rest)),
  init: (rest) => import("./commands/init.mjs").then((m) => m.run(rest)),
  doctor: (rest) => import("./commands/doctor.mjs").then((m) => m.run(rest)),
  quarantine: (rest) => import("./commands/quarantine.mjs").then((m) => m.run(rest)),
};

const USAGE = `\
ai-log-clean — trim old AI CLI session logs across providers and platforms.

Usage:
  ai-log-clean <subcommand> [options]
  ai-log-clean --dry-run [options]        # shorthand for 'run --dry-run [options]'

Subcommands:
  install     Register a daily cleanup job on this OS
              --at HH:MM            time of day (default 12:00)
              --retention-days N    default 60
              --yes                 skip interactive prompts
  uninstall   Remove the schedule
              --purge               also remove ~/.ai-log-clean/ config + logs
  disable     Temporarily stop the schedule (keep config)
  enable      Resume the schedule
  status      Show schedule registration + last run summary
              --json                output one JSON object
  run         Run cleanup once (this is what the scheduler invokes)
              --dry-run             plan only, no changes
              --delete              actually delete (default is archive-only)
               --retention-days N    override per-run
               --budget SIZE         capacity limit (for example 2GB)
               --provider NAME       limit to one provider
               --max-deletes N       cap removals per run
               --json                output one JSON object (progress goes to stderr)
  list        Show current size + oldest file per provider
              --json                output one JSON object
  init        Write a config.toml template to ~/.ai-log-clean/
  doctor      Self-check Node, npx, schedule, config, providers
  quarantine  List or restore archived batches
              list                show quarantine dates / sizes
              prune [--dry-run]   remove expired quarantine batches
              restore <YYYY-MM-DD> [--provider NAME] [--dry-run] [--force]

Examples:
  bunx github:ishizakahiroshi/ai-log-clean --dry-run
  bunx github:ishizakahiroshi/ai-log-clean --dry-run --retention-days 30
  bunx github:ishizakahiroshi/ai-log-clean install --at 12:00 --retention-days 60
  bunx github:ishizakahiroshi/ai-log-clean list
  bunx github:ishizakahiroshi/ai-log-clean doctor
  bunx github:ishizakahiroshi/ai-log-clean quarantine list
  bunx github:ishizakahiroshi/ai-log-clean uninstall --purge

Documentation: https://github.com/ishizakahiroshi/ai-log-clean
`;

/**
 * Options that consume the next argv token as a value. Used so that a
 * value like `list` after `--provider list` is not mistaken for the
 * `list` subcommand (which used to hijack `ai-log-clean --provider list`
 * into the list command entirely).
 */
const OPTIONS_WITH_VALUE = new Set([
  "--at",
  "--retention-days",
  "--budget",
  "--provider",
  "--max-deletes",
]);

/**
 * Return the index of the first *positional* subcommand name, skipping
 * option flags and their values. Returns -1 when no subcommand is present
 * (caller treats that as the `run` shorthand).
 */
export function findSubcommandIndex(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") return -1;
    if (a.startsWith("-")) {
      // --key=value already includes its value
      if (a.includes("=")) continue;
      if (OPTIONS_WITH_VALUE.has(a)) {
        // skip the following value token when it is not another flag
        if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) i++;
      }
      continue;
    }
    // first positional argument
    if (Object.prototype.hasOwnProperty.call(SUBCOMMANDS, a)) {
      return i;
    }
    // unknown positional — not a subcommand
    return -1;
  }
  return -1;
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write("ai-log-clean (development)\n");
    return 0;
  }

  const subIdx = findSubcommandIndex(argv);

  if (subIdx === -1) {
    // No explicit subcommand. Treat as `run` shorthand if any flag is present;
    // otherwise show usage.
    if (argv.length === 0) {
      process.stdout.write(USAGE);
      return 0;
    }
    return SUBCOMMANDS.run(argv);
  }

  const sub = argv[subIdx];
  const rest = [...argv.slice(0, subIdx), ...argv.slice(subIdx + 1)];
  const handler = SUBCOMMANDS[sub];
  try {
    return await handler(rest);
  } catch (err) {
    process.stderr.write(
      `ai-log-clean ${sub} failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((code) => process.exit(code ?? 0));
}
