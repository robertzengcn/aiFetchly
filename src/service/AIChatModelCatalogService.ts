// src/service/AIChatModelCatalogService.ts
//
// Caches the AI server's /api/ai/v1/models response in-process so
// recovery layers can look up a model's context window without paying
// the round-trip on every turn. The cache is invalidated when a fetch
// fails or when refresh() is explicitly called.
import type { OpenAIModelsResponse } from "@/api/aiChatApi";
import { AiChatApi } from "@/api/aiChatApi";
import { AI_CHAT_RECOVERY_DEFAULTS } from "@/service/AIChatRetryPolicy";

export interface AIChatModelCatalogEntry {
  readonly id: string;
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly isDefault?: boolean;
}

/**
 * Process-lifetime catalog of AI server models. Falls back to a
 * default context window (128k) when the server doesn't report one
 * or when the lookup fails. Never throws.
 */
export class AIChatModelCatalogService {
  private cache: ReadonlyMap<string, AIChatModelCatalogEntry> | null = null;
  private defaultModelId: string | null = null;
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
  async refresh(): Promise<void> {
    if (this.fetching) {
      await this.fetching;
      return;
    }
    this.fetching = this.doRefresh();
    try {
      await this.fetching;
    } finally {
      this.fetching = null;
    }
  }

  private async doRefresh(): Promise<void> {
    try {
      const resp: OpenAIModelsResponse = await this.api.listOpenAIModels();
      const map = new Map<string, AIChatModelCatalogEntry>();
      const defaultId = resp.default_model ?? null;
      for (const m of resp.data) {
        const id = m.id;
        if (!id) continue;
        const ctx =
          (m.context_window ?? m.context_length ?? m.context_size) ?? 0;
        map.set(id, {
          id,
          contextWindow: ctx > 0 ? ctx : this.fallbackContextWindow,
          maxOutputTokens: m.max_tokens,
          isDefault: defaultId ? id === defaultId : false,
        });
      }
      this.cache = map;
      this.defaultModelId = defaultId;
      this.fetchedAt = Date.now();
    } catch {
      // Leave previous cache in place if we have one; otherwise mark as
      // attempted-but-empty so callers fall back gracefully.
      if (this.cache === null) {
        this.cache = new Map();
      }
    }
  }

  /** Ensure the catalog is loaded. Loads once on first call. */
  async ensureLoaded(): Promise<void> {
    if (this.cache !== null) return;
    await this.refresh();
  }

  /** Returns the cached entries, empty if not yet loaded. */
  entries(): readonly AIChatModelCatalogEntry[] {
    return this.cache ? Array.from(this.cache.values()) : [];
  }

  /**
   * Look up the context window for a model. Falls back to the default
   * context window (128k) when unknown. Never throws.
   */
  async getContextWindow(model?: string): Promise<number> {
    await this.ensureLoaded();
    if (!model) return this.fallbackContextWindow;
    const entry = this.cache?.get(model);
    if (entry) return entry.contextWindow;
    return this.fallbackContextWindow;
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
}
