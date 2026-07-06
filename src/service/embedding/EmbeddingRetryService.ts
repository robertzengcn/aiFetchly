"use strict";
import type { EmbeddingResult } from "@/entityTypes/embeddingTypes";
import type { EmbeddingProvider } from "@/service/embedding/EmbeddingProvider";
import { isEmbeddingBillingError } from "@/modules/rag/embeddingErrors";

/**
 * Retry profile for a remote embedding provider. The first release uses a small
 * fixed profile; centralizing it here means future tuning does not touch RAG
 * orchestration code.
 */
export interface EmbeddingRetryProfile {
  /** Total number of attempts (1 = no retry). */
  maxAttempts: number;
  /** Delay before each retry attempt, indexed by the failed attempt number. */
  delaysMs: number[];
}

export const DEFAULT_REMOTE_EMBEDDING_RETRY_PROFILE: EmbeddingRetryProfile = {
  maxAttempts: 3,
  delaysMs: [500, 1500],
};

const NON_RETRYABLE_KEYWORDS = [
  "not enabled",
  "invalid model",
  "unauthorized",
  "forbidden",
  "entitlement",
  "upgrade your plan",
];

/**
 * Runs an `EmbeddingProvider` call with retry, and classifies which failures
 * are worth retrying.
 *
 * Retryable: network failures, timeouts, 429/5xx-class errors, malformed
 * responses. Not retryable: invalid model, auth/entitlement rejection,
 * billing/quota denials, or a local model ID mistakenly routed to the remote
 * provider.
 */
export class EmbeddingRetryService {
  constructor(
    private readonly profile: EmbeddingRetryProfile = DEFAULT_REMOTE_EMBEDDING_RETRY_PROFILE,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  /** True when the error looks transient and worth another attempt. */
  isRetryable(error: unknown): boolean {
    // Billing/quota denials are permanent — never retry, just surface them.
    if (isEmbeddingBillingError(error)) {
      return false;
    }
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    return !NON_RETRYABLE_KEYWORDS.some((keyword) => message.includes(keyword));
  }

  async embedBatch(
    provider: EmbeddingProvider,
    texts: string[]
  ): Promise<EmbeddingResult[]> {
    return this.withRetry(() => provider.embedBatch(texts));
  }

  async embedText(
    provider: EmbeddingProvider,
    text: string
  ): Promise<EmbeddingResult> {
    return this.withRetry(() => provider.embedText(text));
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.profile.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === this.profile.maxAttempts) {
          throw error;
        }
        const delay =
          this.profile.delaysMs[attempt - 1] ??
          this.profile.delaysMs[this.profile.delaysMs.length - 1] ??
          0;
        await this.sleep(delay);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Embedding retry exhausted");
  }
}
