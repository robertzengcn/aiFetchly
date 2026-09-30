import "reflect-metadata";
import * as os from "node:os";
import * as path from "node:path";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import {
  ToolResultRetrievalService,
  legacySourceReader,
  type RetrievalTarget,
} from "@/service/toolResult/ToolResultRetrievalService";
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

/** App-managed root for preserved outputs. */
function resolveStorageRoot(): string {
  return path.join(os.homedir(), ".aifetchly", "tool-outputs");
}

/** Cached per-conversation wiring; modules open a database connection. */
const contextCache = new Map<string, ToolResultToolContext>();

/** Resolve (and cache) the trusted context for one conversation. */
export function getToolResultContext(
  context: SkillExecutionContext
): ToolResultToolContext | null {
  const conversationId = context.conversationId;
  if (!conversationId) return null;

  const cached = contextCache.get(conversationId);
  if (cached) return cached;

  const module = new ToolResultModule();
  const storage = new ToolResultStorageService({ root: resolveStorageRoot() });
  // Both backends share one paging/budget contract (technical design §10.2);
  // only the byte source differs.
  const retrieval = new ToolResultRetrievalService(
    storage,
    legacySourceReader({
      readSlice: (args) => module.readLegacySourceSlice(args),
    })
  );

  // The turn id is trusted (it comes from the engine), and it is what scopes
  // the per-turn retrieval allowance.
  const turnId = context.sourceUserMessageId ?? `${conversationId}:${Date.now()}`;

  const resolved: ToolResultToolContext = {
    module,
    retrieval,
    async resolveTarget(outputId: string) {
      const decision = await module.authorizeAccess({
        outputId,
        profileId: DEFAULT_PROFILE_ID,
        conversationId,
      });
      if (!decision.ok) return { ok: false, code: decision.code };
      const row = decision.output;
      const backend = row.storageBackend === "legacy_message" ? "legacy_message" : "file";
      if (backend === "legacy_message") {
        if (!row.sourceRowKey) return { ok: false, code: "OUTPUT_NOT_AVAILABLE" };
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
        agentId: "",
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
        agentId: "",
        turnId,
        tokens,
      });
    },
  };

  contextCache.set(conversationId, resolved);
  return resolved;
}

/** Drop cached wiring (used by tests and on conversation clear). */
export function clearToolResultContextCache(): void {
  contextCache.clear();
}
