import { AIChatEventRouter } from "@/service/AIChatEventRouter";
import type {
  ConversationSummaryEvent,
} from "@/entityTypes/aiChatWorkspaceTypes";
import {
  AIChatTitleService,
  type ResolvedTitleProvider,
} from "@/service/AIChatTitleService";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIProviderResolver } from "@/service/aiProvider/AIProviderResolver";
import { OpenAICompatibleProviderClient } from "@/service/aiProvider/OpenAICompatibleProviderClient";
import { AiChatApi } from "@/api/aiChatApi";
import { getSharedExecutionScheduler } from "@/service/aiChatSharedScheduler";
import { currentProviderConfigVersion } from "@/service/aiProvider/AIProviderConfigVersion";

/**
 * Process-wide workspace event-routing singletons (design §7.5).
 *
 * Lives at the service layer so owner adapters (scheduled runner, future
 * goal/agent executors) can broadcast redacted summaries without importing
 * the IPC registration layer.
 */
export const sharedWorkspaceEventRouter = new AIChatEventRouter();

/** Broadcaster handoff for {@link AIChatRunOwnerAdapter} dependency injection. */
export const sharedSummaryBroadcaster = {
  broadcastSummary(event: ConversationSummaryEvent): void {
    sharedWorkspaceEventRouter.broadcastSummary(event);
  },
};

/**
 * Stage A §3.4 (generator-streaming PRD FR-004): lazy execution-owner seam for
 * queue-drained turns. The workspace IPC layer registers the coordinator's
 * dispatchQueuedTurn here once constructed; the queue service (wired in
 * ai-chat-v2-ipc.ts, which cannot import the workspace IPC module without a
 * static cycle) reads it at drain time. Missing registration fails the turn
 * honestly — it never silently bypasses the owner.
 */
export interface QueueTurnDispatcherHolder {
  dispatchQueuedTurn(input: {
    readonly conversationId: string;
    readonly pendingMessageId: string;
    readonly request: import("@/entityTypes/aiChatV2Types").ChatV2StreamRequest;
    readonly savedUser: {
      readonly messageId: string;
      readonly conversationId: string;
    };
    readonly modelContent: string;
    readonly contentParts?: unknown;
    readonly assistantMessageId: string;
  }): Promise<import("@/service/AIChatQueryEvents").AIChatSegmentOutcome>;
}

let queueTurnDispatcher: QueueTurnDispatcherHolder | null = null;

export function setQueueTurnDispatcher(dispatcher: QueueTurnDispatcherHolder): void {
  queueTurnDispatcher = dispatcher;
}

export function getQueueTurnDispatcher(): QueueTurnDispatcherHolder | null {
  return queueTurnDispatcher;
}

/**
 * Stage A §3.5 (FR-024): lazy run-owner accessor for resume routing. The
 * workspace IPC layer registers its coordinator here; ai-chat-v2-ipc.ts
 * reads it in the permission-resume / plan-answer handlers without a static
 * import cycle. Unregistered accessors fall back to the engine-internal
 * (legacy) resume path.
 */
export interface RunOwnerResumeRouter {
  ownsConversation(conversationId: string): boolean;
  /** Review F1 (FR-008/009): owner-routed Stop/deny for parked runs. */
  cancelOwnedRun(conversationId: string): Promise<boolean>;
  resumeRun(input: {
    readonly conversationId: string;
    readonly runId?: string;
    readonly action:
      | { readonly kind: "permission"; readonly toolId: string }
      | {
          readonly kind: "answer";
          readonly questionId: string;
          readonly answers: import("@/entityTypes/aiChatPlanTypes").AskUserQuestionAnswer[];
        };
  }): Promise<{ ok: boolean; claimed?: boolean; error?: string }>;
}

let runOwnerResumeRouter: RunOwnerResumeRouter | null = null;

export function setRunOwnerResumeRouter(router: RunOwnerResumeRouter): void {
  runOwnerResumeRouter = router;
}

export function getRunOwnerResumeRouter(): RunOwnerResumeRouter | null {
  return runOwnerResumeRouter;
}

/**
 * TODO-08 (FR-018, design §16): the STARTUP-owned production delivery-mode
 * provider. One instance per process, read once at first use — a later
 * environment change never affects already-constructed engines within this
 * process (a change requires restart, where reconciliation applies).
 */
import { EnvAIChatStreamImplementationConfig } from "./aiChat/AIChatStreamImplementationConfig";

let startupStreamConfig: EnvAIChatStreamImplementationConfig | null = null;

export function getStartupStreamImplementationConfig(): EnvAIChatStreamImplementationConfig {
  if (!startupStreamConfig) {
    // Static import would be fine here (pure module, no Node APIs), but the
    // lazy construction keeps the single-read at first engine construction.
    const config = (
      globalThis as {
        __aifetchlyStartupStreamConfig?: EnvAIChatStreamImplementationConfig;
      }
    ).__aifetchlyStartupStreamConfig;
    startupStreamConfig = config ?? new EnvAIChatStreamImplementationConfig();
  }
  return startupStreamConfig;
}

/**
 * Chat-titles design §6: the shared title-generation service. One instance
 * per process; the completion owner wiring (workspace IPC + queue service)
 * funnels completion notifications here without importing IPC modules.
 */
let sharedTitleService: AIChatTitleService | null = null;

export function getSharedAIChatTitleService(): AIChatTitleService {
  if (!sharedTitleService) {
    sharedTitleService = new AIChatTitleService({
      createModule: () => new AIChatConversationModule(),
      resolveTitleProvider: (): ResolvedTitleProvider | null => {
        // Design §8.4: hosted naming requires entitlement; custom-provider
        // naming follows resolveForChat and never invokes hosted fallback.
        const resolution = new AIProviderResolver().resolveForChat();
        if (!resolution.canUse) return null;
        if (resolution.kind === "local") {
          return {
            kind: "local",
            config: resolution.config,
            apiKey: resolution.apiKey,
          };
        }
        return { kind: "hosted" };
      },
      completeTitle: (provider, request, signal) => {
        if (provider.kind === "local") {
          // Pinned snapshot: this client can never re-read the current
          // global provider (titles design §8.3).
          return new OpenAICompatibleProviderClient(
            provider.config,
            provider.apiKey
          ).complete(request, { signal });
        }
        return new AiChatApi().openAIChatCompletion(request, { signal });
      },
      broadcastTitle: (event) => {
        sharedWorkspaceEventRouter.broadcastTitleUpdate(event);
      },
      providerConfigVersion: () => currentProviderConfigVersion(),
      isForegroundBusy: () => {
        // Queued foreground work means naming must yield. (A single
        // already-dispatched run is not visible here; the 10 s deadline
        // bounds that overlap.)
        return getSharedExecutionScheduler().queueDepth() > 0;
      },
      requestIdFactory: () => crypto.randomUUID(),
    });
  }
  return sharedTitleService;
}

/** Test/DB-switch hook: drop the singleton (mirrors other runtime resets). */
export function resetSharedAIChatTitleService(): void {
  sharedTitleService?.resetForTesting();
  sharedTitleService = null;
}
