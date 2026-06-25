/**
 * Windows scheduler implementation.
 *
 *   Task name : ai-log-clean
 *   Trigger   : Daily at --at
 *   Action    : wscript.exe "<install-dir>/run-hidden.vbs" "<bunx>" github:owner/ai-log-clean run [...]
 *
 * The bundled assets/run-hidden.vbs is copied to %LOCALAPPDATA%\ai-log-clean\
 * at install time so the task does not depend on the bunx cache directory.
 *
 * No elevation. LogonType=Interactive user task — runs under the current user
 * and does not require admin to register.
 */

import type { InstallOptions, ScheduleStatus } from "./index.ts";

export const TASK_NAME = "ai-log-clean";

export async function install(_opts: InstallOptions): Promise<void> {
  // TODO: resolve bunx absolute path, copy run-hidden.vbs to
  // %LOCALAPPDATA%/ai-log-clean/, then run:
  //   schtasks /Create /TN ai-log-clean /SC DAILY /ST <opts.at>
  //     /TR "wscript.exe ..." /F
  throw new Error("scheduler.windows.install: not implemented");
}

export async function uninstall(): Promise<void> {
  // schtasks /Delete /TN ai-log-clean /F
  throw new Error("scheduler.windows.uninstall: not implemented");
}

export async function disable(): Promise<void> {
  // schtasks /Change /TN ai-log-clean /DISABLE
  throw new Error("scheduler.windows.disable: not implemented");
}

export async function enable(): Promise<void> {
  // schtasks /Change /TN ai-log-clean /ENABLE
  throw new Error("scheduler.windows.enable: not implemented");
}

export async function status(): Promise<ScheduleStatus> {
  // schtasks /Query /TN ai-log-clean /XML, parse next-run + last-run.
  return { installed: false, enabled: false };
}
