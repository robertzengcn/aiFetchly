import { Token } from "@/modules/token";
import {
  USER_AI_ENABLED,
  USER_AI_PROVIDER_MODE,
  USER_LOCAL_AI_ENABLED,
  USER_LOCAL_AI_PROVIDER_CONFIG,
} from "@/config/usersetting";
import type {
  AIProviderMode,
  AIProviderSettingsView,
  LocalAIProviderConfig,
  LocalAIProviderConfigInput,
} from "@/entityTypes/aiProviderTypes";
import { AIProviderSecretService } from "./AIProviderSecretService";
import { validateLocalProviderConfig } from "./AIProviderConfigValidator";

/**
 * Main-process service that owns provider settings persistence and the
 * redacted view handed to the renderer.
 *
 * Invariants:
 *  - The plaintext API key never enters `LocalAIProviderConfig` (stored JSON).
 *  - Renderer reads receive `apiKeyConfigured: boolean`, never the key.
 *  - `USER_LOCAL_AI_ENABLED` is derived from a successful local save.
 *
 * This class touches only `Token` (encrypted electron-store) — no Vue, IPC,
 * TypeORM, or renderer APIs. It is safe to construct in the main process and
 * unit-testable with a mocked `Token`.
 */
export class AIProviderSettingsService {
  constructor(
    private readonly token: Token = new Token(),
    private readonly secrets: AIProviderSecretService = new AIProviderSecretService()
  ) {}

  /** Active provider mode; defaults to "hosted" when unset/invalid. */
  getMode(): AIProviderMode {
    return this.token.getValue(USER_AI_PROVIDER_MODE) === "local"
      ? "local"
      : "hosted";
  }

  setMode(mode: AIProviderMode): void {
    this.token.setValue(USER_AI_PROVIDER_MODE, mode);
  }

  /** Hosted subscription entitlement flag (`USER_AI_ENABLED === "true"`). */
  isHostedAIEnabled(): boolean {
    return this.token.getValue(USER_AI_ENABLED) === "true";
  }

  /** Local provider availability flag. */
  isLocalAIEnabled(): boolean {
    return this.token.getValue(USER_LOCAL_AI_ENABLED) === "true";
  }

  /**
   * Stored local provider config with `apiKeyConfigured` reflecting the
   * secret store. Returns null when nothing is stored or the stored JSON
   * is corrupt (corruption does not throw — see design §26.3).
   */
  getLocalProviderConfig(): LocalAIProviderConfig | null {
    const raw = this.token.getValue(USER_LOCAL_AI_PROVIDER_CONFIG);
    if (!raw) {
      return null;
    }
    let parsed: Partial<LocalAIProviderConfig>;
    try {
      parsed = JSON.parse(raw) as Partial<LocalAIProviderConfig>;
    } catch {
      console.warn(
        "[ai-provider] stored local provider config is not valid JSON; ignoring"
      );
      return null;
    }
    if (
      typeof parsed.preset !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.defaultModel !== "string"
    ) {
      console.warn(
        "[ai-provider] stored local provider config is malformed; ignoring"
      );
      return null;
    }
    // Never trust a stored apiKeyConfigured — recompute from the secret store
    // and override it last so a stale value cannot leak through. The cast is
    // justified by the required-field checks above; remaining fields are
    // optional on LocalAIProviderConfig anyway.
    return {
      ...(parsed as LocalAIProviderConfig),
      apiKeyConfigured: this.secrets.hasApiKey(),
    };
  }

  /** Redacted, renderer-safe snapshot of all provider settings. */
  getSettingsView(): AIProviderSettingsView {
    return {
      mode: this.getMode(),
      hostedAIEnabled: this.isHostedAIEnabled(),
      localAIEnabled: this.isLocalAIEnabled(),
      localProvider: this.getLocalProviderConfig(),
    };
  }

  /**
   * Validate, normalize, and persist a local provider config. Manages the API
   * key (set/clear) and flips `USER_LOCAL_AI_ENABLED` to "true".
   *
   * @returns the redacted stored config (no plaintext key).
   * @throws Error whose message joins all validation errors.
   */
  saveLocalProvider(input: LocalAIProviderConfigInput): LocalAIProviderConfig {
    const result = validateLocalProviderConfig(input, this.secrets.hasApiKey());
    if (!result.valid || !result.normalized) {
      throw new Error(result.errors.join("; "));
    }
    const normalized = result.normalized;

    if (normalized.clearApiKey) {
      this.secrets.clearApiKey();
    } else if (typeof normalized.apiKey === "string") {
      this.secrets.setApiKey(normalized.apiKey);
    }

    const stored: Omit<LocalAIProviderConfig, "apiKeyConfigured"> = {
      preset: normalized.preset,
      name: normalized.name,
      baseUrl: normalized.baseUrl,
      defaultModel: normalized.defaultModel,
      ...(typeof normalized.contextSize === "number"
        ? { contextSize: normalized.contextSize }
        : {}),
    };
    this.token.setValue(USER_LOCAL_AI_PROVIDER_CONFIG, JSON.stringify(stored));
    this.token.setValue(USER_LOCAL_AI_ENABLED, "true");

    return {
      ...stored,
      apiKeyConfigured: this.secrets.hasApiKey(),
    };
  }

  /**
   * Remove the local provider config and key, and disable local mode
   * availability. Provider mode itself is left to the caller (Save handler).
   */
  clearLocalProvider(): void {
    this.token.deleteValue(USER_LOCAL_AI_PROVIDER_CONFIG);
    this.secrets.clearApiKey();
    this.token.setValue(USER_LOCAL_AI_ENABLED, "false");
  }

  /** Delete only the API key (config retained). */
  clearApiKey(): void {
    this.secrets.clearApiKey();
  }
}
