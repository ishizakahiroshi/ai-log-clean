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
import { mkdir } from "node:fs/promises";
import { basename, relative } from "node:path";

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
import { formatProviderError } from "../utils/errors.mjs";
import { printDivider, isPrettyStdout } from "../utils/output.mjs";
import { writeLastRun } from "../utils/last-run.mjs";
import { appendHistory } from "../utils/last-run.mjs";
import { QUARANTINE_RETENTION_DAYS, pruneQuarantine } from "../utils/quarantine.mjs";
import {
  budgetCandidateKey,
  parseByteSize,
  selectBudgetCandidates,
} from "../utils/budget.mjs";

/**
 * Drop candidates whose path (relative to their source root) matches an
 * entry in the provider's `exclude_files` list. Matching is by exact
 * relative path with `\` normalized to `/`, so config stays portable.
 */
export function applyExcludeFiles(candidates, excludeFiles) {
  if (!excludeFiles || excludeFiles.length === 0) return candidates;
  const excluded = new Set(excludeFiles.map((e) => String(e).replace(/\\/g, "/")));
  return candidates.filter((c) => {
    const rel = relative(c.root, c.path).replace(/\\/g, "/");
    return !excluded.has(rel);
  });
}

/**
 * Cross-provider end-of-run summary (testable pure string).
 *
 * @param {{
 *   byProvider: Record<string, { files: number, bytes: number, action: string }>,
 *   dryRun: boolean,
 *   deleteMode: boolean,
 *   maxDeletes: number,
 *   capped?: boolean,
 *   budget?: { budgetBytes: number, totalBytes: number, afterBytes: number },
 *   pretty?: boolean,
 * }} opts
 * @returns {string}
 */
export function formatRunReport({
  byProvider,
  dryRun,
  deleteMode,
  maxDeletes,
  capped = false,
  budget = null,
  pretty = false,
}) {
  const entries = Object.entries(byProvider || {}).filter(
    ([, v]) => v && (v.files > 0 || v.bytes > 0),
  );
  let totalFiles = 0;
  let totalBytes = 0;
  for (const [, v] of entries) {
    totalFiles += Number(v.files) || 0;
    totalBytes += Number(v.bytes) || 0;
  }

  const chunks = [];
  const pushDivider = (label) => {
    let captured = "";
    printDivider(label, {
      pretty,
      write: (s) => {
        captured += s;
      },
    });
    chunks.push(captured);
  };

  pushDivider("Plan");
  if (entries.length === 0) {
    chunks.push("  (no candidates)\n");
  } else {
    for (const [name, v] of entries) {
      const action = String(v.action || (deleteMode ? "delete" : "archive")).padEnd(9);
      const files = `${Number(v.files) || 0} files`.padStart(12);
      const size = formatSize(Number(v.bytes) || 0).padStart(10);
      chunks.push(`  ${name.padEnd(14)}  ${action}  ${files}  ${size}\n`);
    }
  }
  pushDivider();

  if (totalFiles === 0 && totalBytes === 0) {
    chunks.push("  Nothing to free.\n");
  } else if (dryRun) {
    const dest = deleteMode ? "delete in place" : "archive → quarantine";
    chunks.push(`  Would free ~${formatSize(totalBytes)}  (${dest})\n`);
  } else if (deleteMode) {
    chunks.push(`  Freed ${formatSize(totalBytes)} · deleted in place\n`);
  } else {
    chunks.push(
      `  Freed ${formatSize(totalBytes)} · quarantine kept ~${QUARANTINE_RETENTION_DAYS}d\n`,
    );
  }

  const maxLabel = Number.isFinite(maxDeletes) ? String(maxDeletes) : "∞";
  let modeLine = `  mode: ${dryRun ? "dry-run" : "run"} · delete=${deleteMode ? "true" : "false"} · max-deletes=${maxLabel}`;
  if (capped) modeLine += " · capped";
  chunks.push(`${modeLine}\n`);

  if (budget) {
    const verb = dryRun ? "would free" : "freed";
    chunks.push(
      `  budget: ${formatSize(budget.budgetBytes)} · now ${formatSize(budget.totalBytes)} · ${verb} ${formatSize(totalBytes)} · after ~${formatSize(budget.afterBytes)}\n`,
    );
    chunks.push("  budget scope: enabled + detected providers only\n");
  }

  if (dryRun) {
    chunks.push("\nNo files touched.\n");
  }

  return chunks.join("");
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      delete: { type: "boolean", default: false },
      "retention-days": { type: "string" },
      budget: { type: "string" },
      json: { type: "boolean", default: false },
      provider: { type: "string" },
      "max-deletes": { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });

  const cfg = await loadConfig();
  if (values["retention-days"]) {
    const n = Number.parseInt(String(values["retention-days"]), 10);
    if (!Number.isFinite(n) || n < 1) {
      process.stderr.write(`--retention-days must be a positive integer\n`);
      return 2;
    }
    cfg.defaults.retentionDays = n;
  }
  if (values.budget !== undefined) {
    try {
      cfg.defaults.budgetBytes = parseByteSize(values.budget);
    } catch (err) {
      process.stderr.write(`--budget: ${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  if (values.delete) {
    cfg.defaults.delete = true;
  }
  let maxDeletes = Infinity;
  if (values["max-deletes"]) {
    const n = Number.parseInt(String(values["max-deletes"]), 10);
    if (!Number.isFinite(n) || n < 0) {
      process.stderr.write(`--max-deletes must be a non-negative integer\n`);
      return 2;
    }
    maxDeletes = n;
  }
  const onlyProvider = values.provider ? String(values.provider) : null;
  if (onlyProvider && !PROVIDERS.includes(onlyProvider)) {
    process.stderr.write(
      `--provider must be one of: ${PROVIDERS.join(", ")} (got ${JSON.stringify(onlyProvider)})\n`,
    );
    return 2;
  }
  const dryRun = Boolean(values["dry-run"]);
  const deleteMode = cfg.defaults.delete;
  const json = Boolean(values.json);
  const writeProgress = (text) => (json ? process.stderr : process.stdout).write(text);

  writeProgress(
    `ai-log-clean run (${dryRun ? "dry-run" : deleteMode ? "delete" : "archive-only"})\n`,
  );
  writeProgress(`default retention: ${cfg.defaults.retentionDays}d\n`);
  if (cfg.defaults.budgetBytes !== null) {
    writeProgress(`capacity budget: ${formatSize(cfg.defaults.budgetBytes)}\n`);
  }
  if (Number.isFinite(maxDeletes)) {
    writeProgress(`max items this run: ${maxDeletes}\n`);
  }
  writeProgress("\n");

  let worstExit = 0;

  if (!dryRun) {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const { removed: purged, failed: pruneFailed } = await pruneQuarantine({
      quarantineRoot: QUARANTINE_DIR,
    });
    if (purged > 0) {
      writeProgress(`  (pruned ${purged} expired quarantine batch(es))\n\n`);
    }
    if (pruneFailed > 0) {
      worstExit = 1;
    }
  }

  const today = todayStamp();
  let remainingBudget = maxDeletes;
  /** @type {Record<string, { files: number, bytes: number, action: string }>} */
  const byProvider = {};
  let capped = false;

  const scannedProviders = [];
  const budgetEnabled = cfg.defaults.budgetBytes !== null;

  for (const provider of PROVIDERS) {
    if (onlyProvider && provider !== onlyProvider) continue;
    const enabled = cfg.providers[provider].enabled;
    const impl = PROVIDER_REGISTRY[provider];
    const isDetected = await impl.detected();

    if (!enabled) {
      writeProgress(`  ${provider.padEnd(14)}  skipped (disabled in config)\n`);
      continue;
    }
    if (!isDetected) {
      writeProgress(`  ${provider.padEnd(14)}  skipped (no session directory found)\n`);
      continue;
    }

    const days = effectiveRetentionDays(cfg, provider);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const rawCandidates = await impl.scan(
        budgetEnabled ? new Date(8_640_000_000_000_000) : cutoff,
      );
      const allCandidates = applyExcludeFiles(
        rawCandidates,
        cfg.providers[provider].excludeFiles,
      );
      const retentionCandidates = budgetEnabled
        ? allCandidates.filter((candidate) => candidate.lastWriteTime < cutoff)
        : allCandidates;
      scannedProviders.push({ provider, days, allCandidates, retentionCandidates });
    } catch (err) {
      worstExit = 1;
      process.stderr.write(
        formatProviderError({
          provider,
          err,
          othersContinued: !onlyProvider,
        }),
      );
    }
  }

  const allBudgetCandidates = scannedProviders.flatMap(({ provider, allCandidates }) =>
    allCandidates.map((candidate) => ({ provider, candidate })),
  );
  const retentionKeys = new Set(
    scannedProviders.flatMap(({ provider, retentionCandidates }) =>
      retentionCandidates.map((candidate) => budgetCandidateKey(provider, candidate)),
    ),
  );
  const budgetSelection = selectBudgetCandidates(
    allBudgetCandidates,
    retentionKeys,
    cfg.defaults.budgetBytes,
  );

  for (const { provider, days, allCandidates, retentionCandidates } of scannedProviders) {
    const candidates = budgetEnabled
      ? allCandidates.filter((candidate) =>
          budgetSelection.selectedKeys.has(budgetCandidateKey(provider, candidate)),
        )
      : retentionCandidates;
    const budgetExtra = budgetEnabled
      ? candidates.filter((candidate) =>
          budgetSelection.addedKeys.has(budgetCandidateKey(provider, candidate)),
        ).length
      : 0;
    const candidateSize = candidates.reduce((a, c) => a + c.size, 0);
      let acted = 0;
      let bytesActed = 0;

      if (!dryRun) {
        for (const c of candidates) {
          if (remainingBudget <= 0) {
            if (candidates.length > acted) capped = true;
            break;
          }
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
            // Per-item failure must surface as a non-zero exit so a
            // scheduled run does not look "clean" when it silently
            // skipped half the candidates (e.g. permission / EXDEV).
            worstExit = 1;
            // Mask the full path: log only the basename + kind so a captured
            // stderr does not leak the absolute project / session layout.
            // Prefer err.message only when it has no absolute-looking path
            // fragments; otherwise fall back to err.code / a short label.
            const msg = sanitizeErrorMessage(err);
            process.stderr.write(
              `    ${provider}: ${c.kind} ${basename(c.path)} — ${msg}\n`,
            );
          }
        }
      } else if (Number.isFinite(maxDeletes) && candidates.length > maxDeletes) {
        // dry-run still reports full candidate set; flag cap intent for mode line
        capped = true;
      }

      const action = deleteMode ? "delete" : "archive";
      const reportCount = dryRun ? candidates.length : acted;
      const reportSize = dryRun ? candidateSize : bytesActed;
      const verb = dryRun ? "would" : deleteMode ? "deleted" : "archived";
      writeProgress(
        `  ${provider.padEnd(14)}  retention=${days}d  candidates=${candidates.length}${budgetExtra > 0 ? `  budget-extra=${budgetExtra}` : ""}  ${verb}=${reportCount}  size=${formatSize(reportSize)}\n`,
      );

      if (reportCount > 0 || reportSize > 0) {
        byProvider[provider] = {
          files: reportCount,
          bytes: reportSize,
          action: dryRun ? (deleteMode ? "would-delete" : "would-archive") : action,
        };
      }
  }

  const totalBytesForReport = Object.values(byProvider).reduce(
    (sum, value) => sum + value.bytes,
    0,
  );
  const budgetReport = budgetEnabled
    ? {
        budgetBytes: cfg.defaults.budgetBytes,
        totalBytes: budgetSelection.totalBytes,
        afterBytes: Math.max(0, budgetSelection.totalBytes - totalBytesForReport),
      }
    : null;
  if (json) {
    const totalFiles = Object.values(byProvider).reduce((sum, value) => sum + value.files, 0);
    process.stdout.write(
      JSON.stringify({
        dry_run: dryRun,
        mode: deleteMode ? "delete" : "archive",
        exit_code: worstExit,
        totals: { files: totalFiles, bytes: totalBytesForReport, capped },
        providers: Object.entries(byProvider).map(([name, value]) => ({
          name,
          files: value.files,
          bytes: value.bytes,
          action: value.action,
        })),
        would_free_bytes: dryRun ? totalBytesForReport : undefined,
        budget: budgetReport && {
          budget_bytes: budgetReport.budgetBytes,
          total_bytes: budgetReport.totalBytes,
          after_bytes: budgetReport.afterBytes,
        },
      }) + "\n",
    );
  } else {
    process.stdout.write("\n");
    process.stdout.write(
      formatRunReport({
        byProvider,
        dryRun,
        deleteMode,
        maxDeletes,
        capped,
        budget: budgetReport,
        pretty: isPrettyStdout(),
      }),
    );
  }

  if (!dryRun) {
    let totalFiles = 0;
    let totalBytes = 0;
    const lastByProvider = {};
    for (const [name, v] of Object.entries(byProvider)) {
      totalFiles += v.files;
      totalBytes += v.bytes;
      lastByProvider[name] = {
        files: v.files,
        bytes: v.bytes,
        action: v.action,
      };
    }
    const totals = { files: totalFiles, bytes: totalBytes };
    if (capped) totals.capped = true;
    if (budgetEnabled) {
      totals.budgetBytes = cfg.defaults.budgetBytes;
      totals.afterBytes = Math.max(0, budgetSelection.totalBytes - totalBytes);
    }
    const summary = {
      finishedAt: new Date().toISOString(),
      exitCode: worstExit,
      dryRun: false,
      mode: deleteMode ? "delete" : "archive",
      totals,
      byProvider: lastByProvider,
    };
    await writeLastRun(summary);
    await appendHistory(summary);
  }

  return worstExit;
}

/**
 * Strip absolute-path-looking segments from an error message so scheduler
 * logs do not reveal home-directory layout. Keeps short codes / reasons.
 */
function sanitizeErrorMessage(err) {
  if (!(err instanceof Error)) return String(err);
  // Prefer Node's errno code when present (EPERM, EXDEV, ENOENT, ...).
  if (err.code && typeof err.code === "string") {
    return err.code + (err.message && !looksLikeAbsPath(err.message) ? `: ${err.message}` : "");
  }
  if (looksLikeAbsPath(err.message)) return "operation failed";
  return err.message || "operation failed";
}

function looksLikeAbsPath(s) {
  if (!s) return false;
  // Windows drive letter, UNC, or POSIX absolute home/root paths.
  return /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|var|tmp|private)\b)/.test(s);
}
