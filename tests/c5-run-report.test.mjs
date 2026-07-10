/**
 * C5: run / dry-run cross-provider report + last-run write policy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRunReport } from "../src/commands/run.mjs";

test("formatRunReport: dry-run includes Would free and No files touched", () => {
  const out = formatRunReport({
    byProvider: {
      codex: { files: 42, bytes: 96 * 1024 * 1024, action: "would-archive" },
      copilot: { files: 10, bytes: 10 * 1024 * 1024, action: "would-archive" },
    },
    dryRun: true,
    deleteMode: false,
    maxDeletes: Infinity,
    pretty: false,
  });
  assert.match(out, /Would free/);
  assert.match(out, /No files touched/);
  assert.match(out, /mode: dry-run/);
  assert.match(out, /delete=false/);
  assert.match(out, /codex/);
  assert.doesNotMatch(out, /█/);
});

test("formatRunReport: real archive run says Freed + quarantine retention", () => {
  const out = formatRunReport({
    byProvider: {
      codex: { files: 3, bytes: 1024 * 1024, action: "archive" },
    },
    dryRun: false,
    deleteMode: false,
    maxDeletes: 100,
    capped: false,
    pretty: false,
  });
  assert.match(out, /Freed/);
  assert.match(out, /quarantine kept/);
  assert.match(out, /mode: run/);
  assert.doesNotMatch(out, /No files touched/);
  assert.doesNotMatch(out, /Would free/);
});

test("formatRunReport: capped flag appears on mode line", () => {
  const out = formatRunReport({
    byProvider: { codex: { files: 5, bytes: 100, action: "archive" } },
    dryRun: false,
    deleteMode: false,
    maxDeletes: 5,
    capped: true,
    pretty: false,
  });
  assert.match(out, /capped/);
  assert.match(out, /max-deletes=5/);
});

test("formatRunReport: empty providers → Nothing to free", () => {
  const out = formatRunReport({
    byProvider: {},
    dryRun: true,
    deleteMode: false,
    maxDeletes: Infinity,
    pretty: false,
  });
  assert.match(out, /Nothing to free/);
});
