import { RagSearchModule } from "@/modules/RagSearchModule";
import { EmailReplyKnowledgeScopeModule } from "@/modules/EmailReplyKnowledgeScopeModule";
import {
  decideKnowledgeRelevance,
  type KnowledgeRelevanceDecision,
} from "@/service/emailReply/EmailReplyKnowledgeRelevance";
import { incrementReplyMetric } from "@/service/emailReply/EmailReplyMetrics";
import type {
  EmailReplyKnowledgeSource,
  EmailReplyKnowledgeSourceAudit,
} from "@/entityTypes/emailReceiveAiTypes";

/** Max chars of a snippet embedded in the LLM prompt. */
const PROMPT_SNIPPET_CAP = 800;
/** Default number of sources to retrieve. */
const DEFAULT_LIMIT = 5;
/** Hard cap on retrieved sources. */
const MAX_LIMIT = 10;

/** Input to {@link retrieveReplyKnowledge}. */
export interface ReplyKnowledgeInput {
  readonly emailServiceId: number;
  readonly subject: string;
  readonly bodyText: string | null;
  readonly fromName?: string | null;
  readonly goal?: string;
  readonly classification?: string | null;
  readonly limit?: number;
  readonly useKnowledgeLibrary: boolean;
}

/** Result of retrieval: prompt-facing sources + audit-facing records. */
export interface ReplyKnowledgeResult {
  readonly sources: readonly EmailReplyKnowledgeSource[];
  readonly audits: readonly EmailReplyKnowledgeSourceAudit[];
  readonly query: string;
  readonly warning: string | null;
  /** True when retrieval abstained — generation must not use general knowledge. */
  readonly abstained: boolean;
  /** Machine-readable relevance decision for audit metadata (FR-008/009). */
  readonly relevance: KnowledgeRelevanceDecision | null;
  readonly scopeVersion: number | null;
}

/**
 * Mailbox-scoped knowledge retrieval with relevance + abstention (FR-008/009,
 * §11.1–11.5). Scope rules:
 *  - NO scope row configured → legacy behavior (search all eligible docs);
 *  - a scope row with allowAllDocuments=1 → search all eligible docs;
 *  - a scope row with allowAllDocuments=0 → search ONLY the allowlist, and an
 *    EMPTY allowlist means search NOTHING (it can never degrade to all).
 *
 * After retrieval the pure relevance decision filters neighbors, duplicates,
 * inactive docs, and low scores; conflicting values or missing evidence force
 * abstention + review.
 */
export async function retrieveReplyKnowledge(
  input: ReplyKnowledgeInput
): Promise<ReplyKnowledgeResult> {
  if (!input.useKnowledgeLibrary) {
    return empty("knowledge_library_search disabled by caller", false, null, null);
  }

  // 1. Load the mailbox scope BEFORE any document content is fetched (FR-008).
  const scopeModule = new EmailReplyKnowledgeScopeModule();
  let scopeVersion: number | null = null;
  let allowAll = true;
  let allowedDocumentIds: readonly number[] = [];
  let excludeInactive = true;
  try {
    const scope = await scopeModule.getByEmailServiceId(input.emailServiceId);
    if (scope) {
      scopeVersion = scope.version;
      allowAll = scope.allowAllDocuments === 1;
      try {
        allowedDocumentIds = JSON.parse(scope.documentIdsJson) as number[];
      } catch {
        allowedDocumentIds = [];
      }
      excludeInactive = scope.excludeInactiveDocuments === 1;
    }
  } catch (error) {
    console.error("Failed to load knowledge scope; abstaining:", error);
    return empty("knowledge scope unreadable; abstaining", true, null, null);
  }

  // Empty allowlist with allowAll=false = search NOTHING (never everything).
  if (!allowAll && allowedDocumentIds.length === 0) {
    return empty(
      "knowledge scope for this mailbox is empty; searching nothing",
      true,
      null,
      scopeVersion
    );
  }

  const query = buildQuery(input);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

  try {
    const mod = new RagSearchModule();
    const res = await mod.searchKnowledgeForTool({
      query,
      limit,
      includeNeighborChunks: true,
      ...(allowAll ? {} : { documentIds: [...allowedDocumentIds] }),
    });

    if (!res.success) {
      return empty(
        res.warning ?? "knowledge_library_search failed",
        true,
        null,
        scopeVersion,
        query
      );
    }

    // 2. Relevance + abstention decision over the raw candidates.
    const decision = decideKnowledgeRelevance(
      res.results.map((r) => ({
        documentId: r.documentId,
        documentActive: true,
        text: r.content,
        score: r.score,
        isNeighbor: false,
      })),
      {
        allowAllDocuments: allowAll,
        allowedDocumentIds: allowedDocumentIds,
        excludeInactiveDocuments: excludeInactive,
      }
    );

    if (decision.outcome === "no_results" || decision.outcome === "scope_empty") {
      return empty(
        "no in-scope knowledge results",
        true,
        decision,
        scopeVersion,
        query
      );
    }

    const selectedDocs = new Set(decision.selections.map((s) => s.documentId));
    const picked = res.results.filter((r) => selectedDocs.has(r.documentId));

    const sources: EmailReplyKnowledgeSource[] = picked.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      documentTitle: r.title ?? null,
      content: trim(r.content, PROMPT_SNIPPET_CAP),
      score: r.score,
    }));
    const audits: EmailReplyKnowledgeSourceAudit[] = picked.map((r) => ({
      toolName: "knowledge_library_search",
      query,
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      documentTitle: r.title,
      citation: r.citation,
      score: r.score,
    }));

    incrementReplyMetric("retrieval_outcome", { outcome: decision.outcome });
    const abstained =
      decision.outcome === "low_relevance" || decision.outcome === "conflicting";
    const warning =
      decision.outcome === "conflicting"
        ? decision.reviewReason
        : decision.outcome === "low_relevance"
        ? decision.reviewReason
        : null;

    return {
      sources: abstained ? [] : sources,
      audits: abstained ? [] : audits,
      query,
      warning,
      abstained,
      relevance: decision,
      scopeVersion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return empty(
      `knowledge_library_search failed: ${trim(message, 200)}`,
      true,
      null,
      scopeVersion,
      query
    );
  }
}

function empty(
  warning: string,
  abstained: boolean,
  relevance: KnowledgeRelevanceDecision | null,
  scopeVersion: number | null,
  query = ""
): ReplyKnowledgeResult {
  return {
    sources: [],
    audits: [],
    query,
    warning,
    abstained,
    relevance,
    scopeVersion,
  };
}

/** Build a retrieval query from subject + body + goal + classification. */
function buildQuery(input: ReplyKnowledgeInput): string {
  const parts: string[] = [input.subject];
  if (input.bodyText) parts.push(input.bodyText.slice(0, 500));
  if (input.goal) parts.push(input.goal);
  if (input.classification) parts.push(input.classification);
  // Sender names are deliberately NOT query-stuffed (§11.2).
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function trim(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd() + "…";
}
