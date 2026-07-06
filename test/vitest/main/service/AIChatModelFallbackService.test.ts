import { describe, expect, it, vi } from "vitest";
import { AIChatModelFallbackService } from "@/service/AIChatModelFallbackService";
import { AIChatModelCatalogService } from "@/service/AIChatModelCatalogService";

function makeCatalog(entries: Array<{ id: string; isDefault?: boolean }>) {
  const list = vi.fn(async () => undefined) as unknown;
  // Build a fake catalog by stamping the entries and default.
  const cat = Object.create(AIChatModelCatalogService.prototype) as AIChatModelCatalogService;
  // Pre-seed cache by overriding ensureLoaded/entries/getDefaultModelId.
  let loaded = false;
  const data = entries.map((e) => ({
    id: e.id,
    contextWindow: 128_000,
    isDefault: e.isDefault ?? false,
  }));
  (cat as unknown as { ensureLoaded: () => Promise<void> }).ensureLoaded =
    async () => {
      loaded = true;
    };
  (cat as unknown as { entries: () => typeof data }).entries = () => data;
  (cat as unknown as { getDefaultModelId: () => string | null }).getDefaultModelId =
    () => {
      const def = entries.find((e) => e.isDefault);
      return def?.id ?? null;
    };
  void list;
  return cat;
}

describe("AIChatModelFallbackService", () => {
  it("prefers the local fallback map", async () => {
    const svc = new AIChatModelFallbackService(makeCatalog([]));
    const r = await svc.resolve({
      originalModel: "m1",
      currentModel: "m1",
      reason: "overload",
      fallbackMap: { m1: ["m2", "m3"] },
    });
    expect(r.model).toBe("m2");
    expect(r.source).toBe("fallback_map");
  });

  it("skips same-model entries in the fallback map", async () => {
    const svc = new AIChatModelFallbackService(makeCatalog([]));
    const r = await svc.resolve({
      originalModel: "m1",
      currentModel: "m1",
      reason: "overload",
      fallbackMap: { m1: ["m1", "m3"] },
    });
    expect(r.model).toBe("m3");
    expect(r.source).toBe("fallback_map");
  });

  it("uses server default when no map match", async () => {
    const svc = new AIChatModelFallbackService(
      makeCatalog([
        { id: "m1" },
        { id: "default", isDefault: true },
      ])
    );
    const r = await svc.resolve({
      originalModel: "m1",
      currentModel: "m1",
      reason: "overload",
    });
    expect(r.model).toBe("default");
    expect(r.source).toBe("server_default");
  });

  it("falls back to first different catalog model", async () => {
    const svc = new AIChatModelFallbackService(
      makeCatalog([
        { id: "m1" },
        { id: "m2" },
        { id: "m3" },
      ])
    );
    const r = await svc.resolve({
      originalModel: "m1",
      currentModel: "m1",
      reason: "model_unavailable",
    });
    expect(r.model).toBe("m2");
    expect(r.source).toBe("first_different");
  });

  it("returns undefined when no alternative exists", async () => {
    const svc = new AIChatModelFallbackService(makeCatalog([{ id: "m1" }]));
    const r = await svc.resolve({
      originalModel: "m1",
      currentModel: "m1",
      reason: "overload",
    });
    expect(r.model).toBeUndefined();
    expect(r.source).toBe("none");
  });

  it("never returns the same model as current", async () => {
    const svc = new AIChatModelFallbackService(
      makeCatalog([{ id: "m1" }, { id: "m1" }])
    );
    const r = await svc.resolve({
      originalModel: "m1",
      currentModel: "m1",
      reason: "overload",
    });
    expect(r.model).toBeUndefined();
  });
});
