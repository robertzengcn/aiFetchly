import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";
import type { OpenAIModelsResponse } from "@/api/aiChatApi";

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
