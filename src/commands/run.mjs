/**
 * `run` subcommand: execute one cleanup pass.
 * This is what the scheduler invokes daily. Also runnable interactively
 * with --dry-run for inspection.
 */

import { parseArgs } from "node:util";
import { loadConfig, effectiveRetentionDays, PROVIDERS } from "../config.mjs";
import { PROVIDER_REGISTRY } from "../providers/index.mjs";

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      delete: { type: "boolean", default: false },
      "retention-days": { type: "string" },
      provider: { type: "string" },
      "max-deletes": { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });

  const cfg = await loadConfig();
  if (values["retention-days"]) {
    cfg.defaults.retentionDays = Number.parseInt(String(values["retention-days"]), 10);
  }
  if (values.delete) {
    cfg.defaults.delete = true;
  }
  const onlyProvider = values.provider ? String(values.provider) : null;
  const dryRun = Boolean(values["dry-run"]);

  process.stdout.write(
    `ai-log-clean run (${dryRun ? "dry-run" : cfg.defaults.delete ? "delete" : "archive-only"})\n`,
  );
  process.stdout.write(
    `default retention: ${cfg.defaults.retentionDays}d\n\n`,
  );

  let worstExit = 0;
  let actedCount = 0;
  for (const provider of PROVIDERS) {
    if (onlyProvider && provider !== onlyProvider) continue;
    const enabled = cfg.providers[provider].enabled;
    const impl = PROVIDER_REGISTRY[provider];
    const isDetected = await impl.detected();

    if (!enabled) {
      process.stdout.write(`  ${provider.padEnd(14)}  skipped (disabled in config)\n`);
      continue;
    }
    if (!isDetected) {
      process.stdout.write(`  ${provider.padEnd(14)}  skipped (no session directory found)\n`);
      continue;
    }

    const days = effectiveRetentionDays(cfg, provider);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const candidates = await impl.scan(cutoff);
      process.stdout.write(
        `  ${provider.padEnd(14)}  retention=${days}d  candidates=${candidates.length}${
          dryRun ? "  (dry-run, no changes)" : ""
        }\n`,
      );
      actedCount++;
      // TODO: per-provider archive / delete with --max-deletes cap.
    } catch (err) {
      worstExit = 1;
      process.stderr.write(
        `  ${provider.padEnd(14)}  FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  if (actedCount === 0) {
    process.stdout.write(
      `\nNothing to do. No supported AI CLI session directories were found on this machine,\n` +
        `or every provider is disabled in config. Use 'ai-log-clean list' to inspect state.\n`,
    );
  } else {
    process.stdout.write(
      `\nDone. ${actedCount} provider(s) processed${dryRun ? " (dry-run, nothing changed)" : ""}.\n`,
    );
  }

  return worstExit;
}
