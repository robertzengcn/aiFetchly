import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type {
  CreateHtmlArtifactToolResult,
} from "@/entityTypes/aiArtifactTypes";
import { AIArtifactModule } from "@/modules/AIArtifactModule";
import { validateCreateInput } from "@/service/AIArtifactValidationService";

/**
 * Backs the built-in `create_html_artifact` skill.
 *
 * Validates raw tool arguments, requires a conversation context, persists
 * the artifact via {@link AIArtifactModule}, and returns small typed
 * metadata (never the full HTML content) so the chat stays lightweight.
 *
 * Artifact creation runs inside the AI Chat V2 stream, which already gates
 * on AI enablement — so no separate AI-enable check is needed here.
 */
export class AIHtmlArtifactToolService {
  async create(
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<CreateHtmlArtifactToolResult> {
    if (!context || !context.conversationId) {
      return {
        success: false,
        summary: "Could not create the HTML artifact.",
        error: "Missing conversation id.",
      };
    }

    const validation = validateCreateInput(args);
    if (!validation.ok) {
      return {
        success: false,
        summary: "Could not create the HTML artifact.",
        error: validation.error,
      };
    }

    try {
      const module = new AIArtifactModule();
      const artifact = await module.createHtmlArtifact({
        conversationId: context.conversationId,
        title: validation.value.title,
        description: validation.value.description,
        html: validation.value.html,
      });

      return {
        success: true,
        artifact: {
          id: artifact.id,
          conversationId: artifact.conversationId,
          type: artifact.type,
          title: artifact.title,
          description: artifact.description,
          mimeType: artifact.mimeType,
          version: artifact.version,
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
          openImmediately: validation.value.openImmediately,
        },
        summary: `Created HTML artifact: ${artifact.title}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        summary: "Could not create the HTML artifact.",
        error:
          error instanceof Error
            ? error.message
            : "Failed to persist the HTML artifact.",
      };
    }
  }
}
