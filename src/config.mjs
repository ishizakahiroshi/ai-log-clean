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
 * A zero-dependency TOML subset parser covers the keys above. Unknown keys
 * and sections are ignored so a future schema can grow without breaking
 * older clients. Missing file → defaults only.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDERS = [
  "claude_code",
  "codex",
  "copilot",
  "cursor_agent",
  "opencode",
  "grok",
  "antigravity",
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
      antigravity: { enabled: true },
    },
  };
}

export function effectiveRetentionDays(cfg, provider) {
  return cfg.providers[provider].retentionDays ?? cfg.defaults.retentionDays;
}

/**
 * Parse the supported subset of TOML used by ai-log-clean.
 * Returns a partial config object (only keys that appeared in the file).
 * Throws Error with a human-readable message on syntax / type errors.
 *
 * Supported:
 *   - `#` line comments and trailing comments
 *   - `[defaults]`, `[providers.<name>]` section headers
 *   - keys: retention_days (int), delete (bool), enabled (bool),
 *           exclude_files (array of strings)
 *   - values: bare integers, true/false, "double-quoted" strings,
 *             ["a", "b"] string arrays
 */
export function parseConfigToml(text) {
  const partial = { defaults: {}, providers: {} };
  let section = null; // "defaults" | { provider: name }

  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    // strip comments: only unquoted # (we have no multiline strings)
    let line = stripTomlComment(lines[i]).trim();
    if (!line) continue;

    if (line.startsWith("[")) {
      const m = line.match(/^\[([^\]]+)\]$/);
      if (!m) throw new Error(`line ${lineNo}: malformed section header`);
      const header = m[1].trim();
      if (header === "defaults") {
        section = "defaults";
      } else if (header.startsWith("providers.")) {
        const name = header.slice("providers.".length);
        if (!name || name.includes(".")) {
          // nested beyond providers.<name> is ignored as unknown section
          section = null;
        } else {
          if (!partial.providers[name]) partial.providers[name] = {};
          section = { provider: name };
        }
      } else {
        section = null; // unknown section — skip its keys
      }
      continue;
    }

    if (section === null) continue; // key outside a known section

    const eq = line.indexOf("=");
    if (eq === -1) throw new Error(`line ${lineNo}: expected key = value`);
    const key = line.slice(0, eq).trim();
    const raw = line.slice(eq + 1).trim();
    if (!key) throw new Error(`line ${lineNo}: empty key`);

    if (section === "defaults") {
      if (key === "retention_days") {
        partial.defaults.retentionDays = parseTomlInt(raw, lineNo);
      } else if (key === "delete") {
        partial.defaults.delete = parseTomlBool(raw, lineNo);
      }
      // unknown defaults keys ignored
    } else if (section && section.provider) {
      const p = partial.providers[section.provider];
      if (key === "enabled") {
        p.enabled = parseTomlBool(raw, lineNo);
      } else if (key === "retention_days") {
        p.retentionDays = parseTomlInt(raw, lineNo);
      } else if (key === "exclude_files") {
        p.excludeFiles = parseTomlStringArray(raw, lineNo);
      }
      // unknown provider keys ignored
    }
  }
  return partial;
}

function stripTomlComment(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
      inQuote = !inQuote;
    } else if (ch === "#" && !inQuote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlInt(raw, lineNo) {
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`line ${lineNo}: expected integer, got ${JSON.stringify(raw)}`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`line ${lineNo}: invalid integer ${JSON.stringify(raw)}`);
  }
  return n;
}

function parseTomlBool(raw, lineNo) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`line ${lineNo}: expected true/false, got ${JSON.stringify(raw)}`);
}

function parseTomlString(raw, lineNo) {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) {
    throw new Error(`line ${lineNo}: expected "string", got ${JSON.stringify(raw)}`);
  }
  // minimal unescape for \" and \\
  return raw.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

function parseTomlStringArray(raw, lineNo) {
  if (!(raw.startsWith("[") && raw.endsWith("]"))) {
    throw new Error(`line ${lineNo}: expected string array, got ${JSON.stringify(raw)}`);
  }
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  // split on commas not inside quotes
  const parts = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && (i === 0 || inner[i - 1] !== "\\")) {
      inQuote = !inQuote;
      cur += ch;
    } else if (ch === "," && !inQuote) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((p) => parseTomlString(p, lineNo));
}

/**
 * Deep-merge a partial config (from TOML) onto a full defaultConfig() clone.
 * Unknown provider names in the file are ignored (not added to the shape).
 */
export function mergeConfig(base, partial) {
  if (partial.defaults) {
    if (typeof partial.defaults.retentionDays === "number") {
      base.defaults.retentionDays = partial.defaults.retentionDays;
    }
    if (typeof partial.defaults.delete === "boolean") {
      base.defaults.delete = partial.defaults.delete;
    }
  }
  if (partial.providers) {
    for (const name of PROVIDERS) {
      const src = partial.providers[name];
      if (!src) continue;
      if (typeof src.enabled === "boolean") base.providers[name].enabled = src.enabled;
      if (typeof src.retentionDays === "number") {
        base.providers[name].retentionDays = src.retentionDays;
      }
      if (Array.isArray(src.excludeFiles)) {
        base.providers[name].excludeFiles = src.excludeFiles.slice();
      }
    }
  }
  return base;
}

export async function loadConfig() {
  const cfg = defaultConfig();
  if (existsSync(CONFIG_FILE)) {
    let text;
    try {
      text = await readFile(CONFIG_FILE, "utf8");
    } catch (err) {
      throw new Error(
        `cannot read ${CONFIG_FILE}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const partial = parseConfigToml(text);
      mergeConfig(cfg, partial);
    } catch (err) {
      throw new Error(
        `invalid config.toml (${CONFIG_FILE}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  // Soft validation of numeric ranges after merge so a hand-edited file
  // with retention_days = 0 or a negative value fails loudly rather than
  // producing an Invalid Date cutoff later in run.mjs.
  if (!Number.isFinite(cfg.defaults.retentionDays) || cfg.defaults.retentionDays < 1) {
    throw new Error(
      `config.toml: defaults.retention_days must be a positive integer (got ${cfg.defaults.retentionDays})`,
    );
  }
  for (const name of PROVIDERS) {
    const d = cfg.providers[name].retentionDays;
    if (d !== undefined && (!Number.isFinite(d) || d < 1)) {
      throw new Error(
        `config.toml: providers.${name}.retention_days must be a positive integer (got ${d})`,
      );
    }
  }
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

[providers.antigravity]
enabled = true
`;
