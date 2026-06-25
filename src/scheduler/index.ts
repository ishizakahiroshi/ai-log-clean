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
import * as windowsImpl from "./windows.ts";
import * as macosImpl from "./macos.ts";
import * as linuxImpl from "./linux.ts";

export interface InstallOptions {
  at: string; // HH:MM (24h)
  retentionDays: number;
  delete: boolean;
  interactive: boolean;
}

export interface ScheduleStatus {
  installed: boolean;
  enabled: boolean;
  nextRun?: Date;
  lastRun?: Date;
  lastExitCode?: number;
}

export interface Scheduler {
  install(opts: InstallOptions): Promise<void>;
  uninstall(): Promise<void>;
  disable(): Promise<void>;
  enable(): Promise<void>;
  status(): Promise<ScheduleStatus>;
}

export function currentScheduler(): Scheduler {
  switch (platform()) {
    case "win32":
      return windowsImpl;
    case "darwin":
      return macosImpl;
    default:
      return linuxImpl;
  }
}
