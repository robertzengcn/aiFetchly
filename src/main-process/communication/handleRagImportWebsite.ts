/**
 * Website-import IPC delegator. Thin pass-through from the manual Knowledge
 * Library UI to the AI tool layer, so the UI reuses the exact same
 * scrape → stage → dedupe → RAG-upload path as `knowledge_library_import_website`.
 *
 * Extracted into its own module (electron-free) so it can be unit-tested in
 * isolation without loading the full rag-ipc controller chain.
 *
 * `KnowledgeLibraryAiTools.importWebsite` ignores its `context` argument, so a
 * minimal UI stub is safe. The tool performs its own AI-gate check (returns a
 * structured `AI_DISABLED` outcome) and `replace`-policy rejection, which is why
 * the channel is registered with `registerValidatedHandler` rather than the
 * AI-gated variant.
 */

import { KnowledgeLibraryAiTools } from "@/service/KnowledgeLibraryAiTools";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { KnowledgeLibraryWebsiteImportOutcome } from "@/entityTypes/knowledgeLibraryAiToolTypes";

export async function handleRagImportWebsite(
  input: Record<string, unknown>
): Promise<KnowledgeLibraryWebsiteImportOutcome> {
  const tools = new KnowledgeLibraryAiTools();
  const context: SkillExecutionContext = {
    conversationId: "knowledge-library-ui",
    toolCallId: "ui-website-import",
  };
  return tools.importWebsite(input, context);
}
