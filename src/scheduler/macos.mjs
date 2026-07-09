/**
 * macOS scheduler implementation.
 *
 *   plist     : ~/Library/LaunchAgents/com.ai-log-clean.plist
 *   trigger   : StartCalendarInterval matching --at
 *   load      : launchctl bootstrap gui/$UID <plist>
 *
 * LaunchAgent runs in the user's GUI session, no sudo / no elevation.
 * Output is captured to ~/.ai-log-clean/cleanup.log.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LOG_FILE, CONFIG_DIR } from "../config.mjs";
import {
  buildLaunchAgentPlist,
  resolveNpxPath,
  runCommand,
  tryParseDate,
  TASK_LABEL,
} from "./common.mjs";

export const LABEL = `com.${TASK_LABEL}`;

function plistPath() {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function guiDomain() {
  // launchctl modern domains: gui/<uid>
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `gui/${uid}`;
}

function serviceTarget() {
  return `${guiDomain()}/${LABEL}`;
}

export async function install(opts) {
  const npxPath = await resolveNpxPath();
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });

  const plist = buildLaunchAgentPlist({
    label: LABEL,
    npxPath,
    retentionDays: opts.retentionDays,
    delete: Boolean(opts.delete),
    at: opts.at,
    logPath: LOG_FILE,
  });
  const path = plistPath();

  // bootout first for idempotent re-install (ignore failure if not loaded)
  await runCommand("launchctl", ["bootout", serviceTarget()]).catch(() => {});
  await writeFile(path, plist, { encoding: "utf8", mode: 0o644 });

  const boot = await runCommand("launchctl", ["bootstrap", guiDomain(), path]);
  if (boot.code !== 0) {
    // Older macOS fallback: load -w
    const load = await runCommand("launchctl", ["load", "-w", path]);
    if (load.code !== 0) {
      throw new Error(
        `launchctl bootstrap/load failed: ${(boot.stderr || boot.stdout || load.stderr || load.stdout).trim()}`,
      );
    }
  }
  // Ensure enabled
  await runCommand("launchctl", ["enable", serviceTarget()]).catch(() => {});
}

export async function uninstall() {
  await runCommand("launchctl", ["bootout", serviceTarget()]).catch(() => {});
  await runCommand("launchctl", ["unload", "-w", plistPath()]).catch(() => {});
  const path = plistPath();
  if (existsSync(path)) {
    await rm(path, { force: true });
  }
}

export async function disable() {
  const r = await runCommand("launchctl", ["disable", serviceTarget()]);
  if (r.code !== 0) {
    // fallback: unload without deleting plist
    const u = await runCommand("launchctl", ["unload", plistPath()]);
    if (u.code !== 0) {
      throw new Error(
        `launchctl disable failed: ${(r.stderr || r.stdout || u.stderr || "").trim()}`,
      );
    }
  }
}

export async function enable() {
  const r = await runCommand("launchctl", ["enable", serviceTarget()]);
  if (r.code !== 0) {
    const path = plistPath();
    if (!existsSync(path)) {
      throw new Error(`LaunchAgent plist missing at ${path}; run install first`);
    }
    const load = await runCommand("launchctl", ["load", "-w", path]);
    if (load.code !== 0) {
      throw new Error(
        `launchctl enable/load failed: ${(r.stderr || load.stderr || "").trim()}`,
      );
    }
  }
}

export async function status() {
  const path = plistPath();
  const installed = existsSync(path);
  if (!installed) {
    return { installed: false, enabled: false };
  }

  const print = await runCommand("launchctl", ["print", serviceTarget()]);
  if (print.code !== 0) {
    // plist exists but not loaded → installed but disabled
    return { installed: true, enabled: false };
  }

  const text = print.stdout || "";
  // "state = running|active|..." / "runs = N"
  const enabled = !/state\s*=\s*not running/i.test(text) || /path\s*=/.test(text);
  // Better: if print succeeds the job is registered in the domain
  const disabled = /disabled\s*=\s*1|runs\s*=\s*0[\s\S]*state\s*=\s*not running/i.test(text);

  // last exit status: "last exit code = 0" (varies by OS version)
  let lastExitCode = null;
  const exitMatch = text.match(/last exit code\s*=\s*(-?\d+)/i) ||
    text.match(/exit code\s*=\s*(-?\d+)/i);
  if (exitMatch) lastExitCode = Number.parseInt(exitMatch[1], 10);

  // next run is not always exposed; leave null if unknown
  let nextRun = null;
  const nextMatch = text.match(/next run time\s*=\s*(.+)/i);
  if (nextMatch) nextRun = tryParseDate(nextMatch[1].trim());

  return {
    installed: true,
    enabled: !disabled,
    nextRun,
    lastRun: null,
    lastExitCode,
  };
}
