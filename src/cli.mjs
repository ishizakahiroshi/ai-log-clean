#!/usr/bin/env node
/**
 * ai-log-clean CLI entrypoint.
 *
 * Subcommand router. Each subcommand is a thin shell over a module in this
 * directory. Stubs here keep the surface honest while the actual provider /
 * scheduler logic is being filled in.
 */

import { parseArgs } from "node:util";

const SUBCOMMANDS = {
  install: (rest) => import("./commands/install.mjs").then((m) => m.run(rest)),
  uninstall: (rest) => import("./commands/uninstall.mjs").then((m) => m.run(rest)),
  disable: (rest) => import("./commands/disable.mjs").then((m) => m.run(rest)),
  enable: (rest) => import("./commands/enable.mjs").then((m) => m.run(rest)),
  status: (rest) => import("./commands/status.mjs").then((m) => m.run(rest)),
  run: (rest) => import("./commands/run.mjs").then((m) => m.run(rest)),
  list: (rest) => import("./commands/list.mjs").then((m) => m.run(rest)),
  init: (rest) => import("./commands/init.mjs").then((m) => m.run(rest)),
};

const USAGE = `\
ai-log-clean — trim old AI CLI session logs across providers and platforms.

Usage:
  ai-log-clean <subcommand> [options]
  ai-log-clean --dry-run                  # shorthand for 'run --dry-run'

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
  run         Run cleanup once (this is what the scheduler invokes)
              --dry-run             plan only, no changes
              --delete              actually delete (default is archive-only)
              --retention-days N    override per-run
              --provider NAME       limit to one provider
              --max-deletes N       cap removals per run
  list        Show current size + oldest file per provider
  init        Write a config.toml template to ~/.ai-log-clean/

Examples:
  bunx github:ishizakahiroshi/ai-log-clean --dry-run
  bunx github:ishizakahiroshi/ai-log-clean install --at 12:00 --retention-days 60
  bunx github:ishizakahiroshi/ai-log-clean status
  bunx github:ishizakahiroshi/ai-log-clean uninstall --purge

Documentation: https://github.com/ishizakahiroshi/ai-log-clean
`;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "dry-run": { type: "boolean" },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write("ai-log-clean (development)\n");
    return 0;
  }

  if (positionals.length === 0) {
    if (values["dry-run"]) {
      return SUBCOMMANDS.run(["--dry-run"]);
    }
    process.stdout.write(USAGE);
    return 0;
  }

  const [sub, ...rest] = positionals;
  const handler = SUBCOMMANDS[sub];
  if (!handler) {
    process.stderr.write(`Unknown subcommand: ${sub}\n\n`);
    process.stderr.write(USAGE);
    return 2;
  }
  try {
    return await handler(rest);
  } catch (err) {
    process.stderr.write(
      `ai-log-clean ${sub} failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
