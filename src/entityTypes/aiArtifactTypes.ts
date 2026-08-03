/**
 * Shared type definitions for the AI Artifacts feature.
 *
 * Artifacts are standalone visual outputs (HTML for the MVP) that the AI
 * produces via the `create_html_artifact` tool. Full content is persisted
 * once per version and never duplicated into chat message metadata — chat
 * rows only carry the small `AIArtifactToolMetadata` pointer.
 *
 * @see docs/prd/ai-html-artifacts-prd.md
 * @see docs/prd/ai-html-artifacts-technical-design.md
 */

/** Supported artifact content types. HTML is the only MVP type. */
export type AIArtifactType = "html";

/** Raw tool arguments for the `create_html_artifact` skill. */
export interface CreateHtmlArtifactInput {
  title: string;
  html: string;
  description?: string;
  openImmediately?: boolean;
}

/**
 * Full persisted artifact record, including content.
 * Only leaves the main process through the artifact-read IPC.
 */
export interface AIArtifactRecord {
  id: string;
  conversationId: string;
  type: AIArtifactType;
  title: string;
  description?: string;
  mimeType: "text/html";
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Content-free artifact summary, used for lists and chat pointers. */
export interface AIArtifactSummary {
  id: string;
  conversationId: string;
  type: AIArtifactType;
  title: string;
  description?: string;
  mimeType: "text/html";
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Artifact metadata embedded in chat tool-result messages. */
export interface AIArtifactToolMetadata extends AIArtifactSummary {
  openImmediately: boolean;
}

/** Shape returned by the `create_html_artifact` tool to the model. */
export interface CreateHtmlArtifactToolResult {
  success: boolean;
  artifact?: AIArtifactToolMetadata;
  summary: string;
  error?: string;
}

/** Renderer request payload for fetching a single artifact by id. */
export interface GetAIArtifactRequest {
  artifactId: string;
}

/** Renderer request payload for listing artifacts in a conversation. */
export interface ListAIArtifactsRequest {
  conversationId: string;
}
