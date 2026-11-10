import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";
import {
  bumpProviderConfigVersion,
  providerConfigKey,
} from "@/service/aiProvider/AIProviderConfigVersion";
import { OpenAICompatibleProviderClient } from "@/service/aiProvider/OpenAICompatibleProviderClient";
import { createModelContextResolver } from "@/service/emailReply/EmailReplyDraftGenerationService";
import type { OpenAIModelsResponse } from "@/api/aiChatApi";
import type { AiChatApi } from "@/api/aiChatApi";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";

function buildApiMock(resp: OpenAIModelsResponse | Error): {
  api: { listOpenAIModels: ReturnType<typeof vi.fn> };
  service: AIChatModelCatalogService;
} {
  const listOpenAIModels = vi.fn();
  if (resp instanceof Error) {
    listOpenAIModels.mockRejectedValue(resp);
  } else {
    listOpenAIModels.mockResolvedValue(resp);
  }
  // Cast to satisfy the AiChatApi constructor type; we only use
  // listOpenAIModels on the instance.
  const api = { listOpenAIModels } as unknown as ConstructorParameters<
    typeof AIChatModelCatalogService
  >[0];
  const service = new AIChatModelCatalogService(api, 128_000);
  return { api: { listOpenAIModels }, service };
}

describe("AIChatModelCatalogService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns fallback context window before first load", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [],
    });
    expect(await service.getContextWindow("any-model")).toBe(128_000);
  });

  it("caches and serves context windows", async () => {
    const { api, service } = buildApiMock({
      object: "list",
      data: [
        {
          id: "m1",
          object: "model",
          created: 1,
          owned_by: "test",
          context_size: 200_000,
          max_tokens: 8192,
        },
        {
          id: "m2",
          object: "model",
          created: 1,
          owned_by: "test",
          context_window: 100_000,
        },
      ],
      default_model: "m1",
    });
    await service.refresh();
    expect(api.listOpenAIModels).toHaveBeenCalledTimes(1);
    expect(await service.getContextWindow("m1")).toBe(200_000);
    expect(await service.getContextWindow("m2")).toBe(100_000);
    // Subsequent lookups don't refetch.
    await service.getContextWindow("m1");
    expect(api.listOpenAIModels).toHaveBeenCalledTimes(1);
  });

  it("falls back when the model is unknown", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [],
    });
    await service.refresh();
    expect(await service.getContextWindow("unknown")).toBe(128_000);
  });

  it("returns undefined maxOutputTokens when not reported", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [
        {
          id: "m1",
          object: "model",
          created: 1,
          owned_by: "test",
          context_size: 200_000,
        },
      ],
    });
    await service.refresh();
    expect(await service.getMaxOutputTokens("m1")).toBeUndefined();
  });

  it("reports maxOutputTokens when present", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [
        {
          id: "m1",
          object: "model",
          created: 1,
          owned_by: "test",
          context_size: 200_000,
          max_tokens: 16_384,
        },
      ],
    });
    await service.refresh();
    expect(await service.getMaxOutputTokens("m1")).toBe(16_384);
  });

  it("exposes the server default model id", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [
        {
          id: "default",
          object: "model",
          created: 1,
          owned_by: "test",
          context_size: 200_000,
        },
      ],
      default_model: "default",
    });
    await service.refresh();
    expect(service.getDefaultModelId()).toBe("default");
  });

  it("keeps previous cache on fetch failure", async () => {
    // First call succeeds
    const { api, service } = buildApiMock({
      object: "list",
      data: [
        {
          id: "m1",
          object: "model",
          created: 1,
          owned_by: "test",
          context_size: 200_000,
        },
      ],
    });
    await service.refresh();
    // Now subsequent call fails
    api.listOpenAIModels.mockRejectedValueOnce(new Error("network"));
    await service.refresh();
    // Previous cache still serves.
    expect(await service.getContextWindow("m1")).toBe(200_000);
  });

  it("ensureLoaded is idempotent", async () => {
    const { api, service } = buildApiMock({
      object: "list",
      data: [],
    });
    await service.ensureLoaded();
    await service.ensureLoaded();
    expect(api.listOpenAIModels).toHaveBeenCalledTimes(1);
  });

  it("entries() returns the cached list", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [
        {
          id: "m1",
          object: "model",
          created: 1,
          owned_by: "test",
          context_size: 200_000,
        },
      ],
    });
    await service.refresh();
    const entries = service.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("m1");
  });

  it("exposes the cached small_model capability when reported", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [],
      small_model: {
        available: true,
        resolved_model: "claude-haiku",
        context_size: 200_000,
        max_tokens: 4096,
      },
    });
    await service.refresh();
    const cap = await service.getSmallModelCapability();
    expect(cap).toEqual({
      available: true,
      resolved_model: "claude-haiku",
      context_size: 200_000,
      max_tokens: 4096,
    });
  });

  it("returns null small-model capability when the server reports none", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [],
    });
    await service.refresh();
    expect(await service.getSmallModelCapability()).toBeNull();
  });

  it("returns null small-model capability before the first load", async () => {
    const { service } = buildApiMock({
      object: "list",
      data: [],
    });
    // No refresh() call yet.
    expect(await service.getSmallModelCapability()).toBeNull();
  });

  it("re-reads small-model capability after a refresh following a provider switch", async () => {
    const { api, service } = buildApiMock({
      object: "list",
      data: [],
      small_model: { available: true, resolved_model: "haiku-a" },
    });
    await service.refresh();
    expect((await service.getSmallModelCapability())?.resolved_model).toBe(
      "haiku-a"
    );

    // Provider switch: the new environment has no small model configured.
    api.listOpenAIModels.mockResolvedValueOnce({ object: "list", data: [] });
    await service.refresh();
    expect(await service.getSmallModelCapability()).toBeNull();
  });

  describe("resolveLimits", () => {
    it("uses the 128k catalog fallback before the catalog is loaded", () => {
      const { service } = buildApiMock({ object: "list", data: [] });
      const limits = service.resolveLimits("gpt-4o");
      expect(limits.contextLimit).toBe(128_000);
      expect(limits.outputLimit).toBe(16_384);
      expect(limits.limitSource).toBe("fallback");
    });

    it("uses provider limits after the catalog is loaded", async () => {
      const { service } = buildApiMock({
        object: "list",
        data: [
          {
            id: "gpt-4o",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: 128_000,
            max_tokens: 16_384,
          },
        ],
      });
      await service.refresh();
      expect(service.resolveLimits("gpt-4o")).toEqual({
        contextLimit: 128_000,
        outputLimit: 16_384,
        limitSource: "provider",
        outputSource: "provider",
      });
    });

    it("falls back to the default model when the request omits a model id", async () => {
      const { service } = buildApiMock({
        object: "list",
        data: [
          {
            id: "hosted-default",
            object: "model",
            created: 1,
            owned_by: "test",
            context_size: 200_000,
            max_tokens: 8_192,
          },
        ],
        default_model: "hosted-default",
      });
      await service.refresh();
      expect(service.resolveLimits(undefined)).toEqual({
        contextLimit: 200_000,
        outputLimit: 8_192,
        limitSource: "provider",
        outputSource: "provider",
      });
    });

    // Regression: models without a server-reported context window must
    // default to 256k (not 128k) so long scheduled-loop turns are not
    // rejected with "request budget rejected ... exceeds context (128000)".
    it("defaults to 256k when constructed with the production default", () => {
      const listOpenAIModels = vi.fn().mockResolvedValue({
        object: "list",
        data: [],
      } as OpenAIModelsResponse);
      const api = {
        listOpenAIModels,
      } as unknown as ConstructorParameters<
        typeof AIChatModelCatalogService
      >[0];
      // No explicit fallback arg → uses AI_CHAT_RECOVERY_DEFAULTS.defaultContextWindowTokens (256k).
      const service = new AIChatModelCatalogService(api);
      const limits = service.resolveLimits("agnes-3.0-flash");
      expect(limits.contextLimit).toBe(256_000);
      expect(limits.outputLimit).toBe(16_384);
      expect(limits.limitSource).toBe("fallback");
    });
  });

  // R04: a fallback-substituted context window must NEVER be labeled
  // provider-confirmed — otherwise the reply context resolver trusts the
  // label and budgets a possibly-small model as a large one.
  describe("R04 capability provenance", () => {
    it("labels a listed default model with missing context fields as fallback", async () => {
      // The exact reported reproduction: endpoint lists the default model
      // but omits context-window metadata.
      const { service } = buildApiMock({
        object: "list",
        data: [
          { id: "small-model", object: "model", created: 1, owned_by: "test" },
        ],
        default_model: "small-model",
      });
      await service.refresh();
      const limits = service.resolveLimits("small-model");
      expect(limits.contextLimit).toBe(128_000);
      expect(limits.limitSource).toBe("fallback");
      expect(limits.outputSource).toBe("fallback");
      expect(await service.getContextWindowSource("small-model")).toBe(
        "fallback"
      );
    });

    it("keeps explicit small windows provider-confirmed (no flattening)", async () => {
      const { service } = buildApiMock({
        object: "list",
        data: [
          {
            id: "tiny",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: 8_192,
          },
        ],
      });
      await service.refresh();
      const limits = service.resolveLimits("tiny");
      expect(limits.contextLimit).toBe(8_192);
      expect(limits.limitSource).toBe("provider");
    });

    it("keeps explicit large windows provider-confirmed", async () => {
      const { service } = buildApiMock({
        object: "list",
        data: [
          {
            id: "huge",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: 1_000_000,
            max_tokens: 32_768,
          },
        ],
      });
      await service.refresh();
      const limits = service.resolveLimits("huge");
      expect(limits).toEqual({
        contextLimit: 1_000_000,
        outputLimit: 32_768,
        limitSource: "provider",
        outputSource: "provider",
      });
    });

    it("treats malformed capability values as missing (fallback provenance)", async () => {
      const { service } = buildApiMock({
        object: "list",
        data: [
          {
            id: "negative",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: -5,
            max_tokens: -100,
          },
          {
            id: "zero",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: 0,
          },
          {
            id: "nan",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: NaN,
          },
          {
            id: "string",
            object: "model",
            created: 1,
            owned_by: "test",
            // A malformed server could send a non-numeric value; force
            // it past the response type to prove runtime validation.
            context_window: "big" as unknown as number,
          },
        ],
      });
      await service.refresh();
      for (const id of ["negative", "zero", "nan", "string"]) {
        const limits = service.resolveLimits(id);
        expect(limits.contextLimit).toBe(128_000);
        expect(limits.limitSource).toBe("fallback");
        expect(await service.getContextWindowSource(id)).toBe("fallback");
      }
      // Malformed max_tokens is unknown, not a negative clamp.
      expect(await service.getMaxOutputTokens("negative")).toBeUndefined();
      expect(service.resolveLimits("negative").outputSource).toBe("fallback");
    });

    it("labels an unlisted (missing) model as fallback", async () => {
      const { service } = buildApiMock({
        object: "list",
        data: [
          {
            id: "known",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: 64_000,
          },
        ],
      });
      await service.refresh();
      const limits = service.resolveLimits("ghost");
      expect(limits.contextLimit).toBe(128_000);
      expect(limits.limitSource).toBe("fallback");
    });

    it("refetches when the provider/config key changes (A → B, lower cap)", async () => {
      const listOpenAIModels = vi.fn().mockResolvedValue({
        object: "list",
        data: [
          {
            id: "shared-id",
            object: "model",
            created: 1,
            owned_by: "provider-a",
            context_window: 128_000,
            max_tokens: 16_384,
          },
        ],
      } as OpenAIModelsResponse);
      const api = { listOpenAIModels } as unknown as ConstructorParameters<
        typeof AIChatModelCatalogService
      >[0];
      const service = new AIChatModelCatalogService(api, 128_000);

      await service.ensureLoaded("provider-a");
      expect(service.resolveLimits("shared-id").outputLimit).toBe(16_384);
      expect(listOpenAIModels).toHaveBeenCalledTimes(1);

      // Same key → no refetch.
      await service.ensureLoaded("provider-a");
      expect(listOpenAIModels).toHaveBeenCalledTimes(1);

      // Provider B reports the SAME model id with a LOWER output cap.
      listOpenAIModels.mockResolvedValue({
        object: "list",
        data: [
          {
            id: "shared-id",
            object: "model",
            created: 1,
            owned_by: "provider-b",
            context_window: 128_000,
            max_tokens: 4_096,
          },
        ],
      } as OpenAIModelsResponse);
      await service.ensureLoaded("provider-b");
      expect(listOpenAIModels).toHaveBeenCalledTimes(2);
      expect(service.resolveLimits("shared-id").outputLimit).toBe(4_096);
    });

  // N05: invalidation fences outstanding fetches — a late response from
  // the previous provider must be discarded, never reinstalled.
  describe("N05 epoch-fenced invalidation", () => {
    function deferredCatalog(): {
      service: AIChatModelCatalogService;
      listOpenAIModels: ReturnType<typeof vi.fn>;
      resolveA: (resp: OpenAIModelsResponse) => void;
      rejectA: (err: Error) => void;
    } {
      let resolveA!: (resp: OpenAIModelsResponse) => void;
      let rejectA!: (err: Error) => void;
      const gateA = new Promise<OpenAIModelsResponse>((res, rej) => {
        resolveA = res;
        rejectA = rej;
      });
      const listOpenAIModels = vi.fn();
      // First call hangs (provider A's in-flight request); later calls
      // resolve per-test via mockResolvedValue.
      listOpenAIModels.mockReturnValueOnce(gateA);
      const api = { listOpenAIModels } as unknown as ConstructorParameters<
        typeof AIChatModelCatalogService
      >[0];
      const service = new AIChatModelCatalogService(api, 128_000);
      return {
        service,
        listOpenAIModels,
        resolveA: (resp) => resolveA(resp),
        rejectA: (err) => rejectA(err),
      };
    }

    const responseFor = (
      owner: string,
      cap: number,
      context: number
    ): OpenAIModelsResponse =>
      ({
        object: "list",
        data: [
          {
            id: "shared-id",
            object: "model",
            created: 1,
            owned_by: owner,
            context_window: context,
            max_tokens: cap,
          },
        ],
        default_model: "shared-id",
      }) as OpenAIModelsResponse;

    it("discards A's late response after invalidate when nobody joins (no reinstall)", async () => {
      // The discard matters here: no B lookup joins the in-flight fetch,
      // so without epoch fencing A's late response would reinstall the
      // previous provider's caps and default model.
      const { service, listOpenAIModels, resolveA } = deferredCatalog();
      const loadingA = service.ensureLoaded("provider-a");
      service.invalidate();
      // A's response completes late with a HIGH cap for the model id.
      resolveA(responseFor("provider-a", 4_096, 128_000));
      await loadingA;
      expect(listOpenAIModels).toHaveBeenCalledTimes(1);
      const stale = service.resolveLimits("shared-id");
      expect(stale.limitSource).toBe("fallback");
      expect(stale.outputLimit).toBe(16_384);
      expect(service.getDefaultModelId()).toBeNull();
      // The next lookup refetches from the CURRENT provider (B).
      listOpenAIModels.mockResolvedValue(responseFor("provider-b", 128, 32_000));
      await service.ensureLoaded();
      expect(listOpenAIModels).toHaveBeenCalledTimes(2);
      expect(service.resolveLimits("shared-id").outputLimit).toBe(128);
    });

    it("discards A's late response after invalidate; B lookup fetches B's caps", async () => {
      const { service, listOpenAIModels, resolveA } = deferredCatalog();
      listOpenAIModels.mockResolvedValue(responseFor("provider-b", 128, 32_000));
      // Provider A's request is pending; settings switch to B and
      // invalidate; B's generation joins the outstanding request.
      const loadingA = service.ensureLoaded("provider-a");
      service.invalidate();
      const lookupB = service.ensureLoaded("provider-b");
      // A's response completes late with a HIGH cap for the same model id.
      resolveA(responseFor("provider-a", 4_096, 128_000));
      await Promise.all([loadingA, lookupB]);
      // Exactly two port calls (A wasted + B real) — and the catalog holds
      // B's lower cap and B's ownership, never A's reinstalled values.
      expect(listOpenAIModels).toHaveBeenCalledTimes(2);
      const limits = service.resolveLimits("shared-id");
      expect(limits.outputLimit).toBe(128);
      expect(limits.contextLimit).toBe(32_000);
      expect(limits.limitSource).toBe("provider");
      expect(service.getDefaultModelId()).toBe("shared-id");
      // A subsequent B lookup reuses the cache (no third fetch).
      await service.ensureLoaded("provider-b");
      expect(listOpenAIModels).toHaveBeenCalledTimes(2);
    });

    it("discards a rejected late fetch across rapid invalidations, then loads C", async () => {
      const { service, listOpenAIModels, rejectA } = deferredCatalog();
      listOpenAIModels.mockResolvedValue(
        responseFor("provider-c", 512, 64_000)
      );
      const loadingA = service.ensureLoaded("provider-a");
      // Two rapid settings changes while A is in flight.
      service.invalidate();
      service.invalidate();
      const lookupC = service.ensureLoaded("provider-c");
      // A's request fails late — failure installs nothing; the C lookup
      // that joined still fetches C afterward.
      rejectA(new Error("A gone"));
      await Promise.all([loadingA, lookupC]);
      expect(listOpenAIModels).toHaveBeenCalledTimes(2);
      expect(service.resolveLimits("shared-id").outputLimit).toBe(512);
      expect(service.resolveLimits("shared-id").contextLimit).toBe(64_000);
      expect(service.getDefaultModelId()).toBe("shared-id");
    });
  });

    it("provider config keys track settings bumps (production keying)", async () => {
      // The production resolvers key catalog loads by this version; every
      // settings bump must change it so a previous provider's catalog can
      // never satisfy the current configuration.
      const before = providerConfigKey();
      bumpProviderConfigVersion();
      expect(providerConfigKey()).not.toBe(before);
      const listOpenAIModels = vi
        .fn()
        .mockResolvedValue({ object: "list", data: [] });
      const catalog = new AIChatModelCatalogService(
        { listOpenAIModels } as unknown as ConstructorParameters<
          typeof AIChatModelCatalogService
        >[0],
        128_000
      );
      await catalog.ensureLoaded(before);
      await catalog.ensureLoaded(providerConfigKey());
      // Different key → refetch, not cache reuse.
      expect(listOpenAIModels).toHaveBeenCalledTimes(2);
    });

  // G01: real client → normalizer → catalog → generation-resolver chain
  // (fake transport only). Covers missing windows, synthetic discovery,
  // explicit small windows, and the configured override end to end.
  describe("G01 provider chain with a real client", () => {
    const baseConfig: LocalAIProviderConfig = {
      preset: "custom",
      name: "Chain local",
      baseUrl: "http://127.0.0.1:11434",
      defaultModel: "chain-model",
      apiKeyConfigured: false,
    };

    function modelsResponse(models: unknown, status = 200): Response {
      return new Response(
        status === 200 ? JSON.stringify({ object: "list", data: models }) : "",
        {
          status,
          headers: { "content-type": "application/json" },
        }
      );
    }

    /** Catalog reading through the REAL provider client (fake fetch). */
    async function catalogThroughClient(
      config: LocalAIProviderConfig,
      fetchImpl: typeof fetch
    ): Promise<AIChatModelCatalogService> {
      const client = new OpenAICompatibleProviderClient(config, "", fetchImpl);
      const api = {
        listOpenAIModels: async () =>
          (await client.listModelsWithFallbackStatus()).models,
      } as unknown as AiChatApi;
      const catalog = new AIChatModelCatalogService(api, 128_000);
      await catalog.ensureLoaded();
      return catalog;
    }

    it("missing window and no configuration → unknown (fallback, resolver undefined)", async () => {
      const fetchImpl = (async () =>
        modelsResponse([{ id: "chain-model" }])) as unknown as typeof fetch;
      const catalog = await catalogThroughClient(baseConfig, fetchImpl);
      const limits = catalog.resolveLimits("chain-model");
      expect(limits.limitSource).toBe("fallback");
      // The generation layer treats fallback as unknown and applies its
      // conservative bound instead of a 256k assumption.
      const resolveWindow = createModelContextResolver(catalog);
      await expect(resolveWindow("chain-model")).resolves.toBeUndefined();
    });

    it("explicit small window flows through as provider-confirmed", async () => {
      const fetchImpl = (async () =>
        modelsResponse([{ id: "chain-model", context_window: 4096 }])) as unknown as typeof fetch;
      const catalog = await catalogThroughClient(baseConfig, fetchImpl);
      const limits = catalog.resolveLimits("chain-model");
      expect(limits.limitSource).toBe("provider");
      expect(limits.contextLimit).toBe(4096);
      const resolveWindow = createModelContextResolver(catalog);
      await expect(resolveWindow("chain-model")).resolves.toBe(4096);
    });

    it("configured override reaches the catalog for the default model", async () => {
      const fetchImpl = (async () =>
        modelsResponse([{ id: "chain-model" }])) as unknown as typeof fetch;
      const catalog = await catalogThroughClient(
        { ...baseConfig, contextSize: 16_384 },
        fetchImpl
      );
      const limits = catalog.resolveLimits("chain-model");
      expect(limits.limitSource).toBe("provider");
      expect(limits.contextLimit).toBe(16_384);
      const resolveWindow = createModelContextResolver(catalog);
      await expect(resolveWindow("chain-model")).resolves.toBe(16_384);
    });

    it("synthetic discovery carries the configured window, omits it otherwise", async () => {
      const failing = (async () =>
        new Response("", { status: 500 })) as unknown as typeof fetch;
      const configured = await catalogThroughClient(
        { ...baseConfig, contextSize: 8192 },
        failing
      );
      expect(configured.resolveLimits("chain-model").contextLimit).toBe(8192);
      expect(
        configured.resolveLimits("chain-model").limitSource
      ).toBe("provider");
      const bare = await catalogThroughClient(baseConfig, failing);
      expect(bare.resolveLimits("chain-model").limitSource).toBe("fallback");
    });
  });

    it("invalidate() forces a refetch on next load", async () => {
      const { api, service } = buildApiMock({
        object: "list",
        data: [
          {
            id: "m",
            object: "model",
            created: 1,
            owned_by: "test",
            context_window: 32_000,
          },
        ],
      });
      await service.ensureLoaded();
      expect(api.listOpenAIModels).toHaveBeenCalledTimes(1);
      service.invalidate();
      await service.ensureLoaded();
      expect(api.listOpenAIModels).toHaveBeenCalledTimes(2);
    });
  });
});
