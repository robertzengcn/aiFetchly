import "reflect-metadata";
import type {
  ToolResultReceipt,
  TrustedToolOutputContext,
} from "@/entityTypes/toolResultTypes";
import { toolResultReceiptSchema } from "@/schemas/toolResult";
import type { ToolResultModule } from "@/modules/ToolResultModule";

/**
 * Idempotent terminal receipt publication (technical design §9.1, §9.3).
 *
 * The ordering here is the whole point:
 *
 *   commit artifact -> persist the bounded receipt -> THEN deliver to the UI
 *
 * A queued save Promise is not publication. The previous behaviour saved tool
 * results asynchronously and only logged a failure, which meant a turn could
 * continue and render as if history were saved when it was not. Here the
 * caller AWAITS durable publication, and a publication failure stops model
 * continuation instead of asserting a saved result.
 *
 * Delivery and persistence are separate concerns on purpose: a renderer
 * delivery failure retries DELIVERY from the saved receipt and never re-executes
 * the tool, because the tool already ran and its side effects already happened.
 */

/** Where a published result is delivered for display. */
export type ReceiptDelivery = (receipt: ToolResultReceipt) => void | Promise<void>;

/** Outcome of publishing one terminal result. */
export type PublishOutcome =
  | {
      readonly ok: true;
      readonly receipt: ToolResultReceipt;
      /** True when this call created the durable record. */
      readonly created: boolean;
    }
  | {
      readonly ok: false;
      readonly code: "OUTPUT_PUBLICATION_FAILED";
      /** True when durable publication failed (caller must not continue). */
      readonly durableFailure: boolean;
      readonly reason: string;
    };

/** Persists the canonical receipt for a tool result. */
export type ReceiptStore = (input: {
  context: TrustedToolOutputContext;
  receipt: ToolResultReceipt;
}) => Promise<void>;

export interface PublisherDependencies {
  readonly module: ToolResultModule;
  readonly store: ReceiptStore;
  readonly deliver?: ReceiptDelivery;
}

export class ToolResultPublisher {
  private readonly deps: PublisherDependencies;
  /** In-process guard against re-publishing the same execution in one turn. */
  private readonly published = new Set<string>();

  constructor(deps: PublisherDependencies) {
    this.deps = deps;
  }

  /**
   * Publish one terminal tool result.
   *
   * Idempotent by `(executionId, toolCallId)`: a duplicated tool_result event
   * re-delivers the same receipt rather than persisting or emitting twice
   * (AC-25). The guard is a fast path only; durable idempotency comes from the
   * receipt store's own keying.
   */
  async publish(
    context: TrustedToolOutputContext,
    receipt: ToolResultReceipt
  ): Promise<PublishOutcome> {
    // Validate before anything is persisted or emitted: an unvalidated receipt
    // must never reach the model or the renderer.
    const validated = toolResultReceiptSchema.safeParse(receipt);
    if (!validated.success) {
      return {
        ok: false,
        code: "OUTPUT_PUBLICATION_FAILED",
        durableFailure: true,
        reason: "receipt failed schema validation",
      };
    }
    const bounded = validated.data as ToolResultReceipt;

    const key = `${context.executionId}:${context.toolCallId}`;
    const alreadyPublished = this.published.has(key);

    if (!alreadyPublished) {
      try {
        await this.deps.store({ context, receipt: bounded });
        this.published.add(key);
      } catch (error: unknown) {
        // Durable publication failed. The caller must stop model continuation
        // rather than claim the result was saved.
        return {
          ok: false,
          code: "OUTPUT_PUBLICATION_FAILED",
          durableFailure: true,
          reason:
            error instanceof Error ? error.message : "receipt persistence failed",
        };
      }
    }

    // Mark the registry's outbox field so startup reconciliation does not
    // re-publish a receipt that is already durable.
    for (const output of bounded.outputs) {
      await this.deps.module.markReceiptPublished(output.outputId).catch(() => undefined);
    }

    if (this.deps.deliver) {
      try {
        await this.deps.deliver(bounded);
      } catch (error: unknown) {
        // Delivery is separate from durability: the receipt is already saved,
        // so this is a UI problem, not a reason to re-run the tool.
        console.warn(
          `[tool-result] receipt delivery failed (saved): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return { ok: true, receipt: bounded, created: !alreadyPublished };
  }

  /** Forget a turn's in-process guard (called when a turn ends). */
  resetTurn(turnId?: string): void {
    if (!turnId) {
      this.published.clear();
      return;
    }
    for (const key of [...this.published]) {
      if (key.includes(turnId)) this.published.delete(key);
    }
  }
}
