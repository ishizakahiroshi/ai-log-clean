/** `doctor` subcommand: self-check runtime, scheduler, config, providers. */
import { loadConfig, PROVIDERS } from "../config.mjs";
import { PROVIDER_REGISTRY } from "../providers/index.mjs";
import { currentScheduler } from "../scheduler/index.mjs";
import { resolveNpxPath, GITHUB_SPEC } from "../scheduler/common.mjs";
import { readLastRun } from "../utils/last-run.mjs";
import { readClaudeSettings } from "../providers/claude-code-settings.mjs";
import { providerPolicy } from "../utils/provider-policy.mjs";

const LABEL_WIDTH = 10;
const INSTALL_HINT = `run: npx -y ${GITHUB_SPEC} install`;
const ENABLE_HINT = `run: npx -y ${GITHUB_SPEC} enable`;
const NODE_HINT = "install Node.js 20+ (includes npx), then re-check";

/**
 * Node major >= 20.
 * @param {string} [version] process.version-style (e.g. "v22.11.0")
 * @returns {{ id: string, label: string, status: 'ok'|'!!'|'--', detail: string, fix?: string }}
 */
export function checkNodeVersion(version = process.version) {
  const m = String(version).match(/v?(\d+)/);
  const major = m ? Number(m[1]) : 0;
  if (major >= 20) {
    return {
      id: "node",
      label: "Node",
      status: "ok",
      detail: `v${major}.x`,
    };
  }
  return {
    id: "node",
    label: "Node",
    status: "!!",
    detail: major > 0 ? `v${major}.x (need >= 20)` : "unknown (need >= 20)",
    fix: NODE_HINT,
  };
}

/**
 * npx path resolution result.
 * @param {string|null|undefined} npxPath absolute path when found
 * @param {Error|string|null} [error] set when resolve failed
 */
export function checkNpx(npxPath, error = null) {
  if (npxPath) {
    return { id: "npx", label: "npx", status: "ok", detail: String(npxPath) };
  }
  const msg =
    error instanceof Error
      ? error.message
      : error
        ? String(error)
        : "not found on PATH";
  return {
    id: "npx",
    label: "npx",
    status: "!!",
    detail: msg.includes("\n") ? "not found on PATH" : msg,
    fix: NODE_HINT,
  };
}

/**
 * Scheduler installed + enabled.
 * @param {{ installed?: boolean, enabled?: boolean }} schedule
 */
export function checkSchedule(schedule = {}) {
  if (!schedule.installed) {
    return {
      id: "schedule",
      label: "Schedule",
      status: "!!",
      detail: "not installed",
      fix: INSTALL_HINT,
    };
  }
  if (!schedule.enabled) {
    return {
      id: "schedule",
      label: "Schedule",
      status: "!!",
      detail: "installed · disabled",
      fix: ENABLE_HINT,
    };
  }
  return {
    id: "schedule",
    label: "Schedule",
    status: "ok",
    detail: "installed · enabled",
  };
}

/**
 * Last exit: prefer last-run.json exitCode; else scheduler lastExitCode.
 * Missing → status `--` (not a failure). Non-zero → `!!`.
 * @param {{ lastRun?: object|null, scheduleLastExitCode?: number|null }} opts
 */
export function checkLastExit({ lastRun = null, scheduleLastExitCode = null } = {}) {
  let code = null;
  if (
    lastRun != null &&
    typeof lastRun === "object" &&
    lastRun.exitCode !== undefined &&
    lastRun.exitCode !== null
  ) {
    code = Number(lastRun.exitCode);
  } else if (scheduleLastExitCode !== undefined && scheduleLastExitCode !== null) {
    code = Number(scheduleLastExitCode);
  }

  if (code === null || !Number.isFinite(code)) {
    return {
      id: "lastExit",
      label: "Last exit",
      status: "--",
      detail: "no prior run",
    };
  }
  if (code === 0) {
    return {
      id: "lastExit",
      label: "Last exit",
      status: "ok",
      detail: "0",
    };
  }
  return {
    id: "lastExit",
    label: "Last exit",
    status: "!!",
    detail: String(code),
    fix: "run: npx -y github:ishizakahiroshi/ai-log-clean run --dry-run",
  };
}

/**
 * @param {{ ok: boolean, error?: Error|string|null }} opts
 */
export function checkConfig({ ok, error = null } = { ok: true }) {
  if (ok) {
    return { id: "config", label: "Config", status: "ok", detail: "" };
  }
  const msg =
    error instanceof Error
      ? error.message
      : error
        ? String(error)
        : "invalid config";
  // Keep one short line
  const short = msg.split("\n")[0].slice(0, 80);
  return {
    id: "config",
    label: "Config",
    status: "!!",
    detail: short,
    fix: "fix ~/.ai-log-clean/config.toml (or delete it to use defaults)",
  };
}

/**
 * @param {{ detected: number, total: number }} opts
 */
export function checkProviders({ detected = 0, total = PROVIDERS.length } = {}) {
  return {
    id: "providers",
    label: "Providers",
    status: "ok",
    detail: `${detected}/${total} detected`,
  };
}

export function checkClaudeSettings({ enabled, retentionDays, info = null, error = null } = {}) {
  const policy = providerPolicy({
    provider: "claude_code",
    enabled: Boolean(enabled),
    retentionDays: retentionDays ?? 60,
    claudeSettings: info,
  });
  const state = error ? "unreadable" : info?.exists ? "ok" : "missing";
  const management = policy.cleaned_by_ai_log_clean ? "ai-log-clean-managed" : "body-managed";
  return {
    id: "claude",
    label: "Claude",
    status: error ? "!!" : info?.exists ? "ok" : "--",
    detail: `${state} · cleanupPeriodDays=${policy.cleanup_period_days} (${policy.cleanup_period_source}) · enabled=${Boolean(enabled)} · ${management}`,
    fix: error ? "fix ~/.claude/settings.json, then re-run doctor" : undefined,
  };
}

/**
 * Format doctor report lines + exit code from check results.
 * @param {Array<{ label: string, status: string, detail?: string, fix?: string }>} results
 * @returns {{ exitCode: 0|1, lines: string[], fixLines: string[] }}
 */
export function summarizeChecks(results) {
  const lines = ["doctor"];
  const fixLines = [];
  let hasProblem = false;

  for (const r of results) {
    if (r.status === "!!") hasProblem = true;
    lines.push(formatCheckLine(r));
    if (r.status === "!!" && r.fix && fixLines.length < 3) {
      fixLines.push(`  ${r.label.padEnd(LABEL_WIDTH)}${r.fix}`);
    }
  }

  if (fixLines.length > 0) {
    lines.push("");
    lines.push("Fix");
    for (const f of fixLines) lines.push(f);
  }

  return {
    exitCode: hasProblem ? 1 : 0,
    lines,
    fixLines,
  };
}

function formatCheckLine(r) {
  const status = String(r.status).padEnd(4);
  const detail = r.detail ? ` ${r.detail}` : "";
  return `  ${r.label.padEnd(LABEL_WIDTH)}${status}${detail}`;
}

/**
 * @param {string[]} _argv unused (no flags yet)
 * @returns {Promise<number>} 0 all ok / neutral, 1 if any !!
 */
export async function run(_argv) {
  const results = [];

  results.push(checkNodeVersion(process.version));

  let npxPath = null;
  let npxErr = null;
  try {
    npxPath = await resolveNpxPath();
  } catch (err) {
    npxErr = err;
  }
  results.push(checkNpx(npxPath, npxErr));

  let schedule = { installed: false, enabled: false };
  try {
    schedule = await currentScheduler().status();
  } catch {
    schedule = { installed: false, enabled: false };
  }
  results.push(checkSchedule(schedule));

  const lastRun = await readLastRun();
  results.push(
    checkLastExit({
      lastRun,
      scheduleLastExitCode: schedule.lastExitCode ?? null,
    }),
  );

  let configOk = true;
  let configErr = null;
  let cfg = null;
  try {
    cfg = await loadConfig();
  } catch (err) {
    configOk = false;
    configErr = err;
  }
  results.push(checkConfig({ ok: configOk, error: configErr }));

  let claudeInfo = null;
  let claudeError = null;
  try {
    claudeInfo = await readClaudeSettings();
  } catch (err) {
    claudeError = err;
  }
  results.push(
    checkClaudeSettings({
      enabled: cfg?.providers?.claude_code?.enabled ?? false,
      retentionDays: cfg?.providers?.claude_code?.retentionDays ?? cfg?.defaults?.retentionDays ?? 60,
      info: claudeInfo,
      error: claudeError,
    }),
  );

  let detected = 0;
  for (const name of PROVIDERS) {
    const impl = PROVIDER_REGISTRY[name];
    try {
      if (impl && (await impl.detected())) detected += 1;
    } catch {
      // treat as not detected
    }
  }
  results.push(checkProviders({ detected, total: PROVIDERS.length }));

  const { exitCode, lines } = summarizeChecks(results);
  process.stdout.write(lines.join("\n") + "\n");
  return exitCode;
}
