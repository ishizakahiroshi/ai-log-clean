/**
 * config.toml loader.
 *
 * Schema (all fields optional):
 *
 *   [defaults]
 *   retention_days = 60
 *   delete         = false
 *
 *   [providers.<name>]
 *   enabled        = true
 *   retention_days = <override>           # falls back to defaults.retention_days
 *   exclude_files  = ["relative/path", ...]
 *
 * Loading is deliberately lazy: until a TOML parser is wired in, this module
 * exposes `defaultConfig()` so other modules can be built against the shape.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDERS = [
  "claude_code",
  "codex",
  "copilot",
  "cursor_agent",
  "opencode",
  "grok",
];

export const CONFIG_DIR = join(homedir(), ".ai-log-clean");
export const CONFIG_FILE = join(CONFIG_DIR, "config.toml");
export const QUARANTINE_DIR = join(CONFIG_DIR, "quarantine");
export const LOG_FILE = join(CONFIG_DIR, "cleanup.log");

export function defaultConfig() {
  return {
    defaults: {
      retentionDays: 60,
      delete: false,
    },
    providers: {
      claude_code: { enabled: false },
      codex: { enabled: true },
      copilot: { enabled: true },
      cursor_agent: { enabled: true },
      opencode: { enabled: true },
      grok: { enabled: true, excludeFiles: ["logs/unified.jsonl"] },
    },
  };
}

export function effectiveRetentionDays(cfg, provider) {
  return cfg.providers[provider].retentionDays ?? cfg.defaults.retentionDays;
}

export async function loadConfig() {
  // TODO: wire a TOML parser and read CONFIG_FILE. For now, defaults only.
  const cfg = defaultConfig();
  validateConfigShape(cfg);
  return cfg;
}

/**
 * Guarantees the invariant downstream code relies on: every name in
 * PROVIDERS has a corresponding `cfg.providers[name]` entry with an
 * `enabled` field. Catches drift between PROVIDERS and defaultConfig() /
 * a future TOML loader before it shows up as a runtime TypeError in
 * `run.mjs` or `list.mjs`.
 */
export function validateConfigShape(cfg) {
  if (!cfg || typeof cfg !== "object") {
    throw new Error("loadConfig: returned non-object");
  }
  if (!cfg.defaults || typeof cfg.defaults.retentionDays !== "number") {
    throw new Error("loadConfig: missing defaults.retentionDays");
  }
  if (typeof cfg.defaults.delete !== "boolean") {
    throw new Error("loadConfig: missing defaults.delete");
  }
  if (!cfg.providers || typeof cfg.providers !== "object") {
    throw new Error("loadConfig: missing providers");
  }
  for (const name of PROVIDERS) {
    const p = cfg.providers[name];
    if (!p || typeof p.enabled !== "boolean") {
      throw new Error(`loadConfig: providers.${name}.enabled missing or not boolean`);
    }
  }
}

export const CONFIG_TEMPLATE = `# ai-log-clean config
# Documentation: https://github.com/ishizakahiroshi/ai-log-clean

[defaults]
retention_days = 60
delete         = false   # archive by default; set true (or pass --delete) to remove

[providers.claude_code]
enabled = false          # defer to Claude Code's own cleanupPeriodDays

[providers.codex]
enabled = true

[providers.copilot]
enabled = true

[providers.cursor_agent]
enabled = true

[providers.opencode]
enabled = true

[providers.grok]
enabled       = true
exclude_files = ["logs/unified.jsonl"]
`;
