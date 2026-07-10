/**
 * C2 list disk-health: Total line, heavy tag, TTY-only bars.
 * Synthetic fixtures only. Run: node --test tests/c2-list.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatListRows } from "../src/commands/list.mjs";
import { formatSize } from "../src/utils/fs.mjs";

const NOW = new Date("2026-07-10T12:00:00.000Z");

function sampleRows() {
  return [
    {
      provider: "claude_code",
      enabled: false,
      detected: true,
      size: 1024 * 1024, // 1.0 MB
      oldest: new Date("2026-06-01T00:00:00.000Z"), // within 60d
      newest: new Date("2026-07-09T00:00:00.000Z"),
    },
    {
      provider: "codex",
      enabled: true,
      detected: true,
      size: 2 * 1024 * 1024 * 1024, // 2.00 GB (max)
      oldest: new Date("2025-01-01T00:00:00.000Z"), // older than 60d → heavy
      newest: new Date("2026-07-08T00:00:00.000Z"),
    },
    {
      provider: "copilot",
      enabled: true,
      detected: false,
      size: 0,
      oldest: null,
      newest: null,
    },
  ];
}

test("formatListRows: Total line has sum size and detected count", () => {
  const rows = sampleRows();
  const out = formatListRows(rows, { pretty: false, retentionDays: 60, now: NOW });
  const totalBytes = rows.reduce((s, r) => s + r.size, 0);
  assert.ok(
    out.includes(`Total  ${formatSize(totalBytes)}  ·  2 detected`),
    `expected Total line in:\n${out}`,
  );
  assert.match(out, /Tip  npx -y github:ishizakahiroshi\/ai-log-clean --dry-run/);
});

test("formatListRows: ! heavy when oldest exceeds retentionDays", () => {
  const rows = sampleRows();
  const out = formatListRows(rows, { pretty: false, retentionDays: 60, now: NOW });
  const lines = out.split("\n");
  const codex = lines.find((l) => l.startsWith("codex"));
  const claude = lines.find((l) => l.startsWith("claude_code"));
  assert.ok(codex, "codex row");
  assert.match(codex, /! heavy/);
  assert.ok(claude, "claude_code row");
  assert.doesNotMatch(claude, /! heavy/);
});

test("formatListRows: pretty off has no bar characters and no ANSI", () => {
  const out = formatListRows(sampleRows(), { pretty: false, retentionDays: 60, now: NOW });
  assert.equal(out.includes("█"), false);
  assert.equal(out.includes("░"), false);
  assert.equal(out.includes("\x1b["), false, "NO_COLOR / non-TTY path must stay plain");
});

test("formatListRows: pretty on includes relative bars (max = full)", () => {
  const out = formatListRows(sampleRows(), {
    pretty: true,
    retentionDays: 60,
    now: NOW,
    barWidth: 8,
  });
  assert.ok(out.includes("█") || out.includes("░"));
  assert.ok(out.includes("\x1b["), "TTY pretty path uses ANSI color");
  const codex = out.split("\n").find((l) => l.startsWith("codex"));
  assert.ok(codex);
  assert.match(codex, /████████/); // max size → full bar
  assert.match(codex, /! heavy/);
});

test("formatListRows: keeps core table columns", () => {
  const out = formatListRows(sampleRows(), { pretty: false, retentionDays: 60, now: NOW });
  assert.match(out, /^provider\s+enabled\s+detected\s+size\s+oldest\s+newest/m);
  assert.match(out, /claude_code\s+false\s+true/);
});
