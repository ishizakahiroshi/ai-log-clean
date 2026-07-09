/**
 * Windows scheduler implementation.
 *
 *   Task name : ai-log-clean
 *   Trigger   : Daily at --at
 *   Action    : wscript.exe "<install-dir>\run-hidden.vbs" "<install-dir>\run.ps1"
 *
 * run.ps1 (generated at install) invokes:
 *   <absolute-npx.cmd> -y github:ishizakahiroshi/ai-log-clean run --retention-days N [--delete]
 *
 * Bundled assets/run-hidden.vbs is copied to %LOCALAPPDATA%\ai-log-clean\ so the
 * task does not depend on the npx cache directory layout.
 *
 * No elevation. Interactive user task — runs under the current user.
 */

import { mkdir, writeFile, copyFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  bundledRunHiddenVbsPath,
  buildWindowsRunPs1,
  resolveNpxPath,
  runCommand,
  parseAt,
  parseKeyValueList,
  tryParseDate,
  normalizeSchtasksLastResult,
  windowsInstallDir,
  TASK_LABEL,
} from "./common.mjs";

export const TASK_NAME = TASK_LABEL;

function wscriptPath() {
  const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return join(root, "System32", "wscript.exe");
}

function installPaths() {
  const dir = windowsInstallDir();
  return {
    dir,
    vbs: join(dir, "run-hidden.vbs"),
    ps1: join(dir, "run.ps1"),
    xml: join(dir, "task.xml"),
  };
}

/**
 * Task Scheduler XML (1.2). UTF-16 LE with BOM is what schtasks expects most
 * reliably when the file is handed to /XML.
 */
export function buildTaskXml({ wscript, vbsPath, ps1Path, at }) {
  const { hour, minute } = parseAt(at);
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  // StartBoundary date is arbitrary; the time-of-day drives the daily trigger.
  const startBoundary = `2020-01-01T${hh}:${mm}:00`;
  const args = `"${vbsPath}" "${ps1Path}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>ai-log-clean daily session log cleanup (https://github.com/ishizakahiroshi/ai-log-clean)</Description>
    <URI>\\${TASK_NAME}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${startBoundary}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXmlText(wscript)}</Command>
      <Arguments>${escapeXmlText(args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function install(opts) {
  const npxPath = await resolveNpxPath();
  const paths = installPaths();
  await mkdir(paths.dir, { recursive: true });

  const bundled = bundledRunHiddenVbsPath();
  if (!existsSync(bundled)) {
    throw new Error(`bundled run-hidden.vbs missing at ${bundled}`);
  }
  await copyFile(bundled, paths.vbs);

  const ps1 = buildWindowsRunPs1({
    npxPath,
    retentionDays: opts.retentionDays,
    delete: Boolean(opts.delete),
  });
  await writeFile(paths.ps1, ps1, "utf8");

  const xml = buildTaskXml({
    wscript: wscriptPath(),
    vbsPath: paths.vbs,
    ps1Path: paths.ps1,
    at: opts.at,
  });
  // UTF-16 LE with BOM
  const bom = Buffer.from([0xff, 0xfe]);
  const body = Buffer.from(xml, "utf16le");
  await writeFile(paths.xml, Buffer.concat([bom, body]));

  // Idempotent replace
  await runCommand("schtasks.exe", ["/Delete", "/TN", TASK_NAME, "/F"]).catch(() => {});
  const created = await runCommand("schtasks.exe", [
    "/Create",
    "/TN",
    TASK_NAME,
    "/XML",
    paths.xml,
    "/F",
  ]);
  if (created.code !== 0) {
    throw new Error(
      `schtasks /Create failed (exit ${created.code}): ${(created.stderr || created.stdout).trim()}`,
    );
  }
}

export async function uninstall() {
  const result = await runCommand("schtasks.exe", ["/Delete", "/TN", TASK_NAME, "/F"]);
  // 1 usually means "task not found" — treat as success for idempotent uninstall
  if (result.code !== 0) {
    const msg = `${result.stderr || ""} ${result.stdout || ""}`.toLowerCase();
    if (!/cannot find|not found|存在しません|見つかりません/.test(msg) && result.code !== 1) {
      throw new Error(
        `schtasks /Delete failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`,
      );
    }
  }
  // Leave install dir (run.ps1 / vbs) in place so a re-install is fast; purge is uninstall --purge.
  const paths = installPaths();
  try {
    await rm(paths.xml, { force: true });
  } catch {
    // ignore
  }
}

export async function disable() {
  const result = await runCommand("schtasks.exe", [
    "/Change",
    "/TN",
    TASK_NAME,
    "/DISABLE",
  ]);
  if (result.code !== 0) {
    throw new Error(
      `schtasks /DISABLE failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

export async function enable() {
  const result = await runCommand("schtasks.exe", [
    "/Change",
    "/TN",
    TASK_NAME,
    "/ENABLE",
  ]);
  if (result.code !== 0) {
    throw new Error(
      `schtasks /ENABLE failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
}

export async function status() {
  const result = await runCommand("schtasks.exe", [
    "/Query",
    "/TN",
    TASK_NAME,
    "/FO",
    "LIST",
    "/V",
  ]);
  if (result.code !== 0) {
    return { installed: false, enabled: false };
  }
  const map = parseKeyValueList(result.stdout);
  const state = map["Scheduled Task State"] || map["タスクの状態"] || "";
  const statusText = map["Status"] || map["状態"] || "";
  let isEnabled = true;
  if (/disabled|無効/i.test(state) || /disabled|無効/i.test(statusText)) {
    isEnabled = false;
  } else if (/enabled|有効/i.test(state)) {
    isEnabled = true;
  }

  // schtasks /FO LIST /V keys differ by locale (EN / JA observed).
  const lastRunRaw =
    map["Last Run Time"] || map["前回の実行時刻"] || map["前回の実行"] || "";
  const nextRunRaw =
    map["Next Run Time"] || map["次回の実行時刻"] || map["次回の実行"] || "";
  // Non-verbose LIST only has "Next Run Time" / "次回の実行時刻" at top level
  const lastResult = map["Last Result"] || map["前回の結果"] || "";

  // Task Scheduler uses a 1999-11-30 sentinel for "never ran".
  let lastRun = tryParseDate(lastRunRaw);
  if (lastRun && lastRun.getFullYear() < 2000) lastRun = null;

  return {
    installed: true,
    enabled: isEnabled,
    nextRun: tryParseDate(nextRunRaw),
    lastRun,
    lastExitCode: normalizeSchtasksLastResult(lastResult),
  };
}

/** Test helper: read generated run.ps1 if present. */
export async function readInstalledRunPs1() {
  const { ps1 } = installPaths();
  if (!existsSync(ps1)) return null;
  return readFile(ps1, "utf8");
}
