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

import type { InstallOptions, ScheduleStatus } from "./index.ts";

export const LABEL = "com.ai-log-clean";

export async function install(_opts: InstallOptions): Promise<void> {
  // TODO: write plist, then `launchctl bootstrap gui/$UID <plist>`.
  throw new Error("scheduler.macos.install: not implemented");
}

export async function uninstall(): Promise<void> {
  // launchctl bootout gui/$UID/com.ai-log-clean ; rm plist
  throw new Error("scheduler.macos.uninstall: not implemented");
}

export async function disable(): Promise<void> {
  // launchctl disable gui/$UID/com.ai-log-clean
  throw new Error("scheduler.macos.disable: not implemented");
}

export async function enable(): Promise<void> {
  // launchctl enable gui/$UID/com.ai-log-clean
  throw new Error("scheduler.macos.enable: not implemented");
}

export async function status(): Promise<ScheduleStatus> {
  // launchctl print gui/$UID/com.ai-log-clean
  return { installed: false, enabled: false };
}
