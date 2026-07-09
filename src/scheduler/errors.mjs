/**
 * Shared scheduler error factory. Lives outside index.mjs so OS modules
 * can import it without creating a circular dependency with
 * scheduler/index.mjs (which imports the OS modules).
 */
export function notImplementedError(os, method) {
  return new Error(`scheduler.${os}.${method}: not implemented`);
}
