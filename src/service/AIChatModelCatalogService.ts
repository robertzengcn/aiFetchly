// src/service/AIChatModelCatalogService.ts
//
// Caches the AI server's /api/ai/v1/models response in-process so
// recovery layers can look up a model's context window without paying
// the round-trip on every turn. The cache is invalidated when a fetch
// fails or when refresh() is explicitly called.
import type { OpenAIModelsResponse } from "@/api/aiChatApi";
import { AiChatApi } from "@/api/aiChatApi";
import { AI_CHAT_RECOVERY_DEFAULTS } from "@/service/AIChatRetryPolicy";
import type { ResolvedModelLimits } from "@/service/AIChatRequestBudgetService";

export interface AIChatModelCatalogEntry {
  readonly id: string;
  readonly contextWindow: number;
  /**
   * R04: per-capability provenance for the context window. `"provider"`
   * only when the models endpoint actually reported a positive window;
   * `"fallback"` when the catalog substituted its default. Consumers must
   * never present a fallback-substituted window as provider-confirmed.
   */
  readonly contextWindowSource: "provider" | "fallback";
  readonly maxOutputTokens?: number;
  readonly isDefault?: boolean;
}

/**
 * Process-lifetime catalog of AI server models. Falls back to a
 * default context window (256k) when the server doesn't report one
 * or when the lookup fails. Never throws.
 */
export class AIChatModelCatalogService {
  private cache: ReadonlyMap<string, AIChatModelCatalogEntry> | null = null;
  private defaultModelId: string | null = null;
  /**
   * R04: provider/config identity the cache was fetched under. A mismatch
   * forces a refetch so a previous provider can never supply the current
   * caps. Null when no keyed load has happened yet.
   */
  private loadedConfigKey: string | null = null;
  /**
   * N05: invalidation epoch fencing outstanding fetches. `invalidate()` (or
   * any settings change) bumps the epoch; a fetch that completes under an
   * older epoch DISCARDS its response instead of reinstalling the previous
   * provider's capabilities/default model. The waiter that joined the stale
   * work then refetches under the current key (see `refresh`).
   */
  private fetchEpoch = 0;
  private fetchedAt = 0;
  private fetching: Promise<void> | null = null;
  private readonly api: AiChatApi;
  private readonly fallbackContextWindow: number;

  constructor(
    api?: AiChatApi,
    fallbackContextWindow: number = AI_CHAT_RECOVERY_DEFAULTS.defaultContextWindowTokens
  ) {
    this.api = api ?? new AiChatApi();
    this.fallbackContextWindow = fallbackContextWindow;
  }

  /**
   * Fetch the catalog and cache it. Safe to call repeatedly. Returns
   * void; callers should getContextWindow() afterwards.
   */
  async refresh(configKey?: string): Promise<void> {
    if (this.fetching) {
      await this.fetching;
      // A keyed caller that arrived mid-fetch still needs ITS key's data:
      // if the in-flight fetch was for a different key, fetch again.
      if (
        configKey !== undefined &&
        configKey !== this.loadedConfigKey
      ) {
        await this.refresh(configKey);
      }
      return;
    }
    this.fetching = this.doRefresh(configKey);
    try {
      await this.fetching;
    } finally {
      this.fetching = null;
    }
  }

  private async doRefresh(configKey?: string): Promise<void> {
    const myEpoch = this.fetchEpoch;
    try {
      const resp: OpenAIModelsResponse = await this.api.listOpenAIModels();
      const map = new Map<string, AIChatModelCatalogEntry>();
      const defaultId = resp.default_model ?? null;
      for (const m of resp.data) {
        const id = m.id;
        if (!id) continue;
        // R04: only a positive finite reported window counts as
        // provider-confirmed. Missing, zero, negative, NaN, or non-numeric
        // capability values are malformed → fallback substitution whose
        // provenance stays "fallback" (never "provider").
        const rawCtx =
          m.context_window ?? m.context_length ?? m.context_size;
        const ctx =
          typeof rawCtx === "number" &&
          Number.isFinite(rawCtx) &&
          rawCtx > 0
            ? Math.floor(rawCtx)
            : 0;
        const rawMax = m.max_tokens;
        const maxOut =
          typeof rawMax === "number" &&
          Number.isFinite(rawMax) &&
          rawMax > 0
            ? Math.floor(rawMax)
            : undefined;
        map.set(id, {
          id,
          contextWindow: ctx > 0 ? ctx : this.fallbackContextWindow,
          contextWindowSource: ctx > 0 ? "provider" : "fallback",
          ...(maxOut !== undefined ? { maxOutputTokens: maxOut } : {}),
          isDefault: defaultId ? id === defaultId : false,
        });
      }
      // N05: discard stale-epoch responses — a settings change landed
      // while this fetch was in flight. Installing it would reintroduce
      // the previous provider's caps/default model after invalidation.
      if (myEpoch !== this.fetchEpoch) return;
      this.cache = map;
      this.defaultModelId = defaultId;
      // Record the key only on success — a failed fetch must not claim the
      // new key while still holding the previous provider's rows.
      if (configKey !== undefined) this.loadedConfigKey = configKey;
      this.fetchedAt = Date.now();
    } catch {
      // Leave previous cache in place if we have one; otherwise mark as
      // attempted-but-empty so callers fall back gracefully.
      if (this.cache === null) {
        this.cache = new Map();
      }
    }
  }

  /**
   * Ensure the catalog is loaded. Loads once on first call; a supplied
   * `configKey` identifying the current provider/config forces a refetch
   * when it differs from the key the cache was fetched under (R04).
   */
  async ensureLoaded(configKey?: string): Promise<void> {
    if (
      this.cache !== null &&
      (configKey === undefined || configKey === this.loadedConfigKey)
    ) {
      return;
    }
    await this.refresh(configKey);
  }

  /**
   * R04: drop the cache so the next `ensureLoaded` refetches from the
   * current provider. Call on provider settings changes (mode switch, new
   * local config, API-key clear) so a previous provider can never supply
   * the current caps.
   */
  invalidate(): void {
    // N05: bump the epoch FIRST so an in-flight fetch discards on
    // completion even if it resolves before the clearer below runs.
    this.fetchEpoch += 1;
    this.cache = null;
    this.loadedConfigKey = null;
  }

  /** Returns the cached entries, empty if not yet loaded. */
  entries(): readonly AIChatModelCatalogEntry[] {
    return this.cache ? Array.from(this.cache.values()) : [];
  }

  /**
   * Look up the context window for a model. Falls back to the default
   * context window (256k) when unknown. Never throws.
   */
  async getContextWindow(model?: string): Promise<number> {
    await this.ensureLoaded();
    if (!model) return this.fallbackContextWindow;
    const entry = this.cache?.get(model);
    if (entry) return entry.contextWindow;
    return this.fallbackContextWindow;
  }

  /**
   * R04: provenance of the context window `getContextWindow` would return
   * for a model ("provider" only when the endpoint reported it). Lets
   * callers distinguish a confirmed window from a substituted default
   * without changing the numeric lookup contract.
   */
  async getContextWindowSource(
    model?: string
  ): Promise<"provider" | "fallback"> {
    await this.ensureLoaded();
    if (!model) return "fallback";
    return this.cache?.get(model)?.contextWindowSource ?? "fallback";
  }

  /**
   * Look up the max output tokens for a model, when reported by the
   * server. Returns undefined when unknown.
   */
  async getMaxOutputTokens(model?: string): Promise<number | undefined> {
    await this.ensureLoaded();
    if (!model) return undefined;
    const entry = this.cache?.get(model);
    return entry?.maxOutputTokens;
  }

  /** The server-reported default model id, when known. */
  getDefaultModelId(): string | null {
    return this.defaultModelId;
  }

  /** The timestamp of the last successful refresh, in ms since epoch. */
  getFetchedAt(): number {
    return this.fetchedAt;
  }

  /**
   * Synchronous limit lookup for budget preflight. Call `ensureLoaded()`
   * first so provider rows are available.
   *
   * Unknown / not-yet-loaded models use this catalog's fallback context
   * window (256k by default) — the same value as `getContextWindow()` —
   * not the 8,192-token unknown-model provisional. An unloaded catalog
   * is not evidence the model is small; treating it as 8k falsely
   * rejected first `/goal` Plan Mode turns whose tool+system payload
   * is ~6.5k tokens.
   */
  resolveLimits(model?: string): ResolvedModelLimits {
    const id = model || this.defaultModelId || undefined;
    if (id) {
      const entry = this.cache?.get(id);
      if (entry) {
        return {
          contextLimit: entry.contextWindow,
          // Match the query-loop default maxTokens when the server omits
          // max_tokens. Capping unknown large models at 1,024 truncated
          // `/goal` plans even after the 128k context fallback landed.
          outputLimit: entry.maxOutputTokens ?? 16_384,
          // R04: per-capability provenance. A fallback-substituted context
          // window is NEVER labeled "provider" — the reply context resolver
          // treats "fallback" as unknown and applies its conservative bound
          // instead of budgeting a possibly-small model as a large one.
          // The output number is defaulted independently; its provenance is
          // reported separately because the two fields have different
          // sources (the output cap resolver already treats an omitted
          // max_tokens as unknown via getMaxOutputTokens).
          limitSource:
            entry.contextWindowSource === "provider"
              ? "provider"
              : "fallback",
          outputSource:
            entry.maxOutputTokens !== undefined ? "provider" : "fallback",
        };
      }
    }
    return {
      contextLimit: this.fallbackContextWindow,
      outputLimit: 16_384,
      limitSource: "fallback",
      outputSource: "fallback",
    };
  }
}
