# Local AI Provider For Chat — Implementation Plan

Source: `docs/prd/local-ai-provider-chat-prd.md` + `docs/prd/local-ai-provider-chat-technical-design.md`.
This plan is grounded in a live read of the codebase; deviations from the design doc are flagged **(DEV)**.

## Verified facts (grounding)

- `AiChatApi` (`src/api/aiChatApi.ts`) owns the 3 OpenAI-compatible methods (`listOpenAIModels`, `openAIChatCompletion`, `openAIChatCompletionStream`) plus hosted-only methods. All call `private ensureAIEnabled()` (checks `WORKER_TYPE` env, then `Token.getValue(USER_AI_ENABLED)`).
- The stream method has substantial retry/legacy-fallback logic — must NOT be duplicated or disturbed for the hosted path.
- `Token` (`src/modules/token.ts`) encrypts via `CryptoSource`; `setValue("")` stores an encrypted empty string (NOT a delete). `ElectronStoreService.deleteValue(key)` is a true delete.
- `usersetting.ts` has `USER_AI_ENABLED`, `USER_AI_AUTO_PLAN`. `channellist.ts` has the `AI_CHAT_V2_*` channels. IPC handlers are registered in `communication/index.ts` via `registerXxxIpcHandlers()`.
- `ai-chat-v2-ipc.ts` gates every handler with `isAIEnabled()` (`USER_AI_ENABLED === "true"`). `createQueryLoop()` wires `streamChatCompletion` dep → `new AiChatApi().openAIChatCompletionStream(...)`. `getCompactAgent()` uses `isEnabled: () => USER_AI_ENABLED === "true"`.
- `AIChatQueryLoop` attaches `tools` at line ~337 inside the `streamChatCompletion` dep call — the dep closure is the clean place to strip tools for tool-unsupported local providers.
- Renderer: `views/api/*.ts` uses `windowInvoke`/`windowSend`; channels must be allow-listed in `preload.ts` `invoke.validChannels` (~line 542+) and the send/receive allowlists.
- System settings: DB-driven tree in `systemsetting/index.vue`, plus standalone routes (`mcp`, `skills`, `plugins`) defined in `views/router/index.ts` (children of `system_setting_index`). Pattern = a page component + a back button.
- i18n: `views/lang/{en,zh,es,fr,de,ja}.ts` are flat nested objects; `aiChatV2:` namespace at line ~1826, `system_settings:` at ~1127.
- Tests: Vitest under `test/vitest/utilitycode/` (pure code, mocks `Token`/`HttpClient`) and `test/vitest/main/` (IPC). `@` → `src`. Type-check gate runs `tsc --noEmit` at startup.

## Key design decisions

1. **(DEV) No `HostedAIProviderClient` extraction.** Keep the hosted path byte-for-byte inside `AiChatApi` (zero regression risk on the complex retry logic). Only the 3 OpenAI methods get a resolver branch: hosted → existing in-class impl; local → new `OpenAICompatibleProviderClient`. This is the option the design explicitly allows ("keep it in AiChatApi initially").
2. **(DEV) Shared hosted-gate helper.** Extract the worker-aware hosted check into `AIProviderResolver.isHostedAIEnabled()` and have `ensureAIEnabled()` delegate to it — DRY, identical behavior.
3. **(DEV) Tool gating at the IPC dep closure** (`createQueryLoop.streamChatCompletion`), not inside `AIChatQueryLoop`. If local + tools unsupported/unknown → strip `tools`/`tool_choice`. Plan mode (tool-required) surfaces a pre-send warning via the resolver denial path. Keeps the query loop untouched.
4. **Secrets:** store API key under its own `Token` key; `clearApiKey` uses a new `Token.deleteValue()` (added) so no stale encrypted-empty value lingers. Renderer only ever sees `apiKeyConfigured`.
5. **Default mode = hosted**, `USER_LOCAL_AI_ENABLED` set to `"true"` on first valid local save, reset to `"false"` when local config is removed/cleared.

## Phases (each is one commit)

### Phase 1 — Types, constants, presets, validation (pure, fully unit-tested)
- `src/entityTypes/aiProviderTypes.ts` — all types from design §4.2.
- `src/config/usersetting.ts` — add `USER_LOCAL_AI_ENABLED`, `USER_AI_PROVIDER_MODE`, `USER_LOCAL_AI_PROVIDER_CONFIG`, `USER_LOCAL_AI_PROVIDER_API_KEY`.
- `src/service/aiProvider/AIProviderPresets.ts` — preset table (design §5).
- `src/service/aiProvider/AIProviderConfigValidator.ts` — `normalizeOpenAIBaseUrl`, `validate()` → `{valid,normalized,errors,warnings}` (design §6).
- Tests: `test/vitest/utilitycode/aiProviderConfigValidator.test.ts`.

### Phase 2 — Secrets, settings service, resolver
- `Token.deleteValue()` + `AIProviderSecretService` (get/set/has/clear).
- `AIProviderSettingsService` — mode get/set, redacted settings view, save local provider (validates, stores config JSON + key, sets `USER_LOCAL_AI_ENABLED`).
- `AIProviderResolver` — `resolveForChat()` (hosted/local/denial), `isHostedAIEnabled()`, `ensureHostedAIEnabled()`.
- Tests with mocked `Token`.

### Phase 3 — Provider client + normalization + stream parser
- `ChatProviderClient.ts` (interface + options), `OpenAIRequestPayload.ts` (payload builders), `OpenAIModelNormalizer.ts` (hosted/openai/synthetic), `OpenAIStreamParser.ts` (SSE `[DONE]`, usage-only, tool deltas, abort), `AIProviderError.ts` (HTTP→code mapping), `OpenAICompatibleProviderClient.ts` (listModels w/ synthetic fallback, complete, stream).
- Tests: normalizer, stream parser.

### Phase 4 — Connection tester
- `AIProviderConnectionTester.test()` — validate → GET /models → POST chat (non-stream) → POST chat (stream) → optional tool probe → `{status,capabilities,models,message}` with AbortController timeouts (10s/20s).

### Phase 5 — IPC + channels + preload + renderer API
- `channellist.ts`: 7 `AI_PROVIDER_*` channels.
- `ai-provider-ipc.ts`: settings get/save, mode get/set, models refresh, connection test, api-key clear. `ok`/`denied` envelope, never returns plaintext key.
- Register in `communication/index.ts`.
- `preload.ts`: add channels to invoke + send/receive allowlists.
- `views/api/aiProvider.ts`: typed wrappers (`windowInvoke` only).
- `ai-chat-v2-ipc.ts`: replace `isAIEnabled()` gates on STREAM/MODELS/COMPACT/RESUME with the chat resolver; tool-strip in `createQueryLoop`; `getCompactAgent().isEnabled` → chat resolver.
- Tests: `ai-provider-ipc.test.ts`, `ai-chat-v2-local-provider-gate.test.ts`.

### Phase 6 — AiChatApi routing
- 3 OpenAI methods branch on resolver (hosted = existing impl gated by resolver; local = `OpenAICompatibleProviderClient`). Keep hosted-only methods on `ensureAIEnabled()`.
- Tests: `aiChatApi.test.ts` extension — hosted vs local routing, local SSE parse.

### Phase 7 — Settings UI + i18n
- `AIProviderSettingsPanel.vue`, `AIProviderCapabilityBadges.vue`, route page `systemsetting/ai_provider.vue`; router entry + nav button; `views/lang/{en,zh,es,fr,de,ja}.ts` `aiProvider` namespace.
- Never hydrate `apiKey` from storage (only `apiKeyConfigured`).

### Phase 8 — AiChatV2 integration + hardening
- Provider indicator near model selector; reset selected model to provider default on mode change; surface resolver denial in chat error area; tool warning when local tools unsupported.
- Diagnostics redaction (Authorization/apiKey) in debug logger. Regression tests for gating.

## Deferred (explicitly out of MVP, per design §31)
Per-workspace provider config; per-provider selected-model persistence; local embeddings/rerank; auto tool-probe on save; `auto` provider mode.
