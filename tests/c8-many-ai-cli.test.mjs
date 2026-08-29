/**
 * many-ai-cli provider scope tests.
 *
 * The failure mode this guards against is not "misses a log" but "deletes a
 * config": every <vendor>/<profile>/ root under subscriptions/ is a live CLI
 * HOME holding settings, workbench sources and history, sitting right next to
 * the transcripts we do want to prune. These tests pin the boundary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OLD = new Date("2020-01-01T00:00:00Z");

/** Create a file (parents included) and backdate it well past any cutoff. */
async function aged(path, body = "x") {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body);
  await utimes(path, OLD, OLD);
}

/**
 * Build a fake home containing one profile per vendor, then point homedir()
 * at it. Returns the provider module and the subscriptions root.
 */
async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), "alc-many-"));
  const subs = join(home, ".many-ai-cli", "subscriptions");

  // claude profile: transcripts + live state that must survive
  const claude = join(subs, "claude", "profile-a");
  await aged(join(claude, "projects", "D--work-repo", "session.jsonl"));
  await aged(join(claude, "projects", "D--work-repo", "index.json"));
  await aged(join(claude, ".claude.json"));
  await aged(join(claude, "history.jsonl"));
  await aged(join(claude, "workbench", "tool.py"));

  // codex profile: only rollout-*.jsonl is in scope
  const codex = join(subs, "codex", "profile-b");
  await aged(join(codex, "sessions", "2026", "01", "01", "rollout-abc.jsonl"));
  await aged(join(codex, "sessions", "2026", "01", "01", "notes.jsonl"));
  await aged(join(codex, "session_index.jsonl"));

  // grok profile: one directory per session, two levels down
  const grok = join(subs, "grok", "profile-c");
  await aged(join(grok, "sessions", "D%3A%5Cwork", "0000-uuid", "turn.json"));
  await aged(join(grok, "logs", "unified.jsonl"));

  // a vendor with no native provider must be skipped, not guessed at
  await aged(join(subs, "futurevendor", "profile-d", "sessions", "thing.jsonl"));

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const provider = await import("../src/providers/many-ai-cli.mjs");
  return { provider, subs };
}

test("many_ai_cli: scans transcripts only, never the profile root", async () => {
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  try {
    const { provider, subs } = await fakeHome();
    assert.equal(provider.name, "many_ai_cli");
    assert.equal(await provider.detected(), true);
    assert.equal(provider.sessionsDir(), subs);

    const found = (await provider.scan(new Date())).map((e) => e.path).sort();
    const expected = [
      join(subs, "claude", "profile-a", "projects", "D--work-repo", "session.jsonl"),
      join(subs, "codex", "profile-b", "sessions", "2026", "01", "01", "rollout-abc.jsonl"),
      join(subs, "grok", "profile-c", "sessions", "D%3A%5Cwork", "0000-uuid"),
    ].sort();
    assert.deepEqual(found, expected);

    // Spell the exclusions out: a regression here destroys user data.
    const joined = found.join("\n");
    for (const mustNotAppear of [
      ".claude.json",
      "history.jsonl",
      "session_index.jsonl",
      "index.json",
      "tool.py",
      "notes.jsonl",
      "unified.jsonl",
      "futurevendor",
    ]) {
      assert.ok(
        !joined.includes(mustNotAppear),
        `${mustNotAppear} must stay out of scope, got:\n${joined}`,
      );
    }
  } finally {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedUserProfile;
  }
});

test("many_ai_cli: entries carry the subscriptions root and the right kind", async () => {
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  try {
    const { provider, subs } = await fakeHome();
    const entries = await provider.scan(new Date());
    for (const e of entries) {
      assert.equal(e.root, subs, "root must be the subscriptions dir so restore can rebuild the path");
      assert.ok(e.path.startsWith(subs), "scanned path must live under root");
      assert.ok(e.size > 0);
      assert.ok(e.lastWriteTime instanceof Date);
    }
    const kinds = Object.fromEntries(entries.map((e) => [e.path.split(/[\\/]/).slice(-1)[0], e.kind]));
    assert.equal(kinds["session.jsonl"], "file");
    assert.equal(kinds["rollout-abc.jsonl"], "file");
    assert.equal(kinds["0000-uuid"], "directory");
  } finally {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedUserProfile;
  }
});

test("many_ai_cli: cutoff excludes recent entries", async () => {
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  try {
    const { provider } = await fakeHome();
    const beforeEverything = new Date("2019-01-01T00:00:00Z");
    assert.deepEqual(await provider.scan(beforeEverything), []);
    assert.ok((await provider.totalSize()) > 0);
    const { oldest, newest } = await provider.ageRange();
    assert.ok(oldest instanceof Date);
    assert.ok(newest instanceof Date);
  } finally {
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedUserProfile;
  }
});
