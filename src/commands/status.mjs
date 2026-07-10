/** `status` subcommand: schedule registration + last-run narrative. */
import { parseArgs } from "node:util";
import { currentScheduler } from "../scheduler/index.mjs";
import { formatLocalDateTime, formatRelative } from "../utils/output.mjs";
import {
  readLastRun,
  defaultLastRunPath,
  readHistory,
  defaultHistoryPath,
} from "../utils/last-run.mjs";
import { formatSize } from "../utils/fs.mjs";

const LABEL_WIDTH = 10;

/**
 * Pure formatter for unit tests and the status command.
 *
 * @param {{
 *   schedule: {
 *     installed?: boolean,
 *     enabled?: boolean,
 *     nextRun?: Date|null,
 *     lastRun?: Date|null,
 *   },
 *   lastRun?: object|null,
 *   lastRunPath?: string,
 *   history?: object[],
 *   now?: Date|number,
 * }} opts
 * @returns {string[]} lines without trailing empty line
 */
export function formatStatusLines({
  schedule = {},
  lastRun = null,
  lastRunPath = defaultLastRunPath(),
  history = [],
  now = new Date(),
} = {}) {
  const scheduleText = formatSchedule(schedule);
  const nextText = formatWhen(schedule.nextRun, now);
  const lastText = formatWhen(schedule.lastRun, now);
  const resultText = formatResult(lastRun);

  return [
    line("Schedule", scheduleText),
    line("Next", nextText),
    line("Last", lastText),
    line("Result", resultText),
    line("Log", lastRunPath),
    line("History", formatHistory(history)),
  ];
}

export function formatStatusJson({ schedule = {}, lastRun = null, lastRunPath, history = [] }) {
  return {
    schedule: {
      installed: Boolean(schedule.installed),
      enabled: Boolean(schedule.enabled),
      next_run: asIso(schedule.nextRun),
      last_run: asIso(schedule.lastRun),
      last_exit_code: schedule.lastExitCode ?? null,
    },
    last_run: toJsonRunSummary(lastRun),
    last_run_path: lastRunPath,
    history: history.map(toJsonRunSummary),
  };
}

function toJsonRunSummary(summary) {
  if (summary == null || typeof summary !== "object" || Array.isArray(summary)) return null;
  const totals = summary.totals && typeof summary.totals === "object" ? summary.totals : {};
  const byProvider = summary.byProvider && typeof summary.byProvider === "object"
    ? Object.fromEntries(
        Object.entries(summary.byProvider).map(([name, value]) => [name, {
          files: Number(value?.files) || 0,
          bytes: Number(value?.bytes) || 0,
          action: value?.action ?? null,
        }]),
      )
    : {};
  return {
    finished_at: summary.finishedAt ?? null,
    exit_code: summary.exitCode ?? null,
    dry_run: summary.dryRun === true,
    mode: summary.mode ?? null,
    totals: {
      files: Number(totals.files) || 0,
      bytes: Number(totals.bytes) || 0,
      capped: totals.capped === true,
      budget_bytes: totals.budgetBytes ?? null,
      after_bytes: totals.afterBytes ?? null,
    },
    by_provider: byProvider,
  };
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean", default: false } },
    strict: false,
    allowPositionals: false,
  });
  const schedule = await currentScheduler().status();
  const lastRunPath = defaultLastRunPath();
  const lastRun = await readLastRun({ path: lastRunPath });
  const history = await readHistory();
  if (values.json) {
    process.stdout.write(
      JSON.stringify(formatStatusJson({ schedule, lastRun, lastRunPath, history })) + "\n",
    );
    return 0;
  }
  const lines = formatStatusLines({
    schedule,
    lastRun,
    lastRunPath,
    now: new Date(),
    history,
  });
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

function asIso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function line(label, value) {
  return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

function formatSchedule(schedule) {
  if (!schedule.installed) return "not installed";
  return schedule.enabled ? "installed · enabled" : "installed · disabled";
}

function formatWhen(date, now) {
  if (date == null) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatLocalDateTime(d)}  (${formatRelative(d, now)})`;
}

/**
 * Real cleanup runs only (`dryRun !== true`). Missing / dry-run → "—".
 * Shape: `exit N · archived|deleted X files · <formatSize(bytes)>`
 */
function formatResult(lastRun) {
  if (lastRun == null || typeof lastRun !== "object") return "—";
  if (lastRun.dryRun === true) return "—";

  const exit =
    lastRun.exitCode === undefined || lastRun.exitCode === null
      ? "—"
      : lastRun.exitCode;
  const verb = lastRun.mode === "delete" ? "deleted" : "archived";
  const files = Number(lastRun.totals?.files) || 0;
  const bytes = Number(lastRun.totals?.bytes) || 0;
  return `exit ${exit} · ${verb} ${files} files · ${formatSize(bytes)}`;
}

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return "—";
  const bytes = history.reduce((total, entry) => total + (Number(entry?.totals?.bytes) || 0), 0);
  const failures = history.filter((entry) => Number(entry?.exitCode) !== 0).length;
  return `last ${history.length} runs · freed ${formatSize(bytes)} total · ${failures} failures`;
}
