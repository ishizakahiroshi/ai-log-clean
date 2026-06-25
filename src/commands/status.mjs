/** `status` subcommand: show schedule registration + last run. */
import { currentScheduler } from "../scheduler/index.mjs";

export async function run(_argv) {
  const s = await currentScheduler().status();
  process.stdout.write(
    [
      `installed: ${s.installed}`,
      `enabled:   ${s.enabled}`,
      `next run:  ${s.nextRun ? s.nextRun.toISOString() : "—"}`,
      `last run:  ${s.lastRun ? s.lastRun.toISOString() : "—"}`,
      `last exit: ${s.lastExitCode ?? "—"}`,
      ``,
    ].join("\n"),
  );
  return 0;
}
