/** `list` subcommand: show current size + oldest/newest entry per provider. */
import { parseArgs } from "node:util";
import { loadConfig, PROVIDERS } from "../config.mjs";
import { PROVIDER_REGISTRY } from "../providers/index.mjs";
import { formatSize } from "../utils/fs.mjs";
import { isPrettyStdout, formatBar, paint, ANSI } from "../utils/output.mjs";
import { readClaudeSettings } from "../providers/claude-code-settings.mjs";
import { providerPolicy, formatProviderPolicyNote } from "../utils/provider-policy.mjs";

const TIP_LINE = "Tip  npx -y github:ishizakahiroshi/ai-log-clean --dry-run";

function isoDate(d) {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/**
 * Pure formatter for list table + Total + Tip (testable).
 *
 * @param {Array<{
 *   provider: string,
 *   enabled: boolean,
 *   detected: boolean,
 *   size: number,
 *   oldest?: Date|null,
 *   newest?: Date|null,
 * }>} rows
 * @param {{
 *   pretty?: boolean,
 *   retentionDays?: number,
 *   now?: Date,
 *   barWidth?: number,
 * }} [opts]
 * @returns {string}
 */
export function formatListRows(rows, opts = {}) {
  const pretty = Boolean(opts.pretty);
  const color = pretty; // same gate as bars: TTY + not NO_COLOR
  const retentionDays = Number.isFinite(opts.retentionDays) ? opts.retentionDays : 60;
  const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
  const barWidth = opts.barWidth ?? 16;
  const maxSize = rows.reduce((m, r) => Math.max(m, Number(r.size) || 0), 0);
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  let out = "";
  const header =
    `${"provider".padEnd(14)}  ${"enabled".padEnd(8)}  ${"detected".padEnd(9)}  ${"size".padEnd(10)}  oldest      newest      policy`;
  const rule =
    `${"-".repeat(14)}  ${"-".repeat(8)}  ${"-".repeat(9)}  ${"-".repeat(10)}  ----------  ----------  ------`;
  out += `${paint(header, ANSI.muted, color)}\n`;
  out += `${paint(rule, ANSI.muted, color)}\n`;

  let totalBytes = 0;
  let detectedCount = 0;

  for (const r of rows) {
    const size = Number(r.size) || 0;
    totalBytes += size;
    if (r.detected) detectedCount += 1;

    const oldest = r.oldest instanceof Date && !Number.isNaN(r.oldest.getTime()) ? r.oldest : null;
    const newest = r.newest instanceof Date && !Number.isNaN(r.newest.getTime()) ? r.newest : null;
    const heavy = oldest != null && oldest.getTime() < cutoffMs;

    const enabledStr = String(r.enabled).padEnd(8);
    const detectedStr = String(r.detected).padEnd(9);
    const sizeStr = formatSize(size).padEnd(10);

    let line = [
      String(r.provider).padEnd(14),
      paint(enabledStr, r.enabled ? ANSI.ok : ANSI.muted, color),
      paint(detectedStr, r.detected ? ANSI.ok : ANSI.muted, color),
      paint(sizeStr, size > 0 && maxSize > 0 && size / maxSize >= 0.5 ? ANSI.accent : "", color),
      isoDate(oldest).padEnd(10),
      isoDate(newest),
      formatProviderPolicyNote(
        r.policy ?? providerPolicy({
          provider: r.provider,
          enabled: r.enabled,
          retentionDays,
        }),
      ),
    ].join("  ");

    if (pretty && maxSize > 0) {
      line += `  ${formatBar(size / maxSize, barWidth, { color })}`;
    }

    if (heavy) {
      line += `  ${paint("! heavy", ANSI.heavy, color)}`;
    }

    out += `${line}\n`;
  }

  const totalLine = `Total  ${formatSize(totalBytes)}  ·  ${detectedCount} detected`;
  out += `${paint(totalLine, ANSI.bold + ANSI.accent, color)}\n`;
  out += `\n${paint(TIP_LINE, ANSI.tip, color)}\n`;
  return out;
}

export function formatListJson(rows, retentionDays, now = new Date()) {
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const providers = rows.map((row) => ({
    name: row.provider,
    enabled: row.enabled,
    detected: row.detected,
    size_bytes: row.size,
    oldest: row.oldest ? isoDate(row.oldest) : null,
    newest: row.newest ? isoDate(row.newest) : null,
    heavy: row.oldest instanceof Date && row.oldest.getTime() < cutoffMs,
    policy: row.policy ?? providerPolicy({
      provider: row.provider,
      enabled: row.enabled,
      retentionDays,
    }),
  }));
  return {
    providers,
    total_bytes: providers.reduce((total, provider) => total + provider.size_bytes, 0),
    detected_count: providers.filter((provider) => provider.detected).length,
  };
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean", default: false } },
    strict: false,
    allowPositionals: false,
  });
  const cfg = await loadConfig();
  let claudeSettings = null;
  try {
    claudeSettings = await readClaudeSettings();
  } catch {
    // A broken Claude settings file must not make `list` unusable.
  }
  const rows = [];
  for (const provider of PROVIDERS) {
    const impl = PROVIDER_REGISTRY[provider];
    const detected = await impl.detected();
    const enabledInConfig = cfg.providers[provider].enabled;
    const size = detected ? await impl.totalSize() : 0;
    const { oldest, newest } = detected ? await impl.ageRange() : {};
    const retentionDays = cfg.providers[provider].retentionDays ?? cfg.defaults.retentionDays;
    rows.push({
      provider,
      enabled: enabledInConfig,
      detected,
      size,
      oldest: oldest ?? null,
      newest: newest ?? null,
      policy: providerPolicy({
        provider,
        enabled: enabledInConfig,
        retentionDays,
        claudeSettings,
      }),
    });
  }
  if (values.json) {
    process.stdout.write(JSON.stringify(formatListJson(rows, cfg.defaults.retentionDays)) + "\n");
  } else {
    process.stdout.write(
      formatListRows(rows, {
        pretty: isPrettyStdout(),
        retentionDays: cfg.defaults.retentionDays,
      }),
    );
  }
  return 0;
}
