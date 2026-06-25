/**
 * Provider registry.
 *
 * Each provider exposes a `Provider` implementation that knows where its
 * session files live and how to enumerate / archive / delete them.
 *
 * All provider modules are stubs at this stage. The real cleanup logic
 * will be ported here per provider.
 */

import * as claudeCode from "./claude-code.ts";
import * as codex from "./codex.ts";
import * as copilot from "./copilot.ts";
import * as cursorAgent from "./cursor-agent.ts";
import * as opencode from "./opencode.ts";
import * as grok from "./grok.ts";
import type { ProviderName } from "../config.ts";

export interface CleanupCandidate {
  path: string;
  /** "file" or "directory" — directories are archived/removed wholesale. */
  kind: "file" | "directory";
  /** Most recent mtime under this path. */
  lastWriteTime: Date;
  /** Approximate size in bytes. */
  size: number;
}

export interface Provider {
  name: ProviderName;
  /** True if this provider has ANY visible session storage on this machine. */
  detected(): Promise<boolean>;
  /** Files / directories older than `cutoff` that should be cleaned. */
  scan(cutoff: Date): Promise<CleanupCandidate[]>;
  /** Total size currently held by this provider's session storage. */
  totalSize(): Promise<number>;
  /** Most recent + oldest session timestamps (for `list` subcommand). */
  ageRange(): Promise<{ oldest?: Date; newest?: Date }>;
}

export const PROVIDER_REGISTRY: Record<ProviderName, Provider> = {
  claude_code: claudeCode,
  codex: codex,
  copilot: copilot,
  cursor_agent: cursorAgent,
  opencode: opencode,
  grok: grok,
};
