import { test } from "node:test";
import assert from "node:assert/strict";

import {
  budgetCandidateKey,
  parseByteSize,
  selectBudgetCandidates,
} from "../src/utils/budget.mjs";
import {
  defaultConfig,
  mergeConfig,
  parseConfigToml,
  validateConfigShape,
} from "../src/config.mjs";
import { formatRunReport } from "../src/commands/run.mjs";

function entry(provider, path, size, time) {
  return {
    provider,
    candidate: { path, size, lastWriteTime: new Date(time) },
  };
}

test("parseByteSize: accepts binary units and bare integers", () => {
  assert.equal(parseByteSize("2GB"), 2 * 1024 ** 3);
  assert.equal(parseByteSize("2G"), 2 * 1024 ** 3);
  assert.equal(parseByteSize("500MB"), 500 * 1024 ** 2);
  assert.equal(parseByteSize("1024"), 1024);
  assert.equal(parseByteSize(0), 0);
  assert.throws(() => parseByteSize("1.5GB"), /byte size/);
  assert.throws(() => parseByteSize("-1"), /byte size/);
});

test("selectBudgetCandidates: keeps retention then adds oldest files until within budget", () => {
  const entries = [
    entry("codex", "/synthetic/retention.jsonl", 40, "2026-01-01T00:00:00Z"),
    entry("copilot", "/synthetic/old.log", 60, "2026-02-01T00:00:00Z"),
    entry("codex", "/synthetic/middle.jsonl", 50, "2026-03-01T00:00:00Z"),
    entry("codex", "/synthetic/new.jsonl", 100, "2026-04-01T00:00:00Z"),
  ];
  const retention = new Set([budgetCandidateKey(entries[0].provider, entries[0].candidate)]);

  const result = selectBudgetCandidates(entries, retention, 100);

  assert.equal(result.totalBytes, 250);
  assert.equal(result.afterBytes, 100);
  assert.deepEqual(
    [...result.addedKeys],
    [
      budgetCandidateKey(entries[1].provider, entries[1].candidate),
      budgetCandidateKey(entries[2].provider, entries[2].candidate),
    ],
  );
  assert.equal(result.selectedKeys.size, 3);
});

test("selectBudgetCandidates: no budget keeps exactly the retention candidates", () => {
  const entries = [
    entry("codex", "/synthetic/old.jsonl", 20, "2026-01-01T00:00:00Z"),
    entry("codex", "/synthetic/new.jsonl", 20, "2026-06-01T00:00:00Z"),
  ];
  const retention = new Set([budgetCandidateKey(entries[0].provider, entries[0].candidate)]);

  const result = selectBudgetCandidates(entries, retention, null);

  assert.deepEqual([...result.selectedKeys], [...retention]);
  assert.equal(result.addedKeys.size, 0);
  assert.equal(result.totalBytes, null);
  assert.equal(result.afterBytes, null);
});

test("config budget_bytes: accepts TOML string or integer and defaults to disabled", () => {
  assert.equal(defaultConfig().defaults.budgetBytes, null);

  const partial = parseConfigToml(`
[defaults]
budget_bytes = "2GB"
`);
  assert.equal(partial.defaults.budgetBytes, 2 * 1024 ** 3);

  const integer = parseConfigToml("[defaults]\nbudget_bytes = 1024\n");
  assert.equal(integer.defaults.budgetBytes, 1024);

  const cfg = mergeConfig(defaultConfig(), partial);
  validateConfigShape(cfg);
  assert.equal(cfg.defaults.budgetBytes, 2 * 1024 ** 3);
  assert.throws(() => parseConfigToml("[defaults]\nbudget_bytes = \"soon\"\n"), /byte size/);
});

test("formatRunReport: budget summary reports scope and post-cleanup estimate", () => {
  const out = formatRunReport({
    byProvider: { codex: { files: 2, bytes: 150, action: "would-archive" } },
    dryRun: true,
    deleteMode: false,
    maxDeletes: Infinity,
    budget: { budgetBytes: 100, totalBytes: 250, afterBytes: 100 },
    pretty: false,
  });

  assert.match(out, /budget: 100 B/);
  assert.match(out, /now 250 B/);
  assert.match(out, /after ~100 B/);
  assert.match(out, /budget scope: enabled \+ detected providers only/);
});
