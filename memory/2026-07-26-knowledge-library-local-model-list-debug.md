# Knowledge Library free-user model-list debug

- Symptom: Opening Knowledge Library settings as a free user logged `AI feature is not enabled` from `getAvailableEmbeddingModelsWithDefault()`.
- Root cause: `RAG_GET_AVAILABLE_MODELS` used `registerAiValidatedHandler`, so the request was rejected before the embedding catalog could return its built-in local Xenova model.
- Fix: Model discovery now uses the normal validated handler and passes `includeRemote: isAiEnabled()` to `EmbeddingModelCatalogService`. Disabled users receive a local-only catalog without a remote API call.
- Regression coverage: Added a catalog test asserting that `includeRemote: false` does not call the remote API and returns `local-xenova:Xenova/all-MiniLM-L6-v2` at 384 dimensions.
- Verification: `yarn tsc --noEmit` reported 0 errors; targeted Vitest run passed 11 tests. The unscoped Vitest command also scans `.claude/worktrees/architecture-remediation` and fails there due to that worktree's unresolved `@` alias; the main-workspace run excluded `.claude/**`.
