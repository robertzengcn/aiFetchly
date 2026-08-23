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
});
