// src/service/AIChatModelFallbackService.ts
//
// Layer 6 (model fallback) resolution for the seven-layer recovery
// strategy. Returns a model id different from the current one when the
// current model is overloaded or unavailable.
import type { AIChatModelCatalogEntry } from "@/service/AIChatModelCatalogService";
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";
import type { AIChatRecoveryReason } from "@/service/AIChatRecoveryTypes";

/**
 * Optional local fallback map. Keys are model ids; values are arrays
 * of preferred fallback ids in priority order. Empty by default.
 */
export type ModelFallbackMap = Readonly<Record<string, readonly string[]>>;

export interface ResolveFallbackInput {
  readonly originalModel?: string;
  readonly currentModel?: string;
  readonly reason: AIChatRecoveryReason;
  readonly fallbackMap?: ModelFallbackMap;
}

export interface ResolveFallbackResult {
  readonly model: string | undefined;
  readonly source: "fallback_map" | "server_default" | "first_different" | "none";
}

/**
 * Resolves a fallback model for Layer 6 recovery. Selection order:
 *   1. fallbackMap (first entry different from currentModel)
 *   2. server-reported default model (when different from currentModel)
 *   3. first catalog model whose id differs from currentModel
 * Never returns the same model as currentModel. Returns undefined when
 * no alternative is available.
 */
export class AIChatModelFallbackService {
  private readonly catalog: AIChatModelCatalogService;

  constructor(catalog?: AIChatModelCatalogService) {
    this.catalog = catalog ?? new AIChatModelCatalogService();
  }

  async resolve(
    input: ResolveFallbackInput
  ): Promise<ResolveFallbackResult> {
    const current = input.currentModel ?? input.originalModel;

    // 1. Local fallback map.
    if (input.fallbackMap && current) {
      const list = input.fallbackMap[current] ?? [];
      for (const candidate of list) {
        if (candidate && candidate !== current) {
          return { model: candidate, source: "fallback_map" };
        }
      }
    }

    // Ensure catalog is loaded for the next two strategies.
    await this.catalog.ensureLoaded();
    const entries: readonly AIChatModelCatalogEntry[] = this.catalog.entries();

    // 2. Server-reported default.
    const defaultId = this.catalog.getDefaultModelId();
    if (defaultId && defaultId !== current) {
      return { model: defaultId, source: "server_default" };
    }

    // 3. First different model in the catalog.
    for (const entry of entries) {
      if (entry.id !== current) {
        return { model: entry.id, source: "first_different" };
      }
    }

    return { model: undefined, source: "none" };
  }
}
