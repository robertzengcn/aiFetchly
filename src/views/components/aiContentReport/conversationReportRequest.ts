/**
 * Convert an immutable snapshot + UI selection into the version-2 wire request
 * (design §9). Pure + async (image encoding). Never calls IPC itself, so it is
 * independently testable.
 */
import { encodeReportImagePreview } from "./AIContentReportImageEncoder";
import { normalizeConversationTexts } from "./conversationReportText";
import type { ConversationReportSnapshot } from "./conversationReportSnapshot";
import {
  type AIContentReportCategory,
  type CreateAIConversationReportRequest,
  type AIConversationReportItem,
  type AIConversationReportScope,
} from "@/entityTypes/aiContentReportTypes";

export interface BuildConversationReportRequestInput {
  readonly snapshot: ConversationReportSnapshot;
  readonly selectedAIItemIds: ReadonlySet<string>;
  readonly selectedImageIds: ReadonlySet<string>;
  readonly includeRelatedUserContext: boolean;
  readonly category: AIContentReportCategory;
  readonly comment?: string;
  readonly locale: string;
  readonly clientReportId: string;
}

const MAX_AI_ITEMS = 10;
const MAX_TOTAL_IMAGES = 3;

/** Typed local validation errors — these never cross IPC (design §23). */
export class AIConversationReportLocalError extends Error {
  readonly code:
    | "selection_required"
    | "selection_limit"
    | "image_limit"
    | "related_message_unavailable"
    | "conversation_changed"
    | "evidence_unavailable";
  constructor(
    code: AIConversationReportLocalError["code"],
    message: string
  ) {
    super(message);
    this.name = "AIConversationReportLocalError";
    this.code = code;
  }
}

export async function buildCreateAIConversationReportRequest(
  input: BuildConversationReportRequestInput
): Promise<CreateAIConversationReportRequest> {
  const { snapshot, selectedAIItemIds, selectedImageIds } = input;

  // 1. Resolve selected candidates; reject zero or >10.
  const selected = snapshot.candidates.filter((c) =>
    selectedAIItemIds.has(c.itemId)
  );
  if (selected.length === 0) {
    throw new AIConversationReportLocalError(
      "selection_required",
      "Select at least one AI output to report."
    );
  }
  if (selected.length > MAX_AI_ITEMS) {
    throw new AIConversationReportLocalError(
      "selection_limit",
      `Select at most ${MAX_AI_ITEMS} AI outputs.`
    );
  }

  // 2. Sort by sourceIndex.
  const sorted = [...selected].sort((a, b) => a.sourceIndex - b.sourceIndex);

  // 3. Merge deduplicated related users by sourceIndex if opted in.
  type MergedItem =
    | { kind: "ai"; candidate: (typeof sorted)[number] }
    | { kind: "user"; candidate: (typeof sorted)[number]; related: NonNullable<(typeof sorted)[number]["relatedUser"]> };

  const merged: MergedItem[] = [];
  const seenUserIds = new Set<string>();
  for (const cand of sorted) {
    if (input.includeRelatedUserContext && cand.relatedUser) {
      if (!seenUserIds.has(cand.relatedUser.messageId)) {
        seenUserIds.add(cand.relatedUser.messageId);
        merged.push({ kind: "user", candidate: cand, related: cand.relatedUser });
      }
    }
    merged.push({ kind: "ai", candidate: cand });
  }

  // Final ordered by sourceIndex (interleave users before their owning assistant).
  merged.sort((a, b) => {
    const ai = a.kind === "user" ? a.related.sourceIndex : a.candidate.sourceIndex;
    const bi = b.kind === "user" ? b.related.sourceIndex : b.candidate.sourceIndex;
    return ai - bi;
  });

  // 4. Normalize text.
  const textInputs = merged.map((m) => ({
    itemId: m.kind === "user" ? m.related.itemId : m.candidate.itemId,
    text: m.kind === "user" ? m.related.text : m.candidate.text ?? "",
  }));
  const normalized = normalizeConversationTexts(textInputs);
  const textById = new Map(normalized.texts.map((t) => [t.itemId, t]));

  // 5. Encode selected generated images in chronological order, stop after 3.
  // Items are constructed immutably with their final values — no post-hoc
  // mutation of sequence or evidenceUnavailable.
  const items: AIConversationReportItem[] = [];
  let imageCount = 0;
  let seq = 0;

  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    if (m.kind === "user") {
      const t = textById.get(m.related.itemId)!;
      items.push({
        itemId: m.related.itemId,
        messageId: m.related.messageId,
        sequence: seq++,
        role: "user",
        contentType: "text",
        text: t.text,
        textTruncated: t.truncated || undefined,
        consentSource: "related_user_context_toggle",
        generatedAt: m.related.generatedAt,
      });
      continue;
    }

    const cand = m.candidate;
    const t = textById.get(cand.itemId)!;

    // Encode images only for selected image source IDs owned by this candidate.
    let evidenceUnavailable = cand.evidenceUnavailable;
    let imagePreviews: AIConversationReportItem["imagePreviews"] = undefined;
    if (imageCount < MAX_TOTAL_IMAGES) {
      const previews: NonNullable<AIConversationReportItem["imagePreviews"]> = [];
      for (const img of cand.images) {
        if (imageCount >= MAX_TOTAL_IMAGES) break;
        if (!selectedImageIds.has(img.sourceId)) continue;
        const preview = await encodeReportImagePreview({
          dataBase64: img.dataBase64,
          mimeType: img.mimeType,
        });
        if (preview) {
          previews.push(preview);
          imageCount++;
        } else {
          evidenceUnavailable = true;
        }
      }
      if (previews.length > 0) imagePreviews = previews;
    }

    items.push({
      itemId: cand.itemId,
      messageId: cand.messageId,
      sequence: seq++,
      role: "assistant",
      contentType: cand.contentType,
      text: cand.text ? t.text : undefined,
      textTruncated: cand.text ? t.truncated || undefined : undefined,
      imagePreviews,
      evidenceUnavailable: evidenceUnavailable || undefined,
      generatedAt: cand.generatedAt,
      model: cand.model,
    });
  }

  // 9. reportScope from the toggle.
  const reportScope: AIConversationReportScope = input.includeRelatedUserContext
    ? "selected_ai_outputs_with_related_user_context"
    : "selected_ai_outputs";

  // 10. Count actual roles.
  const selectedAIItemCount = items.filter((i) => i.role === "assistant").length;
  const includedUserItemCount = items.filter((i) => i.role === "user").length;

  // 11. Placeholders for appVersion/platform/installId; main service overwrites.
  const request: CreateAIConversationReportRequest = {
    schemaVersion: 2,
    clientReportId: input.clientReportId,
    surface: snapshot.surface,
    reportScope,
    category: input.category,
    comment: input.comment?.trim() ? input.comment.slice(0, 2000) : undefined,
    items,
    context: {
      conversationId: snapshot.conversationId,
      selectedAIItemCount,
      includedUserItemCount,
      aggregateTextTruncated: normalized.aggregateTruncated || undefined,
      appVersion: "unknown",
      platform: "win32",
      locale: input.locale,
    },
  };

  return request;
}
