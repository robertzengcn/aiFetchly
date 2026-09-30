import { windowInvoke } from "@/views/utils/apirequest";
import {
  AI_TOOL_RESULT_EXPORT,
  AI_TOOL_RESULT_GET,
  AI_TOOL_RESULT_READ,
  AI_TOOL_RESULT_SEARCH,
} from "@/config/channellist";

/**
 * Renderer API for preserved tool outputs.
 *
 * Renderer-side only: no TypeORM, models, or modules are imported here. The
 * renderer never receives a raw storage path and never receives the whole
 * artifact — it pages through bounded responses, and export is the explicit
 * way to obtain the saved whole.
 *
 * Errors arrive as a thrown Error whose message is the machine code (for
 * example OUTPUT_NOT_AVAILABLE), so callers translate rather than string-match
 * on prose.
 */

export interface ToolOutputDescriptorView {
  outputId: string;
  toolName: string;
  format: "text" | "json" | "jsonl" | "binary";
  mediaType: string;
  capturedBytes: number;
  originalBytes?: number;
  preservation: "complete" | "partial";
  sourceCompleteness: "complete" | "partial" | "unknown";
  incompleteReason?: string;
  state: string;
  recordCount?: number;
}

export interface ToolResultReadPageView {
  outputId: string;
  text: string;
  startByte: number;
  endByte: number;
  totalBytes: number;
  nextCursor: string | null;
  complete: boolean;
}

export interface ToolResultSearchPageView {
  outputId: string;
  matches: Array<{
    startByte: number;
    endByte: number;
    excerpt: string;
    readCursor: string;
  }>;
  scanComplete: boolean;
  nextCursor: string | null;
  sourceCompleteness: "complete" | "partial" | "unknown";
}

/** Fetch the public descriptor for one saved output. */
export async function getToolOutput(
  conversationId: string,
  outputId: string
): Promise<ToolOutputDescriptorView | null> {
  return (await windowInvoke(AI_TOOL_RESULT_GET, {
    conversationId,
    outputId,
  })) as ToolOutputDescriptorView | null;
}

/** Read one bounded page. */
export async function readToolOutput(
  req: {
    conversationId: string;
    outputId: string;
    cursor?: string;
    page?: number;
  }
): Promise<ToolResultReadPageView | null> {
  return (await windowInvoke(AI_TOOL_RESULT_READ, req)) as ToolResultReadPageView | null;
}

/** Search the saved bytes for a literal phrase. */
export async function searchToolOutput(
  req: {
    conversationId: string;
    outputId: string;
    query: string;
    cursor?: string;
  }
): Promise<ToolResultSearchPageView | null> {
  return (await windowInvoke(AI_TOOL_RESULT_SEARCH, req)) as ToolResultSearchPageView | null;
}

/**
 * Export the captured output through a native save dialog.
 *
 * Returns "cancelled" when the user dismisses the dialog, which is a normal
 * outcome rather than a failure. The bytes never pass through the renderer.
 */
export async function exportToolOutput(
  conversationId: string,
  outputId: string
): Promise<{ status: "exported" | "cancelled" } | null> {
  return (await windowInvoke(AI_TOOL_RESULT_EXPORT, {
    conversationId,
    outputId,
  })) as { status: "exported" | "cancelled" } | null;
}
