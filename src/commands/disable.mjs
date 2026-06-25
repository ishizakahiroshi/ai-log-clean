/** `disable` subcommand: pause the schedule without removing config. */
import { currentScheduler } from "../scheduler/index.mjs";

export async function run(_argv) {
  await currentScheduler().disable();
  process.stdout.write(`disabled\n`);
  return 0;
}
