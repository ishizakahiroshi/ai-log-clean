/** `enable` subcommand: resume a paused schedule. */
import { currentScheduler } from "../scheduler/index.mjs";

export async function run(_argv) {
  await currentScheduler().enable();
  process.stdout.write(`enabled\n`);
  return 0;
}
