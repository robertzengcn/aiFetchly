import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2GeneratedImage, ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";
import { isEnterPlanModeToolName } from "@/service/EnterPlanModeTool";
import { isPlanToolName } from "@/service/PlanModeToolPolicy";

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

// ---------------------------------------------------------------------------
// Specialized-surface predicates (R8 P3, PRD §13.3)
// ---------------------------------------------------------------------------

/**
 * FR-SKL-001: an installer tool result carrying an install session — the
 * shared AiChatV2Message branch mounts SkillInstallCard for exactly this
 * predicate (toolName prefix + sessionId), so reuse it rather than
 * fabricating a snapshot from arbitrary structured text.
 */
export function isSkillInstallResult(message: ChatV2MessageView): boolean {
  return (
    message.messageType === ("tool_result" as MessageType) &&
    String(message.metadata?.toolName || "").startsWith("skill_install_") &&
    typeof (
      message.metadata?.toolResult as { sessionId?: unknown } | undefined
    )?.sessionId === "string"
  );
}

/** T3/D2: a generated-image batch card (live progress, Stop, Retry). */
export function isBatchToolCard(message: ChatV2MessageView): boolean {
  return (
    (message.messageType === ("tool_call" as MessageType) ||
      message.messageType === ("tool_result" as MessageType)) &&
    String(message.metadata?.toolName || "") === "process_artifact_batch"
  );
}

/**
 * R8 P3 (PRD §13.3): the result renders a SPECIALIZED transcript surface
 * (skill install, outbound batch, generated-image batch) beside the
 * execution group. The group row keeps its identity but must suppress the
 * generic body, or the same result renders twice.
 */
export function hasSpecializedSurface(message: ChatV2MessageView): boolean {
  if (isSkillInstallResult(message) || isBatchToolCard(message)) return true;
  return (
    message.messageType === MessageType.TOOL_RESULT &&
    String(message.metadata?.toolName || "") === "draft_outbound_email_batch" &&
    typeof message.metadata?.toolResult?.batchId === "number"
  );
}

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
  /** D8: image tiles for the images kind (thumbnails + actions). */
  readonly images?: readonly ChatV2GeneratedImage[];
  /** D8: the tool_result message the tiles belong to (reference target). */
  readonly sourceMessageId?: string | null;
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
  /**
   * The result replaced an approved permission prompt (design §15.5) —
   * the just-approved output must stay visible.
   */
  readonly permissionResumed?: boolean;
  /**
   * Stage A §3.3 (FR-006): a REQUIRED persistence write failed for this tool
   * call — the card renders the localized "not run: could not be saved" /
   * "result not saved" failure and never shows running or success.
   */
  readonly persistFailure?: "tool_call_persist_failed" | "tool_result_persist_failed";
  /**
   * R8 P3 (PRD §13.3): the result renders its own specialized transcript
   * surface (skill install / outbound batch / image batch) beside the
   * group — the generic SemanticToolResult body must be suppressed while
   * the execution identity and Activity detail stay.
   */
  readonly hasSpecializedCard?: boolean;
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

const FAILURE_REASON_MAX_CHARS = 500;

/**
 * Plan-mode UI tools (`EnterPlanMode`, `AskUserQuestion`,
 * `SubmitPlanForApproval`) never emit a matching `tool_result` event on
 * success — they drive the plan lifecycle surfaces through `plan_state` /
 * `ask_user_question` / `plan_submitted` events (FR-052). Projecting their
 * call rows as executable work would leave them "running" forever; the same
 * exclusion already guards the v2 pending-check in
 * `aiChatV2/toolExecutionStateUtil.ts`.
 */
export const isPlanModeUiToolName = (toolName: unknown): boolean =>
  typeof toolName === "string" &&
  (isEnterPlanModeToolName(toolName) || isPlanToolName(toolName));

function boundedFailureText(value: string): string | undefined {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > FAILURE_REASON_MAX_CHARS
    ? `${trimmed.slice(0, FAILURE_REASON_MAX_CHARS)}…`
    : trimmed;
}

function readFailureField(body: Record<string, unknown>): string | undefined {
  for (const key of ["error", "errorMessage", "message"] as const) {
    const value = body[key];
    if (typeof value === "string") {
      const bounded = boundedFailureText(value);
      if (bounded) return bounded;
    }
  }
  return undefined;
}

/**
 * Failure text carried on a tool-result payload.
 *
 * Producers put the reason on `error` (run_subagent, thrown skills) and
 * sometimes only on a nested `result.error`. The Execution row reads this
 * when message metadata did not lift the field to the top level.
 */
export function toolFailureReason(
  toolResult: Record<string, unknown> | undefined
): string | undefined {
  if (!toolResult) return undefined;
  const direct = readFailureField(toolResult);
  if (direct) return direct;
  const nested = toolResult.result;
  if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
    return readFailureField(nested as Record<string, unknown>);
  }
  return undefined;
}

/** Terminal statuses derived from a persisted TOOL_RESULT row. */
function statusFromResult(message: ChatV2MessageView): ToolExecutionStatus {
  const metadata = message.metadata;
  // A gated tool that has not been approved yet is parked mid-execution.
  if (metadata?.toolResult?.needsPermissionPrompt === true) {
    return "awaiting_permission";
  }
  if (metadata?.toolResultStatus === "error" || metadata?.success === false) {
    return "failed";
  }
  return "completed";
}

/** Classify a result row's semantic output surface (design §15.11). */
function classifyOutput(message: ChatV2MessageView): {
  kind: ToolOutputKind;
  summary?: string;
  artifactId?: string;
  images?: ChatV2GeneratedImage[];
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
    metadata?.toolResult?.needsPermissionPrompt === true
  ) {
    return { kind: "permission" };
  }
  if (metadata?.artifact) {
    const art = metadata.artifact as { id?: string } | undefined;
    return { kind: "artifact" as const, artifactId: art?.id };
  }
  if (metadata?.toolResultStatus === "error" || metadata?.success === false) {
    const summary =
      (typeof metadata.error === "string"
        ? boundedFailureText(metadata.error)
        : undefined) ??
      toolFailureReason(metadata.toolResult) ??
      (typeof metadata.toolResultSummary === "string"
        ? boundedFailureText(metadata.toolResultSummary)
        : undefined);
    return {
      kind: "error",
      summary,
    };
  }
  if (metadata?.generatedImages && metadata.generatedImages.length > 0) {
    // D8 (audit §13.2): the images row carries the tile metadata so the
    // semantic surface can render thumbnails + actions, not a count label.
    return {
      kind: "images" as const,
      images: metadata.generatedImages,
    };
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

  // Plan-mode UI tool calls project only when a paired result row exists
  // (failure receipts). Unpaired ones never emit a result — the plan
  // lifecycle surfaces own their state, and an unpaired call row would be
  // stuck "running" forever (FR-052).
  const pairedResultCallIds = new Set<string>();
  for (const message of messages) {
    if (message.messageType !== MessageType.TOOL_RESULT) continue;
    const resultCallId = message.metadata?.toolCallId?.trim();
    if (resultCallId) pairedResultCallIds.add(resultCallId);
  }

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const metadata = message.metadata;
    if (message.messageType === MessageType.TOOL_CALL) {
      const toolCallId = metadata?.toolCallId?.trim() || null;
      if (
        isPlanModeUiToolName(metadata?.toolName) &&
        (!toolCallId || !pairedResultCallIds.has(toolCallId))
      ) {
        continue;
      }
      const owner = assistantOwnerFor(messages, i);
      const persistFailure = metadata?.toolPersistFailure;
      const view: ToolExecutionView = {
        key: toolCallId ? `exec-${toolCallId}` : `legacy-call-${message.id}`,
        assistantMessageId: owner,
        toolCallId,
        toolName: metadata?.toolName ?? "",
        // Stage A §3.3 (FR-006): a required-persistence failure marks the
        // card failed — the tool never ran (call failed) or its result was
        // never stored; it must never show running or success.
        status: persistFailure ? "failed" : "running",
        argumentsPreview: boundedArguments(metadata?.toolArguments),
        outputKind: persistFailure ? "error" : "summary",
        isError: persistFailure !== undefined,
        isLegacyUnpaired: !toolCallId,
        ...(persistFailure ? { persistFailure } : {}),
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
      const specialized = hasSpecializedSurface(message);
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
            images: classification.images,
            sourceMessageId: message.id,
            finishedAt,
            durationMs:
              Number.isNaN(startedMs) || Number.isNaN(finishedMs)
                ? undefined
                : Math.max(0, finishedMs - startedMs),
            permissionResumed: metadata?.permissionResumed === true,
            hasSpecializedCard: specialized,
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
            images: classification.images,
            sourceMessageId: message.id,
            finishedAt,
            isLegacyUnpaired: true,
            permissionResumed: metadata?.permissionResumed === true,
            hasSpecializedCard: specialized,
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
        const liveResult = payload.toolResult as
          | { success?: boolean; needsPermissionPrompt?: boolean }
          | undefined;
        entry.view = {
          ...entry.view,
          status: liveResult?.needsPermissionPrompt
            ? "awaiting_permission"
            : liveResult?.success === false
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
    const permissionResumedInGroup = executions.some(
      (e) => e.permissionResumed === true
    );
    groups.push({
      key: `group-${ownerKey}`,
      assistantMessageId: bucket.assistantMessageId,
      executions,
      completedCount: completed,
      totalCount: executions.length,
      hasUnresolvedAttention: unresolved,
      // Successful historical groups may collapse; running/unresolved stay
      // expanded (FR-048). A permission-resumed result also stays expanded:
      // the user just approved that tool, so its output must remain visible
      // instead of vanishing behind an auto-collapse (design §15.5).
      defaultExpanded: unresolved || !allCompleted || permissionResumedInGroup,
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
