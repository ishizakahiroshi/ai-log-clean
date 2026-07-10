/**
 * C6 doctor — unit tests for pure check helpers.
 * Run: node --test tests/c6-doctor.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkNodeVersion,
  checkNpx,
  checkSchedule,
  checkLastExit,
  checkConfig,
  checkClaudeSettings,
  checkProviders,
  summarizeChecks,
} from "../src/commands/doctor.mjs";

test("checkNodeVersion: >= 20 is ok", () => {
  assert.equal(checkNodeVersion("v20.0.0").status, "ok");
  assert.equal(checkNodeVersion("v22.11.0").status, "ok");
  assert.match(checkNodeVersion("v22.11.0").detail, /^v22\.x$/);
  assert.equal(checkNodeVersion("20.5.1").status, "ok");
});

test("checkNodeVersion: < 20 is !! with fix", () => {
  const r = checkNodeVersion("v18.20.0");
  assert.equal(r.status, "!!");
  assert.match(r.detail, /v18/);
  assert.ok(r.fix);
});

test("checkNpx: path ok, missing !!", () => {
  assert.equal(checkNpx("C:\\nodejs\\npx.cmd").status, "ok");
  assert.equal(checkNpx("C:\\nodejs\\npx.cmd").detail, "C:\\nodejs\\npx.cmd");
  const bad = checkNpx(null, new Error("npx not found on PATH"));
  assert.equal(bad.status, "!!");
  assert.ok(bad.fix);
});

test("checkSchedule: installed/enabled matrix", () => {
  assert.equal(checkSchedule({ installed: true, enabled: true }).status, "ok");
  assert.equal(checkSchedule({ installed: true, enabled: true }).detail, "installed · enabled");

  const missing = checkSchedule({ installed: false });
  assert.equal(missing.status, "!!");
  assert.equal(missing.detail, "not installed");
  assert.match(missing.fix, /install/);

  const disabled = checkSchedule({ installed: true, enabled: false });
  assert.equal(disabled.status, "!!");
  assert.equal(disabled.detail, "installed · disabled");
  assert.match(disabled.fix, /enable/);
});

test("checkLastExit: prefer last-run; missing is -- not !!", () => {
  assert.equal(checkLastExit({}).status, "--");
  assert.equal(checkLastExit({ lastRun: null, scheduleLastExitCode: null }).detail, "no prior run");

  assert.equal(
    checkLastExit({ lastRun: { exitCode: 0 } }).status,
    "ok",
  );
  assert.equal(
    checkLastExit({ lastRun: { exitCode: 1 } }).status,
    "!!",
  );

  // Prefer last-run over scheduler
  const r = checkLastExit({
    lastRun: { exitCode: 0 },
    scheduleLastExitCode: 1,
  });
  assert.equal(r.status, "ok");
  assert.equal(r.detail, "0");

  // Fall back to scheduler when last-run has no exitCode
  const s = checkLastExit({
    lastRun: { dryRun: true },
    scheduleLastExitCode: 0,
  });
  assert.equal(s.status, "ok");
  assert.equal(s.detail, "0");
});

test("checkConfig / checkProviders", () => {
  assert.equal(checkConfig({ ok: true }).status, "ok");
  const bad = checkConfig({ ok: false, error: new Error("line 3: bad") });
  assert.equal(bad.status, "!!");
  assert.match(bad.detail, /line 3/);

  const p = checkProviders({ detected: 5, total: 7 });
  assert.equal(p.status, "ok");
  assert.equal(p.detail, "5/7 detected");
});

test("checkClaudeSettings: reports body policy without requiring a settings file", () => {
  const r = checkClaudeSettings({
    enabled: false,
    retentionDays: 60,
    info: { exists: false, cleanupPeriodDays: null },
  });
  assert.equal(r.status, "--");
  assert.match(r.detail, /cleanupPeriodDays=30 \(default\)/);
  assert.match(r.detail, /body-managed/);
});

test("summarizeChecks: exit 0 when no !!; Fix section max 3", () => {
  const allOk = summarizeChecks([
    checkNodeVersion("v22.0.0"),
    checkNpx("/usr/bin/npx"),
    checkSchedule({ installed: true, enabled: true }),
    checkLastExit({ lastRun: null }),
    checkConfig({ ok: true }),
    checkProviders({ detected: 3, total: 7 }),
  ]);
  assert.equal(allOk.exitCode, 0);
  assert.equal(allOk.lines[0], "doctor");
  assert.ok(allOk.lines.some((l) => l.includes("Last exit") && l.includes("--")));
  assert.ok(!allOk.lines.includes("Fix"));

  const problems = summarizeChecks([
    checkNodeVersion("v16.0.0"),
    checkNpx(null, "missing"),
    checkSchedule({ installed: false }),
    checkLastExit({ lastRun: { exitCode: 2 } }),
    checkConfig({ ok: false, error: "bad" }),
  ]);
  assert.equal(problems.exitCode, 1);
  assert.ok(problems.lines.includes("Fix"));
  assert.equal(problems.fixLines.length, 3);
  // only known !! rows contribute; last exit also has fix but capped at 3
  assert.ok(problems.fixLines.every((l) => l.startsWith("  ")));
});

test("summarizeChecks: line layout has text status labels", () => {
  const { lines } = summarizeChecks([
    checkNodeVersion("v22.0.0"),
    checkSchedule({ installed: false }),
  ]);
  const nodeLine = lines.find((l) => l.includes("Node"));
  const schedLine = lines.find((l) => l.includes("Schedule"));
  assert.match(nodeLine, /\bok\b/);
  // `!` is non-word; `\b!!\b` does not match. Match the status column literally.
  assert.match(schedLine, /!!/);
  assert.match(schedLine, /not installed/);
});
