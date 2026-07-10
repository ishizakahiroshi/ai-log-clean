/**
 * C4 unit tests — install success guide (P4) + provider error format (P8).
 *
 * Partial-match only: exact whitespace beyond the public contract is free to
 * drift as long as the key phrases stay put.
 *
 * Run with: `node --test tests/c4-install-errors.test.mjs`
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatInstallSuccess } from "../src/commands/install.mjs";
import { formatProviderError, shortPath } from "../src/utils/errors.mjs";

// --- C4 install/errors ---

test("formatInstallSuccess: archive default shows guide commands + Safe line", () => {
  const out = formatInstallSuccess({
    at: "12:00",
    retentionDays: 60,
    deleteMode: false,
  });
  assert.match(out, /Installed\s+daily at 12:00/);
  assert.match(out, /retention 60d/);
  assert.match(out, /archive \(not delete\)/);
  assert.match(out, /status\s+npx -y github:ishizakahiroshi\/ai-log-clean status/);
  assert.match(out, /try now\s+npx -y github:ishizakahiroshi\/ai-log-clean --dry-run/);
  assert.match(out, /pause\s+npx -y github:ishizakahiroshi\/ai-log-clean disable/);
  assert.match(out, /Config\s+~\/\.ai-log-clean\/config\.toml/);
  assert.match(out, /Safe\s+no admin · user-scope task · default = archive only/);
});

test("formatInstallSuccess: deleteMode reflects on first line only", () => {
  const out = formatInstallSuccess({
    at: "09:30",
    retentionDays: 14,
    deleteMode: true,
  });
  assert.match(out, /daily at 09:30/);
  assert.match(out, /retention 14d/);
  assert.match(out, /· delete\b/);
  assert.doesNotMatch(out, /archive \(not delete\)/);
  // Product default remains archive-only in the Safe footer.
  assert.match(out, /default = archive only/);
});

test("formatProviderError: EPERM partial + permission hint", () => {
  const longPath =
    "/tmp/alc-fixture/.cursor/chats/deep/nested/project/alpha/beta/session-abc";
  const err = Object.assign(new Error("EPERM: operation not permitted"), {
    code: "EPERM",
    path: longPath,
  });
  const out = formatProviderError({
    provider: "cursor_agent",
    err,
    othersContinued: true,
  });
  assert.match(out, /cursor_agent\s+skip: permission denied/);
  assert.match(out, /Others continued\.\s+exit=1 \(partial\)/);
  assert.match(out, /Try\s+re-run as same user that owns the files/);
  assert.match(out, /\[providers\.cursor_agent\] enabled=false/);
  // Path is shortened (basename kept; full absolute dump avoided).
  assert.match(out, /session-abc/);
  assert.doesNotMatch(out, /deep\/nested\/project\/alpha\/beta/);
});

test("formatProviderError: EACCES same family as EPERM", () => {
  const err = Object.assign(new Error("denied"), {
    code: "EACCES",
    path: "C:\\Users\\dev\\.codex\\sessions\\x",
  });
  const out = formatProviderError({
    provider: "codex",
    err,
    othersContinued: true,
  });
  assert.match(out, /codex\s+skip: permission denied/);
  assert.match(out, /re-run as same user/);
  assert.match(out, /\[providers\.codex\] enabled=false/);
});

test("formatProviderError: ENOENT hint", () => {
  const err = Object.assign(new Error("no such file"), {
    code: "ENOENT",
    path: "/tmp/missing-session",
  });
  const out = formatProviderError({
    provider: "grok",
    err,
    othersContinued: true,
  });
  assert.match(out, /grok\s+skip: path not found/);
  assert.match(out, /confirm the session path still exists/);
  assert.match(out, /\[providers\.grok\] enabled=false/);
});

test("formatProviderError: EXDEV hint", () => {
  const err = Object.assign(new Error("cross-device link"), {
    code: "EXDEV",
    path: "/mnt/a/session",
  });
  const out = formatProviderError({
    provider: "opencode",
    err,
    othersContinued: true,
  });
  assert.match(out, /opencode\s+skip: cross-device move failed/);
  assert.match(out, /same volume/);
});

test("formatProviderError: othersContinued=false omits partial line", () => {
  const err = Object.assign(new Error("boom"), { code: "EPERM" });
  const out = formatProviderError({
    provider: "claude_code",
    err,
    othersContinued: false,
  });
  assert.match(out, /claude_code\s+skip: permission denied/);
  assert.doesNotMatch(out, /Others continued/);
  assert.doesNotMatch(out, /partial/);
  assert.match(out, /exit=1/);
});

test("formatProviderError: unknown code still offers disable, no invented cause story", () => {
  const err = Object.assign(new Error("weird"), { code: "EFOO" });
  const out = formatProviderError({
    provider: "copilot",
    err,
    othersContinued: true,
  });
  assert.match(out, /copilot\s+skip: EFOO/);
  assert.match(out, /\[providers\.copilot\] enabled=false/);
  assert.doesNotMatch(out, /permission denied/);
  assert.doesNotMatch(out, /path not found/);
});

test("shortPath: truncates long absolute-style names", () => {
  const long = "/var/tmp/" + "a".repeat(80) + "/file.jsonl";
  const s = shortPath(long);
  assert.ok(s);
  assert.ok(s.length < long.length);
  assert.match(s, /file\.jsonl/);
});
