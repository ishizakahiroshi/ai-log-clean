/**
 * C3 status narrative — unit tests for formatStatusLines.
 * Run: node --test tests/c3-status.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatStatusLines } from "../src/commands/status.mjs";
import { formatLocalDateTime, formatRelative } from "../src/utils/output.mjs";
import { formatSize } from "../src/utils/fs.mjs";

const now = new Date(2026, 6, 10, 12, 0, 0); // local 2026-07-10 12:00

test("formatStatusLines: local + relative times for Next / Last", () => {
  const next = new Date(now.getTime() + 14 * 60 * 60 * 1000);
  const last = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const lines = formatStatusLines({
    schedule: {
      installed: true,
      enabled: true,
      nextRun: next,
      lastRun: last,
    },
    lastRun: null,
    lastRunPath: "/tmp/last-run.json",
    now,
  });

  assert.equal(lines[0], "Schedule  installed · enabled");
  assert.equal(
    lines[1],
    `Next      ${formatLocalDateTime(next)}  (${formatRelative(next, now)})`,
  );
  assert.equal(
    lines[2],
    `Last      ${formatLocalDateTime(last)}  (${formatRelative(last, now)})`,
  );
  assert.match(lines[1], /in 14h/);
  assert.match(lines[2], /2h ago/);
  assert.doesNotMatch(lines.join("\n"), /T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
});

test("formatStatusLines: missing lastRun → Result —", () => {
  const lines = formatStatusLines({
    schedule: { installed: true, enabled: true, nextRun: null, lastRun: null },
    lastRun: null,
    lastRunPath: "~/.ai-log-clean/logs/last-run.json",
    now,
  });

  assert.equal(lines[1], "Next      —");
  assert.equal(lines[2], "Last      —");
  assert.equal(lines[3], "Result    —");
  assert.equal(lines[4], "Log       ~/.ai-log-clean/logs/last-run.json");
  assert.equal(lines[5], "History   —");
});

test("formatStatusLines: dryRun lastRun is not shown as Result", () => {
  const lines = formatStatusLines({
    schedule: { installed: false, enabled: false },
    lastRun: {
      exitCode: 0,
      dryRun: true,
      mode: "archive",
      totals: { files: 5, bytes: 100 },
    },
    lastRunPath: "x",
    now,
  });

  assert.equal(lines[0], "Schedule  not installed");
  assert.equal(lines[3], "Result    —");
});

test("formatStatusLines: real run Result uses mode / totals / formatSize", () => {
  const bytes = 96 * 1024 * 1024;
  const lines = formatStatusLines({
    schedule: { installed: true, enabled: false, nextRun: null, lastRun: null },
    lastRun: {
      exitCode: 0,
      dryRun: false,
      mode: "archive",
      totals: { files: 12, bytes },
    },
    lastRunPath: "logs/last-run.json",
    now,
  });

  assert.equal(lines[0], "Schedule  installed · disabled");
  assert.equal(
    lines[3],
    `Result    exit 0 · archived 12 files · ${formatSize(bytes)}`,
  );
});

test("formatStatusLines: delete mode wording", () => {
  const lines = formatStatusLines({
    schedule: { installed: true, enabled: true },
    lastRun: {
      exitCode: 1,
      mode: "delete",
      totals: { files: 3, bytes: 2048 },
    },
    lastRunPath: "p",
    now,
  });
  assert.equal(
    lines[3],
    `Result    exit 1 · deleted 3 files · ${formatSize(2048)}`,
  );
});

test("formatStatusLines: never throws on sparse inputs", () => {
  assert.doesNotThrow(() => formatStatusLines({}));
  assert.doesNotThrow(() =>
    formatStatusLines({
      schedule: {},
      lastRun: {},
      lastRunPath: "",
      now,
    }),
  );
  const lines = formatStatusLines({});
  assert.equal(lines.length, 6);
  assert.equal(lines[0], "Schedule  not installed");
  assert.equal(lines[3], "Result    —");
});
