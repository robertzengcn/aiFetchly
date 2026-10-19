import "reflect-metadata";
import {
  TOOL_RESULT_CONFIG,
  TOOL_RESULT_POLICY_VERSION,
  type ToolResultConfig,
} from "@/config/toolResultConfig";
import {
  MemorySerializerSink,
  serializeValue,
} from "@/service/toolResult/ToolResultSerializer";
import { toolResultReceiptSchema } from "@/schemas/toolResult";
import type {
  PreparedToolResult,
  StoredToolOutputRef,
  ToolOperationStatus,
  ToolOutputFormat,
  ToolResultErrorCode,
  ToolResultPreviewKind,
  ToolResultReceipt,
  TrustedToolOutputContext,
} from "@/entityTypes/toolResultTypes";
import {
  boundUntrustedValue,
  boundString,
  countTextTokens,
  truncateUtf8Safe,
  utf8ByteLength,
} from "@/service/ToolResultTextUtil";
import type { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { ToolResultPreviewService } from "@/service/toolResult/ToolResultPreviewService";
import type { ToolResultModule } from "@/modules/ToolResultModule";
import { TOOL_RESULT_RETRIEVAL_TOOL_NAMES } from "@/entityTypes/toolResultToolTypes";
import {
  fitWrappedRetrievalResult,
  retrievalSerializedFits,
} from "@/service/toolResult/retrievalInlineBound";
import { encodeToolResultCursor } from "@/service/toolResult/ToolResultCursorCodec";

/**
 * The single shared preparation boundary (technical design §9.1).
 *
 * EVERY execution path - normal V2, permission resume, async completion,
 * scheduled, agent runtime, MCP, legacy - calls this BEFORE ordinary message
 * persistence, model dispatch, and renderer publication. The point of having
 * one boundary is that the lossy behaviour cannot be reintroduced in one
 * adapter: reduction happens before distribution, not after an event has
 * already escaped to the renderer.
 *
 * Two rules the implementation is built around:
 *
 *  - EXECUTION AND PRESERVATION ARE SEPARATE OUTCOMES. A failed capture
 *    produces a truthful receipt that still says the tool SUCCEEDED. Nothing
 *    here can turn a storage problem into a tool failure, and nothing retries
 *    a side-effecting tool.
 *  - OUTER TRUSTED STATUS IS AUTHORITATIVE. Producer properties are read
 *    through a validated allowlist, so a producer's own nested `success` key
 *    can never overwrite the execution status we actually observed.
 */

/** The already-normalized tool outcome handed to preparation. */
export interface ToolOutcome {
  readonly success: boolean;
  readonly executionTimeMs: number;
  readonly summary?: string;
  readonly error?: string;
  /** Classified operation status; derived when not supplied. */
  readonly operationStatus?: ToolOperationStatus;
  /** Producer's own completeness. Defaults to 'complete' when unstated. */
  readonly sourceCompleteness?: "complete" | "partial" | "unknown";
  /**
   * Validated, bounded control fields. Only these keys are carried into the
   * receipt; everything else in the result is treated as output.
   */
  readonly control?: Readonly<Record<string, unknown>>;
  /** The bulk output body, when the tool produced one. */
  readonly output?: unknown;
  readonly outputFormat?: ToolOutputFormat;
  readonly previewKind?: ToolResultPreviewKind;
  /** Extra artifacts (image descriptors etc.) that are NOT text output. */
  readonly extraOutputs?: readonly unknown[];
  /** True when the result carries no text output at all. */
  readonly isEmpty?: boolean;
}

/**
 * Control keys a producer may contribute. An allowlist, not a copy: this is
 * what stops a large or sensitive field from silently riding along in the
 * receipt, and it keeps permission/outcome state OUT of the preview.
 */
const ALLOWED_CONTROL_KEYS = [
  "needsPermissionPrompt",
  "permissionCategory",
  "permissionPreview",
  "executionPending",
  "job_id",
  "shell_id",
  "exit_code",
  "batchId",
  "batchStatus",
  "draftCount",
  "recipientCount",
  "sentCount",
  "reasonCode",
  "code",
  "total",
  "count",
  "page",
  "hasMore",
  "next_cursor",
  "partialCount",
  "expectedCount",
  "retryable",
  "attachments",
  "errorCode",
  "sourceCompleteness",
] as const;

/** Result of preparing one tool outcome. */
export interface PreparationDependencies {
  readonly context: TrustedToolOutputContext;
  readonly storage: ToolResultStorageService;
  readonly module: ToolResultModule;
  readonly previewService?: ToolResultPreviewService;
  /** True when new file capture is enabled for this run. */
  readonly captureEnabled: boolean;
  /** True when model-visible references may be advertised. */
  readonly modelRefsEnabled: boolean;
}

export class ToolResultPreparationService {
  private readonly preview: ToolResultPreviewService;

  constructor(previewService?: ToolResultPreviewService) {
    this.preview = previewService ?? new ToolResultPreviewService();
  }

  /**
   * Prepare one completed tool outcome into bounded, publishable forms.
   *
   * Never throws for a capture failure: a storage problem degrades to an
   * `unavailable`/`partial` receipt carrying the real operation outcome, which
   * is what keeps "the command ran but its output was not saved" distinct from
   * "the command failed".
   */
  async prepare(
    outcome: ToolOutcome,
    deps: PreparationDependencies
  ): Promise<PreparedToolResult> {
    const config = TOOL_RESULT_CONFIG;
    const operationStatus = outcome.operationStatus ?? deriveStatus(outcome);
    const control = this.buildControl(outcome);

    // Read/search pages must stay in the model message. Saving them creates
    // another receipt whose preview hides next_cursor.
    if (TOOL_RESULT_RETRIEVAL_TOOL_NAMES.has(deps.context.toolName)) {
      return this.prepareBoundedRetrieval(outcome, operationStatus);
    }

    // Small results keep their existing wire shape (AC-01): no needless
    // artifact, no receipt, no behavior change.
    //
    // The size gate must be BOUNDED. Stringifying the whole envelope to measure
    // it would materialize a 200 MB result as a 200 MB string purely to throw
    // it away - the exact behaviour the serializer exists to avoid. So the
    // output BODY is measured first through a capped sink that stops at the
    // inline ceiling, and the envelope is only built once the body is known to
    // be small.
    if (!(await isInlineEligible(outcome, config))) {
      return await this.externalize(outcome, deps, operationStatus, control);
    }

    const serialized = trySerializeInline(outcome);
    if (
      serialized !== undefined &&
      utf8ByteLength(serialized) <= config.inlineMaxBytes &&
      countTextTokens(serialized) <= config.inlineMaxTokens
    ) {
      return {
        canonicalMessageContent: serialized,
        modelContent: serialized,
        uiMetadata: {
          ...(operationStatus !== "success" ? { operationStatus } : {}),
          ...control,
        },
        serializedBytes: utf8ByteLength(serialized),
        accountedTokens: countTextTokens(serialized),
      };
    }

    // The body passed the bounded probe but the assembled envelope did not
    // fit (a large `summary` or control payload can do that), so externalize
    // rather than emit something over the inline ceiling.
    return await this.externalize(outcome, deps, operationStatus, control);
  }

  /**
   * Externalize an oversized result: claim a slot, preserve the body, and
   * publish a bounded receipt.
   */
  private async externalize(
    outcome: ToolOutcome,
    deps: PreparationDependencies,
    operationStatus: ToolOperationStatus,
    control: Record<string, unknown>
  ): Promise<PreparedToolResult> {
    // CAPTURE OFF MUST NOT WRITE. With the rollout flag off this conversation
    // still externalizes when a result is oversized, because the size ceiling
    // and the reference contract are not optional. What must not happen is a
    // new file write: the operator turned capture off. So the result degrades to
    // a truthful, bounded receipt carrying the real operation outcome, and the
    // oversized body is never emitted.
    if (!deps.captureEnabled) {
      return this.degradedReceipt(outcome, {
        operationStatus,
        control,
        code: "OUTPUT_CAPTURE_DISABLED",
        deps,
      });
    }

    // The Module mints the artifact id as part of claiming the writing slot;
    // every later step must use THAT id, not a locally generated one, or the
    // commit would target a row that does not exist.
    const claim = await deps.module.claimOutput({
      profileId: deps.context.profileId,
      conversationId: deps.context.conversationId,
      outputEpoch: deps.context.conversationEpoch,
      executionId: deps.context.executionId,
      toolCallId: deps.context.toolCallId,
      toolName: deps.context.toolName,
      turnId: deps.context.turnId,
      ownerAgentId: deps.context.ownerAgentId,
      streamKey: "main",
      format: outcome.outputFormat ?? "json",
      mediaType: "application/json",
      sourceCompleteness: outcome.sourceCompleteness ?? "complete",
    });

    if (claim.kind === "rejected" || claim.kind === "conflict") {
      // Quota refused, epoch rotated, or identity conflict. The operation
      // outcome is unaffected; we publish a truthful degraded receipt.
      return this.degradedReceipt(outcome, {
        operationStatus,
        control,
        code:
          claim.kind === "rejected"
            ? claim.code
            : "OUTPUT_PUBLICATION_FAILED",
        deps,
      });
    }

    // Idempotent replay (AC-25): an existing artifact for the same execution is
    // reused rather than rewritten, so a duplicated delivery produces one
    // artifact identity and one terminal receipt.
    const outputRef =
      claim.kind === "existing"
        ? refFromEntity(claim.output)
        : await this.captureAndCommit(outcome, deps, claim);

    const preview = this.preview.build({
      value: outcome.output,
      kind: outcome.previewKind ?? "records",
      isComplete:
        outputRef !== null &&
        outputRef.preservation === "complete" &&
        (outcome.sourceCompleteness ?? "complete") === "complete",
    });

    // The first page the model can request. Without this, the receipt names
    // tool_result_read but has no cursor, and the model invents one or spends
    // a call just to learn the token.
    if (outputRef && !preview.previewComplete) {
      control.next_cursor = encodeToolResultCursor({
        outputId: outputRef.outputId,
        revision: outputRef.revision,
        mode: "read",
        position: 0,
      });
    }

    const receipt = this.buildReceipt({
      outcome,
      operationStatus,
      control,
      outputRef,
      previewText: preview.text,
      previewComplete: preview.previewComplete,
      storageErrorCode: outputRef ? undefined : "OUTPUT_NOT_AVAILABLE",
      deps,
    });

    return {
      receipt,
      canonicalMessageContent: JSON.stringify(receipt),
      modelContent: deps.modelRefsEnabled
        ? this.modelProjection(receipt, preview.text)
        : JSON.stringify(receipt),
      uiMetadata: {
        operationStatus,
        ...control,
        outputRefs: outputRef ? [outputRef] : [],
        capturedBytes: outputRef?.capturedBytes ?? 0,
        preservation: outputRef?.preservation ?? "unavailable",
        sourceCompleteness: outputRef?.sourceCompleteness ?? "unknown",
        preview: preview.text,
        previewComplete: preview.previewComplete,
        policyVersion: TOOL_RESULT_POLICY_VERSION,
      },
      serializedBytes: utf8ByteLength(JSON.stringify(receipt)),
      accountedTokens: countTextTokens(JSON.stringify(receipt)),
    };
  }

  /** Capture the body, commit the artifact, and return its descriptor. */
  private async captureAndCommit(
    outcome: ToolOutcome,
    deps: PreparationDependencies,
    claim: Extract<
      Awaited<ReturnType<ToolResultModule["claimOutput"]>>,
      { kind: "claimed" }
    >
  ): Promise<StoredToolOutputRef | null> {
    const outputId = claim.outputId;
    let stored;
    try {
      if (outcome.outputFormat === "text" && typeof outcome.output === "string") {
        stored = await deps.storage.captureText({
          outputId,
          profileId: deps.context.profileId,
          outputEpoch: deps.context.conversationEpoch,
          text: outcome.output,
          sourceCompleteness: outcome.sourceCompleteness ?? "complete",
        });
      } else {
        stored = await deps.storage.captureJson({
          outputId,
          profileId: deps.context.profileId,
          outputEpoch: deps.context.conversationEpoch,
          value: outcome.output ?? null,
          format: outcome.outputFormat ?? "json",
          sourceCompleteness: outcome.sourceCompleteness ?? "complete",
        });
      }
    } catch (error: unknown) {
      // Serialization/disk failure. The tool still succeeded; record the
      // bounded code, release quota, and let the caller publish a degraded
      // receipt. Nothing here re-executes anything.
      //
      // The reservation MUST be released here: it is charged against the
      // conversation quota for as long as it stays 'held', so leaking it on a
      // failure path would permanently consume quota.
      const code =
        (error as { code?: ToolResultErrorCode }).code ??
        "OUTPUT_WRITE_FAILED";
      await deps.module.markOutputFailed(outputId, code);
      await settleQuota(deps, claim.reservationId, 0);
      return null;
    }

    const committed = await deps.module.commitOutput({
      outputId,
      leaseFence: claim.leaseFence,
      storageKey: stored.storageKey,
      capturedBytes: stored.capturedBytes,
      originalBytes: stored.originalBytes,
      sha256: stored.sha256,
      preservation: stored.preservation,
      sourceCompleteness: outcome.sourceCompleteness ?? "complete",
      recordCount: stored.recordCount,
      receiptJson: "{}",
    });
    if (!committed) {
      // Epoch rotated or the lease expired while we were writing. Release the
      // reservation for the same reason as above: nothing was committed, so the
      // held bytes must not stay charged.
      await settleQuota(deps, claim.reservationId, 0);
      return null;
    }
    await settleQuota(deps, claim.reservationId, stored.capturedBytes);
    return {
      outputId,
      revision: claim.revision,
      storageBackend: "file",
      format: stored.format,
      mediaType: stored.mediaType,
      capturedBytes: stored.capturedBytes,
      originalBytes: stored.originalBytes,
      sha256: stored.sha256,
      // A cap-interrupted capture is partial even though the write succeeded.
      preservation: stored.preservation,
      sourceCompleteness: (outcome.sourceCompleteness ?? "complete") as
        | "complete"
        | "partial"
        | "unknown",
      ...(stored.failureCode ? { incompleteReason: stored.failureCode } : {}),
    };
  }

  /** Receipt for a result whose output could not be preserved. */
  private degradedReceipt(
    outcome: ToolOutcome,
    input: {
      operationStatus: ToolOperationStatus;
      control: Record<string, unknown>;
      code: ToolResultErrorCode;
      deps: PreparationDependencies;
    }
  ): PreparedToolResult {
    // A tiny diagnostic preview is better than nothing, but it is never
    // presented as the output.
    const diagnostic = boundString(
      outcome.error ?? outcome.summary ?? "",
      400
    );
    const receipt = this.buildReceipt({
      outcome,
      operationStatus: input.operationStatus,
      control: input.control,
      outputRef: null,
      previewText: diagnostic,
      previewComplete: false,
      storageErrorCode: input.code,
      deps: input.deps,
    });
    const text = JSON.stringify(receipt);
    return {
      receipt,
      canonicalMessageContent: text,
      modelContent: text,
      uiMetadata: {
        operationStatus: input.operationStatus,
        ...input.control,
        outputRefs: [],
        preservation: "unavailable",
        sourceCompleteness: "unknown",
        storageErrorCode: input.code,
        policyVersion: TOOL_RESULT_POLICY_VERSION,
      },
      serializedBytes: utf8ByteLength(text),
      accountedTokens: countTextTokens(text),
    };
  }

  /** Validate and bound the control object through a strict allowlist. */
  private buildControl(outcome: ToolOutcome): Record<string, unknown> {
    const config = TOOL_RESULT_CONFIG;
    const source = outcome.control ?? {};
    const out: Record<string, unknown> = {};
    for (const key of ALLOWED_CONTROL_KEYS) {
      if (!(key in source)) continue;
      out[key] = boundUntrustedValue(source[key], {
        maxKeys: config.controlMaxKeys,
        maxArrayItems: config.controlMaxArrayItems,
        maxStringChars: config.controlMaxStringChars,
      });
    }
    // Keep the whole control object inside its ceiling by dropping optional
    // keys from the end; the allowlist order keeps outcome fields first.
    let encoded = JSON.stringify(out);
    for (const key of Object.keys(out).reverse()) {
      if (utf8ByteLength(encoded) <= config.controlMaxBytes) break;
      delete out[key];
      encoded = JSON.stringify(out);
    }
    return out;
  }

  /** Build the canonical receipt and validate it against the schema. */
  private buildReceipt(input: {
    outcome: ToolOutcome;
    operationStatus: ToolOperationStatus;
    control: Record<string, unknown>;
    outputRef: StoredToolOutputRef | null;
    previewText: string;
    previewComplete: boolean;
    storageErrorCode?: ToolResultErrorCode;
    deps: PreparationDependencies;
  }): ToolResultReceipt {
    const config = TOOL_RESULT_CONFIG;
    let preview = truncateUtf8Safe(input.previewText, config.previewMaxBytes);
    const base = {
      schemaVersion: 1 as const,
      toolCallId: boundString(input.deps.context.toolCallId, 200),
      toolName: boundString(input.deps.context.toolName, 200),
      // Outer trusted status, never a producer-provided value.
      operationStatus: input.operationStatus,
      success: input.outcome.success,
      executionTimeMs: Math.max(0, Math.floor(input.outcome.executionTimeMs)),
      summary: input.outcome.summary
        ? boundString(input.outcome.summary, 500)
        : undefined,
      control: input.control,
      outputs: input.outputRef ? [input.outputRef] : [],
      preview,
      previewComplete: input.previewComplete,
      storageErrorCode: input.storageErrorCode,
    };
    // The preview is allocated last, so it is what shrinks to fit the receipt.
    let validated = toolResultReceiptSchema.safeParse(base);
    while (!validated.success && preview.length > 0) {
      preview = truncateUtf8Safe(preview, Math.floor(preview.length / 2));
      validated = toolResultReceiptSchema.safeParse({ ...base, preview });
    }
    if (!validated.success) {
      // Last resort: drop the control payload rather than emit an invalid
      // receipt. Permission/outcome state lives in metadata, not only here.
      const minimal = toolResultReceiptSchema.safeParse({
        ...base,
        control: {},
        preview: preview.slice(0, 200),
        outputs: [],
      });
      return (minimal.success ? minimal.data : {
        ...base,
        control: {},
        preview: "",
        previewComplete: false,
        outputs: [],
      }) as ToolResultReceipt;
    }
    return validated.data as ToolResultReceipt;
  }

  /**
   * Keep a retrieval page in the model message.
   *
   * A page that does not fit is shrunk (fewer matches, shorter text) until it
   * does. If it still cannot fit, the model gets a bounded error. Neither
   * path writes an artifact.
   */
  private prepareBoundedRetrieval(
    outcome: ToolOutcome,
    operationStatus: ToolOperationStatus
  ): PreparedToolResult {
    const fitted = fitWrappedRetrievalResult(outcome.output);
    const output =
      fitted === null
        ? {
            success: false,
            error: "RETRIEVAL_PAGE_TOO_LARGE",
            analysis_complete: false,
          }
        : fitted;
    const controlSource =
      typeof output === "object" && output !== null && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : {};
    const control = this.buildControl({
      ...outcome,
      control: controlSource,
    });
    const serialized = trySerializeInline({
      ...outcome,
      output,
      control,
    });
    const body =
      serialized !== undefined && retrievalSerializedFits(serialized)
        ? serialized
        : JSON.stringify({
            success: false,
            error: "RETRIEVAL_PAGE_TOO_LARGE",
            analysis_complete: false,
          });
    return {
      canonicalMessageContent: body,
      modelContent: body,
      uiMetadata: {
        ...(operationStatus !== "success" ? { operationStatus } : {}),
        ...control,
      },
      serializedBytes: utf8ByteLength(body),
      accountedTokens: countTextTokens(body),
    };
  }

  /**
   * Model-facing projection of a receipt.
   *
   * Preserves identity, outcome, preservation, and the retrieval method -
   * those are what let the assistant continue correctly - and states plainly
   * that the preview is incomplete and how to read more.
   */
  private modelProjection(receipt: ToolResultReceipt, preview: string): string {
    const first = receipt.outputs[0];
    const payload: Record<string, unknown> = {
      schema_version: 1,
      success: receipt.success,
      operation_status: receipt.operationStatus,
      ...(receipt.summary ? { summary: receipt.summary } : {}),
      ...(typeof receipt.control.total === "number"
        ? { total: receipt.control.total }
        : {}),
      output: first
        ? {
            output_id: first.outputId,
            format: first.format,
            captured_bytes: first.capturedBytes,
            preservation: first.preservation,
            source_completeness: first.sourceCompleteness,
          }
        : null,
      preview,
      preview_complete: receipt.previewComplete,
      // One next call. A menu of read and search made the model search for a
      // token that appears on every row, then lose the continuation cursor
      // inside the truncated search preview.
      ...(first && !receipt.previewComplete
        ? {
            next: {
              tool: "tool_result_read",
              arguments: {
                output_id: first.outputId,
                ...(typeof receipt.control.next_cursor === "string"
                  ? { cursor: receipt.control.next_cursor }
                  : {}),
              },
            },
            ...(typeof receipt.control.next_cursor === "string"
              ? { next_cursor: receipt.control.next_cursor }
              : {}),
          }
        : {}),
      ...(receipt.storageErrorCode ? { storage_error: receipt.storageErrorCode } : {}),
    };
    return JSON.stringify(payload);
  }
}


/**
 * Decide whether a result is small enough to stay inline, WITHOUT ever
 * materializing the whole envelope.
 *
 * The output body is walked through a sink capped at the inline byte ceiling.
 * Once the cap is exceeded the walk stops, so the cost of this probe is bounded
 * by the ceiling rather than by the size of the result. A body that cannot be
 * represented as JSON is simply not inline-eligible; the external path reports
 * the precise serialization failure.
 */
async function isInlineEligible(
  outcome: ToolOutcome,
  config: ToolResultConfig
): Promise<boolean> {
  if (outcome.output === undefined) return true;
  if (typeof outcome.output === "string") {
    return utf8ByteLength(outcome.output) <= config.inlineMaxBytes;
  }
  const sink = new MemorySerializerSink(config.inlineMaxBytes);
  try {
    await serializeValue(outcome.output, sink, {
      format: outcome.outputFormat ?? "json",
    });
  } catch {
    return false;
  }
  if (sink.saturated()) return false;
  return countTextTokens(sink.toBuffer().toString("utf8")) <= config.inlineMaxTokens;
}

/**
 * Settle a reservation without ever throwing.
 *
 * Quota bookkeeping is secondary to the tool outcome: a failure to release must
 * not turn a successful tool into a failed one, so it is logged and swallowed.
 */
async function settleQuota(
  deps: PreparationDependencies,
  reservationId: string,
  usedBytes: number
): Promise<void> {
  try {
    await deps.module.settleReservation(reservationId, usedBytes);
  } catch {
    // Left for the recovery sweep's lease expiry to reclaim.
  }
}

/** Derive an operation status from the trusted outcome when unstated. */
function deriveStatus(outcome: ToolOutcome): ToolOperationStatus {
  if (outcome.control?.needsPermissionPrompt === true) return "permission_required";
  if (outcome.isEmpty) return "success";
  if (!outcome.success) return "error";
  return "success";
}

/**
 * Serialize a small inline result, preserving the existing wire shape.
 * Returns undefined when the value cannot be represented as JSON.
 */
function trySerializeInline(outcome: ToolOutcome): string | undefined {
  const parts: Record<string, unknown> = {
    success: outcome.success,
    executionTimeMs: outcome.executionTimeMs,
  };
  if (outcome.summary !== undefined) parts.summary = outcome.summary;
  if (outcome.error !== undefined) parts.error = outcome.error;
  if (outcome.operationStatus !== undefined) {
    parts.operationStatus = outcome.operationStatus;
  }
  if (outcome.isEmpty) {
    parts.output = null;
    parts.empty = true;
  } else if (outcome.output !== undefined) {
    parts.result = outcome.output;
  }
  if (outcome.control && Object.keys(outcome.control).length > 0) {
    parts.control = outcome.control;
  }
  try {
    return JSON.stringify(parts);
  } catch {
    return undefined;
  }
}

/** Project a registry row into a public output descriptor. */
function refFromEntity(entity: {
  outputId: string;
  revision: number;
  storageBackend: string;
  outputFormat: string;
  mediaType: string;
  capturedBytes: number;
  originalBytes?: number | null;
  sha256?: string | null;
  preservation: string;
  sourceCompleteness: string;
  failureCode?: string | null;
}): StoredToolOutputRef {
  return {
    outputId: entity.outputId,
    revision: entity.revision,
    storageBackend:
      entity.storageBackend === "legacy_message" ? "legacy_message" : "file",
    format: (entity.outputFormat as ToolOutputFormat) ?? "text",
    mediaType: entity.mediaType,
    capturedBytes: entity.capturedBytes,
    // TypeORM materializes a nullable column as null, but the receipt schema
    // declares these as OPTIONAL, which Zod means by `undefined`. Passing null
    // through would fail validation and silently drop the whole output list,
    // turning a perfectly good artifact into an empty receipt.
    ...(entity.originalBytes != null ? { originalBytes: entity.originalBytes } : {}),
    ...(entity.sha256 ? { sha256: entity.sha256 } : {}),
    preservation: entity.preservation === "partial" ? "partial" : "complete",
    sourceCompleteness: (entity.sourceCompleteness as
      | "complete"
      | "partial"
      | "unknown") ?? "unknown",
    ...(entity.failureCode ? { incompleteReason: entity.failureCode } : {}),
  };
}

