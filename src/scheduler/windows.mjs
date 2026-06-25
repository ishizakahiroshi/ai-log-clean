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

export const TASK_NAME = "ai-log-clean";

export async function install(_opts) {
  throw new Error("scheduler.windows.install: not implemented");
}
export async function uninstall() {
  throw new Error("scheduler.windows.uninstall: not implemented");
}
export async function disable() {
  throw new Error("scheduler.windows.disable: not implemented");
}
export async function enable() {
  throw new Error("scheduler.windows.enable: not implemented");
}
export async function status() {
  return { installed: false, enabled: false };
}
