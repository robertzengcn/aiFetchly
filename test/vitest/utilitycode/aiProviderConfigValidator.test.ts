import { describe, it, expect } from "vitest";
import type { LocalAIProviderPreset } from "@/entityTypes/aiProviderTypes";
import {
  normalizeOpenAIBaseUrl,
  validateLocalProviderConfig,
  isLocalHostname,
  isInsecurePublicHttpUrl,
} from "@/service/aiProvider/AIProviderConfigValidator";
import {
  AI_PROVIDER_PRESETS,
  getPresetDefinition,
  isValidPreset,
} from "@/service/aiProvider/AIProviderPresets";

describe("normalizeOpenAIBaseUrl", () => {
  it("appends /v1 to a bare localhost URL", () => {
    expect(normalizeOpenAIBaseUrl("http://localhost:11434")).toBe(
      "http://localhost:11434/v1"
    );
  });

  it("appends /v1 to a URL with a trailing slash", () => {
    expect(normalizeOpenAIBaseUrl("http://localhost:11434/")).toBe(
      "http://localhost:11434/v1"
    );
  });

  it("strips trailing slash when /v1 already present", () => {
    expect(normalizeOpenAIBaseUrl("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/v1"
    );
  });

  it("leaves a clean /v1 URL untouched", () => {
    expect(normalizeOpenAIBaseUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1"
    );
  });

  it("keeps a path prefix before appending /v1", () => {
    expect(normalizeOpenAIBaseUrl("https://proxy.example.com/openai")).toBe(
      "https://proxy.example.com/openai/v1"
    );
  });

  it("rejects non-http(s) protocols", () => {
    expect(() => normalizeOpenAIBaseUrl("file:///etc/hosts")).toThrow(
      /http or https/
    );
  });

  it("rejects unparseable input", () => {
    expect(() => normalizeOpenAIBaseUrl("not a url")).toThrow();
  });

  it("drops query and hash", () => {
    expect(normalizeOpenAIBaseUrl("http://localhost:11434/v1?x=1#frag")).toBe(
      "http://localhost:11434/v1"
    );
  });
});

describe("hostname helpers", () => {
  it("recognizes local hostnames", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("::1")).toBe(true);
    expect(isLocalHostname("api.openai.com")).toBe(false);
  });

  it("flags insecure public HTTP URLs", () => {
    expect(isInsecurePublicHttpUrl("http://api.example.com/v1")).toBe(true);
    expect(isInsecurePublicHttpUrl("http://localhost:11434/v1")).toBe(false);
    expect(isInsecurePublicHttpUrl("https://api.example.com/v1")).toBe(false);
  });
});

describe("presets", () => {
  it("has the seven documented presets", () => {
    const ids = AI_PROVIDER_PRESETS.map((p) => p.preset);
    expect(ids).toEqual([
      "ollama",
      "lm_studio",
      "openai",
      "openrouter",
      "vllm",
      "localai",
      "custom",
    ]);
  });

  it("validates known ids", () => {
    expect(isValidPreset("ollama")).toBe(true);
    expect(isValidPreset("nope")).toBe(false);
  });

  it("looks up definitions", () => {
    expect(getPresetDefinition("openai").apiKeyRecommended).toBe(true);
    expect(getPresetDefinition("ollama").apiKeyRecommended).toBe(false);
  });
});

describe("validateLocalProviderConfig", () => {
  const validInput = {
    preset: "ollama" as const,
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
  };

  it("normalizes and accepts a valid config", () => {
    const result = validateLocalProviderConfig(validInput);
    expect(result.valid).toBe(true);
    expect(result.normalized?.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.normalized?.name).toBe("Ollama");
    expect(result.errors).toEqual([]);
  });

  it("rejects an unknown preset", () => {
    // Cast exercises the validator's runtime check for an unknown preset id.
    const result = validateLocalProviderConfig({
      ...validInput,
      preset: "nope" as unknown as LocalAIProviderPreset,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("; ")).toMatch(/Unknown provider preset/);
  });

  it("rejects an empty name", () => {
    const result = validateLocalProviderConfig({ ...validInput, name: "  " });
    expect(result.valid).toBe(false);
    expect(result.errors.join("; ")).toMatch(/Provider name/);
  });

  it("rejects an empty default model", () => {
    const result = validateLocalProviderConfig({
      ...validInput,
      defaultModel: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("; ")).toMatch(/Default model/);
  });

  it("rejects an invalid base URL", () => {
    const result = validateLocalProviderConfig({
      ...validInput,
      baseUrl: "ftp://x",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("; ")).toMatch(/http or https/);
  });

  it("warns (not errors) when an API-key-required preset has no key", () => {
    const result = validateLocalProviderConfig({
      ...validInput,
      preset: "openai",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join("; ")).toMatch(/API key/i);
  });

  it("does not warn about a missing key when one is already configured", () => {
    const result = validateLocalProviderConfig(
      { ...validInput, preset: "openai", baseUrl: "https://api.openai.com/v1" },
      /* existingApiKeyConfigured */ true
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => /API key/i.test(w))).toBe(false);
  });

  it("warns on insecure public HTTP", () => {
    const result = validateLocalProviderConfig({
      ...validInput,
      baseUrl: "http://api.example.com",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join("; ")).toMatch(/HTTP without TLS/);
  });

  it("treats null input as invalid without throwing", () => {
    const result = validateLocalProviderConfig(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("preserves apiKey and clearApiKey flags on the normalized output", () => {
    const result = validateLocalProviderConfig({
      ...validInput,
      apiKey: "sk-test",
      clearApiKey: true,
      contextSize: 8192,
    });
    expect(result.normalized?.apiKey).toBe("sk-test");
    expect(result.normalized?.clearApiKey).toBe(true);
    expect(result.normalized?.contextSize).toBe(8192);
  });

  it("drops a non-positive context size", () => {
    const result = validateLocalProviderConfig({
      ...validInput,
      contextSize: -1,
    });
    expect(result.normalized?.contextSize).toBeUndefined();
    expect(result.warnings.join("; ")).toMatch(/Context size/);
  });

  it("preserves valid capability and last-test metadata", () => {
    const result = validateLocalProviderConfig({
      ...validInput,
      capabilities: {
        modelsEndpoint: "supported",
        chat: "supported",
        streaming: "unsupported",
        tools: "unknown",
        vision: "unknown",
        contextSize: 8192,
      },
      lastTestedAt: "2026-07-20T00:00:00.000Z",
      lastTestStatus: "partial",
      lastTestMessage: "Chat test passed, but streaming could not be verified.",
    });

    expect(result.valid).toBe(true);
    expect(result.normalized?.capabilities).toEqual({
      modelsEndpoint: "supported",
      chat: "supported",
      streaming: "unsupported",
      tools: "unknown",
      vision: "unknown",
      contextSize: 8192,
    });
    expect(result.normalized?.lastTestedAt).toBe("2026-07-20T00:00:00.000Z");
    expect(result.normalized?.lastTestStatus).toBe("partial");
    expect(result.normalized?.lastTestMessage).toMatch(/streaming/i);
  });
});
