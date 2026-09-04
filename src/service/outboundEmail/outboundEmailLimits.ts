/**
 * Implementation safety limits for the intent-aware outbound-email pipeline
 * (technical design §10.2). Extracted as pure data so both the main-process
 * preflight service and the worker-process send path can reference them
 * without either pulling in the other's dependencies.
 */
export const OUTBOUND_EMAIL_BATCH_LIMITS = {
  maxRecipients: 100,
  maxHtmlBodyChars: 50_000,
  maxTextBodyChars: 50_000,
  maxPayloadBytes: 5 * 1024 * 1024,
} as const;
