/**
 * `quarantine` subcommand: list archived batches and restore them.
 *
 * Layout (written by moveToQuarantine):
 *   ~/.ai-log-clean/quarantine/<YYYY-MM-DD>/<provider>/<rel under sourceRoot>
 *
 * restore moves files back to each provider's source root. Absolute original
 * paths are not stored; destination is join(providerSourceRoot, rel).
 * Collisions are skipped unless restore is explicitly given --force.
 */

import { parseArgs } from "node:util";
import { readdir, stat, mkdir, rename, rm, rmdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, dirname, basename, isAbsolute } from "node:path";

import { QUARANTINE_DIR, PROVIDERS } from "../config.mjs";
import { walkFiles, formatSize } from "../utils/fs.mjs";
import {
  QUARANTINE_RETENTION_DAYS,
  pruneQuarantine,
  quarantineExpiresInDays,
} from "../utils/quarantine.mjs";

import * as claudeCode from "../providers/claude-code.mjs";
import * as codex from "../providers/codex.mjs";
import * as copilot from "../providers/copilot.mjs";
import * as cursorAgent from "../providers/cursor-agent.mjs";
import * as opencode from "../providers/opencode.mjs";
import * as grok from "../providers/grok.mjs";
import * as antigravity from "../providers/antigravity.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const USAGE = `\
Usage:
  ai-log-clean quarantine [list]
  ai-log-clean quarantine prune [--dry-run]
  ai-log-clean quarantine restore <YYYY-MM-DD> [--provider NAME] [--dry-run] [--force]
`;

/**
 * Default map of provider → source root (string) or resolver (rel → string).
 * Multi-root providers (copilot, opencode) disambiguate from the relative
 * path stored under the quarantine provider dir.
 *
 * @returns {Record<string, string | ((rel: string) => string)>}
 */
export function defaultProviderRoots() {
  return {
    claude_code: claudeCode.sessionsDir(),
    codex: codex.sessionsDir(),
    cursor_agent: cursorAgent.chatsDir(),
    grok: grok.sessionsDir(),
    antigravity: antigravity.rootDir(),
    // copilot: process-*.log files use logsDir; everything else session-state
    copilot: (rel) => {
      const base = basename(String(rel).replace(/\\/g, "/"));
      if (/^process-.*\.log$/i.test(base)) return copilot.logsDir();
      return copilot.sessionStateDir();
    },
    // opencode: .json under session_diff; .log (and other) under log/
    opencode: (rel) => {
      const norm = String(rel).replace(/\\/g, "/");
      if (norm.endsWith(".json")) return opencode.sessionDiffDir();
      return opencode.logDir();
    },
  };
}

/**
 * Resolve the source root for a quarantined relative path.
 *
 * @param {string} provider
 * @param {string} rel path relative to quarantine/<date>/<provider>/
 * @param {Record<string, string | ((rel: string) => string)>} [providerRoots]
 * @returns {string}
 */
export function resolveProviderSourceRoot(provider, rel, providerRoots = defaultProviderRoots()) {
  const entry = providerRoots[provider];
  if (entry == null) {
    throw new Error(`unknown provider for restore: ${provider}`);
  }
  if (typeof entry === "function") return entry(rel);
  return String(entry);
}

/**
 * Summarize one date batch under quarantine.
 *
 * @param {string} dateDir absolute path to quarantine/<YYYY-MM-DD>
 * @returns {Promise<{ date: string, items: number, bytes: number, providers: string[], expiresInDays: number }>}
 */
export async function summarizeDateBatch(dateDir) {
  const date = basename(dateDir);
  let items = 0;
  let bytes = 0;
  /** @type {string[]} */
  const providers = [];

  let entries;
  try {
    entries = await readdir(dateDir, { withFileTypes: true });
  } catch {
    return { date, items: 0, bytes: 0, providers: [], expiresInDays: 0 };
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    providers.push(e.name);
    const providerDir = join(dateDir, e.name);
    for await (const f of walkFiles(providerDir)) {
      items += 1;
      try {
        const s = await stat(f);
        bytes += s.size;
      } catch {
        // vanished between walk and stat
      }
    }
  }

  providers.sort();
  return { date, items, bytes, providers, expiresInDays: quarantineExpiresInDays(date) };
}

/**
 * List quarantine date batches (newest date first).
 *
 * @param {{ quarantineRoot?: string }} [opts]
 * @returns {Promise<Array<{ date: string, items: number, bytes: number, providers: string[], expiresInDays: number }>>}
 */
export async function listQuarantineBatches(opts = {}) {
  const quarantineRoot = opts.quarantineRoot ?? QUARANTINE_DIR;
  if (!existsSync(quarantineRoot)) return [];

  let entries;
  try {
    entries = await readdir(quarantineRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const dateDirs = entries
    .filter((e) => e.isDirectory() && DATE_RE.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();

  const batches = [];
  for (const date of dateDirs) {
    batches.push(await summarizeDateBatch(join(quarantineRoot, date)));
  }
  return batches;
}

/**
 * Format list rows for stdout.
 * @param {Array<{ date: string, items: number, bytes: number, providers: string[], expiresInDays: number }>} batches
 * @returns {string}
 */
export function formatQuarantineList(batches) {
  if (!batches || batches.length === 0) {
    return "No quarantine batches found.\n";
  }
  let out = "";
  for (const b of batches) {
    const items = String(b.items).padStart(5);
    const size = formatSize(b.bytes).padStart(8);
    const prov = b.providers.length > 0 ? b.providers.join(", ") : "—";
    out += `${b.date}  ${items} items  ${size}  expires in ${b.expiresInDays}d  ${prov}\n`;
  }
  return out;
}

/**
 * Move a single path from quarantine back to dest (EXDEV → copy+remove).
 * @param {string} source
 * @param {string} dest
 */
async function moveBack(source, dest, force = false) {
  await ensureDestinationParent(dirname(dest), force);
  try {
    await rename(source, dest);
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === "EXDEV") {
      await cp(source, dest, { recursive: true, force: false, errorOnExist: true });
      await rm(source, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/** Ensure a file-vs-directory collision in a destination parent is handled
 * only for an explicit forced restore. */
async function ensureDestinationParent(dir, force) {
  let current = dir;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  if (existsSync(current)) {
    const s = await stat(current);
    if (!s.isDirectory()) {
      if (!force) throw new Error("destination parent is not a directory");
      await rm(current, { recursive: true, force: true });
    }
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/**
 * Best-effort prune empty directories under `dir` (depth-first). Does not
 * remove `dir` itself when it still has content; may remove `dir` if empty.
 * @param {string} dir
 */
async function pruneEmptyDirs(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      await pruneEmptyDirs(join(dir, e.name));
    }
  }
  try {
    entries = await readdir(dir);
    if (entries.length === 0) {
      await rmdir(dir);
    }
  } catch {
    // ignore — another process or non-empty
  }
}

/**
 * Restore one quarantine date batch.
 *
 * @param {{
 *   date: string,
 *   quarantineRoot?: string,
 *   provider?: string | null,
 *   dryRun?: boolean,
 *   force?: boolean,
 *   providerRoots?: Record<string, string | ((rel: string) => string)>,
 * }} opts
 * @returns {Promise<{
 *   restored: number,
 *   skipped: number,
 *   failed: number,
 *   bytes: number,
 *   dryRun: boolean,
 * }>}
 */
export async function restoreFromQuarantine(opts) {
  const date = opts.date;
  const quarantineRoot = opts.quarantineRoot ?? QUARANTINE_DIR;
  const onlyProvider = opts.provider ?? null;
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const providerRoots = opts.providerRoots ?? defaultProviderRoots();

  if (!DATE_RE.test(date)) {
    throw new Error(`date must be YYYY-MM-DD (got ${JSON.stringify(date)})`);
  }

  const dateDir = join(quarantineRoot, date);
  if (!existsSync(dateDir)) {
    return { restored: 0, skipped: 0, failed: 0, bytes: 0, dryRun };
  }

  let entries;
  try {
    entries = await readdir(dateDir, { withFileTypes: true });
  } catch {
    return { restored: 0, skipped: 0, failed: 0, bytes: 0, dryRun };
  }

  let restored = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const provider = e.name;
    if (onlyProvider && provider !== onlyProvider) continue;

    const providerDir = join(dateDir, provider);
    for await (const source of walkFiles(providerDir)) {
      const rel = relative(providerDir, source);
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        failed += 1;
        continue;
      }

      let sourceRoot;
      try {
        sourceRoot = resolveProviderSourceRoot(provider, rel, providerRoots);
      } catch {
        failed += 1;
        continue;
      }

      const dest = join(sourceRoot, rel);
      // Refuse restore targets that escape the provider root (symlink / .. tricks)
      const destRel = relative(sourceRoot, dest);
      if (destRel.startsWith("..") || isAbsolute(destRel)) {
        failed += 1;
        continue;
      }

      if (existsSync(dest) && !force) {
        skipped += 1;
        continue;
      }

      let size = 0;
      try {
        const s = await stat(source);
        size = s.size;
      } catch {
        failed += 1;
        continue;
      }

      if (dryRun) {
        restored += 1;
        bytes += size;
        continue;
      }

      try {
        if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
        await moveBack(source, dest, force);
        restored += 1;
        bytes += size;
      } catch {
        failed += 1;
      }
    }
  }

  if (!dryRun && restored > 0) {
    await pruneEmptyDirs(dateDir);
    // If the date dir is now empty it was removed; if quarantine root has only
    // empty shells, leave parent quarantineRoot alone (other dates may exist).
  }

  return { restored, skipped, failed, bytes, dryRun };
}

/**
 * @param {{ restored: number, skipped: number, failed: number, bytes: number, dryRun: boolean }} r
 * @returns {string}
 */
export function formatRestoreReport(r) {
  if (r.dryRun) {
    return (
      `Would restore ${r.restored} file(s) (${formatSize(r.bytes)}), ` +
      `skip ${r.skipped} (destination exists), fail ${r.failed}\n`
    );
  }
  return (
    `Restored ${r.restored} file(s) (${formatSize(r.bytes)}), ` +
    `skipped ${r.skipped} (destination exists), failed ${r.failed}\n`
  );
}

export async function run(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        provider: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
      strict: false,
      allowPositionals: true,
    }));
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n${USAGE}`,
    );
    return 2;
  }

  const action = positionals[0] ?? "list";

  if (action === "list") {
    const batches = await listQuarantineBatches({ quarantineRoot: QUARANTINE_DIR });
    process.stdout.write(formatQuarantineList(batches));
    return 0;
  }

  if (action === "prune") {
    const result = await pruneQuarantine({
      quarantineRoot: QUARANTINE_DIR,
      dryRun: Boolean(values["dry-run"]),
    });
    const verb = result.dryRun ? "Would prune" : "Pruned";
    process.stdout.write(`${verb} ${result.removed} expired quarantine batch(es), failed ${result.failed}\n`);
    return result.failed > 0 ? 1 : 0;
  }

  if (action === "restore") {
    const date = positionals[1];
    if (!date) {
      process.stderr.write(`restore requires <YYYY-MM-DD>\n${USAGE}`);
      return 2;
    }
    if (!DATE_RE.test(date)) {
      process.stderr.write(`date must be YYYY-MM-DD (got ${JSON.stringify(date)})\n`);
      return 2;
    }

    const onlyProvider = values.provider ? String(values.provider) : null;
    if (onlyProvider && !PROVIDERS.includes(onlyProvider)) {
      process.stderr.write(
        `--provider must be one of: ${PROVIDERS.join(", ")} (got ${JSON.stringify(onlyProvider)})\n`,
      );
      return 2;
    }

    const dryRun = Boolean(values["dry-run"]);
    let result;
    try {
      result = await restoreFromQuarantine({
        date,
        quarantineRoot: QUARANTINE_DIR,
        provider: onlyProvider,
        dryRun,
        force: Boolean(values.force),
      });
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }

    process.stdout.write(formatRestoreReport(result));

    // Exit: ≥1 successful (or planned) restore → 0; none / all skip → 1
    if (result.restored >= 1) return 0;
    return 1;
  }

  process.stderr.write(`unknown quarantine action: ${JSON.stringify(action)}\n${USAGE}`);
  return 2;
}
