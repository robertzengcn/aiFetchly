/**
 * Rerank service – wraps AiChatApi.rerank() with timeout, stable index
 * mapping, and graceful fallback.
 *
 * The service is intentionally stateless; each call receives the candidates
 * and returns a new ranked array (no mutation of inputs).
 */

import { AiChatApi } from "@/api/aiChatApi";
import type {
  RagSearchCandidate,
  KnowledgeSearchResultItem,
} from "./RagSearchTypes";
import {
  RERANK_TIMEOUT_MS,
  RERANK_TOP_N_MULTIPLIER,
  MAX_CHUNK_CONTENT_CHARS,
} from "./RagSearchTypes";

export interface RerankOutcome {
  /** Ranked candidates (may be reranked or fallback hybrid-ranked). */
  ranked: RagSearchCandidate[];
  /** Whether rerank was actually used. */
  rerankUsed: boolean;
  /** Warning message when falling back. */
  warning?: string;
  /** Rerank call duration in ms (0 when fallback). */
  rerankMs: number;
}

export class RagRerankService {
  private aiChatApi: AiChatApi;

  constructor() {
    this.aiChatApi = new AiChatApi();
  }

  /**
   * Rerank candidates by relevance to the query.
   * Falls back to the existing hybrid ranking if rerank fails or times out.
   */
  async rerank(
    query: string,
    candidates: RagSearchCandidate[],
    finalLimit: number
  ): Promise<RerankOutcome> {
    if (candidates.length === 0) {
      return { ranked: [], rerankUsed: false, rerankMs: 0 };
    }

    const topN = Math.min(
      candidates.length,
      finalLimit * RERANK_TOP_N_MULTIPLIER
    );
    const startTime = Date.now();

    try {
      // Build document payloads with stable index mapping
      const documents = candidates.map((c) => ({
        text: c.content.slice(0, MAX_CHUNK_CONTENT_CHARS),
        chunkId: c.chunkId,
        documentId: c.documentId,
      }));

      // Race the rerank call against a timeout
      const response = await this.callWithTimeout(
        this.aiChatApi.rerank({
          query,
          documents,
          top_n: topN,
          return_documents: false,
        }),
        RERANK_TIMEOUT_MS
      );

      const rerankMs = Date.now() - startTime;

      // Map response indexes back to candidates
      const ranked: RagSearchCandidate[] = [];
      for (const item of response.results) {
        const candidate = candidates[item.index];
        if (!candidate) {
          console.warn(
            `Rerank returned invalid candidate index: ${item.index}`
          );
          continue;
        }
        ranked.push({
          ...candidate,
          rerankScore: item.relevance_score,
          combinedScore: item.relevance_score,
        });
      }

      return { ranked, rerankUsed: true, rerankMs };
    } catch (error) {
      const rerankMs = Date.now() - startTime;
      const message =
        error instanceof Error ? error.message : "Unknown rerank error";
      console.warn(`Rerank failed (${message}), falling back to hybrid ranking`);

      return {
        ranked: candidates.slice(0, topN),
        rerankUsed: false,
        warning: "Rerank unavailable; returned hybrid-ranked results.",
        rerankMs,
      };
    }
  }

  /**
   * Race a promise against a timeout.
   */
  private callWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Rerank timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
}
