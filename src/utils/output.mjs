/**
 * Shared CLI output helpers (TTY pretty-print, local/relative times, bars).
 *
 * Design (parent plan D1 / D4 / D5):
 *   - Pretty (bars, dividers) only when stdout is a TTY and NO_COLOR is unset.
 *   - Times: local `YYYY-MM-DD HH:mm` + English relative (`in 14h` / `2h ago`).
 *   - No emoji / no always-on ANSI.
 */

/**
 * Whether stdout should get decorative extras (bars, labeled dividers).
 * False under pipes, redirects, or when NO_COLOR is set (any non-empty value).
 */
export function isPrettyStdout(stream = process.stdout, env = process.env) {
  if (env && env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return Boolean(stream && stream.isTTY);
}

/**
 * Local calendar time as `YYYY-MM-DD HH:mm` (no seconds, no TZ suffix).
 * @param {Date|number|string} date
 */
export function formatLocalDateTime(date) {
  const d = toDate(date);
  if (!d) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/**
 * English relative phrasing vs `now`.
 * Granularity: seconds (just now) → minutes → hours → days.
 * @param {Date|number|string} date
 * @param {Date|number} [now]
 */
export function formatRelative(date, now = new Date()) {
  const d = toDate(date);
  const n = toDate(now) ?? new Date();
  if (!d) return "—";
  const diffMs = d.getTime() - n.getTime();
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;

  if (abs < 45 * 1000) return "just now";

  const minutes = Math.round(abs / (60 * 1000));
  if (minutes < 60) {
    return past ? `${minutes}m ago` : `in ${minutes}m`;
  }
  const hours = Math.round(abs / (60 * 60 * 1000));
  if (hours < 48) {
    return past ? `${hours}h ago` : `in ${hours}h`;
  }
  const days = Math.round(abs / (24 * 60 * 60 * 1000));
  return past ? `${days}d ago` : `in ${days}d`;
}

/** Minimal ANSI (no chalk). Only used when caller opts in + pretty TTY. */
const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  // 256-color — reads well on dark + light terminals
  fillLow: "\x1b[38;5;114m", // soft green
  fillMid: "\x1b[38;5;221m", // amber
  fillHigh: "\x1b[38;5;208m", // orange (house accent-ish)
  empty: "\x1b[38;5;240m", // dim gray
  heavy: "\x1b[38;5;203m", // coral red
  ok: "\x1b[38;5;114m",
  muted: "\x1b[38;5;245m",
  accent: "\x1b[38;5;208m",
  tip: "\x1b[38;5;110m", // soft blue
};

/**
 * Wrap `text` in ANSI when `color` is true; otherwise return plain.
 * @param {string} text
 * @param {string} open ANSI open sequence
 * @param {boolean} [color]
 */
export function paint(text, open, color = false) {
  if (!color || !text || !open) return text;
  return `${open}${text}${ANSI.reset}`;
}

/**
 * ASCII progress bar. `ratio` is clamped to [0, 1].
 * Filled = █, empty = ░. Optional ANSI when `color` is true.
 * Color scale by ratio: low green → mid amber → high orange.
 * @param {number} ratio
 * @param {number} [width=16]
 * @param {{ color?: boolean }} [opts]
 */
export function formatBar(ratio, width = 16, opts = {}) {
  const w = Math.max(1, Math.floor(width));
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const filled = Math.round(r * w);
  const solid = "█".repeat(filled);
  const empty = "░".repeat(w - filled);
  if (!opts.color) return solid + empty;

  const fillOpen =
    r >= 0.66 ? ANSI.fillHigh : r >= 0.33 ? ANSI.fillMid : ANSI.fillLow;
  return (
    (solid ? `${fillOpen}${solid}${ANSI.reset}` : "") +
    (empty ? `${ANSI.empty}${empty}${ANSI.reset}` : "")
  );
}

export { ANSI };

/**
 * Print a section divider when pretty; otherwise a plain `---` line (or no-op
 * when `label` is omitted and not pretty — fixed policy: always emit a plain
 * line so non-TTY still has a visible section break without bar chars).
 *
 * @param {string} [label]
 * @param {{ pretty?: boolean, write?: (s: string) => void }} [opts]
 */
export function printDivider(label, opts = {}) {
  const pretty = opts.pretty ?? isPrettyStdout();
  const write = opts.write ?? ((s) => process.stdout.write(s));
  if (pretty) {
    if (label) {
      write(`── ${label} ──\n`);
    } else {
      write(`──\n`);
    }
  } else {
    if (label) {
      write(`--- ${label} ---\n`);
    } else {
      write(`---\n`);
    }
  }
}

function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
