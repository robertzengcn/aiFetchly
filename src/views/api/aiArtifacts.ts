import { windowInvoke } from "@/views/utils/apirequest";
import { AI_ARTIFACT_GET, AI_ARTIFACT_LIST } from "@/config/channellist";
import type {
  AIArtifactRecord,
  AIArtifactSummary,
} from "@/entityTypes/aiArtifactTypes";

/**
 * Fetch a single persisted artifact (including full HTML content) by its
 * stable id, for rendering in the sandboxed workspace iframe.
 */
export async function getAIArtifact(
  artifactId: string
): Promise<AIArtifactRecord | null> {
  const resp = await windowInvoke(AI_ARTIFACT_GET, { artifactId });
  return (resp as AIArtifactRecord | null) ?? null;
}

/**
 * List content-free artifact summaries for a conversation (used for
 * history/reopen affordances).
 */
export async function listAIArtifacts(
  conversationId: string
): Promise<AIArtifactSummary[]> {
  const resp = await windowInvoke(AI_ARTIFACT_LIST, { conversationId });
  return (resp as AIArtifactSummary[] | null) ?? [];
}
