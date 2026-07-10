/**
 * Provider-level error formatting for run (and similar) UX.
 *
 * Design (P8): one-line cause + short path + "others continued" when partial,
 * plus a Try hint only for known errno codes (no over-guessing).
 */

import { basename } from "node:path";
import { homedir } from "node:os";

/**
 * Format a whole-provider failure for stderr.
 *
 * @param {{ provider: string, err: unknown, othersContinued?: boolean }} opts
 * @returns {string} multi-line message ending with `\n`
 */
export function formatProviderError({ provider, err, othersContinued = true }) {
  const code = errnoCode(err);
  const path = shortPath(errorPath(err));
  const reason = humanReason(code, err);
  const onPath = path ? ` on ${path}` : "";

  const lines = [`${provider}  skip: ${reason}${onPath}`];

  if (othersContinued) {
    lines.push(`Others continued.  exit=1 (partial)`);
  } else {
    lines.push(`exit=1`);
  }

  const hint = fixHint(code, provider);
  if (hint) {
    lines.push("");
    lines.push(hint);
  }

  return lines.join("\n") + "\n";
}

/**
 * @param {unknown} err
 * @returns {string|null}
 */
function errnoCode(err) {
  if (err && typeof err === "object" && "code" in err) {
    const c = /** @type {{ code?: unknown }} */ (err).code;
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/**
 * Prefer Node's `err.path` / `err.dest`; never invent a path from prose.
 * @param {unknown} err
 * @returns {string|null}
 */
function errorPath(err) {
  if (!err || typeof err !== "object") return null;
  const e = /** @type {{ path?: unknown, dest?: unknown }} */ (err);
  if (typeof e.path === "string" && e.path) return e.path;
  if (typeof e.dest === "string" && e.dest) return e.dest;
  return null;
}

/**
 * Short, home-relative path for display (basename if still long).
 * @param {string|null} p
 * @returns {string|null}
 */
export function shortPath(p) {
  if (!p) return null;
  let s = String(p);
  try {
    const home = homedir();
    if (home && s.startsWith(home)) {
      s = "~" + s.slice(home.length).replace(/\\/g, "/");
    } else {
      s = s.replace(/\\/g, "/");
    }
  } catch {
    s = s.replace(/\\/g, "/");
  }
  // Cap length: keep ~prefix or trailing basename segment.
  if (s.length <= 48) return s;
  const base = basename(s);
  if (base && base !== s) return `…/${base}`;
  return s.slice(0, 45) + "…";
}

/**
 * @param {string|null} code
 * @param {unknown} err
 */
function humanReason(code, err) {
  switch (code) {
    case "EPERM":
    case "EACCES":
      return "permission denied";
    case "ENOENT":
      return "path not found";
    case "EXDEV":
      return "cross-device move failed";
    case "ENOSPC":
      return "no space left";
    case "EEXIST":
      return "path already exists";
    case "EISDIR":
      return "is a directory";
    case "ENOTDIR":
      return "not a directory";
    default:
      break;
  }
  // Prefer errno code over free-form message (message may be noisy / pathy).
  if (code) return code;
  if (err instanceof Error && err.message && !looksLikeAbsPath(err.message)) {
    const m = err.message.trim();
    if (m.length > 0 && m.length <= 60) return m;
  }
  return "operation failed";
}

/**
 * Actionable Try lines for known errnos; unknown → disable-only (no invented cause).
 * @param {string|null} code
 * @param {string} provider
 * @returns {string}
 */
function fixHint(code, provider) {
  const disable = `disable: [providers.${provider}] enabled=false`;
  switch (code) {
    case "EPERM":
    case "EACCES":
      return `Try  re-run as same user that owns the files\n     or ${disable}`;
    case "ENOENT":
      return `Try  confirm the session path still exists\n     or ${disable}`;
    case "EXDEV":
      return `Try  keep quarantine on the same volume as sources\n     or ${disable}`;
    case "ENOSPC":
      return `Try  free disk space, then re-run\n     or ${disable}`;
    default:
      return `Try  ${disable}`;
  }
}

function looksLikeAbsPath(s) {
  if (!s) return false;
  return /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|var|tmp|private)\b)/.test(s);
}
