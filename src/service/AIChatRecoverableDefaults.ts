/**
 * Central configurable defaults for recoverable history + incremental
 * compaction. Mirrors the PRD defaults table. Values are intentionally
 * conservative; production tuning happens via Token-based feature flags
 * (see featureFlags.ts), not by editing these constants.
 */
export const AI_CHAT_RECOVERABLE_DEFAULTS = {
  // Token budget fractions.
  compactionTriggerFraction: 0.8,
  compactionTargetFraction: 0.6,
  safetyMarginFraction: 0.1,

  // Section packing.
  sectionSourceTargetTokens: 12_000,
  sectionOutputCapTokens: 1_500,
  overviewOutputTargetTokens: 2_000,
  maxSectionsPerBackgroundBatch: 3,
  maxModelAttemptsPerSectionPerRun: 4,
  maxContextReductionRetriesPerSection: 2,

  // Recent-turn retention.
  minRetainedCompleteTurns: 2,

  // Bounded read limits.
  metadataPageRows: 64,
  decodedTextAllowanceBytes: 65_536,

  // Search.
  searchFragmentMaxCodePoints: 4_096,
  searchFragmentOverlapCodePoints: 128,
  searchMaxFragmentsPerPage: 500,
  searchMaxMsPerPage: 100,

  // Retrieval accounting.
  retrievalDefaultOutputTokens: 4_000,
  retrievalMaxOutputTokens: 8_000,
  retrievalMaxCumulativeTokensPerTurn: 8_000,
  retrievalMaxCallsPerTurn: 4,

  // Lease / provider.
  leaseInitialSeconds: 120,
  leaseRenewIntervalSeconds: 30,
  providerTimeoutSeconds: 90,

  // Generation retention.
  retainedGenerationHistoryCount: 10,
} as const;

/** Token-based feature-flag names (values are the Token keys to read). */
export const AI_CHAT_RECOVERABLE_FLAGS = {
  archiveReads: "ai_chat_archive_reads_flag",
  historyTools: "ai_chat_history_tools_flag",
  newCompaction: "ai_chat_new_compaction_flag",
  historyUi: "ai_chat_history_ui_flag",
} as const;
