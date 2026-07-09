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
 * Windows: schtasks /Create user task + wscript.exe + run-hidden.vbs + run.ps1
 * macOS:   ~/Library/LaunchAgents/com.ai-log-clean.plist + launchctl
 * Linux:   ~/.config/systemd/user/ai-log-clean.{service,timer} + systemctl --user
 *
 * Scheduled jobs always invoke `npx -y github:ishizakahiroshi/ai-log-clean run ...`
 * (not bunx — GitHub cache stickiness breaks main-as-release).
 *
 * No administrator / sudo / UAC is required on any OS.
 */

import { platform } from "node:os";
import * as windowsImpl from "./windows.mjs";
import * as macosImpl from "./macos.mjs";
import * as linuxImpl from "./linux.mjs";

// Re-export so existing `import { notImplementedError } from "./index.mjs"`
// call sites (if any) keep working. OS modules import from ./errors.mjs
// directly to avoid a circular dependency with this barrel.
export { notImplementedError } from "./errors.mjs";

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
