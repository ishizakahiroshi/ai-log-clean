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
] as const;

export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderConfig {
  enabled: boolean;
  retentionDays?: number;
  excludeFiles?: string[];
}

export interface AiLogCleanConfig {
  defaults: {
    retentionDays: number;
    delete: boolean;
  };
  providers: Record<ProviderName, ProviderConfig>;
}

export const CONFIG_DIR = join(homedir(), ".ai-log-clean");
export const CONFIG_FILE = join(CONFIG_DIR, "config.toml");
export const QUARANTINE_DIR = join(CONFIG_DIR, "quarantine");
export const LOG_FILE = join(CONFIG_DIR, "cleanup.log");

export function defaultConfig(): AiLogCleanConfig {
  return {
    defaults: {
      retentionDays: 60,
      delete: false,
    },
    providers: {
      claude_code: { enabled: false }, // defer to Claude Code's own cleanupPeriodDays
      codex: { enabled: true },
      copilot: { enabled: true },
      cursor_agent: { enabled: true },
      opencode: { enabled: true },
      grok: { enabled: true, excludeFiles: ["logs/unified.jsonl"] },
    },
  };
}

/**
 * Resolve effective retention for a provider: per-provider override or default.
 */
export function effectiveRetentionDays(
  cfg: AiLogCleanConfig,
  provider: ProviderName,
): number {
  return cfg.providers[provider].retentionDays ?? cfg.defaults.retentionDays;
}

/**
 * Load config.toml from disk. Returns defaults if the file does not exist.
 * TODO: wire a TOML parser (e.g. `@iarna/toml` or `smol-toml`) and validate.
 */
export async function loadConfig(): Promise<AiLogCleanConfig> {
  // TODO: read CONFIG_FILE and parse. For now, defaults only.
  return defaultConfig();
}

/**
 * Write a config template to ~/.ai-log-clean/config.toml.
 * Used by the `init` subcommand.
 */
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
