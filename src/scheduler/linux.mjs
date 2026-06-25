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

export const UNIT_NAME = "ai-log-clean";

export async function install(_opts) {
  throw new Error("scheduler.linux.install: not implemented");
}
export async function uninstall() {
  throw new Error("scheduler.linux.uninstall: not implemented");
}
export async function disable() {
  throw new Error("scheduler.linux.disable: not implemented");
}
export async function enable() {
  throw new Error("scheduler.linux.enable: not implemented");
}
export async function status() {
  return { installed: false, enabled: false };
}
