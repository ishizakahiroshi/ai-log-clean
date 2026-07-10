import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatListJson, formatListRows } from "../src/commands/list.mjs";
import { checkClaudeSettings } from "../src/commands/doctor.mjs";
import { readClaudeSettings } from "../src/providers/claude-code-settings.mjs";
import { formatProviderPolicyNote, providerPolicy } from "../src/utils/provider-policy.mjs";

test("Claude policy: missing settings reports the body default and no ai-log-clean cleanup", () => {
  const policy = providerPolicy({
    provider: "claude_code",
    enabled: false,
    retentionDays: 60,
    claudeSettings: { exists: false, cleanupPeriodDays: null },
  });
  assert.deepEqual(policy, {
    managed_by: "claude_code_body",
    retention_days: null,
    cleaned_by_ai_log_clean: false,
    cleanup_period_days: 30,
    cleanup_period_source: "default",
  });
  assert.match(formatProviderPolicyNote(policy), /not cleaned by ai-log-clean/);
});

test("Claude policy: synthetic settings file reports its explicit cleanup period", async () => {
  const root = await mkdtemp(join(tmpdir(), "alc-claude-policy-"));
  const path = join(root, "settings.json");
  await writeFile(path, JSON.stringify({ cleanupPeriodDays: 45 }));
  const info = await readClaudeSettings(path);
  const policy = providerPolicy({
    provider: "claude_code",
    enabled: true,
    retentionDays: 60,
    claudeSettings: info,
  });
  assert.equal(policy.cleanup_period_days, 45);
  assert.equal(policy.cleanup_period_source, "file");
  assert.match(formatProviderPolicyNote(policy), /ret=60d/);
});

test("list JSON exposes the policy object and text list renders its note", () => {
  const policy = providerPolicy({
    provider: "claude_code",
    enabled: false,
    retentionDays: 60,
    claudeSettings: null,
  });
  const rows = [{
    provider: "claude_code",
    enabled: false,
    detected: true,
    size: 10,
    oldest: new Date("2026-06-01T00:00:00Z"),
    newest: new Date("2026-07-01T00:00:00Z"),
    policy,
  }];
  assert.deepEqual(formatListJson(rows, 60).providers[0].policy, policy);
  assert.match(formatListRows(rows, { pretty: false, retentionDays: 60 }), /body cleanupPeriodDays=30/);
});

test("doctor Claude check makes missing settings neutral and unreadable settings visible", () => {
  const missing = checkClaudeSettings({
    enabled: false,
    retentionDays: 60,
    info: { exists: false, cleanupPeriodDays: null },
  });
  assert.equal(missing.status, "--");
  assert.match(missing.detail, /cleanupPeriodDays=30 \(default\)/);
  assert.match(missing.detail, /body-managed/);

  const unreadable = checkClaudeSettings({
    enabled: false,
    retentionDays: 60,
    error: new Error("invalid JSON"),
  });
  assert.equal(unreadable.status, "!!");
  assert.match(unreadable.detail, /unreadable/);
});
