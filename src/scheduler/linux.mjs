/**
 * Linux scheduler implementation.
 *
 *   units     : ~/.config/systemd/user/ai-log-clean.{service,timer}
 *   trigger   : OnCalendar=*-*-* <at>:00
 *   enable    : systemctl --user enable --now ai-log-clean.timer
 *
 * --user systemd, no sudo. Requires that `XDG_RUNTIME_DIR` is set (it is in a
 * normal desktop login; headless servers may need `loginctl enable-linger`,
 * which we'll detect and instruct the user about rather than running ourselves.
 */

import { notImplementedError } from "./index.mjs";

export const UNIT_NAME = "ai-log-clean";

export async function install(_opts) {
  throw notImplementedError("linux", "install");
}
export async function uninstall() {
  throw notImplementedError("linux", "uninstall");
}
export async function disable() {
  throw notImplementedError("linux", "disable");
}
export async function enable() {
  throw notImplementedError("linux", "enable");
}
export async function status() {
  return { installed: false, enabled: false };
}
