/**
 * C7: quarantine list + restore.
 * Synthetic fixtures only. Run: node --test tests/c7-quarantine.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";

import {
  listQuarantineBatches,
  formatQuarantineList,
  restoreFromQuarantine,
  formatRestoreReport,
  resolveProviderSourceRoot,
} from "../src/commands/quarantine.mjs";
import { formatSize } from "../src/utils/fs.mjs";

async function makeTmp() {
  return mkdtemp(join(tmpdir(), "alc-c7-"));
}

/**
 * Build a synthetic quarantine tree:
 *   q/<date>/<provider>/<rel...>
 */
async function seedQuarantine(qRoot, date, provider, relPath, content) {
  const full = join(qRoot, date, provider, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

test("listQuarantineBatches: empty root → no batches", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  await mkdir(q, { recursive: true });
  const batches = await listQuarantineBatches({ quarantineRoot: q });
  assert.deepEqual(batches, []);
  assert.equal(formatQuarantineList(batches), "No quarantine batches found.\n");
});

test("listQuarantineBatches: shows date, item count, size, providers", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  // two files same day, two providers
  await seedQuarantine(q, "2026-07-10", "codex", join("2026", "01", "rollout-a.jsonl"), "aaaa");
  await seedQuarantine(q, "2026-07-10", "cursor_agent", join("h1", "u1", "store.json"), "bbbbbb");
  // older day
  await seedQuarantine(q, "2026-07-09", "copilot", "process-1.log", "cc");

  const batches = await listQuarantineBatches({ quarantineRoot: q });
  assert.equal(batches.length, 2);
  // newest first
  assert.equal(batches[0].date, "2026-07-10");
  assert.equal(batches[0].items, 2);
  assert.equal(batches[0].bytes, 4 + 6);
  assert.deepEqual(batches[0].providers, ["codex", "cursor_agent"]);

  assert.equal(batches[1].date, "2026-07-09");
  assert.equal(batches[1].items, 1);
  assert.deepEqual(batches[1].providers, ["copilot"]);

  const text = formatQuarantineList(batches);
  assert.match(text, /2026-07-10/);
  assert.match(text, /2 items/);
  assert.match(text, /codex, cursor_agent/);
  assert.match(text, /2026-07-09/);
  assert.match(text, new RegExp(formatSize(4 + 6).replace(".", "\\.")));
});

test("restoreFromQuarantine: moves file back when dest is free", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  const sessions = join(root, "sessions");
  const rel = join("2026", "06", "01", "rollout-foo.jsonl");
  const qPath = await seedQuarantine(q, "2026-07-10", "codex", rel, "session-body");

  const result = await restoreFromQuarantine({
    date: "2026-07-10",
    quarantineRoot: q,
    providerRoots: { codex: sessions },
  });

  assert.equal(result.restored, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.dryRun, false);

  const dest = join(sessions, rel);
  assert.ok(existsSync(dest), "file must be present at provider root + rel");
  assert.equal(readFileSync(dest, "utf8"), "session-body");
  assert.equal(existsSync(qPath), false, "quarantine source must be gone (move, not copy)");
  // restore is not a delete of user data: payload still exists at dest
  assert.ok(existsSync(dest));
});

test("restoreFromQuarantine: skips when destination already exists", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  const sessions = join(root, "sessions");
  const rel = join("nested", "keep.jsonl");
  const qPath = await seedQuarantine(q, "2026-07-10", "codex", rel, "from-quarantine");
  const dest = join(sessions, rel);
  await mkdir(join(dest, ".."), { recursive: true });
  await writeFile(dest, "already-here");

  const result = await restoreFromQuarantine({
    date: "2026-07-10",
    quarantineRoot: q,
    providerRoots: { codex: sessions },
  });

  assert.equal(result.restored, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(readFileSync(dest, "utf8"), "already-here", "must not overwrite");
  assert.ok(existsSync(qPath), "quarantine file remains when skipped");
});

test("restoreFromQuarantine: dry-run plans moves without writing", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  const sessions = join(root, "sessions");
  const rel = "only-dry.jsonl";
  const qPath = await seedQuarantine(q, "2026-07-10", "codex", rel, "payload");

  const result = await restoreFromQuarantine({
    date: "2026-07-10",
    quarantineRoot: q,
    dryRun: true,
    providerRoots: { codex: sessions },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.restored, 1);
  assert.equal(result.skipped, 0);
  assert.ok(existsSync(qPath), "dry-run must leave quarantine file in place");
  assert.equal(existsSync(join(sessions, rel)), false, "dry-run must not create dest");

  const report = formatRestoreReport(result);
  assert.match(report, /Would restore 1/);
});

test("restoreFromQuarantine: --provider limits scope", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  const codexRoot = join(root, "codex");
  const cursorRoot = join(root, "cursor");
  await seedQuarantine(q, "2026-07-10", "codex", "a.jsonl", "A");
  await seedQuarantine(q, "2026-07-10", "cursor_agent", "b.json", "B");

  const result = await restoreFromQuarantine({
    date: "2026-07-10",
    quarantineRoot: q,
    provider: "codex",
    providerRoots: { codex: codexRoot, cursor_agent: cursorRoot },
  });

  assert.equal(result.restored, 1);
  assert.ok(existsSync(join(codexRoot, "a.jsonl")));
  assert.equal(existsSync(join(cursorRoot, "b.json")), false);
  // cursor file still in quarantine
  assert.ok(existsSync(join(q, "2026-07-10", "cursor_agent", "b.json")));
});

test("restoreFromQuarantine: missing date batch → zero restored", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  await mkdir(q, { recursive: true });
  const result = await restoreFromQuarantine({
    date: "2099-01-01",
    quarantineRoot: q,
    providerRoots: { codex: join(root, "sessions") },
  });
  assert.equal(result.restored, 0);
  assert.equal(result.skipped, 0);
});

test("restore is not a delete: content survives only at destination", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  const sessions = join(root, "sessions");
  const rel = "prove-not-delete.jsonl";
  await seedQuarantine(q, "2026-07-10", "codex", rel, "important-session");

  await restoreFromQuarantine({
    date: "2026-07-10",
    quarantineRoot: q,
    providerRoots: { codex: sessions },
  });

  const dest = join(sessions, rel);
  assert.ok(existsSync(dest));
  assert.equal(readFileSync(dest, "utf8"), "important-session");
  // no copy left under quarantine for that date/provider (tree pruned or empty)
  const qFile = join(q, "2026-07-10", "codex", rel);
  assert.equal(existsSync(qFile), false);
  // user data still readable — restore never deleted it
  assert.equal(readFileSync(dest, "utf8").length > 0, true);
});

test("resolveProviderSourceRoot: string map wins over defaults", () => {
  const root = resolveProviderSourceRoot("codex", "x.jsonl", {
    codex: "/tmp/fake-codex",
  });
  assert.equal(root, "/tmp/fake-codex");
});

test("resolveProviderSourceRoot: function map for multi-root", () => {
  const roots = {
    copilot: (rel) =>
      /^process-.*\.log$/i.test(basename(rel)) ? "/logs" : "/session-state",
  };
  assert.equal(resolveProviderSourceRoot("copilot", "process-1.log", roots), "/logs");
  assert.equal(resolveProviderSourceRoot("copilot", "uuid-1/state.json", roots), "/session-state");
});

test("formatRestoreReport: wording for dry vs real", () => {
  assert.match(
    formatRestoreReport({ restored: 2, skipped: 1, failed: 0, bytes: 100, dryRun: true }),
    /Would restore 2/,
  );
  assert.match(
    formatRestoreReport({ restored: 2, skipped: 1, failed: 0, bytes: 100, dryRun: false }),
    /Restored 2/,
  );
});

// silence unused in edge case when date dir fully pruned
test("list ignores non-date directories under quarantine root", async () => {
  const root = await makeTmp();
  const q = join(root, "quarantine");
  await mkdir(join(q, "not-a-date"), { recursive: true });
  await writeFile(join(q, "not-a-date", "x"), "z");
  await seedQuarantine(q, "2026-07-10", "codex", "a.jsonl", "ok");
  const batches = await listQuarantineBatches({ quarantineRoot: q });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].date, "2026-07-10");
  // ensure readdir of q still works after
  assert.ok((await readdir(q)).includes("2026-07-10"));
});
