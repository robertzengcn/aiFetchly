import { RagSearchModule } from "@/modules/RagSearchModule";
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
}

/**
 * Retrieve knowledge-library context for reply generation by calling the
 * existing {@code knowledge_library_search} contract
 * ({@link RagSearchModule.searchKnowledgeForTool}). Never throws — on failure
 * it returns an empty source set with a warning so draft generation can
 * continue (with an audit record) per the PRD error-handling rules.
 */
export async function retrieveReplyKnowledge(
  input: ReplyKnowledgeInput
): Promise<ReplyKnowledgeResult> {
  if (!input.useKnowledgeLibrary) {
    return {
      sources: [],
      audits: [],
      query: "",
      warning: "knowledge_library_search disabled by caller",
    };
  }

  const query = buildQuery(input);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));

  try {
    const mod = new RagSearchModule();
    const res = await mod.searchKnowledgeForTool({
      query,
      limit,
      includeNeighborChunks: true,
    });

    if (!res.success || res.results.length === 0) {
      return {
        sources: [],
        audits: [],
        query,
        warning: res.warning ?? "knowledge_library_search returned no results",
      };
    }

    const sources: EmailReplyKnowledgeSource[] = res.results.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      documentTitle: r.title ?? null,
      content: trim(r.content, PROMPT_SNIPPET_CAP),
      score: r.score,
    }));

    const audits: EmailReplyKnowledgeSourceAudit[] = res.results.map((r) => ({
      toolName: "knowledge_library_search",
      query,
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentName: r.documentName,
      documentTitle: r.title,
      citation: r.citation,
      score: r.score,
    }));

    return { sources, audits, query, warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sources: [],
      audits: [],
      query,
      warning: `knowledge_library_search failed: ${trim(message, 200)}`,
    };
  }
}

/** Build a retrieval query from subject + body + sender + goal + classification. */
function buildQuery(input: ReplyKnowledgeInput): string {
  const parts: string[] = [input.subject];
  if (input.bodyText) parts.push(input.bodyText.slice(0, 500));
  if (input.fromName) parts.push(input.fromName);
  if (input.classification) parts.push(input.classification);
  if (input.goal) parts.push(input.goal);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function trim(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).trimEnd() + "…";
}
