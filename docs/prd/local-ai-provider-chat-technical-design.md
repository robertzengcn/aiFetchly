# Local AI Provider For Chat - Technical Design

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-16 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/local-ai-provider-chat-prd.md` |
| Primary code paths | `src/api/aiChatApi.ts`, `src/main-process/communication/ai-chat-v2-ipc.ts`, `src/views/components/aiChatV2/AiChatV2.vue`, `src/views/pages/system/`, `src/config/usersetting.ts`, `src/modules/token.ts` |

## 1. Purpose

This document translates the Local AI Provider For Chat PRD into an implementation-facing design.

The feature lets AiChatV2 use either:

1. The existing hosted aiFetchly AI server.
2. A user-configured OpenAI-compatible provider such as Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI, or a custom endpoint.

The design keeps the existing chat engine contract intact:

```text
AIChatQueryEngine
  -> AIChatQueryLoop
  -> AiChatApi.openAIChatCompletionStream()
  -> OpenAI-compatible chunks
```

The core change is provider routing inside the API/service layer, plus settings and IPC support for managing a local provider.

## 2. Current Behavior To Preserve

### 2.1 Hosted AI Entitlement

`USER_AI_ENABLED` currently means the user may use hosted aiFetchly AI features.

That behavior must remain true for hosted-cost features:

- hosted chat provider
- keyword generation
- email template generation
- AI recovery APIs
- hosted rerank
- hosted embeddings
- any AI IPC handler not explicitly migrated to local provider routing

### 2.2 AiChatV2 Internal Contract

AiChatV2 already uses OpenAI-compatible request and response types from `src/api/aiChatApi.ts`:

```typescript
export interface OpenAIChatCompletionRequest {
  messages: OpenAIChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  stop?: string | string[];
  user?: string;
}
```

This contract should not be replaced.

### 2.3 Query Engine And Query Loop Boundaries

The provider feature must not push provider-specific logic into:

- `AIChatQueryEngine`
- `AIChatQueryLoop`
- tool execution services
- renderer message rendering

Those layers should continue to ask for OpenAI-compatible completions and receive OpenAI-compatible chunks.

### 2.4 IPC Architecture

IPC handlers remain communication boundaries:

- validate input
- check access policy
- call modules/services
- sanitize output

IPC handlers must not store database records directly or expose provider secrets.

### 2.5 Worker And Database Rules

No worker process should directly access database state for this feature. The first release does not require new worker processes.

Provider settings can use `Token` for encrypted settings. If later persisted in SQLite, writes must go through Model/Module layers.

## 3. Design Overview

Add these new service/module files:

```text
src/entityTypes/aiProviderTypes.ts
src/service/aiProvider/AIProviderPresets.ts
src/service/aiProvider/AIProviderConfigValidator.ts
src/service/aiProvider/AIProviderSecretService.ts
src/service/aiProvider/AIProviderSettingsService.ts
src/service/aiProvider/AIProviderResolver.ts
src/service/aiProvider/ChatProviderClient.ts
src/service/aiProvider/HostedAIProviderClient.ts
src/service/aiProvider/OpenAICompatibleProviderClient.ts
src/service/aiProvider/OpenAIModelNormalizer.ts
src/service/aiProvider/OpenAIStreamParser.ts
src/service/aiProvider/AIProviderConnectionTester.ts
src/main-process/communication/ai-provider-ipc.ts
src/views/api/aiProvider.ts
```

Update these existing files:

```text
src/config/usersetting.ts
src/api/aiChatApi.ts
src/main-process/communication/ai-chat-v2-ipc.ts
src/main-process/communication/index.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2ModelSelector.vue
src/views/lang/{en,zh,es,fr,de,ja}.ts
```

High-level flow:

```text
Renderer System Settings
  -> views/api/aiProvider.ts
  -> AI_PROVIDER_* IPC
  -> AIProviderSettingsService
  -> Token encrypted storage

Renderer AiChatV2
  -> AI_CHAT_V2_STREAM IPC
  -> chat availability resolver
  -> AIChatQueryEngine
  -> AIChatQueryLoop
  -> AiChatApi
  -> AIProviderResolver
  -> HostedAIProviderClient OR OpenAICompatibleProviderClient
```

## 4. Settings And Type System

### 4.1 User Setting Constants

File: `src/config/usersetting.ts`

Add:

```typescript
export const USER_LOCAL_AI_ENABLED = "user_local_ai_enabled";
export const USER_AI_PROVIDER_MODE = "user_ai_provider_mode";
export const USER_LOCAL_AI_PROVIDER_CONFIG = "user_local_ai_provider_config";
export const USER_LOCAL_AI_PROVIDER_API_KEY = "user_local_ai_provider_api_key";
```

Default behavior:

```text
USER_AI_PROVIDER_MODE = "hosted"
USER_LOCAL_AI_ENABLED = "false"
```

### 4.2 Entity Types

File: `src/entityTypes/aiProviderTypes.ts`

```typescript
export type AIProviderMode = "hosted" | "local";

export type LocalAIProviderPreset =
  | "ollama"
  | "lm_studio"
  | "openai"
  | "openrouter"
  | "vllm"
  | "localai"
  | "custom";

export type ProviderCapabilityStatus =
  | "supported"
  | "unsupported"
  | "unknown"
  | "failed";

export interface LocalAIProviderCapabilities {
  readonly modelsEndpoint: ProviderCapabilityStatus;
  readonly chat: ProviderCapabilityStatus;
  readonly streaming: ProviderCapabilityStatus;
  readonly tools: ProviderCapabilityStatus;
  readonly vision: "supported" | "unsupported" | "unknown";
  readonly contextSize?: number;
}

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

export interface LocalAIProviderConfigInput {
  readonly preset: LocalAIProviderPreset;
  readonly name: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly apiKey?: string;
  readonly clearApiKey?: boolean;
  readonly contextSize?: number;
}

export interface AIProviderSettingsView {
  readonly mode: AIProviderMode;
  readonly hostedAIEnabled: boolean;
  readonly localAIEnabled: boolean;
  readonly localProvider: LocalAIProviderConfig | null;
}

export interface AIProviderValidationResult {
  readonly valid: boolean;
  readonly normalized?: LocalAIProviderConfigInput;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface LocalAIProviderTestResult {
  readonly status: "passed" | "failed" | "partial";
  readonly message: string;
  readonly capabilities: LocalAIProviderCapabilities;
  readonly models?: readonly string[];
  readonly defaultModel?: string;
}
```

Rules:

- Plaintext API key appears only in `LocalAIProviderConfigInput`.
- Plaintext API key never appears in `LocalAIProviderConfig`.
- Renderer reads receive `apiKeyConfigured`, not the secret.

## 5. Provider Presets

File: `src/service/aiProvider/AIProviderPresets.ts`

```typescript
export interface AIProviderPresetDefinition {
  readonly preset: LocalAIProviderPreset;
  readonly displayName: string;
  readonly defaultBaseUrl: string;
  readonly apiKeyRecommended: boolean;
  readonly defaultName: string;
}

export const AI_PROVIDER_PRESETS: readonly AIProviderPresetDefinition[] = [
  {
    preset: "ollama",
    displayName: "Ollama",
    defaultName: "Ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "lm_studio",
    displayName: "LM Studio",
    defaultName: "LM Studio",
    defaultBaseUrl: "http://localhost:1234/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "openai",
    displayName: "OpenAI",
    defaultName: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyRecommended: true,
  },
  {
    preset: "openrouter",
    displayName: "OpenRouter",
    defaultName: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKeyRecommended: true,
  },
  {
    preset: "vllm",
    displayName: "vLLM",
    defaultName: "vLLM",
    defaultBaseUrl: "http://localhost:8000/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "localai",
    displayName: "LocalAI",
    defaultName: "LocalAI",
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKeyRecommended: false,
  },
  {
    preset: "custom",
    displayName: "Custom",
    defaultName: "Custom Provider",
    defaultBaseUrl: "",
    apiKeyRecommended: false,
  },
];
```

The UI can localize display labels separately. The preset ids must remain stable.

## 6. Validation And URL Normalization

File: `src/service/aiProvider/AIProviderConfigValidator.ts`

### 6.1 Base URL Normalization

Rules:

1. Trim whitespace.
2. Require `http:` or `https:`.
3. Remove trailing slash.
4. If path does not end with `/v1`, append `/v1`.
5. Keep existing path prefixes before `/v1`.

Examples:

| Input | Output |
| --- | --- |
| `http://localhost:11434` | `http://localhost:11434/v1` |
| `http://localhost:11434/` | `http://localhost:11434/v1` |
| `http://localhost:11434/v1/` | `http://localhost:11434/v1` |
| `https://api.openai.com/v1` | `https://api.openai.com/v1` |
| `https://proxy.example.com/openai` | `https://proxy.example.com/openai/v1` |

Implementation sketch:

```typescript
export function normalizeOpenAIBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Provider URL must use http or https.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (!parsed.pathname.endsWith("/v1")) {
    parsed.pathname = `${parsed.pathname || ""}/v1`;
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}
```

### 6.2 Config Validation

Required:

- `preset` is known.
- `name.trim().length > 0`.
- `defaultModel.trim().length > 0`.
- `baseUrl` normalizes successfully.

Warnings:

- OpenAI/OpenRouter preset with no API key configured.
- `http:` with non-localhost host.
- context size less than or equal to 0.

Validation returns structured errors and warnings. IPC handlers should not throw raw validation errors to renderer.

## 7. Secret Storage

File: `src/service/aiProvider/AIProviderSecretService.ts`

Use `Token` because the project already stores encrypted values through `Token.setValue()`.

```typescript
export class AIProviderSecretService {
  constructor(private readonly token = new Token()) {}

  getApiKey(): string {
    return this.token.getValue(USER_LOCAL_AI_PROVIDER_API_KEY);
  }

  setApiKey(value: string): void {
    this.token.setValue(USER_LOCAL_AI_PROVIDER_API_KEY, value);
  }

  clearApiKey(): void {
    this.token.setValue(USER_LOCAL_AI_PROVIDER_API_KEY, "");
  }

  hasApiKey(): boolean {
    return this.getApiKey().trim().length > 0;
  }
}
```

Important note:

`Token.getValue()` currently returns empty string for missing values. If `Token.setValue(key, "")` is not a reliable delete operation, add an explicit delete method to `ElectronStoreService` or use a sentinel-free deletion helper. Do not leave stale API keys after "Clear API key".

## 8. Provider Settings Service

File: `src/service/aiProvider/AIProviderSettingsService.ts`

Responsibilities:

- Read provider mode.
- Read hosted/local availability.
- Save local provider config.
- Redact secrets.
- Clear API key.
- Build settings view for renderer.

```typescript
export class AIProviderSettingsService {
  constructor(
    private readonly token = new Token(),
    private readonly secrets = new AIProviderSecretService(token),
    private readonly validator = new AIProviderConfigValidator()
  ) {}

  getMode(): AIProviderMode {
    const raw = this.token.getValue(USER_AI_PROVIDER_MODE);
    return raw === "local" ? "local" : "hosted";
  }

  setMode(mode: AIProviderMode): void {
    this.token.setValue(USER_AI_PROVIDER_MODE, mode);
  }

  getSettingsView(): AIProviderSettingsView {
    return {
      mode: this.getMode(),
      hostedAIEnabled: this.token.getValue(USER_AI_ENABLED) === "true",
      localAIEnabled: this.token.getValue(USER_LOCAL_AI_ENABLED) === "true",
      localProvider: this.getLocalProviderConfig(),
    };
  }

  getLocalProviderConfig(): LocalAIProviderConfig | null {
    const raw = this.token.getValue(USER_LOCAL_AI_PROVIDER_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalAIProviderConfig;
    return {
      ...parsed,
      apiKeyConfigured: this.secrets.hasApiKey(),
    };
  }

  saveLocalProvider(input: LocalAIProviderConfigInput): LocalAIProviderConfig {
    const result = this.validator.validate(input, {
      apiKeyConfigured: this.secrets.hasApiKey(),
    });
    if (!result.valid || !result.normalized) {
      throw new Error(result.errors.join("; "));
    }
    if (input.clearApiKey) {
      this.secrets.clearApiKey();
    } else if (typeof input.apiKey === "string") {
      this.secrets.setApiKey(input.apiKey);
    }
    const config = this.toStoredConfig(result.normalized);
    this.token.setValue(USER_LOCAL_AI_PROVIDER_CONFIG, JSON.stringify(config));
    this.token.setValue(USER_LOCAL_AI_ENABLED, "true");
    return {
      ...config,
      apiKeyConfigured: this.secrets.hasApiKey(),
    };
  }
}
```

Do not import Vue, IPC, TypeORM, or renderer APIs in this service.

## 9. Chat Availability Resolver

File: `src/service/aiProvider/AIProviderResolver.ts`

### 9.1 Resolver Result

```typescript
export type ResolvedChatProvider =
  | {
      readonly kind: "hosted";
      readonly canUse: true;
    }
  | {
      readonly kind: "local";
      readonly canUse: true;
      readonly config: LocalAIProviderConfig;
      readonly apiKey: string;
    };

export interface ChatProviderDenial {
  readonly canUse: false;
  readonly reason:
    | "hosted_subscription_required"
    | "local_provider_not_configured"
    | "local_provider_disabled"
    | "local_provider_invalid";
  readonly message: string;
}
```

### 9.2 Resolver Behavior

```typescript
resolveForChat(): ResolvedChatProvider | ChatProviderDenial
```

Hosted mode:

- If `USER_AI_ENABLED === "true"`, return hosted.
- Else return hosted subscription denial.

Local mode:

- If `USER_LOCAL_AI_ENABLED !== "true"`, return local disabled denial.
- If config is missing, return local provider not configured.
- If config is invalid, return local provider invalid.
- Else return local config plus API key from secret service.

### 9.3 Hosted-Only Resolver

Also expose:

```typescript
ensureHostedAIEnabled(): void
```

This keeps hosted-only handlers explicit and avoids accidental use of local provider access in hosted-cost features.

## 10. Provider Client Interface

File: `src/service/aiProvider/ChatProviderClient.ts`

```typescript
export interface OpenAIChatCompletionStreamOptions {
  readonly signal?: AbortSignal;
  readonly onRetry?: (info: StreamRetryInfo) => void;
  readonly retryProfile?: AIChatRecoveryProfile;
  readonly onRecoveryStatus?: (info: StreamRecoveryInfo) => void;
}

export interface ChatProviderClient {
  listModels(): Promise<OpenAIModelsResponse>;

  complete(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse>;

  stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void>;
}
```

The interface returns existing OpenAI-compatible types.

## 11. Hosted Provider Client

File: `src/service/aiProvider/HostedAIProviderClient.ts`

Responsibilities:

- Preserve current aiFetchly hosted behavior.
- Use existing `HttpClient`.
- Keep hosted retry and fallback behavior.
- Normalize hosted model list.

Methods:

```typescript
export class HostedAIProviderClient implements ChatProviderClient {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly normalizer: OpenAIModelNormalizer
  ) {}

  async listModels(): Promise<OpenAIModelsResponse> {
    try {
      const raw = await this.httpClient.get("/api/ai/v1/models");
      return this.normalizer.normalizeHostedModelsResponse(raw);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const legacy = await this.httpClient.get("/api/ai/chat/models");
      return this.normalizer.normalizeLegacyHostedModelsResponse(legacy);
    }
  }

  async complete(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    return this.httpClient.postJson(
      "/api/ai/v1/chat/completions",
      buildNonStreamingPayload(request)
    );
  }

  async stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void> {
    // Keep current retry and legacy fallback behavior from AiChatApi.
  }
}
```

Implementation note:

The existing retry logic in `AiChatApi.openAIChatCompletionStream()` is substantial. Move it carefully into this hosted client or keep it in `AiChatApi` initially and let hosted client call a shared helper. Avoid duplicating retry logic.

## 12. OpenAI-Compatible Provider Client

File: `src/service/aiProvider/OpenAICompatibleProviderClient.ts`

### 12.1 Constructor

```typescript
export class OpenAICompatibleProviderClient implements ChatProviderClient {
  constructor(
    private readonly config: LocalAIProviderConfig,
    private readonly apiKey: string,
    private readonly normalizer = new OpenAIModelNormalizer(),
    private readonly streamParser = new OpenAIStreamParser(),
    private readonly fetchImpl: typeof fetch = fetch
  ) {}
}
```

### 12.2 URL Builder

```typescript
private url(path: "/models" | "/chat/completions"): string {
  return `${this.config.baseUrl}${path}`;
}
```

`config.baseUrl` is already normalized to end in `/v1`.

### 12.3 Headers

```typescript
private jsonHeaders(accept: "application/json" | "text/event-stream"): HeadersInit {
  const headers: Record<string, string> = {
    Accept: accept,
    "Content-Type": "application/json",
  };
  if (this.apiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${this.apiKey}`;
  }
  return headers;
}
```

Never log `headers.Authorization`.

### 12.4 Model Listing

```typescript
async listModels(): Promise<OpenAIModelsResponse> {
  try {
    const res = await this.fetchImpl(this.url("/models"), {
      method: "GET",
      headers: this.jsonHeaders("application/json"),
    });
    if (!res.ok) {
      throw await this.toProviderError(res);
    }
    const raw = await res.json();
    return this.normalizer.normalizeOpenAIModelsResponse(raw, {
      defaultModel: this.config.defaultModel,
      providerName: this.config.name,
      contextSize: this.config.contextSize,
    });
  } catch (error) {
    return this.normalizer.buildSyntheticModelList({
      model: this.config.defaultModel,
      providerName: this.config.name,
      contextSize: this.config.contextSize,
      warning: error instanceof Error ? error.message : String(error),
    });
  }
}
```

The fallback is intentional. Local providers often have weak `/models` support.

### 12.5 Non-Streaming Completion

```typescript
async complete(
  request: OpenAIChatCompletionRequest
): Promise<OpenAIChatCompletionResponse> {
  const payload = buildNonStreamingPayload({
    ...request,
    model: request.model ?? this.config.defaultModel,
  });
  const res = await this.fetchImpl(this.url("/chat/completions"), {
    method: "POST",
    headers: this.jsonHeaders("application/json"),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await this.toProviderError(res);
  }
  return (await res.json()) as OpenAIChatCompletionResponse;
}
```

### 12.6 Streaming Completion

```typescript
async stream(
  request: OpenAIChatCompletionRequest,
  onChunk: (chunk: OpenAIChatCompletionChunk) => void,
  options?: OpenAIChatCompletionStreamOptions
): Promise<void> {
  const payload = buildStreamingPayload({
    ...request,
    model: request.model ?? this.config.defaultModel,
  });
  const res = await this.fetchImpl(this.url("/chat/completions"), {
    method: "POST",
    headers: this.jsonHeaders("text/event-stream"),
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
  if (!res.ok) {
    throw await this.toProviderError(res);
  }
  if (!res.body) {
    throw new Error("Provider response body is null.");
  }
  await this.streamParser.consume(res, onChunk, options?.signal);
}
```

Local provider stream should use short retry behavior only. Do not apply hosted persistent retry policy by default to local providers.

## 13. Request Payload Builders

File: `src/service/aiProvider/OpenAIRequestPayload.ts`

Add two pure helpers:

```typescript
export function buildNonStreamingPayload(
  request: OpenAIChatCompletionRequest
): OpenAIChatCompletionRequest {
  return buildOpenAIPayload(request, false);
}

export function buildStreamingPayload(
  request: OpenAIChatCompletionRequest
): OpenAIChatCompletionRequest {
  return {
    ...buildOpenAIPayload(request, true),
    stream_options: { include_usage: true },
  };
}
```

Rules:

- Copy only known request fields.
- Do not pass `undefined` values.
- Include `tools` only when non-empty.
- Include `tool_choice` only when provided.
- Use default model when request model is missing.

This avoids duplicating field-copy logic between hosted and local clients.

## 14. Model Normalization

File: `src/service/aiProvider/OpenAIModelNormalizer.ts`

### 14.1 Hosted Response Normalization

Input:

```json
{
  "models": [
    {
      "name": "gpt-4.1",
      "available": true,
      "max_tokens": 4096,
      "context_size": 128000,
      "description": "Hosted model",
      "is_free": false
    }
  ],
  "default_model": "gpt-4.1",
  "total_count": 1
}
```

Output:

```typescript
{
  object: "list",
  data: [
    {
      id: "gpt-4.1",
      object: "model",
      created: 0,
      owned_by: "ai-server",
      context_size: 128000,
      max_tokens: 4096,
      is_free: false,
    },
  ],
  default_model: "gpt-4.1",
}
```

### 14.2 OpenAI Response Normalization

Input:

```json
{
  "object": "list",
  "data": [
    {
      "id": "llama3.1",
      "object": "model",
      "created": 0,
      "owned_by": "ollama"
    }
  ]
}
```

Output:

```typescript
{
  object: "list",
  data: [
    {
      id: "llama3.1",
      object: "model",
      created: 0,
      owned_by: "ollama",
    },
  ],
  default_model: "llama3.1",
}
```

If configured default model is not present, insert it at the top.

### 14.3 Synthetic Model List

When local `/models` fails:

```typescript
buildSyntheticModelList({
  model: "llama3.1",
  providerName: "Ollama",
  contextSize: 8192,
})
```

Output:

```typescript
{
  object: "list",
  data: [
    {
      id: "llama3.1",
      object: "model",
      created: 0,
      owned_by: "Ollama",
      context_size: 8192,
    },
  ],
  default_model: "llama3.1",
}
```

## 15. Stream Parser

File: `src/service/aiProvider/OpenAIStreamParser.ts`

### 15.1 Supported Wire Formats

Support:

```text
data: {"id":"...","choices":[{"delta":{"content":"hi"}}]}

data: [DONE]
```

Also tolerate:

- multiple SSE messages in one read
- blank lines between events
- `event:` lines before `data:`
- final chunk with `usage`
- chunks with `choices: []` and usage only

### 15.2 Parser Contract

```typescript
export class OpenAIStreamParser {
  async consume(
    response: Response,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {}
}
```

### 15.3 Parser Algorithm

```text
read bytes
decode with TextDecoder stream mode
append to buffer
split by newline
for each complete line:
  trim right
  if blank:
    flush current SSE data buffer
  if starts with "data:":
    append payload to current data buffer
  if starts with "event:":
    store event name but do not require it
after loop:
  flush trailing data buffer
release reader lock
```

For each data payload:

- If payload is `[DONE]`, stop parsing.
- Else parse JSON.
- Validate it has OpenAI chunk shape enough for downstream.
- Invoke `onChunk(chunk)`.

Do not throw for empty keepalive lines.

### 15.4 Abort Behavior

If `signal.aborted`, reject with `DOMException("The operation was aborted.", "AbortError")`.

If `reader.read()` throws abort, rethrow abort. Existing chat cancellation depends on abort semantics.

## 16. Provider Connection Tester

File: `src/service/aiProvider/AIProviderConnectionTester.ts`

### 16.1 Test Steps

```text
1. validate config
2. try GET /models
3. try POST /chat/completions with stream false
4. try POST /chat/completions with stream true
5. optionally probe tool calling
6. return capabilities and message
```

### 16.2 Timeouts

Use `AbortController` for timeouts:

- model list timeout: 10 seconds
- chat timeout: 20 seconds
- stream timeout: 20 seconds

### 16.3 Test Chat Payload

```json
{
  "model": "<configured model>",
  "messages": [
    { "role": "user", "content": "Reply with exactly: pong" }
  ],
  "temperature": 0,
  "max_tokens": 8,
  "stream": false
}
```

Any valid completion means chat is supported. Do not require exact "pong".

### 16.4 Tool Probe Payload

Only run if user enables tool probing or if product accepts the extra request.

```json
{
  "model": "<configured model>",
  "messages": [
    { "role": "user", "content": "Call the provided tool." }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "ping_tool",
        "description": "Return pong.",
        "parameters": {
          "type": "object",
          "properties": {},
          "additionalProperties": false
        }
      }
    }
  ],
  "tool_choice": {
    "type": "function",
    "function": { "name": "ping_tool" }
  },
  "max_tokens": 16,
  "stream": false
}
```

If response includes `choices[0].message.tool_calls`, mark tools supported.

If it returns 400 with unsupported tools wording, mark tools unsupported.

If unclear, mark tools unknown.

## 17. AiChatApi Changes

File: `src/api/aiChatApi.ts`

### 17.1 Current Problem

`AiChatApi` currently owns three separate concerns:

1. Hosted aiFetchly API transport.
2. OpenAI-compatible request formatting.
3. Streaming retry and parsing behavior.

The provider feature should keep public method signatures but delegate provider-specific work.

### 17.2 New Dependencies

```typescript
private readonly providerResolver = new AIProviderResolver();
```

Avoid constructing provider clients as long-lived singletons because provider settings may change while the app is open.

### 17.3 listOpenAIModels

Replace direct hosted API call with provider routing:

```typescript
async listOpenAIModels(): Promise<OpenAIModelsResponse> {
  const provider = this.providerResolver.resolveForChat();
  if (!provider.canUse) {
    throw new Error(provider.message);
  }
  return this.clientFor(provider).listModels();
}
```

### 17.4 openAIChatCompletion

```typescript
async openAIChatCompletion(
  request: OpenAIChatCompletionRequest
): Promise<OpenAIChatCompletionResponse> {
  const provider = this.providerResolver.resolveForChat();
  if (!provider.canUse) {
    throw new Error(provider.message);
  }
  return this.clientFor(provider).complete(request);
}
```

### 17.5 openAIChatCompletionStream

```typescript
async openAIChatCompletionStream(
  request: OpenAIChatCompletionRequest,
  onChunk: (chunk: OpenAIChatCompletionChunk) => void,
  options?: OpenAIChatCompletionStreamOptions
): Promise<void> {
  const provider = this.providerResolver.resolveForChat();
  if (!provider.canUse) {
    throw new Error(provider.message);
  }
  return this.clientFor(provider).stream(request, onChunk, options);
}
```

### 17.6 Hosted-Only Methods

Keep these methods hosted-only unless separately migrated:

- `sendMessage`
- `streamMessage`
- `streamEmailTemplateGeneration`
- `generateWebsiteAnalysis`
- `recoverPuppeteerAction`
- `rerank`
- batch keyword generation methods

They should continue to call `ensureAIEnabled()`.

### 17.7 Naming Adjustment

Rename private `ensureAIEnabled()` to `ensureHostedAIEnabled()` if feasible. If not, add a new method and leave the old method for hosted-only paths:

```typescript
private ensureHostedAIEnabled(): void {}
private ensureChatAIAvailable(): void {}
```

Do not use `ensureChatAIAvailable()` in hosted-only methods.

## 18. AiChatV2 IPC Changes

File: `src/main-process/communication/ai-chat-v2-ipc.ts`

### 18.1 Current Gate

The current stream handler checks `USER_AI_ENABLED` before parsing request data.

For this feature, `AI_CHAT_V2_STREAM` needs a chat-specific gate. However, the handler still must avoid unnecessary work when AI is unavailable.

### 18.2 Proposed Gate

```typescript
function resolveChatAIAccess(): { ok: true } | { ok: false; message: string } {
  const resolver = new AIProviderResolver();
  const provider = resolver.resolveForChat();
  if (provider.canUse) return { ok: true };
  return { ok: false, message: provider.message };
}
```

Usage:

```typescript
async function handleStream(event: IpcEventLike, data: string): Promise<void> {
  const access = resolveChatAIAccess();
  if (!access.ok) {
    sendComplete(event, {
      eventType: "error",
      conversationId: "",
      errorMessage: access.message,
    });
    return;
  }

  let req: ChatV2StreamRequest;
  // parse only after access gate
}
```

This preserves the "check first" rule while allowing local provider chat.

### 18.3 Other Handlers

Review each handler in `ai-chat-v2-ipc.ts`:

- `AI_CHAT_V2_STREAM`: use chat provider resolver.
- `AI_CHAT_V2_MODELS`: use chat provider resolver because model selector depends on active provider.
- Plan approval/question handlers: no direct LLM call, keep existing validation.
- Compact conversation: calls `openAIChatCompletion`, so use chat resolver.
- Resume tool after permission: continues the active chat/tool loop, so use chat resolver.

Hosted-only handlers outside Chat V2 remain unchanged.

## 19. AI Provider IPC

File: `src/main-process/communication/ai-provider-ipc.ts`

### 19.1 Channels

Add channel constants in `src/config/channellist.ts`:

```typescript
export const AI_PROVIDER_SETTINGS_GET = "ai-provider:settings:get";
export const AI_PROVIDER_SETTINGS_SAVE = "ai-provider:settings:save";
export const AI_PROVIDER_MODE_SET = "ai-provider:mode:set";
export const AI_PROVIDER_MODE_GET = "ai-provider:mode:get";
export const AI_PROVIDER_MODELS_REFRESH = "ai-provider:models:refresh";
export const AI_PROVIDER_CONNECTION_TEST = "ai-provider:connection:test";
export const AI_PROVIDER_API_KEY_CLEAR = "ai-provider:api-key:clear";
```

### 19.2 Handler Responsibilities

Handlers should call `AIProviderSettingsService` and `AIProviderConnectionTester`.

Example:

```typescript
ipcMain.handle(AI_PROVIDER_SETTINGS_GET, async () => {
  try {
    const service = new AIProviderSettingsService();
    return ok(service.getSettingsView());
  } catch (error) {
    return denied(error instanceof Error ? error.message : String(error));
  }
});
```

### 19.3 Save Handler

Input:

```typescript
interface SaveAIProviderSettingsRequest {
  readonly mode: AIProviderMode;
  readonly localProvider?: LocalAIProviderConfigInput;
}
```

Rules:

- If mode is hosted, save mode only.
- If mode is local, validate and save local provider.
- Return redacted settings view.

### 19.4 Refresh Models Handler

Input may use unsaved form values:

```typescript
interface RefreshLocalAIModelsRequest {
  readonly provider: LocalAIProviderConfigInput;
}
```

This allows users to test a URL before saving.

Output:

```typescript
interface RefreshLocalAIModelsResponse {
  readonly models: OpenAIModelsResponse;
  readonly warning?: string;
}
```

### 19.5 Test Connection Handler

Input:

```typescript
interface TestLocalAIProviderRequest {
  readonly provider: LocalAIProviderConfigInput;
}
```

Output:

```typescript
LocalAIProviderTestResult
```

Do not persist test results unless the caller explicitly saves settings after the test.

## 20. Renderer API

File: `src/views/api/aiProvider.ts`

Add typed wrappers:

```typescript
export async function getAIProviderSettings(): Promise<AIProviderSettingsView> {}
export async function saveAIProviderSettings(
  request: SaveAIProviderSettingsRequest
): Promise<AIProviderSettingsView> {}
export async function refreshLocalAIModels(
  request: RefreshLocalAIModelsRequest
): Promise<RefreshLocalAIModelsResponse> {}
export async function testLocalAIProvider(
  request: TestLocalAIProviderRequest
): Promise<LocalAIProviderTestResult> {}
export async function clearLocalAIProviderApiKey(): Promise<AIProviderSettingsView> {}
```

Use `windowInvoke` only. Do not call provider URLs from renderer.

## 21. System Settings UI

The exact settings page file should follow the existing system settings structure under `src/views/pages/system/`.

Recommended component split:

```text
src/views/components/settings/AIProviderSettingsPanel.vue
src/views/components/settings/AIProviderPresetSelect.vue
src/views/components/settings/AIProviderCapabilityBadges.vue
```

If this repo already colocates system settings components inside `pages/system`, follow the local pattern instead.

### 21.1 AIProviderSettingsPanel State

State:

```typescript
const mode = ref<AIProviderMode>("hosted");
const preset = ref<LocalAIProviderPreset>("ollama");
const name = ref("");
const baseUrl = ref("");
const apiKey = ref("");
const defaultModel = ref("");
const contextSize = ref<number | null>(null);
const models = ref<OpenAIModel[]>([]);
const testing = ref(false);
const refreshingModels = ref(false);
const capabilities = ref<LocalAIProviderCapabilities | null>(null);
```

Never initialize `apiKey` from stored value. Stored reads should set only `apiKeyConfigured`.

### 21.2 Controls

Use:

- segmented control or radio group for provider mode
- select for preset
- text field for name
- text field for base URL
- password field for API key
- combobox for model
- number input for optional context size
- Refresh Models button
- Test Connection button
- Save button
- Clear API key button

### 21.3 Validation

Perform light client validation before calling IPC:

- required fields
- URL shape
- model required

Server-side validation remains authoritative.

### 21.4 User-Facing Copy

Add i18n keys under a new namespace:

```text
aiProvider.title
aiProvider.modeHosted
aiProvider.modeLocal
aiProvider.hostedRequiresSubscription
aiProvider.localProviderDescription
aiProvider.providerPreset
aiProvider.providerName
aiProvider.baseUrl
aiProvider.apiKey
aiProvider.apiKeyConfigured
aiProvider.defaultModel
aiProvider.refreshModels
aiProvider.testConnection
aiProvider.connectionPassed
aiProvider.connectionFailed
aiProvider.partialConnection
aiProvider.modelsEndpoint
aiProvider.chatCapability
aiProvider.streamingCapability
aiProvider.toolsCapability
aiProvider.visionCapability
aiProvider.clearApiKey
aiProvider.save
aiProvider.saved
```

Update:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

## 22. AiChatV2 UI Integration

### 22.1 Provider Indicator

Add provider settings load on mount:

```typescript
const providerSettings = ref<AIProviderSettingsView | null>(null);
```

Show a compact indicator near model selector:

```text
Hosted
Local: Ollama
Local offline
```

Click behavior:

- If route exists, open System Settings -> AI Provider.
- Else show settings dialog or no-op for MVP.

### 22.2 Model List

`getOpenAIChatModels()` already calls the `AI_CHAT_V2_MODELS` channel. Once that channel routes to active provider, the model selector can keep using the same API.

Local mode fallback:

- If `listOpenAIModels()` returns synthetic configured model, show it normally.
- If no model can be resolved, disable send and show config warning.

### 22.3 Tool Capability

When local provider tools are unsupported:

- disable auto tool approval modes
- default to `ask_for_approval`
- optionally hide tool-required modes
- show warning before sending a message with tools

Implementation point:

`AIChatQueryLoop` currently sends `tools` when skills are available. The loop can receive a provider capability object from the provider resolver or from request context. For MVP, the safer path is to block tool-required local chat if tools are unsupported before entering the loop.

## 23. Tool Calling Strategy

### 23.1 MVP Safe Behavior

Local provider modes:

- `tools: supported`: allow existing tool flow.
- `tools: unsupported`: send chat without tools only if mode is plain chat and no tool-required behavior is active.
- `tools: unknown`: warn and default to no tools unless user explicitly enables experimental tool use.

### 23.2 Query Loop Option

Add to query loop context:

```typescript
interface AIChatProviderRuntimeCapabilities {
  readonly providerKind: "hosted" | "local";
  readonly tools: ProviderCapabilityStatus;
  readonly streaming: ProviderCapabilityStatus;
  readonly vision: "supported" | "unsupported" | "unknown";
}
```

The context assembler or loop can use this to decide whether to include tools.

### 23.3 Error Feedback

If user asks for a tool-required workflow with unsupported local tools:

```text
The selected local provider does not support tool calling. Switch to a tool-capable model or hosted aiFetchly AI.
```

This should appear as a chat stream error, not as a silent no-op.

## 24. Security Design

### 24.1 Secret Boundaries

Plaintext local provider API key may exist only in:

- settings form input before save
- IPC request payload during save/test
- main process memory while making provider requests
- encrypted `Token` storage after save

Plaintext API key must not appear in:

- stored provider config JSON
- renderer settings reads
- logs
- diagnostics export
- chat messages
- exception strings

### 24.2 Logging Redaction

Update debug helpers to redact:

- `Authorization`
- `apiKey`
- `api_key`
- `USER_LOCAL_AI_PROVIDER_API_KEY`

Provider request debug logs should show:

```text
Authorization: <redacted>
```

or omit the header entirely.

### 24.3 URL Validation

Allowed protocols:

- `http:`
- `https:`

Security warning:

- `http://localhost`
- `http://127.0.0.1`
- `http://[::1]`
- private network HTTP may be acceptable
- public HTTP should warn

Do not block localhost HTTP.

### 24.4 Renderer Isolation

Renderer must never call `fetch(baseUrl)` directly.

Reasons:

- keeps CORS out of the app UX
- keeps API key out of renderer code paths
- keeps provider request logging centralized
- keeps access policy in main process/service layer

## 25. Error Mapping

Create provider error mapping in `OpenAICompatibleProviderClient`.

```typescript
export class AIProviderError extends Error {
  readonly status?: number;
  readonly code:
    | "network"
    | "auth"
    | "not_found"
    | "rate_limit"
    | "server_error"
    | "invalid_config"
    | "model_unavailable"
    | "unsupported"
    | "unknown";
}
```

HTTP mapping:

| Condition | Code | Message |
| --- | --- | --- |
| network error | `network` | Could not connect to the AI provider. |
| 401/403 | `auth` | AI provider authentication failed. Check your API key. |
| 404 on model/chat | `not_found` | AI provider endpoint was not found. Check the base URL. |
| 404 model-specific response | `model_unavailable` | The selected model is not available from this provider. |
| 429 | `rate_limit` | AI provider rate limit reached. |
| 500-599 | `server_error` | AI provider returned a server error. |
| 400 tool unsupported | `unsupported` | The selected provider does not support this request. |

Keep raw response body bounded to 8 KB for diagnostics.

## 26. Migration Plan

### 26.1 Default Settings

No explicit migration is required for existing users.

When settings are missing:

```text
mode = hosted
localAIEnabled = false
localProvider = null
```

### 26.2 Existing Selected Model

Current `LAST_MODEL_STORAGE_KEY` in `AiChatV2.vue` stores the last selected model globally.

Problem:

Hosted and local providers may use overlapping or incompatible model ids.

Recommended change:

```typescript
const LAST_MODEL_STORAGE_KEY = "ai-chat-v2-last-model";
const LAST_MODEL_BY_PROVIDER_STORAGE_KEY = "ai-chat-v2-last-model-by-provider";
```

Store:

```json
{
  "hosted": "server-default-model",
  "local:Ollama:http://localhost:11434/v1": "llama3.1"
}
```

For MVP, simpler behavior is acceptable:

- when provider mode changes, reset selected model to provider default
- then persist new selection under existing key

The provider-specific key is better for user experience.

### 26.3 Corrupt Config

If local provider config JSON fails to parse:

- do not throw in settings page load
- return local provider null
- set local enabled false only when user saves again
- log a redacted warning

## 27. Testing Strategy

### 27.1 Unit Tests

Add tests under:

```text
test/vitest/utilitycode/aiProviderConfigValidator.test.ts
test/vitest/utilitycode/openAIModelNormalizer.test.ts
test/vitest/utilitycode/openAIStreamParser.test.ts
test/vitest/utilitycode/aiProviderResolver.test.ts
```

Required cases:

- normalizes `http://localhost:11434` to `/v1`
- rejects `file://`
- warns for public HTTP
- validates missing model
- redacts API key in settings view
- normalizes hosted model response
- normalizes OpenAI model response
- inserts configured default model when absent
- builds synthetic model list when `/models` fails
- parses `data: [DONE]`
- parses usage-only final chunk
- parses tool call deltas
- resolver allows hosted subscribed user
- resolver denies hosted unsubscribed user
- resolver allows valid local config without hosted subscription
- resolver denies invalid local config

### 27.2 IPC Tests

Add tests under:

```text
test/vitest/main/ipc/ai-provider-ipc.test.ts
test/vitest/main/ipc/ai-chat-v2-local-provider-gate.test.ts
```

Required cases:

- settings get returns redacted provider config
- settings save stores API key but does not return it
- clear API key updates `apiKeyConfigured` false
- refresh models returns synthetic list on local `/models` failure
- connection test maps 401 to auth error
- `AI_CHAT_V2_STREAM` allows local mode without `USER_AI_ENABLED`
- hosted-only AI handler still denies without `USER_AI_ENABLED`

### 27.3 AiChatApi Tests

Add or extend:

```text
test/vitest/utilitycode/aiChatApi.test.ts
```

Required cases:

- `listOpenAIModels()` uses hosted client in hosted mode
- `listOpenAIModels()` uses local client in local mode
- `openAIChatCompletion()` sends local request to configured base URL
- `openAIChatCompletionStream()` parses local SSE chunks
- local stream cancellation uses AbortError semantics

### 27.4 Renderer Component Tests

Add tests for settings UI:

```text
test/vitest/main/components/AIProviderSettingsPanel.test.ts
```

Required cases:

- preset selection fills base URL
- saved API key is displayed as configured, not plaintext
- Refresh Models populates model combobox
- failed model refresh keeps manual model enabled
- capability badges render statuses
- Hosted mode hides local-only fields or disables them

### 27.5 Manual Test Matrix

| Scenario | Steps | Expected |
| --- | --- | --- |
| Ollama local chat | Run Ollama, set URL, model, test, chat | Chat streams response without subscription. |
| Ollama offline | Stop Ollama, test connection | Offline error, no crash. |
| LM Studio | Start local server, configure preset | Model refresh and chat work. |
| OpenAI valid key | Configure OpenAI preset and key | Chat works. |
| OpenAI invalid key | Configure bad key | Auth error without key leak. |
| `/models` missing | Custom provider with chat only | Manual model fallback works. |
| hosted unsubscribed | Hosted mode, no `USER_AI_ENABLED` | Chat denied. |
| local unsubscribed | Local mode, valid config, no `USER_AI_ENABLED` | Chat allowed. |
| hosted-only feature | Local configured, use keyword generation | Subscription required. |

## 28. Implementation Sequence

### Phase 1: Pure Types And Validation

1. Add `aiProviderTypes.ts`.
2. Add setting constants.
3. Add provider presets.
4. Add URL normalization and config validator.
5. Add unit tests.

### Phase 2: Settings And Secrets

1. Add secret service.
2. Add settings service.
3. Add resolver.
4. Add unit tests with mocked `Token`.

### Phase 3: Provider Clients

1. Extract hosted model normalizer from `AiChatApi`.
2. Add hosted provider client.
3. Add OpenAI-compatible provider client.
4. Add stream parser.
5. Add connection tester.
6. Add tests with mocked `fetch`.

### Phase 4: IPC

1. Add channel constants.
2. Add `ai-provider-ipc.ts`.
3. Register handlers in communication index.
4. Update `ai-chat-v2-ipc.ts` stream/model gates.
5. Add IPC tests.

### Phase 5: AiChatApi Routing

1. Route `listOpenAIModels()`.
2. Route `openAIChatCompletion()`.
3. Route `openAIChatCompletionStream()`.
4. Keep hosted-only APIs unchanged.
5. Add routing tests.

### Phase 6: Settings UI

1. Add renderer API wrapper.
2. Add settings panel.
3. Add i18n keys in all supported languages.
4. Add component tests.

### Phase 7: Chat UI Integration

1. Add provider indicator.
2. Refresh model selector on provider mode change.
3. Reset selected model to provider default on mode switch.
4. Add tool capability warnings.
5. Add manual QA for Ollama and LM Studio.

## 29. Rollout And Risk Controls

### 29.1 Feature Risk

Risk: local provider support accidentally bypasses hosted subscription gates.

Control:

- only Chat V2 stream/model/compact/resume paths use chat resolver
- hosted-only APIs keep `ensureHostedAIEnabled()`
- add tests proving hosted-only handlers still deny without subscription

### 29.2 Secret Leak Risk

Risk: API key leaks to renderer logs or diagnostics.

Control:

- store key separately
- redacted settings view
- debug redaction
- IPC tests assert no plaintext key in response

### 29.3 Provider Compatibility Risk

Risk: local providers differ from OpenAI behavior.

Control:

- manual model fallback
- tolerant SSE parser
- capability test
- clear unsupported-tool messaging

### 29.4 UX Confusion Risk

Risk: users think local provider unlocks all AI features.

Control:

- settings explanatory copy
- hosted-only feature error copy
- chat provider indicator

## 30. Open Technical Questions

1. Should `USER_LOCAL_AI_ENABLED` be explicitly toggleable, or derived from saved valid config?
2. Should provider settings live only in `Token`, or should non-secret config move to SQLite for future per-workspace scope?
3. Should tool probing run automatically, given third-party providers may bill for test calls?
4. Should OpenRouter support optional `HTTP-Referer` and `X-Title` headers in MVP?
5. Should local provider streaming use the same retry policy as hosted, or a shorter local-only policy?
6. Should plan mode be disabled until tool support is confirmed?
7. Should selected model be persisted per provider immediately, or reset on provider mode change for MVP?

## 31. MVP Recommendation

Build the MVP with these choices:

1. Store non-secret provider config in `Token` JSON for speed.
2. Store API key in a separate `Token` key.
3. Make `USER_LOCAL_AI_ENABLED` derived by save operation but keep it as an explicit stored flag for future admin policy.
4. Route only Chat V2 model list, non-stream completion, stream completion, compact, and permission resume through local provider support.
5. Keep all other AI functions hosted-only.
6. Do not auto-probe tools by default. Offer tool capability as unknown unless chat test or explicit tool test runs.
7. Reset selected model to provider default when switching mode in MVP.
8. Add provider-specific selected model persistence in a later polish pass.

