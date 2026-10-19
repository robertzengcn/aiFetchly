/**
 * H5 — `notifications/aifetchly/plugin-partial` host-side gate (TODO §2).
 *
 * The plugin sends bounded partial snapshots during a scrape (see plugin
 * childprocess/call-result.ts). The host must NOT trust them:
 *
 *   - schema validation (Zod) — shape, enum phases, byte-bounded strings;
 *   - serialized-size cap (16 KiB) before any processing;
 *   - executionId must match the call's registry-owned execution id;
 *   - sequence must be strictly monotonic per client call;
 *   - the underlying registry job must still be live (not terminal);
 *   - repeated abuse terminates the MCP call (client disconnects the
 *     transport, which escalates to the supervised tree kill).
 *
 * Valid snapshots map onto `ToolJobRegistry.updatePartial` (bounded counts
 * only — full records are NEVER stored in the registry) and
 * `tool_progress`, including the phase.
 */
import { z } from "zod";
import { redactProgressText } from "@/modules/mcp/progressCoalescing";

export const MCP_PLUGIN_PARTIAL_METHOD =
  "notifications/aifetchly/plugin-partial";

/** Byte cap on the SERIALIZED notification params (plugin contract §21.5). */
export const PLUGIN_PARTIAL_MAX_BYTES = 16 * 1024;

/** Rejections tolerated for one call before the call is terminated. */
export const PLUGIN_PARTIAL_ABUSE_TERMINATE_AT = 5;

export const pluginPartialPhaseSchema = z.enum([
  "queued",
  "running",
  "fetching",
  "extracting",
  "finalizing",
]);

export const pluginPartialNotificationSchema = z.object({
  method: z.literal(MCP_PLUGIN_PARTIAL_METHOD),
  params: z.object({
    executionId: z.string().min(1).max(160),
    sequence: z.number().int().min(1),
    collectedCount: z.number().int().min(0),
    expectedCount: z.number().int().min(0).nullable(),
    phase: pluginPartialPhaseSchema,
    message: z.string().max(200).optional(),
  }),
});

export type PluginPartialParams = z.infer<
  typeof pluginPartialNotificationSchema
>["params"];

export type PluginPartialPhase = z.infer<typeof pluginPartialPhaseSchema>;

/**
 * Registers the plugin-partial route on an SDK client. The SDK's
 * `setNotificationHandler` combines zod v3/v4 compat unions whose generic
 * inference overflows (TS2589), so registration is duck-typed here with the
 * real schema still passed through for runtime validation by the SDK.
 */
export function registerPluginPartialHandler(
  client: unknown,
  handler: (notification: { method: string; params: unknown }) => void
): void {
  const typed = client as {
    setNotificationHandler?: (
      schema: unknown,
      cb: (notification: unknown) => void | Promise<void>
    ) => void;
  };
  typed.setNotificationHandler?.(pluginPartialNotificationSchema, (raw) => {
    handler(
      (raw as { method?: string; params?: unknown }) as {
        method: string;
        params: unknown;
      }
    );
  });
}

export interface PluginPartialMapping {
  readonly phase: PluginPartialPhase;
  readonly message: string;
  readonly progress: number | null;
  readonly partialCount: number;
  readonly expectedCount: number | null;
}

export interface PluginPartialGateOutcome {
  readonly accept: boolean;
  /** Reject reason when accept=false ("schema" | "size" | "execution-id" | "sequence" | "terminal"). */
  readonly reason?: string;
  /** True when the accumulated abuse reached the termination threshold. */
  readonly terminateCall: boolean;
  readonly partial?: {
    readonly data: { readonly phase: PluginPartialPhase; readonly message: string };
    readonly collectedCount: number;
    readonly expectedCount: number | null;
  };
  readonly mapping?: PluginPartialMapping;
}

function serializedByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    // JSON.stringify can throw on cycles; treat as oversized.
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Per-call validator. One instance is created per MCP client call; the
 * sequence anchor and abuse counter live only that long, so a fresh call
 * starts clean.
 */
export class PluginPartialGate {
  private lastSequence = 0;
  private rejections = 0;

  constructor(
    private readonly expectedExecutionId: string | undefined,
    private readonly isJobLive: () => boolean,
    private readonly terminateAt: number = PLUGIN_PARTIAL_ABUSE_TERMINATE_AT
  ) {}

  observe(raw: unknown): PluginPartialGateOutcome {
    const reject = (reason: string): PluginPartialGateOutcome => {
      this.rejections += 1;
      return { accept: false, reason, terminateCall: this.abused() };
    };

    // 1. Size cap first: never parse/allocate for an oversized payload.
    if (serializedByteLength(raw) > PLUGIN_PARTIAL_MAX_BYTES) {
      return reject("size");
    }
    // 2. Shape (Zod): enum phases, integral counts, bounded strings.
    const parsed = pluginPartialNotificationSchema
      .pick({ params: true })
      .safeParse({ params: raw });
    if (!parsed.success) return reject("schema");
    const params: PluginPartialParams = parsed.data.params;

    // 3. The snapshot must be FOR THIS execution (the id is host-owned).
    if (
      this.expectedExecutionId === undefined ||
      params.executionId !== this.expectedExecutionId
    ) {
      return reject("execution-id");
    }
    // 4. Strictly monotonic sequence.
    if (params.sequence <= this.lastSequence) {
      return reject("sequence");
    }
    // 5. Terminal (or unknown) jobs must not drive progress.
    if (!this.isJobLive()) {
      return reject("terminal");
    }

    this.lastSequence = params.sequence;
    // G02: a server-supplied message is displayed data, never an
    // instruction — secrets redacted, control chars dropped, bounded.
    const displayedMessage = redactProgressText(
      params.message ?? "",
      200
    );
    const progress =
      params.expectedCount !== null && params.expectedCount > 0
        ? Math.min(
            1,
            params.collectedCount / Math.max(1, params.expectedCount)
          )
        : null;
    // G02: `collected > expected` is normalized for display — the renderer
    // never shows more-than-total progress.
    const displayedCollected =
      params.expectedCount !== null
        ? Math.min(params.collectedCount, params.expectedCount)
        : params.collectedCount;
    return {
      accept: true,
      terminateCall: false,
      partial: {
        data: {
          phase: params.phase,
          message: displayedMessage,
        },
        collectedCount: params.collectedCount,
        expectedCount: params.expectedCount,
      },
      mapping: {
        phase: params.phase,
        message:
          displayedMessage.length > 0
            ? displayedMessage
            : `Collected ${displayedCollected} records`,
        progress,
        partialCount: displayedCollected,
        expectedCount: params.expectedCount,
      },
    };
  }

  /** True once accumulated rejections reached the termination threshold. */
  private abused(): boolean {
    return this.rejections >= this.terminateAt;
  }
}
