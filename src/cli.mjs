#!/usr/bin/env node
/**
 * ai-log-clean CLI entrypoint.
 *
 * Hand-rolled router: find the first non-option argument (the subcommand)
 * and pass everything else through to that subcommand's parser. The
 * top-level deliberately does NOT use parseArgs for subcommand option
 * parsing, because parseArgs would consume `--retention-days` etc. before
 * the subcommand sees them.
 */

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
  bunx github:ishizakahiroshi/ai-log-clean --dry-run --retention-days 30
  bunx github:ishizakahiroshi/ai-log-clean install --at 12:00 --retention-days 60
  bunx github:ishizakahiroshi/ai-log-clean list
  bunx github:ishizakahiroshi/ai-log-clean uninstall --purge

Documentation: https://github.com/ishizakahiroshi/ai-log-clean
`;

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write("ai-log-clean (development)\n");
    return 0;
  }

  // Find the first known subcommand name. Anything else (including stray
  // values like '30' after '--retention-days 30') passes through.
  const subIdx = argv.findIndex((a) =>
    Object.prototype.hasOwnProperty.call(SUBCOMMANDS, a),
  );

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

main(process.argv.slice(2)).then((code) => process.exit(code));
