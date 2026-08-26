// src/service/AIChatLightweightCompletionFactory.ts
//
// Process-wide singleton for the lightweight completion service. Shared
// across user auto-dream, workspace auto-dream, and compact services so one
// workload's route-level failure can open a cooldown that suppresses the
// others. Reset hooks clear cooldowns on provider/database switch (so one
// account/provider cannot suppress another) and on provider-setting updates.
import { AIProviderResolver } from "@/service/aiProvider/AIProviderResolver";
import { AIChatLightweightCompletionService } from "@/service/AIChatLightweightCompletionService";
import type { AIChatLightweightCompletionDeps } from "@/service/AIChatLightweightCompletionService";
import type { AIChatLightweightProviderKind } from "@/service/AIChatLightweightTypes";

let shared: AIChatLightweightCompletionService | null = null;

/**
 * Map a local provider's display name to the observability kind enum. Falls
 * back to `custom` for unrecognized names.
 */
function mapLocalProviderName(name: string): AIChatLightweightProviderKind {
  const lower = name.toLowerCase();
  if (lower.includes("ollama")) return "ollama";
  if (lower.includes("lm")) return "lm_studio";
  if (lower.includes("openrouter")) return "openrouter";
  if (lower.includes("vllm")) return "vllm";
  if (lower.includes("localai")) return "localai";
  if (lower.includes("openai")) return "openai";
  return "custom";
}

/**
 * Production dependency wiring: routes hosted completion through AiChatApi's
 * hosted path and local completion through the OpenAI-compatible client. The
 * resolver and AI-enabled gate come from the real services.
 *
 * The AiChatApi is resolved lazily inside the completion closures via dynamic
 * import so this factory module does not pull AiChatApi's renderer-incompatible
 * transitive imports at load time (this factory is main-process only).
 */
function buildProductionDeps(): AIChatLightweightCompletionDeps {
  const resolver = new AIProviderResolver();
  let apiPromise: Promise<import("@/api/aiChatApi").AiChatApi> | null = null;
  const getApi = (): Promise<import("@/api/aiChatApi").AiChatApi> => {
    if (!apiPromise) {
      apiPromise = import("@/api/aiChatApi").then(
        ({ AiChatApi }) => new AiChatApi()
      );
    }
    return apiPromise;
  };
  return {
    resolveProvider: async () => {
      const resolved = resolver.resolveForChat();
      if (!resolved.canUse) {
        // A hosted-subscription denial maps to the hosted kind so the router
        // classifies the resulting auth failure; a local-provider denial has
        // no usable provider, but the router will surface a clear error when
        // it tries the normal route.
        return { kind: "hosted", providerKind: "hosted" as const };
      }
      if (resolved.kind === "local") {
        const providerName = resolved.config.name ?? "custom";
        return {
          kind: "local" as const,
          providerKind: mapLocalProviderName(providerName),
        };
      }
      return { kind: "hosted" as const, providerKind: "hosted" as const };
    },
    completeHosted: async (request, signal) => {
      const api = await getApi();
      return api.openAIChatCompletion(request, signal);
    },
    completeLocal: async (request, signal) => {
      const api = await getApi();
      return api.openAIChatCompletion(request, signal);
    },
  };
}

/**
 * Get the shared lightweight completion service. Constructs it lazily with
 * production dependencies on first call.
 */
export function getSharedLightweightCompletionService(): AIChatLightweightCompletionService {
  if (!shared) {
    shared = new AIChatLightweightCompletionService(buildProductionDeps());
  }
  return shared;
}

/**
 * Construct a service with injected deps. For tests that need to drive
 * hosted vs local and control completion outcomes without the real resolver.
 */
export function createLightweightCompletionService(
  deps: AIChatLightweightCompletionDeps
): AIChatLightweightCompletionService {
  return new AIChatLightweightCompletionService(deps);
}

/**
 * Reset shared runtime state. Called from
 * `resetAiChatV2RuntimeForDatabaseSwitch()` and provider-setting updates so
 * one account/provider cannot suppress another. A process restart also
 * clears process-local cooldown state.
 */
export function resetLightweightRuntime(): void {
  if (shared) {
    shared.resetCooldowns();
  }
  shared = null;
}
