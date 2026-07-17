/**
 * Type definitions for the Local AI Provider feature.
 *
 * These types model a user-configured OpenAI-compatible chat provider
 * (Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI, or a custom
 * endpoint) that can power AiChatV2 independently of the hosted aiFetchly
 * AI subscription.
 *
 * Secret rule: the plaintext API key appears ONLY in `LocalAIProviderConfigInput`
 * (the save/test payload). Stored config (`LocalAIProviderConfig`) and every
 * renderer read expose only `apiKeyConfigured: boolean` — never the key itself.
 */

/** Which provider path AiChatV2 uses for completions. */
export type AIProviderMode = "hosted" | "local";

/** Stable identifiers for known OpenAI-compatible provider presets. */
export type LocalAIProviderPreset =
  | "ollama"
  | "lm_studio"
  | "openai"
  | "openrouter"
  | "vllm"
  | "localai"
  | "custom";

/** Tri/quad-state capability probe result. */
export type ProviderCapabilityStatus =
  | "supported"
  | "unsupported"
  | "unknown"
  | "failed";

/** Vision is probed less aggressively, so it omits the "failed" state. */
export type VisionCapabilityStatus = "supported" | "unsupported" | "unknown";

/** Capabilities discovered (or configured) for a local provider. */
export interface LocalAIProviderCapabilities {
  readonly modelsEndpoint: ProviderCapabilityStatus;
  readonly chat: ProviderCapabilityStatus;
  readonly streaming: ProviderCapabilityStatus;
  readonly tools: ProviderCapabilityStatus;
  readonly vision: VisionCapabilityStatus;
  readonly contextSize?: number;
}

/**
 * Stored local provider config. Persisted as JSON under
 * `USER_LOCAL_AI_PROVIDER_CONFIG`. Never contains the plaintext API key —
 * `apiKeyConfigured` reflects whether a key is stored separately.
 */
export interface LocalAIProviderConfig {
  readonly preset: LocalAIProviderPreset;
  readonly name: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly apiKeyConfigured: boolean;
  readonly contextSize?: number;
  readonly capabilities?: LocalAIProviderCapabilities;
  readonly lastTestedAt?: string;
  readonly lastTestStatus?: "passed" | "failed" | "partial" | "untested";
  readonly lastTestMessage?: string;
}

/**
 * Input payload used when saving or testing a provider. This is the ONLY
 * type that may carry the plaintext API key, and only transiently during an
 * IPC save/test request.
 */
export interface LocalAIProviderConfigInput {
  readonly preset: LocalAIProviderPreset;
  readonly name: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  /** Plaintext key, only when the user is entering/updating it. */
  readonly apiKey?: string;
  /** When true, the stored key is deleted regardless of `apiKey`. */
  readonly clearApiKey?: boolean;
  readonly contextSize?: number;
}

/** Redacted, renderer-safe snapshot of all provider settings. */
export interface AIProviderSettingsView {
  readonly mode: AIProviderMode;
  readonly hostedAIEnabled: boolean;
  readonly localAIEnabled: boolean;
  readonly localProvider: LocalAIProviderConfig | null;
}

/** Result of validating a provider config input. */
export interface AIProviderValidationResult {
  readonly valid: boolean;
  readonly normalized?: LocalAIProviderConfigInput;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Final capability/test outcome returned by the connection tester. */
export interface LocalAIProviderTestResult {
  readonly status: "passed" | "failed" | "partial";
  readonly message: string;
  readonly capabilities: LocalAIProviderCapabilities;
  readonly models?: readonly string[];
  readonly defaultModel?: string;
}

/** Request body for saving provider settings (mode + optional local config). */
export interface SaveAIProviderSettingsRequest {
  readonly mode: AIProviderMode;
  readonly localProvider?: LocalAIProviderConfigInput;
}

/** Request body for refreshing models from an (possibly unsaved) provider. */
export interface RefreshLocalAIModelsRequest {
  readonly provider: LocalAIProviderConfigInput;
}

/** Response for model refresh, including a warning when /models failed. */
export interface RefreshLocalAIModelsResponse {
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly object: string;
    readonly created: number;
    readonly owned_by: string;
    readonly context_size?: number;
  }>;
  readonly default_model?: string;
  readonly warning?: string;
}

/** Request body for running a connection test against a provider. */
export interface TestLocalAIProviderRequest {
  readonly provider: LocalAIProviderConfigInput;
}
