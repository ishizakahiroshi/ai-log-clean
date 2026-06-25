/**
 * `run` subcommand: execute one cleanup pass.
 * This is what the scheduler invokes daily. Also runnable interactively
 * with --dry-run for inspection.
 *
 * Cleanup modes:
 *   - default: archive (move to ~/.ai-log-clean/quarantine/<YYYY-MM-DD>/<provider>/...)
 *   - --delete: delete in place
 *   - --dry-run: report only, change nothing
 *
 * Safety knobs:
 *   - --max-deletes N caps the number of items acted on this pass.
 *   - Quarantine entries older than 30 days are removed at the start of
 *     each run (only when not --dry-run).
 */

import { parseArgs } from "node:util";
import { readdir, stat } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  loadConfig,
  effectiveRetentionDays,
  PROVIDERS,
  QUARANTINE_DIR,
  CONFIG_DIR,
} from "../config.mjs";
import { PROVIDER_REGISTRY } from "../providers/index.mjs";
import {
  moveToQuarantine,
  removePath,
  formatSize,
  todayStamp,
} from "../utils/fs.mjs";

const QUARANTINE_RETENTION_DAYS = 30;

async function pruneQuarantine() {
  if (!existsSync(QUARANTINE_DIR)) return 0;
  const cutoff = Date.now() - QUARANTINE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  let entries;
  try {
    entries = await readdir(QUARANTINE_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = join(QUARANTINE_DIR, e.name);
    try {
      const s = await stat(full);
      if (s.mtimeMs < cutoff) {
        await removePath(full);
        removed++;
      }
    } catch {
      // ignore
    }
  }
  return removed;
}

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
  const maxDeletes = values["max-deletes"]
    ? Number.parseInt(String(values["max-deletes"]), 10)
    : Infinity;
  const onlyProvider = values.provider ? String(values.provider) : null;
  const dryRun = Boolean(values["dry-run"]);
  const deleteMode = cfg.defaults.delete;

  process.stdout.write(
    `ai-log-clean run (${dryRun ? "dry-run" : deleteMode ? "delete" : "archive-only"})\n`,
  );
  process.stdout.write(`default retention: ${cfg.defaults.retentionDays}d\n`);
  if (Number.isFinite(maxDeletes)) {
    process.stdout.write(`max items this run: ${maxDeletes}\n`);
  }
  process.stdout.write("\n");

  if (!dryRun) {
    await mkdir(CONFIG_DIR, { recursive: true });
    const purged = await pruneQuarantine();
    if (purged > 0) {
      process.stdout.write(`  (pruned ${purged} expired quarantine batch(es))\n\n`);
    }
  }

  const today = todayStamp();
  let worstExit = 0;
  let actedProviders = 0;
  let totalActed = 0;
  let totalSize = 0;
  let remainingBudget = maxDeletes;

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
      const candidateSize = candidates.reduce((a, c) => a + c.size, 0);
      let acted = 0;
      let bytesActed = 0;

      if (!dryRun) {
        for (const c of candidates) {
          if (remainingBudget <= 0) break;
          try {
            if (deleteMode) {
              await removePath(c.path);
            } else {
              await moveToQuarantine({
                source: c.path,
                sourceRoot: c.root,
                provider,
                quarantineRoot: QUARANTINE_DIR,
                today,
              });
            }
            acted++;
            bytesActed += c.size;
            remainingBudget--;
          } catch (err) {
            process.stderr.write(
              `    ${provider}: ${c.path} — ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
      }

      const verb = dryRun ? "would" : deleteMode ? "deleted" : "archived";
      const reportCount = dryRun ? candidates.length : acted;
      const reportSize = dryRun ? candidateSize : bytesActed;
      process.stdout.write(
        `  ${provider.padEnd(14)}  retention=${days}d  candidates=${candidates.length}  ${verb}=${reportCount}  size=${formatSize(reportSize)}\n`,
      );
      if (!dryRun && acted > 0) actedProviders++;
      totalActed += dryRun ? candidates.length : acted;
      totalSize += dryRun ? candidateSize : bytesActed;
    } catch (err) {
      worstExit = 1;
      process.stderr.write(
        `  ${provider.padEnd(14)}  FAILED: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  process.stdout.write("\n");
  if (totalActed === 0) {
    process.stdout.write(
      `Nothing to do. No files older than the configured retention were found.\n`,
    );
  } else if (dryRun) {
    process.stdout.write(
      `${totalActed} item(s) (${formatSize(totalSize)}) would be ${deleteMode ? "deleted" : "archived"}. Re-run without --dry-run to apply.\n`,
    );
  } else {
    const dest = deleteMode ? "deleted" : `archived to ${join(QUARANTINE_DIR, today)}`;
    process.stdout.write(
      `${totalActed} item(s) (${formatSize(totalSize)}) ${dest}. ${actedProviders} provider(s) acted.\n`,
    );
  }

  return worstExit;
}
