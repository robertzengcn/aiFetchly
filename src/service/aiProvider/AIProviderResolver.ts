import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import type {
  AIProviderMode,
  LocalAIProviderConfig,
} from "@/entityTypes/aiProviderTypes";
import { AIProviderSettingsService } from "./AIProviderSettingsService";
import { AIProviderSecretService } from "./AIProviderSecretService";
import {
  normalizeOpenAIBaseUrl,
  validateLocalProviderConfig,
} from "./AIProviderConfigValidator";

/** Successful resolution to the hosted aiFetchly provider. */
export interface ResolvedHostedChatProvider {
  readonly kind: "hosted";
  readonly canUse: true;
}

/** Successful resolution to a configured local/custom provider. */
export interface ResolvedLocalChatProvider {
  readonly kind: "local";
  readonly canUse: true;
  readonly config: LocalAIProviderConfig;
  /** Plaintext API key (empty string when none). Main-process use only. */
  readonly apiKey: string;
}

export type ResolvedChatProvider =
  | ResolvedHostedChatProvider
  | ResolvedLocalChatProvider;

export type ChatProviderDenialReason =
  | "hosted_subscription_required"
  | "local_provider_not_configured"
  | "local_provider_disabled"
  | "local_provider_invalid";

export interface ChatProviderDenial {
  readonly canUse: false;
  readonly reason: ChatProviderDenialReason;
  readonly message: string;
}

export type ChatProviderResolution = ResolvedChatProvider | ChatProviderDenial;

/**
 * Decides which provider AiChatV2 may use for a chat request, and why not.
 *
 * This is the chat-specific availability resolver. It is deliberately
 * SEPARATE from the hosted-only `USER_AI_ENABLED` gate so that local-provider
 * chat can work without a hosted subscription, while every hosted-cost feature
 * keeps its own `ensureHostedAIEnabled()` check.
 */
export class AIProviderResolver {
  constructor(
    private readonly token: Token = new Token(),
    private readonly settings: AIProviderSettingsService = new AIProviderSettingsService(),
    private readonly secrets: AIProviderSecretService = new AIProviderSecretService()
  ) {}

  /**
   * Worker-aware hosted entitlement check, mirroring `AiChatApi.ensureAIEnabled`:
   * in worker processes, read `WORKER_AI_ENABLED` env (Token is unavailable);
   * otherwise read `USER_AI_ENABLED` from encrypted storage.
   */
  isHostedAIEnabled(): boolean {
    if (process.env.WORKER_TYPE) {
      return process.env.WORKER_AI_ENABLED === "true";
    }
    return this.token.getValue(USER_AI_ENABLED) === "true";
  }

  /** Active provider mode (hosted | local). */
  getMode(): AIProviderMode {
    return this.settings.getMode();
  }

  /**
   * Resolve the chat provider for the current user. Never throws — returns a
   * structured denial the caller can surface to the UI.
   */
  resolveForChat(): ChatProviderResolution {
    const mode = this.settings.getMode();
    if (mode === "local") {
      return this.resolveLocal();
    }
    // Hosted mode (default).
    if (this.isHostedAIEnabled()) {
      return { kind: "hosted", canUse: true };
    }
    return {
      canUse: false,
      reason: "hosted_subscription_required",
      message:
        "Hosted aiFetchly AI requires a subscription. Configure a local AI provider or upgrade your plan to use AI Chat.",
    };
  }

  /**
   * Resolve the provider for model listing only. Unlike resolveForChat(), this
   * does NOT gate on hosted AI entitlement — users need to see available models
   * even without a subscription (e.g. to evaluate what's available, or to
   * configure a local provider). Local provider resolution remains the same.
   */
  resolveForModelList(): ChatProviderResolution {
    const mode = this.settings.getMode();
    if (mode === "local") {
      return this.resolveLocal();
    }
    // Hosted mode — model list is available without subscription.
    return { kind: "hosted", canUse: true };
  }

  private resolveLocal(): ChatProviderResolution {
    if (!this.settings.isLocalAIEnabled()) {
      return {
        canUse: false,
        reason: "local_provider_disabled",
        message:
          "Local AI provider is not enabled. Open System Settings -> AI Provider.",
      };
    }
    const config = this.settings.getLocalProviderConfig();
    if (!config) {
      return {
        canUse: false,
        reason: "local_provider_not_configured",
        message:
          "Local AI provider is not configured. Open System Settings -> AI Provider.",
      };
    }
    // Re-validate stored config defensively (corruption / manual edits).
    const result = validateLocalProviderConfig(
      {
        preset: config.preset,
        name: config.name,
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel,
      },
      this.secrets.hasApiKey()
    );
    if (!result.valid || !result.normalized) {
      return {
        canUse: false,
        reason: "local_provider_invalid",
        message:
          "Local AI provider configuration is invalid. Open System Settings -> AI Provider to fix it.",
      };
    }
    const normalizedConfig: LocalAIProviderConfig = {
      ...config,
      baseUrl: this.safeBaseUrl(result.normalized.baseUrl, config.baseUrl),
    };
    return {
      kind: "local",
      canUse: true,
      config: normalizedConfig,
      apiKey: this.secrets.getApiKey(),
    };
  }

  /** Keep baseUrl valid; fall back to the stored value if normalization throws. */
  private safeBaseUrl(normalized: string, fallback: string): string {
    try {
      return normalizeOpenAIBaseUrl(normalized) || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Throw when hosted AI is not enabled. Used by hosted-only handlers
   * (keyword generation, email templates, rerank, etc.) so they stay
   * subscription-gated regardless of local-provider configuration.
   */
  ensureHostedAIEnabled(): void {
    if (!this.isHostedAIEnabled()) {
      throw new Error(
        "AI features are not enabled. Please upgrade your plan to access AI features."
      );
    }
  }
}
