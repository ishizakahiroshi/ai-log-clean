/**
 * `run` subcommand: execute one cleanup pass.
 * This is what the scheduler invokes daily. Also runnable interactively
 * with --dry-run for inspection.
 */

import { parseArgs } from "node:util";
import { loadConfig, effectiveRetentionDays, PROVIDERS } from "../config.mjs";
import { PROVIDER_REGISTRY } from "../providers/index.mjs";

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      delete: { type: "boolean", default: false },
      "retention-days": { type: "string" },
      provider: { type: "string" },
      "max-deletes": { type: "string" },
    },
    strict: false,
    allowPositionals: false,
  });

  const cfg = await loadConfig();
  if (values["retention-days"]) {
    cfg.defaults.retentionDays = Number.parseInt(String(values["retention-days"]), 10);
  }
  if (values.delete) {
    cfg.defaults.delete = true;
  }
  const onlyProvider = values.provider ? String(values.provider) : null;
  const dryRun = Boolean(values["dry-run"]);

  let worstExit = 0;
  for (const provider of PROVIDERS) {
    if (onlyProvider && provider !== onlyProvider) continue;
    if (!cfg.providers[provider].enabled) continue;
    const impl = PROVIDER_REGISTRY[provider];
    if (!(await impl.detected())) continue;

    const days = effectiveRetentionDays(cfg, provider);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const candidates = await impl.scan(cutoff);
      process.stdout.write(
        `${provider}: retention=${days}d candidates=${candidates.length}${
          dryRun ? " (dry-run)" : ""
        }\n`,
      );
      // TODO: per-provider archive / delete with --max-deletes cap.
    } catch (err) {
      worstExit = 1;
      process.stderr.write(
        `${provider}: failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  return worstExit;
}
