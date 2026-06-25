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

import type { InstallOptions, ScheduleStatus } from "./index.ts";

export const UNIT_NAME = "ai-log-clean";

export async function install(_opts: InstallOptions): Promise<void> {
  // TODO: write {service,timer}, then `systemctl --user daemon-reload`
  // and `systemctl --user enable --now ai-log-clean.timer`.
  throw new Error("scheduler.linux.install: not implemented");
}

export async function uninstall(): Promise<void> {
  // systemctl --user disable --now ai-log-clean.timer ; rm units
  throw new Error("scheduler.linux.uninstall: not implemented");
}

export async function disable(): Promise<void> {
  // systemctl --user stop ai-log-clean.timer
  throw new Error("scheduler.linux.disable: not implemented");
}

export async function enable(): Promise<void> {
  // systemctl --user start ai-log-clean.timer
  throw new Error("scheduler.linux.enable: not implemented");
}

export async function status(): Promise<ScheduleStatus> {
  // systemctl --user list-timers ai-log-clean.timer
  return { installed: false, enabled: false };
}
