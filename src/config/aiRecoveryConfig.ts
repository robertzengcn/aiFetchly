/**
 * Centralized configuration constants for AI recovery and observe-execute operations.
 * These values are used across multiple utility files and should be updated here
 * to maintain consistency across the codebase.
 */

/**
 * AI Recovery Configuration
 */
export const AI_RECOVERY_CONFIG = {
  /**
   * Maximum time to wait for AI support response (milliseconds)
   * Observe-execute can take multiple rounds, so we allow 60 seconds
   */
  SUPPORT_REQUEST_TIMEOUT_MS: 60_000,

  /**
   * Default timeout for individual Puppeteer actions (milliseconds)
   */
  ACTION_DEFAULT_TIMEOUT_MS: 5_000,

  /**
   * Maximum timeout for individual Puppeteer actions (milliseconds)
   */
  ACTION_MAX_TIMEOUT_MS: 60_000,

  /**
   * Default maximum number of observe-execute iterations
   */
  MAX_OBSERVE_ITERATIONS: 3,

  /**
   * Minimum allowed timeout (milliseconds) to prevent issues with overly short timeouts
   */
  ACTION_MIN_TIMEOUT_MS: 100,

  /**
   * Polling interval for XPath selector waiting (milliseconds)
   * Used when waitForXPath is not available
   */
  XPATH_POLL_INTERVAL_MS: 200
} as const;

/**
 * Type definitions for configuration values
 */
export type AiRecoveryConfig = typeof AI_RECOVERY_CONFIG;
