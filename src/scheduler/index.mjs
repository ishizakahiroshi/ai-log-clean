/**
 * Cross-platform scheduler registration.
 *
 * Each OS has a different mechanism, but the user-facing contract is the same:
 *   - install(opts)   register a daily user-scope job
 *   - uninstall()     remove it
 *   - disable()       pause without losing state
 *   - enable()        resume
 *   - status()        report registration + last run
 *
 * Windows: schtasks /Create user task + wscript.exe + run-hidden.vbs
 * macOS:   ~/Library/LaunchAgents/com.ai-log-clean.plist + launchctl
 * Linux:   ~/.config/systemd/user/ai-log-clean.{service,timer} + systemctl --user
 *
 * No administrator / sudo / UAC is required on any OS.
 */

import { platform } from "node:os";
import * as windowsImpl from "./windows.mjs";
import * as macosImpl from "./macos.mjs";
import * as linuxImpl from "./linux.mjs";

export function currentScheduler() {
  switch (platform()) {
    case "win32":
      return windowsImpl;
    case "darwin":
      return macosImpl;
    default:
      return linuxImpl;
  }
}

/**
 * Shared error factory for scheduler stubs. Keeps the magic string
 * "not implemented" in one place so callers can match on it (e.g. the
 * uninstall command tolerates this specific failure to allow --purge).
 */
export function notImplementedError(os, method) {
  return new Error(`scheduler.${os}.${method}: not implemented`);
}
