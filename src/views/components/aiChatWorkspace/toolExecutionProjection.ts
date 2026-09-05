import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Pure tool-execution projection for the redesigned workspace
 * (PRD §12.5, FR-042..050; design §15.9–§15.11).
 *
 * Reduces persisted TOOL_CALL / TOOL_RESULT message rows (plus live detail
 * events) into ONE evolving execution row per stable `toolCallId`, grouped
 * by owning assistant response. Persisted transcript rows are NEVER merged,
 * mutated, or rewritten — this is a read projection only (design §8.7).
 */

export type ToolExecutionStatus =
  | "queued"
  | "running"
  | "awaiting_permission"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ToolOutputKind =
  | "summary"
  | "artifact"
  | "files"
  | "images"
  | "permission"
  | "error"
  | "structured";

export interface ToolExecutionView {
  readonly key: string;
  readonly assistantMessageId: string | null;
  readonly toolCallId: string | null;
  readonly toolName: string;
  readonly status: ToolExecutionStatus;
  readonly phase?: string;
  readonly progress?: number;
  readonly partialCount?: number;
  readonly expectedCount?: number;
  readonly summary?: string;
  readonly outputKind: ToolOutputKind;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly isError: boolean;
  /** Legacy row without a stable call id — compact standalone receipt. */
  readonly isLegacyUnpaired: boolean;
  /** Escaped-safe bounded arguments for the Activity details view. */
  readonly argumentsPreview?: string;
  /** FR-030: persisted artifact ID for reopen from history. */
  readonly artifactId?: string;
}

export interface ToolExecutionGroupView {
  readonly key: string;
  readonly assistantMessageId: string | null;
  readonly executions: readonly ToolExecutionView[];
  readonly completedCount: number;
  readonly totalCount: number;
  readonly hasUnresolvedAttention: boolean;
  readonly defaultExpanded: boolean;
}

/** Owning assistant message for a tool row: the nearest preceding assistant
 * MESSAGE row, or null for legacy histories (design §15.10 rule 1). */
function assistantOwnerFor(
  messages: readonly ChatV2MessageView[],
  index: number
): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (
      messages[i].messageType === MessageType.MESSAGE &&
      messages[i].role === "assistant" &&
      messages[i].id
    ) {
      return messages[i].id;
    }
  }
  return null;
}

/** Terminal statuses derived from a persisted TOOL_RESULT row. */
function statusFromResult(message: ChatV2MessageView): ToolExecutionStatus {
  const metadata = message.metadata;
  if (metadata?.toolResultStatus === "error") return "failed";
  return "completed";
}

/** Classify a result row's semantic output surface (design §15.11). */
function classifyOutput(message: ChatV2MessageView): {
  kind: ToolOutputKind;
  summary?: string;
  artifactId?: string;
} {
  const metadata = message.metadata;
  // FR-047: files (write_file/edit_file/list_files results with file changes)
  if (
    metadata?.toolName === "write_file" ||
    metadata?.toolName === "edit_file" ||
    metadata?.toolName === "list_files" ||
    metadata?.toolName === "search_files"
  ) {
    return { kind: "files" };
  }
  // FR-047: permission (skill permission prompts awaiting decision)
  if (
    metadata?.toolName === "install_system_dependency" ||
    (metadata?.toolResult &&
      typeof metadata.toolResult === "object" &&
      "needsPermission" in metadata.toolResult)
  ) {
    return { kind: "permission" };
  }
  if (metadata?.artifact) {
    const art = metadata.artifact as { id?: string } | undefined;
    return { kind: "artifact" as const, artifactId: art?.id };
  }
  if (metadata?.toolResultStatus === "error") {
    return {
      kind: "error",
      summary: metadata.error ?? metadata.toolResultSummary,
    };
  }
  if (metadata?.generatedImages && metadata.generatedImages.length > 0) {
    return { kind: "images" };
  }
  const summary =
    metadata?.toolResultSummary ?? metadata?.summary ?? message.content;
  const trimmed =
    typeof summary === "string" ? summary.replace(/\s+/g, " ").trim() : "";
  if (trimmed) {
    return { kind: "summary", summary: trimmed.slice(0, 200) };
  }
  return { kind: "structured" };
}

function boundedArguments(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  try {
    const text = JSON.stringify(args);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return undefined;
  }
}

/**
 * Build cohesive execution groups from persisted messages plus (optionally)
 * live detail events. Pairing rules (design §15.10):
 * - Pair call/result ONLY on equal non-empty `toolCallId`.
 * - Never pair on toolName, adjacency, or timestamps.
 * - Preserve original sequence order for multiple calls.
 * - Unpairable legacy rows become compact standalone receipts.
 */
export function buildToolExecutionGroups(
  messages: readonly ChatV2MessageView[],
  liveEvents: readonly ChatRunDetailEvent[] = []
): ToolExecutionGroupView[] {
  interface Pending {
    view: ToolExecutionView;
    order: number;
  }

  const byCallId = new Map<string, Pending>();
  const legacy: Pending[] = [];
  let order = 0;

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const metadata = message.metadata;
    if (message.messageType === MessageType.TOOL_CALL) {
      const toolCallId = metadata?.toolCallId?.trim() || null;
      const owner = assistantOwnerFor(messages, i);
      const view: ToolExecutionView = {
        key: toolCallId ? `exec-${toolCallId}` : `legacy-call-${message.id}`,
        assistantMessageId: owner,
        toolCallId,
        toolName: metadata?.toolName ?? "",
        status: "running",
        argumentsPreview: boundedArguments(metadata?.toolArguments),
        outputKind: "summary",
        isError: false,
        isLegacyUnpaired: !toolCallId,
        // FR-042: read persisted toolProgress metadata (applied by the
        // presenter from live tool_progress events) so the evolving row
        // shows progress without a separate liveEvents overlay.
        phase: metadata?.toolProgress?.phase ?? undefined,
        progress:
          typeof metadata?.toolProgress?.progress === "number"
            ? metadata.toolProgress.progress
            : undefined,
        partialCount: metadata?.toolProgress?.partialCount ?? undefined,
        expectedCount: metadata?.toolProgress?.expectedCount ?? undefined,
      };
      if (toolCallId) {
        byCallId.set(toolCallId, { view, order: order++ });
      } else {
        legacy.push({ view, order: order++ });
      }
    } else if (message.messageType === MessageType.TOOL_RESULT) {
      const toolCallId = metadata?.toolCallId?.trim() || null;
      const classification = classifyOutput(message);
      const finishedAt = message.timestamp;
      const pending = toolCallId ? byCallId.get(toolCallId) : undefined;
      if (toolCallId && pending) {
        // Paired: the ONE row evolves — no second generic result card.
        const startedMs = Date.parse(pending.view.startedAt ?? "");
        const finishedMs = Date.parse(finishedAt);
        byCallId.set(toolCallId, {
          order: pending.order,
          view: {
            ...pending.view,
            status: statusFromResult(message),
            summary: classification.summary,
            outputKind: classification.kind,
            isError: classification.kind === "error",
            artifactId: classification.artifactId,
            finishedAt,
            durationMs:
              Number.isNaN(startedMs) || Number.isNaN(finishedMs)
                ? undefined
                : Math.max(0, finishedMs - startedMs),
          },
        });
      } else {
        // Legacy unpaired result — compact standalone receipt.
        legacy.push({
          order: order++,
          view: {
            key: `legacy-result-${message.id}`,
            assistantMessageId: assistantOwnerFor(messages, i),
            toolCallId: null,
            toolName: metadata?.toolName ?? "",
            status: statusFromResult(message),
            summary: classification.summary,
            outputKind: classification.kind,
            isError: classification.kind === "error",
            finishedAt,
            isLegacyUnpaired: true,
          },
        });
      }
    }
  }

  // Apply live progress overlays to matching projections without mutating
  // the persisted message objects (design §15.10 rule 3).
  const entries = [...byCallId.values(), ...legacy];
  for (const event of liveEvents) {
    const payload = event.payload;
    if (
      (event.eventType !== "tool_progress" &&
        event.eventType !== "tool_call" &&
        event.eventType !== "tool_result") ||
      typeof payload.toolCallId !== "string"
    ) {
      continue;
    }
    for (const entry of entries) {
      if (entry.view.toolCallId !== payload.toolCallId) continue;
      if (event.eventType === "tool_progress") {
        entry.view = {
          ...entry.view,
          status: "running",
          phase:
            typeof payload.phase === "string"
              ? payload.phase
              : entry.view.phase,
          progress:
            typeof payload.progressFraction === "number"
              ? payload.progressFraction
              : entry.view.progress,
          partialCount:
            typeof payload.partialCount === "number"
              ? payload.partialCount
              : entry.view.partialCount,
          expectedCount:
            typeof payload.expectedCount === "number"
              ? payload.expectedCount
              : entry.view.expectedCount,
        };
      } else if (
        event.eventType === "tool_result" &&
        entry.view.status === "running"
      ) {
        // Live terminal fence: a later persisted result stays authoritative
        // after reload; duplicates cannot reopen a terminal row.
        entry.view = {
          ...entry.view,
          status:
            (payload.toolResult as { success?: boolean } | undefined)
              ?.success === false
              ? "failed"
              : "completed",
        };
      }
    }
  }

  entries.sort((a, b) => a.order - b.order);

  // Group by owning assistant message (one group per response). Buckets
  // accumulate first; immutable group views are built once at the end.
  const buckets = new Map<
    string,
    { assistantMessageId: string | null; views: ToolExecutionView[] }
  >();
  for (const entry of entries) {
    const ownerKey = entry.view.assistantMessageId ?? "__legacy__";
    const bucket = buckets.get(ownerKey) ?? {
      assistantMessageId: entry.view.assistantMessageId,
      views: [],
    };
    bucket.views.push(entry.view);
    buckets.set(ownerKey, bucket);
  }

  const groups: ToolExecutionGroupView[] = [];
  for (const [ownerKey, bucket] of buckets) {
    const executions = bucket.views;
    const completed = executions.filter(
      (e) => e.status === "completed" || e.status === "failed"
    ).length;
    const unresolved = executions.some(
      (e) =>
        e.status === "awaiting_permission" ||
        e.status === "awaiting_user" ||
        e.status === "failed" ||
        e.status === "interrupted" ||
        e.status === "running"
    );
    const allCompleted = executions.every((e) => e.status === "completed");
    groups.push({
      key: `group-${ownerKey}`,
      assistantMessageId: bucket.assistantMessageId,
      executions,
      completedCount: completed,
      totalCount: executions.length,
      hasUnresolvedAttention: unresolved,
      // Successful historical groups may collapse; running/unresolved stay
      // expanded (FR-048).
      defaultExpanded: unresolved || !allCompleted,
    });
  }

  return groups;
}

/**
 * Localized action-label registry (design §15.9): human-readable action as
 * the primary label; the raw tool name is secondary technical metadata.
 */
export const TOOL_ACTION_LABELS: Readonly<Record<string, string>> = {
  read_file: "Reading file",
  write_file: "Writing file",
  edit_file: "Editing file",
  list_files: "Listing files",
  search_files: "Searching project files",
  create_html_artifact: "Creating HTML report",
  web_search: "Searching the web",
  google_search: "Searching Google",
  send_email: "Sending email",
  read_emails: "Reading emails",
  install_system_dependency: "Installing dependency",
  run_command: "Running command",
};

export function actionLabelFor(toolName: string): string {
  return TOOL_ACTION_LABELS[toolName] ?? "";
}

/** Unknown-tool fallback pattern key (renderer localizes `Running {tool}`). */
export const UNKNOWN_TOOL_LABEL_KEY = "workspaceChat.execution.runningTool";
