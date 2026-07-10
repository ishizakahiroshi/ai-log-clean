import { CLAUDE_DEFAULT_CLEANUP_DAYS } from "../providers/claude-code-settings.mjs";

export function providerPolicy({ provider, enabled, retentionDays, claudeSettings = null }) {
  if (provider !== "claude_code") {
    return {
      managed_by: "ai_log_clean",
      retention_days: retentionDays,
      cleaned_by_ai_log_clean: true,
    };
  }

  const fromFile = Boolean(claudeSettings?.exists) && claudeSettings.cleanupPeriodDays != null;
  const cleanupPeriodDays = fromFile
    ? claudeSettings.cleanupPeriodDays
    : CLAUDE_DEFAULT_CLEANUP_DAYS;
  return {
    managed_by: enabled ? "ai_log_clean" : "claude_code_body",
    retention_days: enabled ? retentionDays : null,
    cleaned_by_ai_log_clean: enabled,
    cleanup_period_days: cleanupPeriodDays,
    cleanup_period_source: fromFile ? "file" : "default",
  };
}

export function formatProviderPolicyNote(policy) {
  if (policy.managed_by !== "claude_code_body") {
    if (policy.cleanup_period_days == null) return `ret=${policy.retention_days}d`;
    return `ret=${policy.retention_days}d · body cleanupPeriodDays=${policy.cleanup_period_days} (${policy.cleanup_period_source})`;
  }
  return `body cleanupPeriodDays=${policy.cleanup_period_days} (${policy.cleanup_period_source}) · not cleaned by ai-log-clean`;
}
