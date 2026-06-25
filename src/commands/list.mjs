/** `list` subcommand: show current size + oldest/newest entry per provider. */
import { loadConfig, PROVIDERS } from "../config.mjs";
import { PROVIDER_REGISTRY } from "../providers/index.mjs";
import { formatSize } from "../utils/fs.mjs";

function isoDate(d) {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export async function run(_argv) {
  const cfg = await loadConfig();
  process.stdout.write(
    `${"provider".padEnd(14)}  ${"enabled".padEnd(8)}  ${"detected".padEnd(9)}  ${"size".padEnd(10)}  oldest      newest\n`,
  );
  process.stdout.write(`${"-".repeat(14)}  ${"-".repeat(8)}  ${"-".repeat(9)}  ${"-".repeat(10)}  ----------  ----------\n`);
  for (const provider of PROVIDERS) {
    const impl = PROVIDER_REGISTRY[provider];
    const detected = await impl.detected();
    const enabledInConfig = cfg.providers[provider].enabled;
    const size = detected ? await impl.totalSize() : 0;
    const { oldest, newest } = detected ? await impl.ageRange() : {};
    process.stdout.write(
      [
        provider.padEnd(14),
        String(enabledInConfig).padEnd(8),
        String(detected).padEnd(9),
        formatSize(size).padEnd(10),
        isoDate(oldest).padEnd(10),
        isoDate(newest),
      ].join("  ") + "\n",
    );
  }
  return 0;
}
