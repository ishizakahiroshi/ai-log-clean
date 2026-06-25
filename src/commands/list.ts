/** `list` subcommand: show current size + oldest file per provider. */
import { loadConfig, PROVIDERS } from "../config.ts";
import { PROVIDER_REGISTRY } from "../providers/index.ts";

export async function run(_argv: string[]): Promise<number> {
  const cfg = await loadConfig();
  process.stdout.write(`provider       enabled  size       oldest                 newest\n`);
  for (const provider of PROVIDERS) {
    const impl = PROVIDER_REGISTRY[provider];
    const detected = await impl.detected();
    const enabled = cfg.providers[provider].enabled && detected;
    const size = await impl.totalSize();
    const { oldest, newest } = await impl.ageRange();
    process.stdout.write(
      [
        provider.padEnd(14),
        String(enabled).padEnd(8),
        formatSize(size).padEnd(10),
        (oldest ? oldest.toISOString().slice(0, 10) : "—").padEnd(22),
        newest ? newest.toISOString().slice(0, 10) : "—",
      ].join(" ") + "\n",
    );
  }
  return 0;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
