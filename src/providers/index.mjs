/**
 * Provider registry.
 *
 * Each provider exposes the same shape: name, detected(), scan(cutoff),
 * totalSize(), ageRange(). The CLI subcommands operate on the registry
 * without caring which provider is which.
 *
 * All provider modules are stubs at this stage. The real cleanup logic
 * will be ported here per provider.
 */

import * as claudeCode from "./claude-code.mjs";
import * as codex from "./codex.mjs";
import * as copilot from "./copilot.mjs";
import * as cursorAgent from "./cursor-agent.mjs";
import * as opencode from "./opencode.mjs";
import * as grok from "./grok.mjs";

export const PROVIDER_REGISTRY = {
  claude_code: claudeCode,
  codex: codex,
  copilot: copilot,
  cursor_agent: cursorAgent,
  opencode: opencode,
  grok: grok,
};
