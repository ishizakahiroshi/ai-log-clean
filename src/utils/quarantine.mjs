import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { removePath } from "./fs.mjs";

export const QUARANTINE_RETENTION_DAYS = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateStart(date) {
  return new Date(`${date}T00:00:00`);
}

export function quarantineExpiresInDays(date, now = new Date()) {
  const start = dateStart(date);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.ceil((start.getTime() + QUARANTINE_RETENTION_DAYS * DAY_MS - now.getTime()) / DAY_MS));
}

export async function pruneQuarantine({ quarantineRoot, dryRun = false, now = new Date() }) {
  if (!existsSync(quarantineRoot)) return { removed: 0, failed: 0, dryRun };
  let entries;
  try {
    entries = await readdir(quarantineRoot, { withFileTypes: true });
  } catch {
    return { removed: 0, failed: 1, dryRun };
  }

  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE_RE.test(entry.name)) continue;
    if (quarantineExpiresInDays(entry.name, now) > 0) continue;
    try {
      if (!dryRun) await removePath(join(quarantineRoot, entry.name));
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed, dryRun };
}
