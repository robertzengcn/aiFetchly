import "reflect-metadata";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import {
  createToolResultRetrievalService,
  ToolResultRetrievalService,
  type RetrievalTarget,
} from "@/service/toolResult/ToolResultRetrievalService";
import { getToolResultStorageRoot } from "@/service/toolResult/toolResultRoot";
import type { ToolResultErrorCode } from "@/entityTypes/toolResultTypes";

/**
 * Trusted runtime wiring for the retrieval tools.
 *
 * The tools receive a `SkillExecutionContext`, which carries the conversation
 * but NOT an epoch, a profile, or an output registry. Resolving those here -
 * in the main process, from stored state - is what makes "IDs are not
 * authorization" enforceable: a caller can name an id, but it cannot choose
 * which scope that id is read against.
 *
 * The profile id falls back to a per-user default because the current product
 * has a single local profile; the indirection exists so multi-profile support
 * does not have to change the tool contract.
 */

/** Everything a retrieval tool is allowed to act on. */
export interface ToolResultToolContext {
  readonly module: ToolResultModule;
  readonly retrieval: ToolResultRetrievalService;
  /**
   * Authorize `output_id` for this caller and return a retrieval target.
   * Missing and unauthorized are reported with the SAME code so existence is
   * never leaked.
   */
  resolveTarget(
    outputId: string
  ): Promise<
    | { ok: true; target: RetrievalTarget }
    | { ok: false; code: ToolResultErrorCode }
  >;
  /** Charge one retrieval call against the durable per-turn allowance. */
  reserveWork(): Promise<{ ok: true } | { ok: false; code: ToolResultErrorCode }>;
  /** Settle the tokens actually returned by a completed retrieval call. */
  settleWork(tokens: number): Promise<void>;
}

/** Profile key for the single local profile. */
const DEFAULT_PROFILE_ID = "default";

/**
 * Long-lived, turn-INDEPENDENT wiring.
 *
 * Only the collaborators are cached. The per-turn identity (turn id, agent id)
 * is deliberately resolved on every call, because caching it would scope the
 * per-turn retrieval allowance to whichever turn happened to arrive first -
 * which is how one turn's allowance ended up shared across a whole
 * conversation.
 */
interface CachedWiring {
  readonly module: ToolResultModule;
  readonly storage: ToolResultStorageService;
  readonly retrieval: ToolResultRetrievalService;
}

const wiringCache = new Map<string, CachedWiring>();

/**
 * Resolve the trusted turn scope for this call.
 *
 * The turn id comes from the engine via `sourceUserMessageId`. When it is
 * absent the fallback must still be STABLE for the lifetime of the call, not
 * `Date.now()`, otherwise a reserve and its settle can land on different rows
 * and the reservation is never released.
 */
function resolveTurnScope(context: SkillExecutionContext): {
  turnId: string;
  agentId: string;
} {
  const agentId = context.skillName ?? "";
  const turnId =
    context.sourceUserMessageId ??
    context.toolCallId ??
    `${context.conversationId}:${Date.now()}`;
  return { turnId, agentId };
}

function getWiring(conversationId: string): CachedWiring {
  const cached = wiringCache.get(conversationId);
  if (cached) return cached;

  const module = new ToolResultModule();
  const storage = new ToolResultStorageService({
    root: getToolResultStorageRoot(),
  });
  // Both backends are wired here so a file artifact and a historical source row
  // are both readable through the same paging/budget contract, and so no caller
  // can accidentally commit every target to a single backend.
  const retrieval = createToolResultRetrievalService({ storage, module });

  const wiring: CachedWiring = { module, storage, retrieval };
  wiringCache.set(conversationId, wiring);
  return wiring;
}

/** Resolve the trusted context for one retrieval call. */
export function getToolResultContext(
  context: SkillExecutionContext
): ToolResultToolContext | null {
  const conversationId = context.conversationId;
  if (!conversationId) return null;

  const { module, retrieval } = getWiring(conversationId);
  const { turnId, agentId } = resolveTurnScope(context);

  return {
    module,
    retrieval,
    async resolveTarget(outputId: string) {
      const decision = await module.authorizeAccess({
        outputId,
        profileId: DEFAULT_PROFILE_ID,
        conversationId,
        agentId: agentId || undefined,
      });
      if (!decision.ok) return { ok: false, code: decision.code };
      const row = decision.output;
      const backend =
        row.storageBackend === "legacy_message" ? "legacy_message" : "file";
      if (backend === "legacy_message") {
        if (!row.sourceRowKey) {
          return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
        }
      } else if (!row.storageKey) {
        return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
      }
      return {
        ok: true,
        target: {
          outputId: row.outputId,
          revision: row.revision,
          backend,
          sourceRowKey: row.sourceRowKey ?? undefined,
          storageKey: row.storageKey ?? "",
          format: (row.outputFormat as RetrievalTarget["format"]) ?? "text",
          capturedBytes: row.capturedBytes,
          sourceCompleteness:
            (row.sourceCompleteness as RetrievalTarget["sourceCompleteness"]) ??
            "unknown",
        },
      };
    },
    async reserveWork() {
      const scope = await module.ensureScope(DEFAULT_PROFILE_ID, conversationId);
      const reserved = await module.reserveRetrievalCall({
        profileId: DEFAULT_PROFILE_ID,
        conversationId,
        outputEpoch: scope.outputEpoch,
        agentId,
        turnId,
      });
      if (!reserved.ok) return { ok: false, code: "RETRIEVAL_BUDGET_EXHAUSTED" };
      return { ok: true };
    },
    async settleWork(tokens: number) {
      const scope = await module.ensureScope(DEFAULT_PROFILE_ID, conversationId);
      await module.settleRetrievalCall({
        profileId: DEFAULT_PROFILE_ID,
        conversationId,
        outputEpoch: scope.outputEpoch,
        agentId,
        turnId,
        tokens,
      });
    },
  };
}

/** Drop cached wiring (used by tests and on conversation clear). */
export function clearToolResultContextCache(): void {
  wiringCache.clear();
}
