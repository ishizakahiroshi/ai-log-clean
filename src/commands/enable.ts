/** `enable` subcommand: resume a paused schedule. */
import { currentScheduler } from "../scheduler/index.ts";

export async function run(_argv: string[]): Promise<number> {
  await currentScheduler().enable();
  process.stdout.write(`enabled\n`);
  return 0;
}
