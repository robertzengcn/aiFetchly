import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type { OpenAIChatMessage } from "@/api/aiChatApi";

export interface BuildOpenAITranscriptInput {
  history: AIChatMessageEntity[];
  currentUserMessage?: string;
  systemPrompt?: string;
  /** When set, only rows whose metadata.source equals this value are included. */
  filterSource?: "chat-v2";
  /** Optional cap on the number of history rows (most recent kept). */
  maxMessages?: number;
}

export interface BuildOpenAITranscriptResult {
  messages: OpenAIChatMessage[];
  skippedMessageIds: string[];
  warnings: string[];
}

interface ParsedRowMeta {
  source?: string;
}

function parseMeta(raw: string | undefined | null): ParsedRowMeta | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as ParsedRowMeta;
    }
  } catch {
    // Malformed metadata: treat as null, never throw.
  }
  return null;
}

/**
 * Pure converter: local DB rows -> OpenAI messages[].
 * Phase 1 only maps MESSAGE rows of role system/user/assistant. Tool rows are
 * skipped with a warning so they never leak into a request prematurely.
 */
export function buildOpenAITranscript(
  input: BuildOpenAITranscriptInput
): BuildOpenAITranscriptResult {
  const messages: OpenAIChatMessage[] = [];
  const skippedMessageIds: string[] = [];
  const warnings: string[] = [];

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }

  const sorted = [...input.history].sort((a, b) => {
    const ta = a.timestamp.getTime();
    const tb = b.timestamp.getTime();
    if (ta !== tb) {
      return ta - tb;
    }
    return a.id - b.id;
  });

  let rows = sorted;
  if (input.maxMessages !== undefined && input.maxMessages > 0) {
    rows = sorted.slice(-input.maxMessages);
  }

  for (const row of rows) {
    if (input.filterSource) {
      const meta = parseMeta(row.metadata);
      if (!meta || meta.source !== input.filterSource) {
        continue;
      }
    }

    if (row.messageType !== MessageType.MESSAGE) {
      skippedMessageIds.push(row.messageId);
      warnings.push(
        `Skipped non-message row ${row.messageId} (messageType=${row.messageType})`
      );
      continue;
    }

    const role = row.role;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      skippedMessageIds.push(row.messageId);
      warnings.push(`Skipped row ${row.messageId} (unsupported role=${role})`);
      continue;
    }

    messages.push({ role, content: row.content });
  }

  if (input.currentUserMessage) {
    messages.push({ role: "user", content: input.currentUserMessage });
  }

  return { messages, skippedMessageIds, warnings };
}
