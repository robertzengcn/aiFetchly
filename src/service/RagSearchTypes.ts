/**
 * Types and constants for the reranked RAG retrieval pipeline.
 *
 * These types model the intermediate candidate stage (between raw vector/keyword
 * results and the final LLM-facing tool output) and the structured tool result
 * that the AI receives.
 */

// ---------------------------------------------------------------------------
// Performance / pipeline constants
// ---------------------------------------------------------------------------

export const DEFAULT_RESULT_LIMIT = 5;
export const MAX_RESULT_LIMIT = 10;
export const VECTOR_CANDIDATE_LIMIT = 50;
export const KEYWORD_CANDIDATE_LIMIT = 50;
/** Rerank top_n is multiplied by this factor to leave room for neighbor expansion */
export const RERANK_TOP_N_MULTIPLIER = 2;
export const MAX_TOOL_CONTENT_CHARS = 12_000;
export const MAX_CHUNK_CONTENT_CHARS = 3_000;
export const RERANK_TIMEOUT_MS = 6_000;

// Default hybrid weights
export const DEFAULT_VECTOR_WEIGHT = 0.65;
export const DEFAULT_KEYWORD_WEIGHT = 0.35;
/** Weights shifted toward keyword for identifier-like queries */
export const IDENTIFIER_VECTOR_WEIGHT = 0.45;
export const IDENTIFIER_KEYWORD_WEIGHT = 0.55;

// ---------------------------------------------------------------------------
// Candidate source
// ---------------------------------------------------------------------------

export type RagSearchCandidateSource = "vector" | "keyword" | "hybrid";

// ---------------------------------------------------------------------------
// Intermediate candidate (used inside the retrieval pipeline)
// ---------------------------------------------------------------------------

export interface RagSearchCandidate {
  chunkId: number;
  documentId: number;
  content: string;
  source: RagSearchCandidateSource;
  /** Raw L2 distance from vector search */
  vectorDistance?: number;
  /** Normalised similarity score derived from vector distance */
  vectorScore?: number;
  /** Simple hit-based score from keyword search */
  keywordScore?: number;
  /** Combined score used for candidate selection before rerank */
  combinedScore: number;
  /** Rerank relevance score (set after rerank call) */
  rerankScore?: number;
  metadata: {
    chunkIndex: number;
    startPosition?: number;
    endPosition?: number;
    pageNumber?: number;
  };
  document: {
    id: number;
    name: string;
    title?: string;
    fileType: string;
  };
}

// ---------------------------------------------------------------------------
// Tool request / response types
// ---------------------------------------------------------------------------

export interface KnowledgeSearchRequest {
  query: string;
  limit?: number;
  documentIds?: number[];
  documentTypes?: string[];
  tags?: string[];
  author?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  includeNeighborChunks?: boolean;
}

export interface KnowledgeSearchResultItem {
  citation: string;
  documentId: number;
  documentName: string;
  title?: string;
  fileType: string;
  chunkId: number;
  chunkIndex: number;
  /** Combined or rerank score */
  score: number;
  rerankScore?: number;
  content: string;
  matchType: "direct" | "neighbor";
}

export interface KnowledgeSearchToolResult {
  success: boolean;
  query: string;
  totalCandidates: number;
  rerankUsed: boolean;
  truncated: boolean;
  warning?: string;
  results: KnowledgeSearchResultItem[];
  timing?: {
    vectorMs: number;
    keywordMs: number;
    rerankMs: number;
    totalMs: number;
  };
}

// ---------------------------------------------------------------------------
// Neighbor chunk expansion types
// ---------------------------------------------------------------------------

export interface NeighborChunkResult {
  previous: {
    chunkId: number;
    chunkIndex: number;
    content: string;
  } | null;
  next: {
    chunkId: number;
    chunkIndex: number;
    content: string;
  } | null;
}
