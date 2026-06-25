/** `init` subcommand: write a config.toml template to ~/.ai-log-clean/. */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { CONFIG_DIR, CONFIG_FILE, CONFIG_TEMPLATE } from "../config.mjs";

export async function run(_argv) {
  // 0o700 so the config dir (which will hold quarantine paths revealing
  // session layout) is not world-readable on POSIX. Windows ignores mode.
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    await stat(CONFIG_FILE);
    process.stdout.write(`config already exists at ${CONFIG_FILE} (not overwritten)\n`);
    return 0;
  } catch {
    // not present → create
  }
  await writeFile(CONFIG_FILE, CONFIG_TEMPLATE, { mode: 0o600 });
  process.stdout.write(`wrote ${CONFIG_FILE}\n`);
  return 0;
}
