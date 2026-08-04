# LLM Proxy Management Tools — Implementation Plan

Source: `docs/prd/llm-proxy-management-tools-prd.md` + `docs/prd/llm-proxy-management-tools-technical-design.md`

## Scope (8 tools + batch refactor)
Implement `proxy_list`, `proxy_get`, `proxy_create`, `proxy_update`, `proxy_delete`, `proxy_import`, `proxy_check`, `proxy_remove_failed`. Refactor batch checking. Defer: async large-batch jobs (use sync small-batch limits), credential-reveal, subagent, UI cards.

## Architecture decisions
- **Layering**: AI tool (`src/service/ProxyAiTools.ts`) → `ProxyModule`/`ProxyController` → `ProxyModel`/`ProxyCheckModel`. Never TypeORM repos in the AI layer.
- **Types/schemas/normalizers/concurrency** live in `src/entityTypes/proxyAiToolTypes.ts` (pure, DB-free, unit-testable).
- **DI for tests**: `new ProxyAiTools({ proxyModule?, proxyController? })` — defaults to real instances.
- **Status "unknown"**: model hardcodes `status:1`. Resolve unknown via `checktime` presence (checked ⟺ checktime set by controller enrichment).
- **Pagination**: AI `page` is 0-based; pass `page+1` to `ProxyController.getProxylist` (model does `skip((page-1)*size)`). Status/googlePass filters → bounded scan ≤500 + in-memory filter.
- **Import**: per-row `safeParse` (AC-6: invalid row details), batch duplicate check via new `findByHostPortPairs`, reload for summaries.
- **Batch check**: new `ProxyController.checkProxyBatch(opts)` with `runWithConcurrency`; `checkAllproxy` becomes a thin wrapper (preserves UI signature + fixes async-`forEach` bug).
- **Credentials**: all outputs redacted (`hasPassword`, never `pass`/`password`); redact `updateProxyStatus` log. Defer `sensitiveArgumentKeys` audit redaction (document residual risk).
- **Permissions**: read tools `pure`/no-confirm; mutating+check+remove tools `automation`/confirm; `proxy_check` `timeoutClass:"network"`.

## Phases (each = one commit)
1. **Foundation**: `proxyAiToolTypes.ts` (types, status mappers, normalizers, Zod schemas, `runWithConcurrency`) + pure tests.
2. **Read tools**: `ProxyAiTools.ts` `listProxies`/`getProxy` + wrappers; register `proxy_list`/`proxy_get`; redaction tests.
3. **CRUD**: `createProxy`/`updateProxy`/`deleteProxy`/`importProxies`; model `findByHostPortPairs` + module wrapper; controller `deleteProxyWithCheck`; register; safety tests.
4. **Batch refactor**: `checkProxyBatch` + `runProxyCheck(mode)`, redact logs, `checkAllproxy` wrapper; concurrency/orchestration tests.
5. **Check tool**: `checkProxies` (target resolution, clamp, sync limits, progress); register `proxy_check`; tests.
6. **Cleanup + registry/policy**: `proxy_remove_failed` (dry_run, max_delete); controller candidate/delete methods; `ProxyCheckModel.getProxyByGooglePassStatus`; register; registry + scheduled-policy tests.

## Files
**New**: `src/entityTypes/proxyAiToolTypes.ts`, `src/service/ProxyAiTools.ts`, `test/vitest/main/proxyAiToolTypes.test.ts`, `test/vitest/main/proxyAiTools.test.ts`, `test/vitest/main/proxyAiToolRegistry.test.ts`, `test/vitest/main/proxyAiToolScheduledPolicy.test.ts`
**Modified**: `src/config/skillsRegistry.ts`, `src/controller/proxy-controller.ts`, `src/modules/ProxyModule.ts`, `src/modules/interface/IProxyApi.ts`, `src/model/Proxy.model.ts`, `src/model/ProxyCheck.model.ts`
