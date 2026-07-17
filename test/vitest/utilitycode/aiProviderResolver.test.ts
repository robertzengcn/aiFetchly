import { describe, it, expect, beforeEach } from "vitest";
import {
  USER_AI_ENABLED,
  USER_LOCAL_AI_ENABLED,
  USER_AI_PROVIDER_MODE,
  USER_LOCAL_AI_PROVIDER_CONFIG,
} from "@/config/usersetting";
import type { Token } from "@/modules/token";
import { AIProviderSecretService } from "@/service/aiProvider/AIProviderSecretService";
import { AIProviderSettingsService } from "@/service/aiProvider/AIProviderSettingsService";
import { AIProviderResolver } from "@/service/aiProvider/AIProviderResolver";

/** Minimal in-memory Token replacement so services + resolver share state. */
class FakeToken {
  private store = new Map<string, string>();
  setValue(key: string, value: string): void {
    this.store.set(key, value);
  }
  getValue(key: string): string {
    return this.store.get(key) ?? "";
  }
  deleteValue(key: string): void {
    this.store.delete(key);
  }
  hasValue(key: string): boolean {
    return this.store.has(key) && this.store.get(key)!.length > 0;
  }
}

/** Cast helper: FakeToken is structurally compatible except for Token's
 *  private `store` field, which we deliberately omit. */
const asToken = (t: FakeToken): Token => t as unknown as Token;

function makeServices(): {
  resolver: AIProviderResolver;
  settings: AIProviderSettingsService;
  secrets: AIProviderSecretService;
  token: FakeToken;
} {
  const token = new FakeToken();
  const secrets = new AIProviderSecretService(asToken(token));
  const settings = new AIProviderSettingsService(asToken(token), secrets);
  const resolver = new AIProviderResolver(asToken(token), settings, secrets);
  return { resolver, settings, secrets, token };
}

const validProvider = {
  preset: "ollama" as const,
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  defaultModel: "llama3.1",
};

describe("AIProviderResolver.resolveForChat", () => {
  let ctx: ReturnType<typeof makeServices>;
  beforeEach(() => {
    ctx = makeServices();
  });

  it("allows a hosted subscribed user", () => {
    ctx.token.setValue(USER_AI_ENABLED, "true");
    const r = ctx.resolver.resolveForChat();
    expect(r.canUse).toBe(true);
    if (r.canUse) {
      expect(r.kind).toBe("hosted");
    }
  });

  it("denies a hosted unsubscribed user", () => {
    const r = ctx.resolver.resolveForChat();
    expect(r.canUse).toBe(false);
    if (!r.canUse) {
      expect(r.reason).toBe("hosted_subscription_required");
      expect(r.message).toMatch(/subscription/i);
    }
  });

  it("allows a valid local provider without a hosted subscription", () => {
    ctx.settings.setMode("local");
    ctx.settings.saveLocalProvider(validProvider);
    // Hosted entitlement intentionally NOT set.
    const r = ctx.resolver.resolveForChat();
    expect(r.canUse).toBe(true);
    if (r.canUse && r.kind === "local") {
      expect(r.config.defaultModel).toBe("llama3.1");
      expect(r.config.baseUrl).toBe("http://localhost:11434/v1");
      expect(r.apiKey).toBe("");
    }
  });

  it("returns the plaintext API key to the main process for a local provider", () => {
    ctx.settings.setMode("local");
    ctx.settings.saveLocalProvider({ ...validProvider, apiKey: "sk-secret" });
    const r = ctx.resolver.resolveForChat();
    if (r.canUse && r.kind === "local") {
      expect(r.apiKey).toBe("sk-secret");
    }
  });

  it("denies local mode when local AI is disabled", () => {
    ctx.settings.setMode("local");
    // USER_LOCAL_AI_ENABLED stays unset (false).
    const r = ctx.resolver.resolveForChat();
    expect(r.canUse).toBe(false);
    if (!r.canUse) expect(r.reason).toBe("local_provider_disabled");
  });

  it("denies local mode when no provider is configured", () => {
    ctx.settings.setMode("local");
    ctx.token.setValue(USER_LOCAL_AI_ENABLED, "true");
    const r = ctx.resolver.resolveForChat();
    expect(r.canUse).toBe(false);
    if (!r.canUse) expect(r.reason).toBe("local_provider_not_configured");
  });

  it("denies local mode when stored config is invalid", () => {
    ctx.settings.setMode("local");
    ctx.token.setValue(USER_LOCAL_AI_ENABLED, "true");
    // Structurally complete but baseUrl is an unsupported protocol, so the
    // resolver's re-validation rejects it as invalid (not "not configured").
    ctx.token.setValue(
      USER_LOCAL_AI_PROVIDER_CONFIG,
      JSON.stringify({
        preset: "ollama",
        name: "x",
        baseUrl: "ftp://x",
        defaultModel: "m",
      })
    );
    const r = ctx.resolver.resolveForChat();
    expect(r.canUse).toBe(false);
    if (!r.canUse) expect(r.reason).toBe("local_provider_invalid");
  });

  it("ensureHostedAIEnabled throws when hosted AI is disabled", () => {
    expect(() => ctx.resolver.ensureHostedAIEnabled()).toThrow(/not enabled/i);
  });

  it("ensureHostedAIEnabled passes when hosted AI is enabled", () => {
    ctx.token.setValue(USER_AI_ENABLED, "true");
    expect(() => ctx.resolver.ensureHostedAIEnabled()).not.toThrow();
  });
});

describe("AIProviderSettingsService secret redaction", () => {
  let ctx: ReturnType<typeof makeServices>;
  beforeEach(() => {
    ctx = makeServices();
  });

  it("stores the API key but never returns it in the settings view", () => {
    ctx.settings.saveLocalProvider({ ...validProvider, apiKey: "sk-secret" });
    const view = ctx.settings.getSettingsView();
    expect(view.localProvider).not.toBeNull();
    expect(view.localProvider?.apiKeyConfigured).toBe(true);
    // The plaintext key must not appear on the redacted config object.
    expect(JSON.stringify(view.localProvider).includes("sk-secret")).toBe(
      false
    );
  });

  it("marks apiKeyConfigured false after clearing the key", () => {
    ctx.settings.saveLocalProvider({ ...validProvider, apiKey: "sk-secret" });
    ctx.settings.clearApiKey();
    const view = ctx.settings.getSettingsView();
    expect(view.localProvider?.apiKeyConfigured).toBe(false);
  });

  it("clearLocalProvider disables local mode and drops config", () => {
    ctx.settings.setMode("local");
    ctx.settings.saveLocalProvider(validProvider);
    ctx.settings.clearLocalProvider();
    expect(ctx.settings.getLocalProviderConfig()).toBeNull();
    expect(ctx.settings.isLocalAIEnabled()).toBe(false);
  });

  it("flips USER_LOCAL_AI_ENABLED to true on first save (mode left to caller)", () => {
    ctx.settings.saveLocalProvider(validProvider);
    expect(ctx.token.getValue(USER_LOCAL_AI_ENABLED)).toBe("true");
    // saveLocalProvider must NOT change provider mode — the IPC Save handler
    // sets mode based on the UI selection. Raw stored value stays empty.
    expect(ctx.token.getValue(USER_AI_PROVIDER_MODE)).toBe("");
  });

  it("does not overwrite an existing key when save omits apiKey", () => {
    ctx.settings.saveLocalProvider({ ...validProvider, apiKey: "sk-secret" });
    // Re-save without apiKey and without clearApiKey → existing key retained.
    ctx.settings.saveLocalProvider(validProvider);
    const view = ctx.settings.getSettingsView();
    expect(view.localProvider?.apiKeyConfigured).toBe(true);
  });

  it("rejects an invalid config without storing anything", () => {
    expect(() =>
      ctx.settings.saveLocalProvider({ ...validProvider, baseUrl: "ftp://x" })
    ).toThrow();
    expect(ctx.settings.getLocalProviderConfig()).toBeNull();
  });

  it("ignores corrupt stored JSON instead of throwing", () => {
    ctx.token.setValue(USER_LOCAL_AI_PROVIDER_CONFIG, "{not json");
    expect(ctx.settings.getLocalProviderConfig()).toBeNull();
  });
});
