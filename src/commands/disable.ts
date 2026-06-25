/** `disable` subcommand: pause the schedule without removing config. */
import { currentScheduler } from "../scheduler/index.ts";

export async function run(_argv: string[]): Promise<number> {
  await currentScheduler().disable();
  process.stdout.write(`disabled\n`);
  return 0;
}
