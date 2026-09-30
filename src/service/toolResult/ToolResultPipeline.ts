import "reflect-metadata";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { ToolResultPreparationService, type ToolOutcome } from "@/service/toolResult/ToolResultPreparationService";
import { ToolResultPublisher } from "@/service/toolResult/ToolResultPublisher";
import { getToolResultStorageRoot } from "@/service/toolResult/toolResultRoot";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import type {
  PreparedToolResult,
  ToolResultReceipt,
  TrustedToolOutputContext,
} from "@/entityTypes/toolResultTypes";

/**
 * The single entry point every execution path uses to turn a raw tool result
 * into bounded, persistable, publishable forms (technical design §9.1).
 *
 * Why a facade rather than calling the services directly: the ordering
 * constraint is subtle and easy to get wrong per-caller. Preparation must
 * complete BEFORE the renderer event, the persisted receipt must be durable
 * BEFORE model continuation, and the delivery must happen after that. Doing
 * that correctly in six adapters is six chances to get it wrong, so it lives
 * here once.
 *
 * A `null` return means the feature is disabled for this call and the caller
 * must fall back to its existing behaviour. That is what makes rollout safe:
 * with the flags off, nothing changes.
 */

/** What the caller needs after processing one result. */
export interface ProcessedToolResult {
  /** Model-facing text. A receipt when externalized, else the inline body. */
  readonly modelContent: string;
  /** Exactly what is persisted as the tool-result message content. */
  readonly canonicalContent: string;
  /** Bounded renderer payload (no bulk output). */
  readonly toolResultPayload: Record<string, unknown>;
  /** Present only when the result was externalized. */
  readonly receipt?: ToolResultReceipt;
}

/** Injectable collaborators, so tests need no real filesystem or database. */
export interface ToolResultPipelineDeps {
  readonly module?: ToolResultModule;
  readonly storage?: ToolResultStorageService;
  readonly preparation?: ToolResultPreparationService;
  readonly publisher?: ToolResultPublisher;
  /** True when new file capture is enabled. */
  readonly captureEnabled: () => boolean;
  /** True when model-visible references may be advertised. */
  readonly modelRefsEnabled: () => boolean;
  /**
   * True when this conversation already holds committed references.
   *
   * Turning capture off must NOT disable reading existing output, so
   * preparation still runs when references already exist (TD §13.4).
   */
  readonly hasExistingReferences?: () => Promise<boolean>;
}

export class ToolResultPipeline {
  private readonly deps: ToolResultPipelineDeps;
  private readonly preparation: ToolResultPreparationService;
  private publisher: ToolResultPublisher | null = null;
  private module: ToolResultModule | null = null;
  private storage: ToolResultStorageService | null = null;

  constructor(deps: ToolResultPipelineDeps) {
    this.deps = deps;
    this.preparation = deps.preparation ?? new ToolResultPreparationService();
  }

  /**
   * Whether this call would do anything at all.
   *
   * Kept cheap and synchronous: the loop consults it before doing any work so
   * the disabled path costs one function call and keeps its exact old
   * behaviour.
   */
  isActive(): boolean {
    // Flags only. Deliberately free of mutable state so the caller's decision
    // is deterministic: a conversation either opts in or it does not.
    return this.deps.captureEnabled() || this.deps.modelRefsEnabled();
  }

  private getModule(): ToolResultModule {
    this.module ??= this.deps.module ?? new ToolResultModule();
    return this.module;
  }

  private getStorage(): ToolResultStorageService {
    this.storage ??=
      this.deps.storage ??
      new ToolResultStorageService({ root: getToolResultStorageRoot() });
    return this.storage;
  }

  private getPublisher(store: ToolResultPublisherDeps["store"]): ToolResultPublisher {
    this.publisher ??=
      this.deps.publisher ??
      new ToolResultPublisher({ module: this.getModule(), store });
    return this.publisher;
  }

  /**
   * Prepare and publish one completed tool result.
   *
   * `deliver` is invoked after the receipt is durable, so a delivery failure
   * can never leave the model believing an unsaved result was saved.
   */
  async process(input: {
    readonly context: TrustedToolOutputContext;
    readonly outcome: ToolOutcome;
    readonly store: ToolResultPublisherDeps["store"];
    readonly deliver?: (receipt: ToolResultReceipt) => void | Promise<void>;
  }): Promise<PreparedToolResult> {
    if (!this.deps.captureEnabled() && !this.deps.modelRefsEnabled()) {
      // Capture AND reference delivery are both off: leave the caller's
      // legacy representation alone.
      return {
        canonicalMessageContent: JSON.stringify(input.outcome),
        modelContent: JSON.stringify(input.outcome),
        uiMetadata: {},
        serializedBytes: 0,
        accountedTokens: 0,
      };
    }

    const prepared = await this.preparation.prepare(input.outcome, {
      context: input.context,
      storage: this.getStorage(),
      module: this.getModule(),
      captureEnabled: this.deps.captureEnabled(),
      modelRefsEnabled: this.deps.modelRefsEnabled(),
    });

    if (prepared.receipt) {
      // A receipt is a durable artifact: the terminal receipt is persisted
      // before anything is shown or handed back to the model.
      const outcome = await this.getPublisher(input.store).publish(
        input.context,
        prepared.receipt,
        input.deliver
      );
      if (!outcome.ok && outcome.durableFailure) {
        // The caller must stop model continuation rather than assert a result
        // was saved when it was not.
        throw new ToolResultPublicationError(outcome.reason);
      }
    }

    return prepared;
  }
}

/** Convenience alias for the store collaborator. */
export type ToolResultPublisherDeps = {
  store: (input: {
    context: TrustedToolOutputContext;
    receipt: ToolResultReceipt;
  }) => Promise<void>;
};

/** Thrown when the terminal receipt could not be made durable. */
export class ToolResultPublicationError extends Error {
  constructor(reason: string) {
    super(`tool result publication failed: ${reason}`);
    this.name = "ToolResultPublicationError";
  }
}

/** Defaults resolved once per process. */
export const TOOL_RESULT_LIMITS = TOOL_RESULT_CONFIG;
