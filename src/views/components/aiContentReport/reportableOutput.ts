import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { AIArtifactToolMetadata } from "@/entityTypes/aiArtifactTypes";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import type {
  AIContentType,
  AIOutputSurface,
} from "@/entityTypes/aiContentReportTypes";

/**
 * Renderer-side descriptor for a reportable AI output.
 *
 * Built at the call site from the message / artifact / plan the user is
 * reporting — a bounded snapshot, NOT a live pointer to reactive state
 * (PRD FR-3.1). The dialog and image encoder consume this; nothing here
 * is sent verbatim — the service layer re-truncates text and re-encodes
 * images before transmission.
 *
 * Only the selected AI output and the reporter's optional comment are ever
 * transmitted (PRD §3.4, FR-3.4). Prompts, neighboring messages, reasoning,
 * tool arguments, attachments, and workspace files are never present.
 */
export interface ReportableOutputDescriptor {
  surface: AIOutputSurface;
  contentType: AIContentType;
  /** Bounded text snapshot (service truncates to 32,000 chars). */
  text?: string;
  /** Generated-image sources for preview encoding (max 3 enforced later). */
  images?: ReportableImageSource[];
  context: {
    conversationId?: string;
    messageId?: string;
    artifactId?: string;
    model?: string;
    generatedAt?: string;
  };
}

export interface ReportableImageSource {
  /** Base64-encoded image bytes, WITHOUT the `data:` prefix. */
  dataBase64?: string;
  mimeType?: string;
}

/**
 * Build a descriptor for an AI Chat V2 assistant message (text and/or
 * generated images). Hidden for tool calls, tool results, user messages,
 * empty placeholders, and streaming messages — the caller decides
 * visibility; this helper just assembles the snapshot.
 */
export function buildChatV2Descriptor(
  message: ChatV2MessageView,
  surface: AIOutputSurface = "chat_v2"
): ReportableOutputDescriptor {
  const generatedImages = message.metadata?.generatedImages ?? [];
  const hasImages = generatedImages.length > 0;
  const hasText =
    typeof message.content === "string" && message.content.length > 0;

  const contentType: AIContentType =
    hasImages && hasText ? "mixed" : hasImages ? "image" : "text";

  return {
    surface,
    contentType,
    text: hasText ? message.content : undefined,
    images: hasImages
      ? generatedImages
          .filter(
            (img) => typeof img.b64_json === "string" && img.b64_json.length > 0
          )
          .slice(0, 3)
          .map((img) => ({
            dataBase64: img.b64_json,
            mimeType: img.mime_type ?? "image/png",
          }))
      : undefined,
    context: {
      conversationId: message.conversationId,
      messageId: message.id,
      model: message.model,
      generatedAt: message.timestamp,
    },
  };
}

/**
 * Build a descriptor for a generated artifact. The artifact's bounded
 * plaintext representation (title + description) is the report evidence —
 * never executable HTML, scripts, or a live file:// reference (PRD §13.2,
 * §14.5).
 */
export function buildArtifactDescriptor(
  artifact: AIArtifactToolMetadata
): ReportableOutputDescriptor {
  const parts = [artifact.title];
  if (artifact.description) {
    parts.push(artifact.description);
  }
  return {
    surface: "ai_artifact",
    contentType: "artifact",
    text: parts.filter(Boolean).join("\n\n"),
    context: {
      conversationId: artifact.conversationId,
      artifactId: artifact.id,
      generatedAt: artifact.createdAt,
    },
  };
}

/**
 * Build a descriptor for a generated plan (pinned for approval or moved
 * into history). The plan markdown + title + objective form the bounded
 * text evidence.
 */
export function buildPlanDescriptor(
  plan: AIChatPlanStateView,
  context: { conversationId?: string; messageId?: string; model?: string }
): ReportableOutputDescriptor {
  const parts: string[] = [];
  if (plan.title) parts.push(plan.title);
  if (plan.objective) parts.push(plan.objective);
  if (plan.latestVersion?.planMarkdown) {
    parts.push(plan.latestVersion.planMarkdown);
  }
  return {
    surface: "chat_v2",
    contentType: "plan",
    text: parts.length > 0 ? parts.join("\n\n") : undefined,
    context: {
      ...context,
      conversationId: plan.conversationId ?? context.conversationId,
    },
  };
}

/**
 * Build a descriptor for an AI-generated email template (subject + body)
 * shown in the template editor before Save/Send. The snapshot captures the
 * generated version, not later user edits (PRD §9.3, §13.2).
 */
export function buildEmailTemplateDescriptor(
  subject: string,
  body: string,
  context: { conversationId?: string; messageId?: string; model?: string } = {}
): ReportableOutputDescriptor {
  return {
    surface: "email_template_editor",
    contentType: "email_template",
    text: `${subject}\n\n${body}`,
    context,
  };
}
