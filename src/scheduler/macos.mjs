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

import { notImplementedError } from "./index.mjs";

export const LABEL = "com.ai-log-clean";

export async function install(_opts) {
  throw notImplementedError("macos", "install");
}
export async function uninstall() {
  throw notImplementedError("macos", "uninstall");
}
export async function disable() {
  throw notImplementedError("macos", "disable");
}
export async function enable() {
  throw notImplementedError("macos", "enable");
}
export async function status() {
  return { installed: false, enabled: false };
}
