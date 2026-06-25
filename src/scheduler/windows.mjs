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

import { notImplementedError } from "./index.mjs";

export const TASK_NAME = "ai-log-clean";

export async function install(_opts) {
  throw notImplementedError("windows", "install");
}
export async function uninstall() {
  throw notImplementedError("windows", "uninstall");
}
export async function disable() {
  throw notImplementedError("windows", "disable");
}
export async function enable() {
  throw notImplementedError("windows", "enable");
}
export async function status() {
  return { installed: false, enabled: false };
}
