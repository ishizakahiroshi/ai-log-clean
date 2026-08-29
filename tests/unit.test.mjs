/**
 * Unit tests — Node 20+ built-in test runner. No devDep required.
 *
 * These exercise the safety contracts a regression would silently break:
 *   - the default config exposes every PROVIDERS entry with the shape
 *     run.mjs / list.mjs depend on (`validateConfigShape` invariant)
 *   - moveToQuarantine refuses paths that escape its sourceRoot
 *     (path-traversal guard, F-SEC-01)
 *   - moveToQuarantine appends a suffix instead of clobbering an
 *     existing quarantine target (F-BUG-04)
 *   - the package ships with zero runtime dependencies (house rule)
 *
 * Run with: `node --test tests/`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROVIDERS,
  defaultConfig,
  effectiveRetentionDays,
  validateConfigShape,
  parseConfigToml,
  mergeConfig,
  CONFIG_TEMPLATE,
} from "../src/config.mjs";
import {
  formatSize,
  todayStamp,
  moveToQuarantine,
} from "../src/utils/fs.mjs";
import { findSubcommandIndex } from "../src/cli.mjs";
import { applyExcludeFiles } from "../src/commands/run.mjs";
import { isValidAt, normalizeAt } from "../src/commands/install.mjs";
import { conversationGroupKey } from "../src/providers/antigravity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

test("formatSize: handles B / KB / MB / GB boundaries", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1.0 KB");
  assert.equal(formatSize(1024 * 1024), "1.0 MB");
  assert.equal(formatSize(1024 * 1024 * 1024), "1.00 GB");
});

test("todayStamp: returns YYYY-MM-DD", () => {
  const s = todayStamp();
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
});

test("defaultConfig: every PROVIDERS entry exists with enabled bool", () => {
  const cfg = defaultConfig();
  for (const p of PROVIDERS) {
    assert.ok(cfg.providers[p], `missing providers.${p}`);
    assert.equal(typeof cfg.providers[p].enabled, "boolean", `providers.${p}.enabled must be boolean`);
  }
});

test("validateConfigShape: passes on defaultConfig, rejects drift", () => {
  validateConfigShape(defaultConfig());
  assert.throws(() => validateConfigShape(null), /non-object/);
  assert.throws(() => validateConfigShape({}), /defaults/);
  const broken = defaultConfig();
  delete broken.providers.codex;
  assert.throws(() => validateConfigShape(broken), /providers\.codex/);
});

test("effectiveRetentionDays: per-provider override wins, defaults fallback", () => {
  const cfg = defaultConfig();
  assert.equal(effectiveRetentionDays(cfg, "codex"), 60);
  cfg.providers.codex.retentionDays = 7;
  assert.equal(effectiveRetentionDays(cfg, "codex"), 7);
});

test("moveToQuarantine: refuses a source outside sourceRoot (path traversal guard)", async () => {
  const root = await mkdtemp(join(tmpdir(), "alc-test-"));
  const sourceRoot = join(root, "sessions");
  const quarantineRoot = join(root, "quarantine");
  await mkdir(sourceRoot, { recursive: true });
  // a path *outside* sourceRoot
  const outside = join(root, "elsewhere.txt");
  await writeFile(outside, "hi");
  await assert.rejects(
    () =>
      moveToQuarantine({
        source: outside,
        sourceRoot,
        provider: "codex",
        quarantineRoot,
        today: "2026-06-25",
      }),
    /not inside sourceRoot/,
  );
});

test("moveToQuarantine: archives a real file and appends .2 on collision", async () => {
  const root = await mkdtemp(join(tmpdir(), "alc-test-"));
  const sourceRoot = join(root, "sessions");
  const quarantineRoot = join(root, "quarantine");
  const subDir = join(sourceRoot, "a");
  await mkdir(subDir, { recursive: true });

  // first archive
  const f1 = join(subDir, "x.jsonl");
  await writeFile(f1, "first");
  const target1 = await moveToQuarantine({
    source: f1,
    sourceRoot,
    provider: "codex",
    quarantineRoot,
    today: "2026-06-25",
  });
  assert.ok(existsSync(target1));
  assert.equal(existsSync(f1), false);

  // second archive of the same relpath → must NOT clobber the first
  const f2 = join(subDir, "x.jsonl");
  await writeFile(f2, "second");
  const target2 = await moveToQuarantine({
    source: f2,
    sourceRoot,
    provider: "codex",
    quarantineRoot,
    today: "2026-06-25",
  });
  assert.notEqual(target1, target2, "second archive should use a different name");
  assert.ok(target2.endsWith(".2.jsonl"), `expected suffix .2.jsonl, got ${target2}`);
  assert.ok(existsSync(target1), "original quarantined file must still exist");
  assert.ok(existsSync(target2));
});

test("package.json: runtime dependencies stay at zero (house rule)", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const deps = pkg.dependencies || {};
  assert.equal(
    Object.keys(deps).length,
    0,
    `runtime dependencies must remain empty (got ${Object.keys(deps).join(", ")})`,
  );
});

test("PROVIDER_REGISTRY: every provider exports the expected surface", async () => {
  const { PROVIDER_REGISTRY } = await import("../src/providers/index.mjs");
  for (const p of PROVIDERS) {
    const impl = PROVIDER_REGISTRY[p];
    assert.ok(impl, `missing PROVIDER_REGISTRY.${p}`);
    for (const method of ["detected", "scan", "totalSize", "ageRange"]) {
      assert.equal(typeof impl[method], "function", `${p}.${method} must be a function`);
    }
  }
});

test("quarantine layout sanity: archived file lives under quarantineRoot/today/provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "alc-test-"));
  const sourceRoot = join(root, "sessions");
  const quarantineRoot = join(root, "q");
  await mkdir(join(sourceRoot, "nested"), { recursive: true });
  const f = join(sourceRoot, "nested", "session.jsonl");
  await writeFile(f, "data");
  const target = await moveToQuarantine({
    source: f,
    sourceRoot,
    provider: "codex",
    quarantineRoot,
    today: "2026-06-25",
  });
  // Walk should find exactly one file under the day/provider dir
  const dayDir = join(quarantineRoot, "2026-06-25", "codex");
  const entries = await readdir(dayDir, { recursive: true });
  assert.ok(entries.length >= 1);
  assert.ok(target.startsWith(dayDir), `target should be under ${dayDir}, got ${target}`);
});

test("moveToQuarantine: path-traversal error message does not embed absolute paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "alc-test-"));
  const sourceRoot = join(root, "sessions");
  const quarantineRoot = join(root, "quarantine");
  await mkdir(sourceRoot, { recursive: true });
  const outside = join(root, "elsewhere.txt");
  await writeFile(outside, "hi");
  try {
    await moveToQuarantine({
      source: outside,
      sourceRoot,
      provider: "codex",
      quarantineRoot,
      today: "2026-06-25",
    });
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /not inside sourceRoot/);
    // Must not leak the absolute source path (drive letter or home-style root).
    assert.equal(
      /[A-Za-z]:[\\/]|\/(?:Users|home)\b/.test(err.message),
      false,
      `error leaked an absolute path: ${err.message}`,
    );
  }
});

test("parseConfigToml + mergeConfig: reads defaults and per-provider overrides", () => {
  const partial = parseConfigToml(`
# comment
[defaults]
retention_days = 30
delete = true

[providers.codex]
enabled = false
retention_days = 7
exclude_files = ["a/b.jsonl", "c.jsonl"]

[providers.unknown_future]
enabled = false
`);
  assert.equal(partial.defaults.retentionDays, 30);
  assert.equal(partial.defaults.delete, true);
  assert.equal(partial.providers.codex.enabled, false);
  assert.equal(partial.providers.codex.retentionDays, 7);
  assert.deepEqual(partial.providers.codex.excludeFiles, ["a/b.jsonl", "c.jsonl"]);

  const cfg = mergeConfig(defaultConfig(), partial);
  assert.equal(cfg.defaults.retentionDays, 30);
  assert.equal(cfg.defaults.delete, true);
  assert.equal(cfg.providers.codex.enabled, false);
  assert.equal(cfg.providers.codex.retentionDays, 7);
  // unknown_future is not a known PROVIDER — ignored, no new key
  assert.equal(cfg.providers.unknown_future, undefined);
  validateConfigShape(cfg);
});

test("parseConfigToml: CONFIG_TEMPLATE round-trips into a valid shape", () => {
  const partial = parseConfigToml(CONFIG_TEMPLATE);
  const cfg = mergeConfig(defaultConfig(), partial);
  validateConfigShape(cfg);
  assert.equal(cfg.providers.claude_code.enabled, false);
  assert.equal(cfg.providers.antigravity.enabled, true);
  assert.equal(cfg.providers.many_ai_cli.enabled, true);
  assert.deepEqual(cfg.providers.grok.excludeFiles, ["logs/unified.jsonl"]);
});

test("parseConfigToml: rejects bad types", () => {
  assert.throws(() => parseConfigToml("[defaults]\nretention_days = true\n"), /integer/);
  assert.throws(() => parseConfigToml("[defaults]\ndelete = yes\n"), /true\/false/);
  assert.throws(() => parseConfigToml("[defaults]\nretention_days = abc\n"), /integer/);
});

test("findSubcommandIndex: does not treat option values as subcommands", () => {
  // Regression: `ai-log-clean --provider list` used to route to `list`.
  assert.equal(findSubcommandIndex(["--provider", "list"]), -1);
  assert.equal(findSubcommandIndex(["--provider", "run"]), -1);
  assert.equal(findSubcommandIndex(["--retention-days", "30"]), -1);
  assert.equal(findSubcommandIndex(["--at", "12:00"]), -1);
  // Real subcommands still resolve (including after flags).
  assert.equal(findSubcommandIndex(["list"]), 0);
  assert.equal(findSubcommandIndex(["--yes", "install", "--at", "12:00"]), 1);
  assert.equal(findSubcommandIndex(["run", "--provider", "list"]), 0);
  // --key=value form
  assert.equal(findSubcommandIndex(["--provider=list"]), -1);
  assert.equal(findSubcommandIndex(["--provider=codex", "status"]), 1);
});

test("applyExcludeFiles: drops matching relative paths", () => {
  // Synthetic paths only — no real home-dir prefixes (secrets-scan).
  const candidates = [
    { path: "/tmp/alc-fixture/.grok/sessions/a", root: "/tmp/alc-fixture/.grok/sessions", size: 1 },
    { path: "/tmp/alc-fixture/.grok/logs/unified.jsonl", root: "/tmp/alc-fixture/.grok", size: 2 },
  ];
  const kept = applyExcludeFiles(candidates, ["logs/unified.jsonl"]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].path, "/tmp/alc-fixture/.grok/sessions/a");
  // empty exclude keeps all
  assert.equal(applyExcludeFiles(candidates, []).length, 2);
  assert.equal(applyExcludeFiles(candidates, undefined).length, 2);
});

test("isValidAt / normalizeAt: 24h clock bounds", () => {
  assert.equal(isValidAt("12:00"), true);
  assert.equal(isValidAt("0:00"), true);
  assert.equal(isValidAt("23:59"), true);
  assert.equal(isValidAt("9:05"), true);
  assert.equal(isValidAt("24:00"), false);
  assert.equal(isValidAt("12:60"), false);
  assert.equal(isValidAt("99:99"), false);
  assert.equal(isValidAt("noon"), false);
  assert.equal(isValidAt("12"), false);
  assert.equal(normalizeAt("9:05"), "09:05");
  assert.equal(normalizeAt("12:00"), "12:00");
});

test("conversationGroupKey: maps SQLite triple to the .db basename", () => {
  assert.equal(conversationGroupKey("/x/foo.db"), "foo.db");
  assert.equal(conversationGroupKey("/x/foo.db-shm"), "foo.db");
  assert.equal(conversationGroupKey("/x/foo.db-wal"), "foo.db");
  assert.equal(conversationGroupKey("/x/cli-2026.log"), null);
  assert.equal(conversationGroupKey("/x/foo.txt"), null);
});

test("buildNpxRunArgs: always uses npx -y github spec (no bunx)", async () => {
  const { buildNpxRunArgs, GITHUB_SPEC, buildWindowsRunPs1, buildLaunchAgentPlist, buildSystemdUnits, systemdQuote, parseAt } =
    await import("../src/scheduler/common.mjs");
  const args = buildNpxRunArgs({ retentionDays: 60 });
  assert.deepEqual(args, ["-y", GITHUB_SPEC, "run", "--retention-days", "60"]);
  assert.ok(args.includes("-y"));
  assert.ok(!args.some((a) => /bunx/i.test(a)));
  const withDel = buildNpxRunArgs({ retentionDays: 30, delete: true });
  assert.ok(withDel.includes("--delete"));

  const ps1 = buildWindowsRunPs1({
    npxPath: "C:\\Program Files\\nodejs\\npx.cmd",
    retentionDays: 60,
    delete: false,
  });
  assert.match(ps1, /npx\.cmd/);
  assert.match(ps1, /github:ishizakahiroshi\/ai-log-clean/);
  assert.match(ps1, /--retention-days/);
  assert.equal(ps1.includes("bunx"), false);

  const plist = buildLaunchAgentPlist({
    label: "com.ai-log-clean",
    npxPath: "/usr/local/bin/npx",
    retentionDays: 60,
    delete: false,
    at: "12:00",
    logPath: "/tmp/alc-fixture/cleanup.log",
  });
  assert.match(plist, /StartCalendarInterval/);
  assert.match(plist, /<integer>12<\/integer>/);
  assert.match(plist, /github:ishizakahiroshi\/ai-log-clean/);

  const { service, timer } = buildSystemdUnits({
    unitName: "ai-log-clean",
    npxPath: "/usr/bin/npx",
    retentionDays: 45,
    delete: true,
    at: "09:30",
  });
  assert.match(service, /Type=oneshot/);
  assert.match(service, /--delete/);
  assert.match(timer, /OnCalendar=\*-\*-\* 09:30:00/);
  assert.equal(parseAt("7:05").hour, 7);
  assert.equal(parseAt("7:05").minute, 5);
  assert.equal(systemdQuote("simple"), "simple");
  assert.match(systemdQuote("a b"), /"/);
});

test("buildTaskXml: daily trigger + wscript action", async () => {
  const { buildTaskXml } = await import("../src/scheduler/windows.mjs");
  const xml = buildTaskXml({
    wscript: "C:\\Windows\\System32\\wscript.exe",
    vbsPath: "C:\\tmp\\alc\\run-hidden.vbs",
    ps1Path: "C:\\tmp\\alc\\run.ps1",
    at: "12:00",
  });
  assert.match(xml, /ScheduleByDay/);
  assert.match(xml, /wscript\.exe/);
  assert.match(xml, /run-hidden\.vbs/);
  assert.match(xml, /run\.ps1/);
  assert.match(xml, /T12:00:00/);
});

test("systemdUsecToDate: parses usec and rejects n/a", async () => {
  const { systemdUsecToDate } = await import("../src/scheduler/linux.mjs");
  assert.equal(systemdUsecToDate("n/a"), null);
  assert.equal(systemdUsecToDate("0"), null);
  const d = systemdUsecToDate("1609459200000000"); // 2021-01-01T00:00:00Z
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString().startsWith("2021-01-01"), true);
});

test("tryParseDate + normalizeSchtasksLastResult: ja-JP schtasks forms", async () => {
  const { tryParseDate, normalizeSchtasksLastResult } = await import(
    "../src/scheduler/common.mjs"
  );
  const next = tryParseDate("2026/07/10 金 12:00:00");
  assert.ok(next instanceof Date);
  assert.equal(next.getFullYear(), 2026);
  assert.equal(next.getMonth(), 6);
  assert.equal(next.getDate(), 10);
  assert.equal(next.getHours(), 12);
  assert.equal(normalizeSchtasksLastResult("267011"), null); // HAS_NOT_RUN
  assert.equal(normalizeSchtasksLastResult("0"), 0);
  assert.equal(normalizeSchtasksLastResult("1"), 1);
  assert.equal(tryParseDate("N/A"), null);
});

test("maybeBumpCleanupPeriodDays: updates / declines / skips correctly", async () => {
  const { maybeBumpCleanupPeriodDays, readClaudeSettings } = await import(
    "../src/providers/claude-code-settings.mjs"
  );
  const root = await mkdtemp(join(tmpdir(), "alc-claude-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ cleanupPeriodDays: 30, other: true }, null, 2));

  // --yes bumps
  const updated = await maybeBumpCleanupPeriodDays({
    retentionDays: 60,
    yes: true,
    settingsPath,
  });
  assert.equal(updated.action, "updated");
  assert.equal(updated.from, 30);
  assert.equal(updated.to, 60);
  const after = await readClaudeSettings(settingsPath);
  assert.equal(after.cleanupPeriodDays, 60);
  assert.equal(after.settings.other, true, "unrelated keys must be preserved");

  // already sufficient
  const skip = await maybeBumpCleanupPeriodDays({
    retentionDays: 60,
    yes: true,
    settingsPath,
  });
  assert.equal(skip.action, "skipped");
  assert.equal(skip.reason, "already-sufficient");

  // decline via ask
  await writeFile(settingsPath, JSON.stringify({ cleanupPeriodDays: 20 }, null, 2));
  const declined = await maybeBumpCleanupPeriodDays({
    retentionDays: 60,
    yes: false,
    settingsPath,
    ask: async () => "n",
  });
  assert.equal(declined.action, "declined");
  const still = await readClaudeSettings(settingsPath);
  assert.equal(still.cleanupPeriodDays, 20);

  // missing file
  const missing = await maybeBumpCleanupPeriodDays({
    retentionDays: 60,
    yes: true,
    settingsPath: join(root, "nope.json"),
  });
  assert.equal(missing.action, "skipped");
  assert.equal(missing.reason, "no-settings-file");
});

// --- C1 output/last-run ---

test("formatRelative: past minutes / future hours / just now", async () => {
  const { formatRelative } = await import("../src/utils/output.mjs");
  const now = new Date("2026-07-10T12:00:00");
  assert.equal(formatRelative(new Date(now.getTime() - 5 * 60 * 1000), now), "5m ago");
  assert.equal(formatRelative(new Date(now.getTime() + 14 * 60 * 60 * 1000), now), "in 14h");
  assert.equal(formatRelative(new Date(now.getTime() - 10 * 1000), now), "just now");
  assert.equal(formatRelative(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), now), "in 3d");
});

test("formatBar: width and clamp at 0 / 1", async () => {
  const { formatBar } = await import("../src/utils/output.mjs");
  assert.equal(formatBar(0, 8), "░░░░░░░░");
  assert.equal(formatBar(1, 8), "████████");
  assert.equal(formatBar(0.5, 10).length, 10);
  assert.equal(formatBar(-1, 4), "░░░░");
  assert.equal(formatBar(2, 4), "████");
  const colored = formatBar(1, 4, { color: true });
  assert.match(colored, /████/);
  assert.ok(colored.includes("\x1b["));
  assert.equal(formatBar(0.5, 10, { color: false }).length, 10);
});

test("isPrettyStdout: NO_COLOR forces false", async () => {
  const { isPrettyStdout } = await import("../src/utils/output.mjs");
  assert.equal(isPrettyStdout({ isTTY: true }, { NO_COLOR: "1" }), false);
  assert.equal(isPrettyStdout({ isTTY: true }, {}), true);
  assert.equal(isPrettyStdout({ isTTY: false }, {}), false);
});

test("formatLocalDateTime: YYYY-MM-DD HH:mm shape", async () => {
  const { formatLocalDateTime } = await import("../src/utils/output.mjs");
  const s = formatLocalDateTime(new Date(2026, 6, 10, 9, 5)); // local July 10
  assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(s, "2026-07-10 09:05");
});

test("last-run: write → read round-trip; bad JSON → null", async () => {
  const { writeLastRun, readLastRun } = await import("../src/utils/last-run.mjs");
  const root = await mkdtemp(join(tmpdir(), "alc-lastrun-"));
  const path = join(root, "logs", "last-run.json");
  const summary = {
    finishedAt: "2026-07-10T12:00:00.000Z",
    exitCode: 0,
    dryRun: false,
    mode: "archive",
    totals: { files: 3, bytes: 1024 },
    byProvider: { codex: { files: 3, bytes: 1024, action: "archive" } },
  };
  await writeLastRun(summary, { path });
  const got = await readLastRun({ path });
  assert.deepEqual(got, summary);

  await writeFile(path, "{not json", "utf8");
  assert.equal(await readLastRun({ path }), null);
  assert.equal(await readLastRun({ path: join(root, "missing.json") }), null);
});
