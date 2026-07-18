# Local AI Provider For Chat - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-16
- **Owner**: Engineering Team
- **Related areas**: AiChatV2, system settings, OpenAI-compatible API, model selector, subscription gating, local model providers
- **Primary files**:
  - `src/api/aiChatApi.ts`
  - `src/main-process/communication/ai-chat-v2-ipc.ts`
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/AiChatV2ModelSelector.vue`
  - `src/views/pages/system/`
  - `src/config/usersetting.ts`
  - `src/modules/token.ts`

## 1. Summary

AiFetchly currently routes AiChatV2 completions through the hosted aiFetchly AI server. This works well for subscribed users, but it prevents unsubscribed users from using AiChatV2 with their own local or third-party OpenAI-compatible model provider.

This feature adds support for user-configured local/custom AI providers for AiChatV2. Users can configure a provider URL, optional API key, and default model in the system settings page. When configured and enabled, AiChatV2 can use the user's provider even if the user does not have a hosted aiFetchly AI subscription.

Hosted aiFetchly AI features remain subscription-gated. Local/custom providers unlock only the chat surfaces and workflows that can run through the OpenAI-compatible chat-completions contract. Other AI features that consume hosted aiFetchly resources continue to require `USER_AI_ENABLED`.

## 2. Problem

AiFetchly users increasingly run local models through tools such as Ollama, LM Studio, vLLM, LocalAI, or OpenAI-compatible third-party gateways. These users may want the AI chat experience, tool calling, and plan mode inside AiFetchly, but they do not necessarily want to use hosted aiFetchly AI credits.

The current implementation has three limitations:

1. `openAIChatCompletion`, `openAIChatCompletionStream`, and `listOpenAIModels` are coupled to aiFetchly's hosted AI API endpoints.
2. The existing `USER_AI_ENABLED` flag represents hosted subscription entitlement, so it blocks chat even when the user could provide their own model.
3. The UI has no system-level provider configuration flow for base URL, API key, model, connection test, or provider capabilities.

The product needs a clear split between hosted AI entitlement and local/custom chat availability.

## 3. Goals

1. Allow users to configure an OpenAI-compatible provider for AiChatV2.
2. Allow AiChatV2 to work for unsubscribed users when a valid local/custom provider is configured.
3. Keep hosted aiFetchly AI features gated by the existing subscription flag.
4. Add a new local AI enablement flag separate from hosted AI entitlement.
5. Provide a system settings UI for provider mode, provider preset, base URL, API key, default model, model refresh, and connection testing.
6. Support common OpenAI-compatible providers: Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI, and Custom.
7. Preserve the app's existing OpenAI-compatible request and response types.
8. Normalize model-list responses from both aiFetchly's hosted server and OpenAI-compatible providers into `OpenAIModelsResponse`.
9. Make model listing resilient when local provider `/models` is unavailable by falling back to the manually configured model.
10. Detect and store provider capabilities such as streaming, tool calling, vision, and context size when possible.
11. Never expose provider API keys to the renderer beyond masked display state.
12. Add complete i18n coverage for all new user-facing settings and chat messages.

## 4. Non-Goals

1. Do not unlock all hosted aiFetchly AI features for unsubscribed users.
2. Do not bypass hosted subscription checks for keyword generation, email template generation, hosted AI recovery, hosted rerank, hosted embeddings, or other hosted AI-cost features.
3. Do not require all local providers to implement `/v1/models`.
4. Do not require local providers to support tool calling.
5. Do not require local providers to support image inputs.
6. Do not add provider-specific SDKs in the first release.
7. Do not send user API keys through renderer IPC responses in plaintext.
8. Do not make renderer code call local or remote LLM providers directly.
9. Do not implement per-workspace provider selection in the first release.
10. Do not build a full prompt/model benchmarking tool in the first release.

## 5. Definitions

| Term | Meaning |
| --- | --- |
| Hosted AI | aiFetchly-managed AI server and model billing path. |
| Local AI | User-managed provider path, including local servers and third-party OpenAI-compatible APIs. |
| Provider | A configured chat-completions endpoint plus optional API key and default model. |
| OpenAI-compatible | Provider that exposes `/v1/chat/completions` and optionally `/v1/models` using OpenAI-like JSON/SSE schemas. |
| Provider mode | User selection that chooses hosted aiFetchly AI or local/custom AI for AiChatV2. |
| Capability | Provider/model behavior discovered or configured by test connection: streaming, tools, vision, context size. |

## 6. Entitlement And Access Policy

### 6.1 Existing Hosted Flag

`USER_AI_ENABLED` remains the hosted aiFetchly AI entitlement flag.

It continues to gate:

- Hosted aiFetchly chat provider.
- Hosted keyword generation.
- Hosted email template generation.
- Hosted AI recovery APIs.
- Hosted rerank APIs.
- Hosted embeddings and other remote AI-server features.
- Any AI IPC handler that has not explicitly been migrated to local-provider support.

### 6.2 New Local Flag

Add a new setting key:

```ts
export const USER_LOCAL_AI_ENABLED = "user_local_ai_enabled";
```

`USER_LOCAL_AI_ENABLED` controls whether the user may use a self-managed provider for AiChatV2.

This flag does not represent subscription status. It represents local/custom provider availability. It may be enabled by user configuration when a valid provider is saved.

### 6.3 Provider Mode

Add:

```ts
export const USER_AI_PROVIDER_MODE = "user_ai_provider_mode";
```

Allowed values:

```ts
type AIProviderMode = "hosted" | "local";
```

MVP behavior:

- `hosted`: AiChatV2 uses aiFetchly hosted AI and requires `USER_AI_ENABLED === "true"`.
- `local`: AiChatV2 uses the configured local/custom provider and requires `USER_LOCAL_AI_ENABLED === "true"` plus valid provider config.

Future-compatible behavior may add:

```ts
type AIProviderMode = "hosted" | "local" | "auto";
```

`auto` should not be implemented in the MVP unless product explicitly wants automatic fallback.

### 6.4 Chat Availability Resolver

AiChatV2 should use a chat-specific resolver, not the generic hosted-only gate.

Required behavior:

```ts
canUseAiChatV2 =
  (providerMode === "hosted" && USER_AI_ENABLED === "true") ||
  (providerMode === "local" &&
    USER_LOCAL_AI_ENABLED === "true" &&
    localProviderConfigIsValid);
```

If the resolver denies access, AiChatV2 must return a clear message:

> Configure a local AI provider or upgrade your plan to use AI Chat.

### 6.5 Hosted-Only Handler Rule

Existing AI IPC handlers that are not migrated to provider routing must keep checking `USER_AI_ENABLED` first.

Only handlers directly serving AiChatV2 local-provider paths may use the new chat availability resolver.

## 7. Target Users

### 7.1 Local Model User

Runs Ollama or LM Studio locally and wants AiFetchly chat without hosted AI subscription.

Example:

```text
Provider: Ollama
Base URL: http://localhost:11434/v1
Model: llama3.1
API key: empty
```

### 7.2 Developer Or Power User

Runs vLLM, LocalAI, or another OpenAI-compatible server for better control, privacy, or cost.

### 7.3 Third-Party Gateway User

Uses OpenAI, OpenRouter, Groq-compatible gateways, or a company proxy with their own API key.

### 7.4 Hosted aiFetchly Subscriber

Continues using hosted aiFetchly AI without any local configuration changes.

## 8. User Stories

1. As an unsubscribed user, I can configure Ollama and use AiChatV2 with my local model.
2. As a subscribed user, I can continue using hosted aiFetchly AI without changing settings.
3. As a user, I can switch AiChatV2 between hosted and local provider mode.
4. As a user, I can test whether my provider URL, API key, and model work before opening chat.
5. As a user, I can type a model name manually if `/models` does not work.
6. As a user, I can refresh model options from my provider when `/models` is supported.
7. As a user, I can see whether my provider supports streaming, tools, and vision.
8. As a user, I can use local chat but still see that hosted-only features require a subscription.
9. As a maintainer, I can add provider support without modifying chat loop internals.
10. As a maintainer, I can keep API keys encrypted and out of renderer responses.

## 9. Product Behavior

### 9.1 System Settings Entry Point

Add a dedicated section under System Settings:

```text
AI Provider
```

The section should be visible to all users.

It should explain:

> Custom providers can power AI Chat with your own model. Hosted aiFetchly AI features still require a subscription.

### 9.2 Provider Mode Control

Use a segmented control or radio group:

- Hosted aiFetchly
- Custom / Local Provider

Behavior:

- Selecting Hosted aiFetchly shows subscription status and hosted model info.
- Selecting Custom / Local Provider shows provider configuration fields.
- Saving Custom / Local Provider sets `USER_AI_PROVIDER_MODE = "local"`.
- Saving Hosted aiFetchly sets `USER_AI_PROVIDER_MODE = "hosted"`.

### 9.3 Provider Presets

Provide preset choices:

| Preset | Default Base URL | API Key Required |
| --- | --- | --- |
| Ollama | `http://localhost:11434/v1` | No |
| LM Studio | `http://localhost:1234/v1` | No |
| OpenAI | `https://api.openai.com/v1` | Yes |
| OpenRouter | `https://openrouter.ai/api/v1` | Yes |
| vLLM | `http://localhost:8000/v1` | Usually no |
| LocalAI | `http://localhost:8080/v1` | Usually no |
| Custom | empty | User decides |

Preset selection fills defaults but does not lock fields.

### 9.4 Custom Provider Fields

Required fields:

- Provider name.
- Base URL.
- Default model.

Optional fields:

- API key.
- Context size override.
- Notes or label.

Field behavior:

- API key input must be masked.
- API key may be empty for local providers.
- Model field must support manual typing.
- If model list is available, the model field should support dropdown selection.
- Base URL should be normalized on save.

### 9.5 Base URL Normalization

Users may enter:

- `http://localhost:11434`
- `http://localhost:11434/v1`
- `http://localhost:11434/v1/`
- `https://api.openai.com/v1`

The app should normalize to a base URL ending with `/v1` and no trailing slash.

Examples:

| Input | Stored |
| --- | --- |
| `http://localhost:11434` | `http://localhost:11434/v1` |
| `http://localhost:11434/` | `http://localhost:11434/v1` |
| `http://localhost:11434/v1/` | `http://localhost:11434/v1` |
| `https://api.openai.com/v1` | `https://api.openai.com/v1` |

### 9.6 Model Refresh

Settings must include a `Refresh Models` action.

Behavior:

- Calls active local provider `/models`.
- Normalizes the response into `OpenAIModelsResponse`.
- Populates model dropdown options.
- Does not fail the whole configuration if `/models` fails.
- Keeps manual model input available.
- If `/models` fails and a default model exists, show a warning but allow save.

Example warning:

> Model list could not be loaded. You can still use the manually entered model if your provider supports it.

### 9.7 Test Connection

Settings must include a `Test Connection` action.

The test should verify:

1. Base URL is syntactically valid.
2. Provider is reachable.
3. `/models` works or manual default model is present.
4. Non-streaming chat completion works with a cheap prompt.
5. Streaming chat completion works if enabled or requested.
6. Tool calling support is detected when possible.

Recommended test prompt:

```json
{
  "messages": [
    { "role": "user", "content": "Reply with exactly: pong" }
  ],
  "model": "<configured model>",
  "temperature": 0,
  "max_tokens": 8
}
```

Do not require exact text match for pass/fail because local models may add formatting. Treat any valid completion as chat success.

### 9.8 Capability Display

After test connection, display capability badges:

- Models endpoint.
- Chat.
- Streaming.
- Tool calls.
- Vision.
- Context size.

Capability states:

- Supported.
- Unsupported.
- Unknown.
- Failed.

### 9.9 Chat Header Provider Indicator

AiChatV2 should show the active provider in the header or near the model selector.

Examples:

- `Hosted`
- `Local: Ollama`
- `Local: LM Studio`
- `Local offline`
- `Model unavailable`

Clicking the provider indicator should open System Settings -> AI Provider when feasible.

### 9.10 Locked Feature Messaging

If the user configures local AI but tries a hosted-only feature, the app should not imply the local provider unlocks it.

Recommended copy:

> This feature uses hosted aiFetchly AI and requires a subscription. Your custom provider can be used for AI Chat.

## 10. Data Model And Settings

### 10.1 Setting Keys

Add to `src/config/usersetting.ts`:

```ts
export const USER_LOCAL_AI_ENABLED = "user_local_ai_enabled";
export const USER_AI_PROVIDER_MODE = "user_ai_provider_mode";
export const USER_LOCAL_AI_PROVIDER_CONFIG = "user_local_ai_provider_config";
```

### 10.2 Provider Config Type

```ts
export type AIProviderMode = "hosted" | "local";

export type LocalAIProviderPreset =
  | "ollama"
  | "lm_studio"
  | "openai"
  | "openrouter"
  | "vllm"
  | "localai"
  | "custom";

export interface LocalAIProviderConfig {
  preset: LocalAIProviderPreset;
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyConfigured: boolean;
  contextSize?: number;
  capabilities?: LocalAIProviderCapabilities;
  lastTestedAt?: string;
  lastTestStatus?: "passed" | "failed" | "partial" | "untested";
  lastTestMessage?: string;
}
```

The API key should not be returned to renderer config reads. Store the key separately or store config encrypted and redact on read.

### 10.3 Secret Storage

Recommended keys:

```ts
export const USER_LOCAL_AI_PROVIDER_API_KEY = "user_local_ai_provider_api_key";
```

Store through `Token.setValue()`.

Renderer reads should return:

```ts
{
  apiKeyConfigured: true
}
```

Renderer must not receive the plaintext API key unless the user is actively entering a new value in the UI.

### 10.4 Capability Type

```ts
export interface LocalAIProviderCapabilities {
  modelsEndpoint: "supported" | "unsupported" | "unknown" | "failed";
  chat: "supported" | "unsupported" | "unknown" | "failed";
  streaming: "supported" | "unsupported" | "unknown" | "failed";
  tools: "supported" | "unsupported" | "unknown" | "failed";
  vision: "supported" | "unsupported" | "unknown";
  contextSize?: number;
}
```

### 10.5 Provider Config Validation

Valid local provider config requires:

- `baseUrl` is a valid `http:` or `https:` URL.
- `defaultModel` is a non-empty string.
- `name` is a non-empty string.
- `preset` is one of the supported preset values.

API key requirement:

- OpenAI and OpenRouter presets should warn if API key is empty.
- Local presets should allow empty API key.
- Custom should allow empty API key but warn that some providers require one.

## 11. API And Architecture Requirements

### 11.1 Provider Client Interface

Introduce a provider client abstraction.

```ts
interface ChatProviderClient {
  listModels(): Promise<OpenAIModelsResponse>;
  complete(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse>;
  stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void>;
  testConnection(
    config: LocalAIProviderConfig
  ): Promise<LocalAIProviderTestResult>;
}
```

`AiChatApi` should use this abstraction instead of adding provider conditionals throughout the chat loop.

### 11.2 Hosted Provider Client

Hosted provider behavior keeps current aiFetchly endpoints:

- Models: `/api/ai/v1/models`
- Chat completion: `/api/ai/v1/chat/completions`
- Stream completion: `/api/ai/v1/chat/completions`

Hosted provider continues to use `HttpClient`, hosted auth token, and hosted retry behavior.

### 11.3 OpenAI-Compatible Provider Client

Local/custom provider behavior uses direct `fetch` from main process/service code:

- Models: `${baseUrl}/models`
- Chat completion: `${baseUrl}/chat/completions`
- Stream completion: `${baseUrl}/chat/completions`

Headers:

```ts
{
  "Accept": "application/json",
  "Content-Type": "application/json",
  "Authorization": apiKey ? `Bearer ${apiKey}` : undefined
}
```

Streaming headers:

```ts
{
  "Accept": "text/event-stream",
  "Content-Type": "application/json",
  "Authorization": apiKey ? `Bearer ${apiKey}` : undefined
}
```

### 11.4 AiChatApi Routing

`AiChatApi` methods should route through the active provider:

- `listOpenAIModels()`
- `openAIChatCompletion()`
- `openAIChatCompletionStream()`

Pseudo-code:

```ts
async listOpenAIModels(): Promise<OpenAIModelsResponse> {
  const provider = this.providerResolver.resolveForChat();
  return provider.listModels();
}

async openAIChatCompletion(
  request: OpenAIChatCompletionRequest
): Promise<OpenAIChatCompletionResponse> {
  const provider = this.providerResolver.resolveForChat();
  return provider.complete(request);
}

async openAIChatCompletionStream(
  request: OpenAIChatCompletionRequest,
  onChunk: (chunk: OpenAIChatCompletionChunk) => void,
  options?: OpenAIChatCompletionStreamOptions
): Promise<void> {
  const provider = this.providerResolver.resolveForChat();
  return provider.stream(request, onChunk, options);
}
```

### 11.5 Model List Normalization

Use provider-specific normalizers.

Hosted aiFetchly shape:

```json
{
  "models": [
    {
      "name": "model-id",
      "available": true,
      "max_tokens": 4096,
      "context_size": 128000,
      "description": "Model description",
      "is_free": false
    }
  ],
  "default_model": "model-id",
  "total_count": 1
}
```

OpenAI-compatible shape:

```json
{
  "object": "list",
  "data": [
    {
      "id": "model-id",
      "object": "model",
      "created": 0,
      "owned_by": "provider"
    }
  ]
}
```

Normalize both into:

```ts
interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
  default_model?: string;
}
```

### 11.6 Local Model List Fallback

If local provider `/models` fails but `defaultModel` exists, return synthetic model list:

```ts
{
  object: "list",
  data: [
    {
      id: config.defaultModel,
      object: "model",
      created: 0,
      owned_by: config.name
    }
  ],
  default_model: config.defaultModel
}
```

The UI should display a warning, but chat may still proceed.

### 11.7 Stream Parsing

OpenAI-compatible local stream parser must support:

- SSE `data: {...}`
- SSE `data: [DONE]`
- blank-line event separation
- chunks with `choices[].delta.content`
- chunks with `choices[].delta.tool_calls`
- final usage chunk when present

Parser output must remain `OpenAIChatCompletionChunk`.

### 11.8 Tool Calling

If a provider is marked as tool-unsupported:

- AiChatV2 should not send `tools` for normal chat.
- Tool approval UI should not imply tools can run.
- Plan/tool workflows should show a clear warning or disable tool-required mode.

If provider support is unknown:

- Default to safe behavior.
- Allow sending tools only if the user explicitly enables experimental local tool calling or if connection test detects tool support.

Local provider default tool approval mode should be conservative:

```ts
ask_for_approval
```

### 11.9 Rerank And Embeddings

This PRD does not migrate hosted rerank or embeddings to local providers.

If future work adds embedding/rerank provider configuration, it should use separate provider capabilities and not assume the chat provider supports embeddings.

## 12. IPC Requirements

### 12.1 Settings IPC

Add IPC handlers for provider settings:

- Get provider settings.
- Save provider settings.
- Refresh provider models.
- Test provider connection.
- Clear provider API key.

Handlers must:

- Validate input.
- Never return plaintext stored API keys.
- Use `Token` for encrypted secret storage.
- Keep database access out of IPC handlers.
- Return `{ status, msg, data }` consistently.

### 12.2 AiChatV2 Stream IPC Gate

`AI_CHAT_V2_STREAM` should use the chat availability resolver.

Hosted mode:

- Require `USER_AI_ENABLED`.

Local mode:

- Require `USER_LOCAL_AI_ENABLED`.
- Require valid provider config.

Error examples:

```text
Hosted aiFetchly AI requires a subscription.
```

```text
Local AI provider is not configured. Open System Settings -> AI Provider.
```

### 12.3 Other AI IPC Handlers

All other AI IPC handlers should keep existing hosted entitlement checks unless explicitly migrated.

This prevents local provider configuration from accidentally unlocking unrelated paid features.

## 13. UI Requirements

### 13.1 System Settings Layout

Recommended layout:

```text
System Settings
  AI Provider
    Provider mode
    Hosted status
    Custom provider preset
    Provider name
    Base URL
    API key
    Default model
    Refresh Models
    Test Connection
    Capability badges
    Save
```

This should be a quiet operational settings panel, not a marketing page.

### 13.2 Form Controls

Required controls:

- Segmented control or radio group for provider mode.
- Select for provider preset.
- Text input for provider name.
- Text input for base URL.
- Password input for API key.
- Combobox for model selection/manual entry.
- Button for Refresh Models.
- Button for Test Connection.
- Save button.
- Clear API key action.

### 13.3 Validation States

Show inline validation for:

- Invalid URL.
- Missing model.
- Missing provider name.
- Empty API key for presets that usually require one.
- Failed connection test.

### 13.4 Success States

After saving valid local config:

> Local AI provider saved. AI Chat can now use your configured model.

After successful connection test:

> Connection test passed.

### 13.5 Partial Success States

If chat works but model list fails:

> Chat test passed, but model list could not be loaded. The manually entered model will be used.

If chat works but streaming fails:

> Chat test passed, but streaming could not be verified. Streaming chat may not work with this provider.

### 13.6 Chat UI States

AiChatV2 should:

- Enable chat when hosted entitlement is active in hosted mode.
- Enable chat when local provider config is valid in local mode.
- Show active provider label near the model selector.
- Use active provider models in the model selector.
- Disable or warn for tools when local provider does not support tools.
- Surface provider connection errors in the chat error area.

## 14. Security And Privacy Requirements

1. API keys must be encrypted at rest.
2. API keys must not be logged.
3. API keys must not be returned to renderer reads.
4. Debug request logs must redact Authorization headers and secrets.
5. Provider diagnostics must show only `apiKeyConfigured: true/false`.
6. Local provider requests should be initiated from main process/service code, not renderer.
7. Base URL must be validated as `http:` or `https:`.
8. The app should allow localhost HTTP for local providers.
9. The app should warn when a non-local HTTP URL is used without TLS.
10. Connection test errors should not include API key values.

## 15. Error Handling

### 15.1 Invalid Config

If provider config is invalid:

> Local AI provider is not configured. Open System Settings -> AI Provider.

### 15.2 Provider Offline

If local provider is unreachable:

> Could not connect to the local AI provider. Check that the provider is running and the base URL is correct.

### 15.3 Auth Failure

If provider returns 401 or 403:

> AI provider authentication failed. Check your API key.

### 15.4 Model Missing

If provider reports model not found:

> The selected model is not available from this provider. Choose another model or update the provider configuration.

### 15.5 Tool Unsupported

If tools are required but unsupported:

> The selected local provider does not support tool calling. Switch to a tool-capable model or hosted aiFetchly AI.

## 16. Functional Requirements

### FR1: Provider Mode Settings

The system settings page must let users choose hosted or local provider mode.

Acceptance criteria:

- User can select Hosted aiFetchly.
- User can select Custom / Local Provider.
- Selection persists across app restarts.
- Hosted mode continues current behavior.
- Local mode enables local provider fields.

### FR2: Local Provider Config Storage

The app must store local provider config and API key securely.

Acceptance criteria:

- Base URL, provider name, preset, and default model persist.
- API key persists encrypted.
- Renderer reads do not expose plaintext API key.
- Clear API key removes the stored secret.

### FR3: Provider Presets

The settings UI must provide common provider presets.

Acceptance criteria:

- Ollama fills `http://localhost:11434/v1`.
- LM Studio fills `http://localhost:1234/v1`.
- OpenAI fills `https://api.openai.com/v1`.
- OpenRouter fills `https://openrouter.ai/api/v1`.
- Custom allows manual URL.
- User can edit preset-filled values.

### FR4: Model Refresh

The app must support refreshing model list from local provider.

Acceptance criteria:

- `/models` success populates model options.
- OpenAI-style responses are normalized.
- `/models` failure shows warning.
- Manual default model remains usable after `/models` failure.

### FR5: Connection Test

The settings UI must test local provider connectivity.

Acceptance criteria:

- Test validates URL format.
- Test checks provider reachability.
- Test checks chat completion.
- Test checks streaming when possible.
- Test records capability results.
- Test never logs or displays API key.

### FR6: AiChatV2 Local Access

AiChatV2 must be available to unsubscribed users when valid local provider config exists.

Acceptance criteria:

- Given `USER_AI_ENABLED !== "true"` and valid local mode, chat can send messages.
- Given invalid local config, chat is blocked with clear settings guidance.
- Given hosted mode and no subscription, chat is blocked.
- Given hosted mode and subscription, chat works as before.

### FR7: Hosted-Only Features Stay Locked

Local provider configuration must not unlock unrelated hosted AI features.

Acceptance criteria:

- Hosted keyword generation still requires `USER_AI_ENABLED`.
- Hosted email template generation still requires `USER_AI_ENABLED`.
- Hosted recovery APIs still require `USER_AI_ENABLED`.
- Hosted rerank and embeddings still require `USER_AI_ENABLED` unless separately migrated.

### FR8: Model Selector Uses Active Provider

AiChatV2 model selector must list models from the active provider.

Acceptance criteria:

- Hosted mode lists hosted aiFetchly models.
- Local mode lists local provider models when `/models` succeeds.
- Local mode lists configured default model when `/models` fails.
- Default model resolves to provider-configured default model in local mode.

### FR9: Provider Indicator

AiChatV2 must show active provider identity.

Acceptance criteria:

- Hosted mode displays hosted provider indicator.
- Local mode displays configured provider name.
- Offline or invalid local provider state is visible.

### FR10: Tool Capability Handling

AiChatV2 must handle local provider tool support safely.

Acceptance criteria:

- If tools unsupported, tool-required workflows are disabled or blocked with clear message.
- If tools unknown, app defaults to conservative approval and warning behavior.
- If tools supported, existing tool call flow works.

## 17. Non-Functional Requirements

### 17.1 Performance

- Settings page should load provider config within 300 ms under normal local storage conditions.
- Model refresh should timeout within a configurable short limit, recommended 10 seconds.
- Connection test should timeout within a configurable limit, recommended 20 seconds.
- Chat stream should use existing recovery/retry behavior where applicable, but local providers should not retry indefinitely.

### 17.2 Reliability

- Local provider offline state should not crash chat UI.
- Model list failure should not prevent manual model usage.
- Provider config corruption should reset safely to disabled local mode or show actionable error.

### 17.3 Maintainability

- Provider routing must be isolated behind provider client/resolver classes.
- Chat loop should continue using OpenAI-compatible request/response types.
- Provider normalizers should have unit tests.
- Settings validation should have unit tests.

### 17.4 Internationalization

All new user-facing strings must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

## 18. Analytics And Diagnostics

No telemetry should include prompts, completions, API keys, or provider URLs unless explicitly redacted.

Allowed diagnostic fields:

- provider preset
- provider mode
- `apiKeyConfigured: boolean`
- connection test status
- capability statuses
- model count
- error category

Diagnostics copy should support:

```text
Provider: Ollama
Base URL: http://localhost:11434/v1
Model: llama3.1
Models endpoint: ok
Chat endpoint: ok
Streaming: ok
Tools: unsupported
API key: not configured
```

Never include the API key.

## 19. Migration And Backward Compatibility

### 19.1 Existing Users

Default state:

```ts
USER_AI_PROVIDER_MODE = "hosted"
USER_LOCAL_AI_ENABLED = "false"
```

Existing subscribed users continue using hosted aiFetchly AI.

### 19.2 Existing Model Selection

The last selected model should remain valid for hosted mode.

Local mode should use the configured local default model unless a local model selection is stored.

### 19.3 No Forced Config

Users are not required to configure local AI.

### 19.4 Failed Migration

If new settings are missing or malformed:

- Fall back to hosted mode.
- Do not delete existing hosted auth settings.
- Show local provider as unconfigured.

## 20. Implementation Plan

### Phase 1: Provider Settings Foundation

- Add setting constants.
- Add provider config types.
- Add provider config validation.
- Add encrypted API key storage helpers.
- Add IPC handlers for get/save/clear/test/refresh.
- Add unit tests for validation and redaction.

### Phase 2: Provider Client Abstraction

- Add `ChatProviderClient` interface.
- Implement hosted aiFetchly provider client.
- Implement OpenAI-compatible provider client.
- Add model response normalizers.
- Add stream parser support for OpenAI-compatible SSE.
- Add unit tests for model normalization and stream parsing.

### Phase 3: AiChatApi Routing

- Route `listOpenAIModels()` through active provider.
- Route `openAIChatCompletion()` through active provider.
- Route `openAIChatCompletionStream()` through active provider.
- Keep hosted-only APIs unchanged.
- Add tests for hosted vs local routing.

### Phase 4: System Settings UI

- Add AI Provider settings section.
- Add provider mode selector.
- Add preset/base URL/API key/model fields.
- Add Refresh Models action.
- Add Test Connection action.
- Add capability badges.
- Add i18n keys for all languages.

### Phase 5: AiChatV2 UI Integration

- Show active provider indicator.
- Use active provider model list.
- Use local default model when active provider is local.
- Add invalid provider error state.
- Add tool capability warning/disable state.

### Phase 6: Hardening

- Add timeout behavior.
- Add diagnostics export without secrets.
- Add regression tests for subscription/local gating.
- Add manual test cases for Ollama, LM Studio, OpenAI, and Custom.

## 21. Test Plan

### 21.1 Unit Tests

Required tests:

- Provider config validation.
- Base URL normalization.
- API key redaction.
- Hosted model response normalization.
- OpenAI model response normalization.
- Synthetic local model fallback.
- Provider resolver access policy.
- Local vs hosted chat gate.
- Stream parser handles `[DONE]`.
- Stream parser handles tool call deltas.

### 21.2 IPC Tests

Required tests:

- Save provider config does not return API key.
- Get provider config returns `apiKeyConfigured`.
- Clear API key removes secret.
- Test connection handles 401/403 without leaking key.
- Chat stream IPC allows local mode without `USER_AI_ENABLED`.
- Hosted-only IPC still denies without `USER_AI_ENABLED`.

### 21.3 UI Tests

Required tests:

- Provider preset fills base URL.
- Invalid URL shows validation.
- Manual model can be saved when model refresh fails.
- Capability badges render after test connection.
- AiChatV2 provider indicator changes when provider mode changes.
- Tool warning appears when provider tools are unsupported.

### 21.4 Manual Test Matrix

| Scenario | Expected |
| --- | --- |
| Hosted mode + subscribed | Chat works through aiFetchly server. |
| Hosted mode + unsubscribed | Chat blocked with subscription message. |
| Local mode + Ollama running | Chat works without subscription. |
| Local mode + Ollama stopped | Chat shows provider offline error. |
| Local mode + LM Studio running | Chat works without subscription. |
| Local mode + OpenAI key valid | Chat works. |
| Local mode + OpenAI key invalid | Auth error shown. |
| Local mode + `/models` fails + manual model | Save allowed, chat can still test. |
| Local mode + tools unsupported | Tool workflows warn or disable. |
| Local mode configured + hosted keyword generation | Still requires subscription. |

## 22. Acceptance Criteria

1. User can configure a local/custom OpenAI-compatible provider in system settings.
2. User can save provider config with optional API key.
3. Stored API key is encrypted and never returned in plaintext to renderer reads.
4. User can refresh provider models when `/models` is supported.
5. User can manually enter a model when `/models` fails.
6. User can test provider connection and see capability results.
7. AiChatV2 can use a local provider without `USER_AI_ENABLED`.
8. Hosted mode still requires `USER_AI_ENABLED`.
9. Hosted-only AI features remain locked without subscription.
10. `listOpenAIModels()` returns normalized models from the active provider.
11. `openAIChatCompletion()` routes to the active provider.
12. `openAIChatCompletionStream()` routes to the active provider.
13. Local provider stream parsing handles standard OpenAI-compatible SSE.
14. AiChatV2 model selector uses active provider models.
15. AiChatV2 shows active provider indicator.
16. Tool-required workflows handle unsupported local tools safely.
17. All new UI strings are translated in all supported language files.
18. Regression tests cover local vs hosted gating and model-list fallback.

## 23. Open Questions

1. Should `USER_LOCAL_AI_ENABLED` be user-toggleable, or should it be derived from valid saved provider config?
2. Should local provider mode be available to all users by default, or hidden behind an advanced setting?
3. Should local provider support plan mode by default, or only plain chat until tool capability is verified?
4. Should local provider config be global or per workspace in a future release?
5. Should OpenRouter or other third-party gateways require extra headers such as `HTTP-Referer` or app title?
6. Should provider connection tests send an actual chat request automatically, or require user confirmation because third-party APIs may bill per token?
7. Should local provider chat history be visually marked to show it was generated by a non-hosted model?
8. Should hosted fallback be offered when local provider fails and the user is subscribed?

## 24. Recommended MVP Scope

The recommended MVP should include:

1. Provider mode setting.
2. Local provider config with preset, base URL, optional API key, and default model.
3. Encrypted API key storage and redacted reads.
4. Refresh Models.
5. Test Connection.
6. `listOpenAIModels()`, `openAIChatCompletion()`, and `openAIChatCompletionStream()` provider routing.
7. AiChatV2 provider indicator and model selector integration.
8. Hosted-only features remain unchanged.

The recommended MVP should defer:

- Per-feature model routing.
- Local embeddings/rerank.
- Full provider benchmarking.
- Per-workspace provider configuration.
- Advanced model parameter UI.

