import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { formatListJson } from "../src/commands/list.mjs";
import { formatStatusJson, formatStatusLines } from "../src/commands/status.mjs";
import { appendHistory, readHistory } from "../src/utils/last-run.mjs";
import {
  formatQuarantineList,
  listQuarantineBatches,
  restoreFromQuarantine,
} from "../src/commands/quarantine.mjs";
import { pruneQuarantine, quarantineExpiresInDays } from "../src/utils/quarantine.mjs";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "alc-wave-b-"));
}

async function seed(root, date, rel, content) {
  const path = join(root, date, "codex", rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

test("list JSON has stable snake_case keys and no display-only fields", () => {
  const output = formatListJson(
    [{ provider: "codex", enabled: true, detected: true, size: 10, oldest: new Date("2026-01-01"), newest: new Date("2026-07-01") }],
    60,
    new Date("2026-07-10"),
  );
  assert.deepEqual(Object.keys(output), ["providers", "total_bytes", "detected_count"]);
  assert.equal(output.providers[0].size_bytes, 10);
  assert.equal(output.providers[0].heavy, true);
});

test("status JSON includes schedule, last run, and history", () => {
  const output = formatStatusJson({
    schedule: { installed: true, enabled: true, nextRun: new Date("2026-07-11T00:00:00Z") },
    lastRun: {
      finishedAt: "2026-07-10T00:00:00Z",
      exitCode: 0,
      dryRun: false,
      totals: { bytes: 5, budgetBytes: 10 },
      byProvider: { codex: { files: 1, bytes: 5, action: "archive" } },
    },
    lastRunPath: "/synthetic/last-run.json",
    history: [{ exitCode: 0 }],
  });
  assert.equal(output.schedule.installed, true);
  assert.equal(output.schedule.next_run, "2026-07-11T00:00:00.000Z");
  assert.equal(output.last_run_path, "/synthetic/last-run.json");
  assert.equal(output.history.length, 1);
  assert.equal(output.last_run.finished_at, "2026-07-10T00:00:00Z");
  assert.equal(output.last_run.exit_code, 0);
  assert.equal(output.last_run.dry_run, false);
  assert.equal(output.last_run.totals.budget_bytes, 10);
  assert.equal(output.last_run.by_provider.codex.files, 1);
  assert.equal("exitCode" in output.last_run, false);
});

test("history append and read are newest first, while status summarizes failures", async () => {
  const root = await tempRoot();
  const path = join(root, "logs", "history.jsonl");
  await appendHistory({ finishedAt: "one", exitCode: 0, totals: { bytes: 10 } }, { path });
  await appendHistory({ finishedAt: "two", exitCode: 1, totals: { bytes: 20 } }, { path });
  const history = await readHistory({ path });
  assert.deepEqual(history.map((entry) => entry.finishedAt), ["two", "one"]);
  assert.match(formatStatusLines({ history })[5], /last 2 runs.*30 B total.*1 failures/);
});

test("history read only returns the requested newest entries", async () => {
  const root = await tempRoot();
  const path = join(root, "logs", "history.jsonl");
  for (let i = 0; i < 20; i++) {
    await appendHistory({ finishedAt: `run-${i}`, exitCode: 0, totals: { bytes: i } }, { path });
  }
  const history = await readHistory({ path, limit: 3 });
  assert.deepEqual(history.map((entry) => entry.finishedAt), ["run-19", "run-18", "run-17"]);
});

test("quarantine expiry is based on date directory, and prune dry-run preserves it", async () => {
  const root = await tempRoot();
  await seed(root, "2026-06-01", "old.jsonl", "old");
  const now = new Date("2026-07-10T12:00:00");
  assert.equal(quarantineExpiresInDays("2026-06-01", now), 0);
  const result = await pruneQuarantine({ quarantineRoot: root, dryRun: true, now });
  assert.equal(result.removed, 1);
  assert.ok(existsSync(join(root, "2026-06-01")));
  const batches = await listQuarantineBatches({ quarantineRoot: root });
  assert.match(formatQuarantineList(batches), /expires in \d+d/);
});

test("restore force overwrites only when explicitly requested", async () => {
  const root = await tempRoot();
  const quarantine = join(root, "quarantine");
  const sessions = join(root, "sessions");
  await seed(quarantine, "2026-07-10", "x.jsonl", "archived");
  await mkdir(sessions, { recursive: true });
  const dest = join(sessions, "x.jsonl");
  await writeFile(dest, "existing");

  const result = await restoreFromQuarantine({
    date: "2026-07-10",
    quarantineRoot: quarantine,
    force: true,
    providerRoots: { codex: sessions },
  });
  assert.equal(result.restored, 1);
  assert.equal(readFileSync(dest, "utf8"), "archived");
});

test("restore force resolves a parent file-versus-directory collision", async () => {
  const root = await tempRoot();
  const quarantine = join(root, "quarantine");
  const sessions = join(root, "sessions");
  await seed(quarantine, "2026-07-10", join("session", "nested.jsonl"), "archived");
  await mkdir(sessions, { recursive: true });
  await writeFile(join(sessions, "session"), "blocking-file");

  const result = await restoreFromQuarantine({
    date: "2026-07-10",
    quarantineRoot: quarantine,
    force: true,
    providerRoots: { codex: sessions },
  });
  assert.equal(result.restored, 1);
  assert.equal(readFileSync(join(sessions, "session", "nested.jsonl"), "utf8"), "archived");
});
