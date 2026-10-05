/**
 * Per-turn retrieval-service cache (technical-design §7.4).
 *
 * The retrieval budget (8,000 cumulative tokens / 4 calls) is scoped to one
 * assistant turn. Multiple tool calls within the same turn (e.g. a search
 * followed by a read) must share one budget so the 4-call cap accumulates
 * correctly. A new user message starts a new turn → a fresh service instance
 * → a fresh budget.
 *
 * SkillExecutionContext has no retrievalService field, and the tool handlers
 * are stateless functions, so the per-turn service instance is held here,
 * keyed by `${conversationId}:${turnId}`. The turnId is the trusted
 * current-turn user message id (context.sourceUserMessageId) supplied by the
 * main process — never a model argument. Falls back to "default" when the
 * caller does not supply one (tests, single-shot calls).
 *
 * The cache is bounded; the oldest entry is evicted when it exceeds the cap.
 * The query loop (Milestone 3) will eventually own instance lifetime more
 * directly, but this cache keeps Task 4e self-contained and correct.
 */
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatHistoryRetrievalService } from "@/service/AIChatHistoryRetrievalService";

const MAX_CACHED_SERVICES = 64;
const serviceCache = new Map<string, AIChatHistoryRetrievalService>();

/** Build the composite turn key from trusted context. */
export function turnKey(
  conversationId: string,
  turnId: string | undefined
): string {
  return `${conversationId}:${turnId ?? "default"}`;
}

/**
 * Get or create the per-turn retrieval service. The same turn reuses one
 * instance so the retrieval budget accumulates across search + read calls.
 */
export function getRetrievalService(
  conversationId: string,
  turnId: string | undefined
): AIChatHistoryRetrievalService {
  const key = turnKey(conversationId, turnId);
  let svc = serviceCache.get(key);
  if (!svc) {
    const archive = new AIChatArchiveModule();
    svc = new AIChatHistoryRetrievalService(archive);
    serviceCache.set(key, svc);
    // Bounded eviction: drop the oldest entry when over cap.
    if (serviceCache.size > MAX_CACHED_SERVICES) {
      const oldest = serviceCache.keys().next().value;
      if (oldest !== undefined) serviceCache.delete(oldest);
    }
  }
  return svc;
}

/** Drop the cached service for a finished turn (called by the query loop). */
export function releaseTurn(conversationId: string, turnId: string | undefined): void {
  serviceCache.delete(turnKey(conversationId, turnId));
}

/** Exposed for tests: how many services are currently cached. */
export function cachedServiceCount(): number {
  return serviceCache.size;
}
