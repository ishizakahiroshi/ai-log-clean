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
} from "../src/config.mjs";
import {
  formatSize,
  todayStamp,
  moveToQuarantine,
} from "../src/utils/fs.mjs";

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
