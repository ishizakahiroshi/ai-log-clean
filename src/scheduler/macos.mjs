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

export const LABEL = "com.ai-log-clean";

export async function install(_opts) {
  throw new Error("scheduler.macos.install: not implemented");
}
export async function uninstall() {
  throw new Error("scheduler.macos.uninstall: not implemented");
}
export async function disable() {
  throw new Error("scheduler.macos.disable: not implemented");
}
export async function enable() {
  throw new Error("scheduler.macos.enable: not implemented");
}
export async function status() {
  return { installed: false, enabled: false };
}
