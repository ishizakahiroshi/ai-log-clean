/**
 * Linux scheduler implementation.
 *
 *   units     : ~/.config/systemd/user/ai-log-clean.{service,timer}
 *   trigger   : OnCalendar=*-*-* <at>:00
 *   enable    : systemctl --user enable --now ai-log-clean.timer
 *
 * --user systemd, no sudo. When XDG_RUNTIME_DIR is missing (some headless
 * setups) we still write the units and print a linger hint — we never run
 * `loginctl enable-linger` ourselves.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildSystemdUnits,
  resolveNpxPath,
  runCommand,
  tryParseDate,
  TASK_LABEL,
} from "./common.mjs";

export const UNIT_NAME = TASK_LABEL;

function unitDir() {
  return join(homedir(), ".config", "systemd", "user");
}

function servicePath() {
  return join(unitDir(), `${UNIT_NAME}.service`);
}

function timerPath() {
  return join(unitDir(), `${UNIT_NAME}.timer`);
}

async function systemctl(args) {
  return runCommand("systemctl", ["--user", ...args]);
}

export async function install(opts) {
  const npxPath = await resolveNpxPath();
  const { service, timer } = buildSystemdUnits({
    unitName: UNIT_NAME,
    npxPath,
    retentionDays: opts.retentionDays,
    delete: Boolean(opts.delete),
    at: opts.at,
  });

  await mkdir(unitDir(), { recursive: true, mode: 0o755 });
  await writeFile(servicePath(), service, { encoding: "utf8", mode: 0o644 });
  await writeFile(timerPath(), timer, { encoding: "utf8", mode: 0o644 });

  const reload = await systemctl(["daemon-reload"]);
  if (reload.code !== 0) {
    const hint = lingerHint();
    throw new Error(
      `systemctl --user daemon-reload failed (exit ${reload.code}): ${(reload.stderr || reload.stdout).trim()}${hint}`,
    );
  }

  // Idempotent: disable first is unnecessary; enable --now restarts the timer
  const enable = await systemctl(["enable", "--now", `${UNIT_NAME}.timer`]);
  if (enable.code !== 0) {
    const hint = lingerHint();
    throw new Error(
      `systemctl --user enable --now ${UNIT_NAME}.timer failed (exit ${enable.code}): ${(enable.stderr || enable.stdout).trim()}${hint}`,
    );
  }

  if (!process.env.XDG_RUNTIME_DIR) {
    process.stderr.write(
      "note: XDG_RUNTIME_DIR is unset. On headless hosts the timer may not fire until you run `loginctl enable-linger $USER` (we will not run it for you).\n",
    );
  }
}

function lingerHint() {
  return (
    "\nIf this is a headless host without a user session, you may need " +
    "`loginctl enable-linger $USER` (not run automatically by ai-log-clean)."
  );
}

export async function uninstall() {
  await systemctl(["disable", "--now", `${UNIT_NAME}.timer`]).catch(() => {});
  await systemctl(["daemon-reload"]).catch(() => {});
  for (const p of [servicePath(), timerPath()]) {
    if (existsSync(p)) {
      await rm(p, { force: true });
    }
  }
  await systemctl(["daemon-reload"]).catch(() => {});
}

export async function disable() {
  const r = await systemctl(["stop", `${UNIT_NAME}.timer`]);
  if (r.code !== 0) {
    throw new Error(
      `systemctl --user stop ${UNIT_NAME}.timer failed: ${(r.stderr || r.stdout).trim()}`,
    );
  }
}

export async function enable() {
  const r = await systemctl(["start", `${UNIT_NAME}.timer`]);
  if (r.code !== 0) {
    // if units missing, enable --now after install is the right path
    const e = await systemctl(["enable", "--now", `${UNIT_NAME}.timer`]);
    if (e.code !== 0) {
      throw new Error(
        `systemctl --user start/enable ${UNIT_NAME}.timer failed: ${(r.stderr || e.stderr || "").trim()}`,
      );
    }
  }
}

export async function status() {
  const installed = existsSync(timerPath()) || existsSync(servicePath());
  if (!installed) {
    return { installed: false, enabled: false };
  }

  const isActive = await systemctl(["is-active", `${UNIT_NAME}.timer`]);
  const isEnabled = await systemctl(["is-enabled", `${UNIT_NAME}.timer`]);
  const active = (isActive.stdout || "").trim() === "active";
  const enabledOut = (isEnabled.stdout || "").trim();
  const enabled = enabledOut === "enabled" || enabledOut === "static" || active;

  // list-timers for next/last
  const timers = await systemctl([
    "list-timers",
    `${UNIT_NAME}.timer`,
    "--no-legend",
    "--no-pager",
  ]);
  let nextRun = null;
  let lastRun = null;
  // Typical: "Tue 2026-07-10 12:00:00 JST 1h left ... ai-log-clean.timer ..."
  // Parsing free-form is fragile; try show
  const show = await systemctl([
    "show",
    `${UNIT_NAME}.timer`,
    "--property=NextElapseUSecRealtime,LastTriggerUSec,ActiveState",
  ]);
  const props = Object.create(null);
  for (const line of (show.stdout || "").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i === -1) continue;
    props[line.slice(0, i)] = line.slice(i + 1);
  }
  // systemd usec since epoch (or "n/a" / empty / 0)
  nextRun = systemdUsecToDate(props.NextElapseUSecRealtime);
  lastRun = systemdUsecToDate(props.LastTriggerUSec);

  let lastExitCode = null;
  const showSvc = await systemctl([
    "show",
    `${UNIT_NAME}.service`,
    "--property=ExecMainStatus,Result",
  ]);
  for (const line of (showSvc.stdout || "").split(/\r?\n/)) {
    if (line.startsWith("ExecMainStatus=")) {
      const n = Number.parseInt(line.slice("ExecMainStatus=".length), 10);
      if (Number.isFinite(n)) lastExitCode = n;
    }
  }

  // silence unused if list-timers failed
  void timers;

  return {
    installed: true,
    enabled,
    nextRun,
    lastRun,
    lastExitCode,
  };
}

/**
 * Convert systemd "show" microsecond timestamps to Date.
 * Accepts integer usec since Unix epoch; returns null for n/a / 0 / empty.
 */
export function systemdUsecToDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "n/a" || s === "0") return null;
  // Some versions print a wall-clock string instead of usec
  if (/[A-Za-z]{3}\s/.test(s) || s.includes("-")) {
    return tryParseDate(s);
  }
  const usec = Number.parseInt(s, 10);
  if (!Number.isFinite(usec) || usec <= 0) return null;
  return new Date(Math.floor(usec / 1000));
}
