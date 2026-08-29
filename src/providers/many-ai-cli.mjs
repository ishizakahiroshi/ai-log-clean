/**
 * many-ai-cli session storage: ~/.many-ai-cli/subscriptions/<vendor>/<profile>/
 *
 * many-ai-cli launches each vendor CLI against a per-profile HOME, so every
 * profile directory mirrors that vendor's own on-disk layout:
 *   claude/<profile>/projects/<encoded-cwd>/*.jsonl
 *   codex/<profile>/sessions/YYYY/MM/DD/rollout-*.jsonl
 *   grok/<profile>/sessions/<encoded>/<uuid>/          (directory per session)
 *
 * Only those transcript paths are in scope, and the matching rules are kept
 * in step with the native provider of the same vendor. A profile root also
 * holds live state the CLI needs (per-vendor config JSON, workbench sources,
 * history.jsonl, session indexes), so we never enumerate the profile root
 * itself — an over-broad scan here would delete configuration, not logs.
 *
 * Vendors without a native provider are skipped rather than guessed at: an
 * unknown layout must not be deleted just because it sits under the same root.
 *
 * Enabled by default because many-ai-cli has no retention setting of its own.
 * (claude_code is the exception among session providers — it defers to Claude
 * Code's built-in cleanupPeriodDays — but that setting governs ~/.claude only
 * and does not reach these mirrored profile HOMEs.)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { walkFiles, listSessionDirs, dirStats, safeStat } from "../utils/fs.mjs";

export const name = "many_ai_cli";

export function sessionsDir() {
  return join(homedir(), ".many-ai-cli", "subscriptions");
}

/**
 * Per-vendor scope. `subdir` is relative to <vendor>/<profile>/.
 * Keep each entry equivalent to the native provider for that vendor.
 */
const VENDOR_SCOPES = {
  claude: {
    subdir: "projects",
    kind: "file",
    match: (p) => p.endsWith(".jsonl"),
  },
  codex: {
    subdir: "sessions",
    kind: "file",
    match: (p) => {
      const b = basename(p);
      return b.startsWith("rollout-") && b.endsWith(".jsonl");
    },
  },
  grok: {
    subdir: "sessions",
    kind: "directory",
    depth: 2,
  },
};

/** Yield {dir, scope} for every <vendor>/<profile>/<subdir> that exists. */
async function* scopeDirs() {
  const root = sessionsDir();
  for (const [vendor, scope] of Object.entries(VENDOR_SCOPES)) {
    for (const profileDir of await listSessionDirs(join(root, vendor), 1)) {
      const dir = join(profileDir, scope.subdir);
      if (!existsSync(dir)) continue;
      yield { dir, scope };
    }
  }
}

/**
 * Yield every in-scope entry once, with the fields all three public
 * functions need. `root` is the subscriptions dir for every entry so the
 * quarantine layout keeps the <vendor>/<profile>/... prefix and `restore`
 * can rebuild the original path.
 */
async function* entries() {
  const root = sessionsDir();
  for await (const { dir, scope } of scopeDirs()) {
    if (scope.kind === "file") {
      for await (const f of walkFiles(dir)) {
        if (!scope.match(f)) continue;
        const s = await safeStat(f);
        if (!s) continue;
        yield {
          path: f,
          kind: "file",
          lastWriteTime: s.mtime,
          oldestWriteTime: s.mtime,
          size: s.size,
          root,
        };
      }
    } else {
      for (const d of await listSessionDirs(dir, scope.depth)) {
        const { size, latest, oldest } = await dirStats(d);
        if (!latest) continue;
        yield {
          path: d,
          kind: "directory",
          lastWriteTime: latest,
          oldestWriteTime: oldest ?? latest,
          size,
          root,
        };
      }
    }
  }
}

export async function detected() {
  return existsSync(sessionsDir());
}

export async function scan(cutoff) {
  const out = [];
  for await (const e of entries()) {
    if (e.lastWriteTime < cutoff) {
      out.push({
        path: e.path,
        kind: e.kind,
        lastWriteTime: e.lastWriteTime,
        size: e.size,
        root: e.root,
      });
    }
  }
  return out;
}

export async function totalSize() {
  let total = 0;
  for await (const e of entries()) total += e.size;
  return total;
}

export async function ageRange() {
  let oldest = Infinity;
  let newest = 0;
  for await (const e of entries()) {
    const o = e.oldestWriteTime.getTime();
    const n = e.lastWriteTime.getTime();
    if (o < oldest) oldest = o;
    if (n > newest) newest = n;
  }
  return {
    oldest: Number.isFinite(oldest) ? new Date(oldest) : undefined,
    newest: newest ? new Date(newest) : undefined,
  };
}
