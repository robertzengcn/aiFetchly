// src/service/AIAutoDreamBatchRunner.ts
//
// Shared total-budgeted batched consolidation runner for the user and
// workspace auto-dream services (SMBW-007). Both services share identical
// batch-packing, per-batch completion + JSON repair, plan merging, and
// oversized-packet handling; they differ only in the profile, prompt builder,
// parser, and the memory module the plan is applied to. This module keeps one
// canonical implementation so a fix in batching applies to both workloads.
import type {
  AIChatLightweightCompletionInput,
  AIChatLightweightCompletionResult,
  AIChatLightweightProfile,
} from "@/service/AIChatLightweightTypes";
import type { AutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";
/**
 * Minimal structural shape of a parsed consolidation plan. Both the user and
 * workspace parse results satisfy this — the runner only needs to push
 * entries and read `ok`/`error`. Keeping the constraint structural (rather
 * than importing the user-specific ParseResult) lets the workspace parse
 * result, which uses workspace-scoped entry types, satisfy it too.
 */
export interface AutoDreamPlanLike {
  ok: boolean;
  create: { readonly sourceId?: string }[];
  update: unknown[];
  archive: unknown[];
  error?: string;
}
import { openAIContentToString } from "@/api/aiChatApi";
import type {
  OpenAIChatMessage,
  OpenAISmallModelCapability,
} from "@/api/aiChatApi";
import {
  computeLightweightBudget,
  CONSERVATIVE_SMALL_CONTEXT_FALLBACK,
  estimateActiveMemoryTokens,
  estimateAutoDreamPacketTokens,
  reduceAutoDreamPacket,
} from "@/service/AIChatPromptBudget";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import { attemptAutoDreamJsonRepair } from "@/service/AIAutoDreamJsonRepair";

/** Active-memory index entry shown to the model (id, type, title, content). */
export interface AutoDreamActiveMemory {
  readonly memoryId?: string;
  readonly type?: string;
  readonly title?: string;
  readonly content?: string;
}

/**
 * Injected memory-shape adapter so the runner can apply a merged plan without
 * depending on either the user- or workspace-memory module directly.
 */
export interface AutoDreamBatchMemoryAdapter<P> {
  /** The active-memory list shown to the model as a compact index. */
  listActiveMemories(): Promise<ReadonlyArray<AutoDreamActiveMemory>>;
  /** Atomically apply the merged plan + complete the run in one transaction. */
  applyPlanAndCompleteRun(input: {
    runId: string;
    plan: P;
    chatConversationsReviewed: number;
    agentTasksReviewed: number;
    model: string;
    reviewedThrough: Date;
  }): Promise<void>;
}

/**
 * Injected prompt/parse adapter so the runner is shape-agnostic.
 */
export interface AutoDreamBatchPromptAdapter<P extends AutoDreamPlanLike> {
  buildSystemPrompt(): string;
  buildUserPrompt(input: {
    activeMemories: ReadonlyArray<AutoDreamActiveMemory>;
    packets: readonly AutoDreamSourcePacket[];
  }): string;
  /** Re-parse a raw model output string into a plan result. */
  parse(
    raw: string,
    packets: readonly AutoDreamSourcePacket[],
    activeMemories: ReadonlyArray<AutoDreamActiveMemory>
  ): P;
}

/**
 * Result of a batched consolidation run. The caller marks the run failed or
 * completed based on `outcome`.
 */
export type AutoDreamBatchOutcome<P> =
  | {
      outcome: "applied";
      plan: P;
      model: string;
      chatConversationsReviewed: number;
      agentTasksReviewed: number;
    }
  | { outcome: "parse_error"; error: string }
  | { outcome: "unprocessable"; sourceId: string }
  | { outcome: "cancelled" };

/**
 * Run total-budgeted batched consolidation (SMBW-007).
 *
 * Resolves the small-model capability (or the conservative 32k fallback),
 * computes the usable payload, packs active memories + source packets into
 * bounded batches, processes each batch through the lightweight service
 * (one same-route JSON repair per batch on invalid non-empty output), merges
 * the per-batch plans, and applies the merged plan in one transactional call.
 *
 * An oversized packet is deterministically reduced (oldest tool summaries,
 * oldest message groups, longest-message clamp) before deferring overflow to
 * later batches. A packet whose identity + newest exchange still cannot fit
 * returns `outcome: "unprocessable"` so the caller fails the run locally
 * without advancing the cursor.
 */
export async function runBatchedAutoDreamConsolidation<
  P extends AutoDreamPlanLike
>(input: {
  runId: string;
  packets: readonly AutoDreamSourcePacket[];
  reviewedThrough: Date;
  isManual: boolean;
  /** Caller cancellation signal, checked before each batch/repair/apply
   * (SMBW-011). Aborts surface as a terminal cancelled outcome. */
  signal?: AbortSignal;
  completeLightweight: (
    input: AIChatLightweightCompletionInput
  ) => Promise<AIChatLightweightCompletionResult>;
  getSmallModelCapability?(): Promise<OpenAISmallModelCapability | null>;
  profile: AIChatLightweightProfile;
  memory: AutoDreamBatchMemoryAdapter<P>;
  prompt: AutoDreamBatchPromptAdapter<P>;
  estimator?: AIChatTokenEstimator;
}): Promise<AutoDreamBatchOutcome<P>> {
  const estimator = input.estimator ?? new AIChatTokenEstimator();
  const activeMemories = await input.memory.listActiveMemories();

  const capability = await resolveCapabilitySafely(
    input.getSmallModelCapability
  );
  const fixedPromptTokens = estimator.estimateText(
    input.prompt.buildSystemPrompt()
  );
  const budget = computeLightweightBudget({
    contextWindow:
      capability?.context_size ?? CONSERVATIVE_SMALL_CONTEXT_FALLBACK,
    maxOutputTokens: input.profile.maxOutputTokens,
    discoveredMaxOutputTokens: capability?.max_tokens,
    fixedPromptTokens,
  });

  const batches = packAutoDreamBatches(
    activeMemories,
    input.packets,
    budget.usablePayloadTokens,
    estimator
  );

  if (batches.unprocessable) {
    return { outcome: "unprocessable", sourceId: batches.unprocessable };
  }

  const mergedPlan: P = {
    ok: true,
    create: [],
    update: [],
    archive: [],
  } as unknown as P;
  let resolvedModel = "auto-dream";
  let reviewedPacketCount = 0;
  let chatCount = 0;
  let agentTaskCount = 0;

  for (const batch of batches.batches) {
    // SMBW-011: check cancellation before each batch/repair/apply so a
    // cancelled run stops without further model or DB calls.
    if (input.signal?.aborted) {
      return { outcome: "cancelled" };
    }
    for (const p of batch.packets) {
      reviewedPacketCount += 1;
      if (p.sourceKind === "chat_v2") chatCount += 1;
      else if (p.sourceKind === "agent_task") agentTaskCount += 1;
    }
    const messages: OpenAIChatMessage[] = [
      { role: "system", content: input.prompt.buildSystemPrompt() },
      {
        role: "user",
        content: input.prompt.buildUserPrompt({
          activeMemories,
          packets: batch.packets,
        }),
      },
    ];
    // SMBW-009: suppress the same-route retry on the first completion so the
    // logical run (first completion + one repair) never exceeds two model
    // requests — the router does not retry the first request and then allow a
    // third repair. The repair (if any) is a separate completion marked
    // repairAttempted so the event records it.
    const result = await input.completeLightweight({
      workload: input.profile.workload,
      messages,
      manual: input.isManual,
      allowSameRouteRetry: false,
    });
    const resp = result.response;
    if (resp.model) resolvedModel = resp.model;
    const raw = openAIContentToString(resp.choices?.[0]?.message?.content);
    let parsed = input.prompt.parse(raw, batch.packets, activeMemories);

    if (!parsed.ok && raw.trim().length > 0) {
      // SMBW-011: check cancellation before the repair request.
      if (input.signal?.aborted) {
        return { outcome: "cancelled" };
      }
      parsed = await attemptAutoDreamJsonRepair({
        workload: input.profile.workload,
        invalidRaw: raw,
        parsed,
        manual: input.isManual,
        completeLightweight: (lwInput) =>
          input.completeLightweight({
            ...lwInput,
            repairAttempted: true,
          }),
        parse: (r) => input.prompt.parse(r, batch.packets, activeMemories),
      });
    }

    if (!parsed.ok) {
      return { outcome: "parse_error", error: parsed.error ?? "unknown" };
    }
    mergedPlan.create.push(...parsed.create);
    mergedPlan.update.push(...parsed.update);
    mergedPlan.archive.push(...parsed.archive);
  }

  // SMBW-011: check cancellation before the transactional apply.
  if (input.signal?.aborted) {
    return { outcome: "cancelled" };
  }
  await input.memory.applyPlanAndCompleteRun({
    runId: input.runId,
    plan: mergedPlan,
    chatConversationsReviewed: chatCount,
    agentTasksReviewed: agentTaskCount,
    model: resolvedModel,
    reviewedThrough: input.reviewedThrough,
  });

  return {
    outcome: "applied",
    plan: mergedPlan,
    model: resolvedModel,
    chatConversationsReviewed: chatCount,
    agentTasksReviewed: agentTaskCount,
  };
}

async function resolveCapabilitySafely(
  resolver?: () => Promise<OpenAISmallModelCapability | null>
): Promise<OpenAISmallModelCapability | null> {
  if (!resolver) return null;
  try {
    return await resolver();
  } catch {
    return null;
  }
}

/**
 * Pack active memories + source packets into total-budgeted batches
 * (SMBW-007). The active-memory index is shared across every batch (its
 * tokens are reserved once per batch so the model can validate update/archive
 * IDs and detect duplicates/contradictions). Packets are added greedily
 * while they fit; an oversized packet is deterministically reduced before
 * overflow packets are deferred to later batches. A packet whose identity +
 * newest exchange still cannot fit is reported as `unprocessable`.
 */
export function packAutoDreamBatches(
  activeMemories: ReadonlyArray<{
    memoryId?: string;
    type?: string;
    title?: string;
    content?: string;
  }>,
  packets: readonly AutoDreamSourcePacket[],
  usablePayloadTokens: number,
  estimator: AIChatTokenEstimator = new AIChatTokenEstimator()
): {
  batches: ReadonlyArray<{ packets: AutoDreamSourcePacket[] }>;
  unprocessable?: string;
} {
  if (packets.length === 0) {
    return { batches: [] };
  }
  const memoryTokens = activeMemories.reduce(
    (sum, m) => sum + estimateActiveMemoryTokens(m, estimator),
    0
  );
  const capacity = usablePayloadTokens > 0 ? usablePayloadTokens : 1;
  const scaffolding =
    memoryTokens + estimator.estimateText("\n\nReturn JSON only.");
  const perBatchCapacity = Math.max(0, capacity - scaffolding);
  if (perBatchCapacity <= 0) {
    return { batches: [], unprocessable: "active_memory_index_too_large" };
  }

  const batches: { packets: AutoDreamSourcePacket[] }[] = [];
  let current: AutoDreamSourcePacket[] = [];
  let currentTokens = 0;
  const flush = (): void => {
    if (current.length > 0) {
      batches.push({ packets: current });
      current = [];
      currentTokens = 0;
    }
  };
  for (const p of packets) {
    const tokens = estimateAutoDreamPacketTokens(p, estimator);
    if (tokens > perBatchCapacity) {
      const reduced = reduceAutoDreamPacket(p, perBatchCapacity, estimator);
      if (!reduced.minimumUsefulFits) {
        return { batches: [], unprocessable: p.sourceId };
      }
      flush();
      current.push(reduced.packet as AutoDreamSourcePacket);
      currentTokens = estimateAutoDreamPacketTokens(reduced.packet, estimator);
      flush();
      continue;
    }
    if (current.length > 0 && currentTokens + tokens > perBatchCapacity) {
      flush();
    }
    current.push(p);
    currentTokens += tokens;
  }
  flush();
  return { batches };
}
