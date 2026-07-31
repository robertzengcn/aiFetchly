# Proxy AI List Metadata Debug

## DEBUG REPORT

- **Symptom:** AI Chat `proxy_list` for "List my proxies." returned `{"success":false,"executionTimeMs":6,"code":"UNSUPPORTED_OPERATION","error":"No metadata for \"ProxyEntity\" was found."}` during TC-1 (`proxy_list` does not expose passwords).
- **Root cause:** `ProxyModel` and `ProxyCheckModel` cached TypeORM repositories before the shared `SqliteDb` `DataSource` was initialized. If the AI tool path reached proxy listing before another path initialized SQLite, TypeORM's metadata map was empty and repository operations failed with the `ProxyEntity` metadata error.
- **Fix:** Changed `ProxyModel` and `ProxyCheckModel` to lazily resolve repositories through `await this.ensureConnection()` before first repository access. Follow-up audit found the same eager-repository pattern in most models, so `BaseDb` now centrally guards every asynchronous model method with `ensureConnection()` before its body runs. This covers legacy models and future models without requiring each caller to remember the initialization step.
- **Evidence:** Added `test/vitest/main/proxyModelMetadata.test.ts`, which mocks `SqliteDb.getRepository()` to throw the same metadata error until `ensureInitialized()` runs. The test verifies `ProxyEntity`, `ProxyCheckEntity`, and a legacy eager `AIChatMessageModel` access initialize first.
- **Regression test:** `test/vitest/main/proxyModelMetadata.test.ts`.
- **Related:** Existing `proxyAiTools` redaction tests already covered TC-1 output shape once the list operation succeeds. The broader audit found dozens of models that cache repositories in constructors, confirming this was an architectural lifecycle issue rather than a proxy-only defect.
- **Status:** DONE.
