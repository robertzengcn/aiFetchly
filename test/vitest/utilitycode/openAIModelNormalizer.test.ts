import { describe, it, expect } from "vitest";
import {
  normalizeOpenAIModelsResponse,
  buildSyntheticModelList,
} from "@/service/aiProvider/OpenAIModelNormalizer";

describe("normalizeOpenAIModelsResponse", () => {
  it("passes through an OpenAI-shaped response and preserves context", () => {
    const res = normalizeOpenAIModelsResponse({
      object: "list",
      data: [
        { id: "llama3.1", object: "model", created: 0, owned_by: "ollama" },
        {
          id: "gpt-oss",
          object: "model",
          created: 1,
          owned_by: "openai",
          context_window: 128000,
        },
      ],
    });
    expect(res.data.map((m) => m.id)).toEqual(["llama3.1", "gpt-oss"]);
    expect(res.data[1].context_size).toBe(128000);
    expect(res.default_model).toBe("llama3.1");
  });

  it("inserts the configured default model at the top when absent", () => {
    const res = normalizeOpenAIModelsResponse(
      { object: "list", data: [{ id: "other", object: "model", created: 0, owned_by: "x" }] },
      { defaultModel: "llama3.1", providerName: "Ollama" }
    );
    expect(res.data[0].id).toBe("llama3.1");
    expect(res.data[0].owned_by).toBe("Ollama");
    expect(res.default_model).toBe("llama3.1");
  });

  it("does not duplicate the default model when already present", () => {
    const res = normalizeOpenAIModelsResponse(
      {
        object: "list",
        data: [{ id: "llama3.1", object: "model", created: 0, owned_by: "ollama" }],
      },
      { defaultModel: "llama3.1" }
    );
    expect(res.data.filter((m) => m.id === "llama3.1").length).toBe(1);
  });

  it("accepts the hosted-style { models: [...] } envelope", () => {
    const res = normalizeOpenAIModelsResponse({
      models: [{ name: "m1" }, { name: "m2", context_size: 8192 }],
      default_model: "m2",
    });
    expect(res.data.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(res.data[1].context_size).toBe(8192);
    expect(res.default_model).toBe("m2");
  });

  it("returns an empty list for unrecognized shapes", () => {
    const res = normalizeOpenAIModelsResponse({ foo: "bar" });
    expect(res.data).toEqual([]);
  });

  it("drops entries without an id", () => {
    const res = normalizeOpenAIModelsResponse({
      data: [{ id: "ok" }, { object: "model" }, { id: "" }],
    });
    expect(res.data.map((m) => m.id)).toEqual(["ok"]);
  });
});

describe("buildSyntheticModelList", () => {
  it("builds a single-model list with the configured model as default", () => {
    const res = buildSyntheticModelList({
      model: "llama3.1",
      providerName: "Ollama",
      contextSize: 8192,
    });
    expect(res.object).toBe("list");
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe("llama3.1");
    expect(res.data[0].owned_by).toBe("Ollama");
    expect(res.data[0].context_size).toBe(8192);
    expect(res.default_model).toBe("llama3.1");
  });

  it("omits context_size when not provided", () => {
    const res = buildSyntheticModelList({ model: "m" });
    expect(res.data[0].context_size).toBeUndefined();
  });
});
