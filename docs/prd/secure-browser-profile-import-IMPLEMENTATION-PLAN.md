# Implementation Plan — Secure Social Account Sessions & Browser Profile Import

Companion to `social-account-secure-browser-profile-import-prd.md` and its technical design.
This document captures scope decisions, deviations, file-by-file changes, commit sequence,
and test strategy for the actual implementation.

## 1. Scope decision

| Phase | Scope this implementation | Status |
|---|---|---|
| **1. Secure cookie persistence** (encrypt at rest + migration + route all writes) | FULL | Build + test |
| **2. Stable account sessions** (manifest + stable partitions + multi-domain capture + cleanup) | FULL | Build + test |
| **3a. Browser-profile import — in-app layer** (request registry + state machine + one-time token + native-messaging protocol schemas + native-host relay child process + IPC + Vue dialog + i18n + tests with mocked transport) | FULL | Build + test; **feature-gated OFF** |
| **3b. External** (signed/published Chromium extension packaging, OS-installer registration of native-host manifest on Windows/macOS/Linux, real cross-browser QA) | DEFERRED | Author extension source skeleton + native-host manifest assets, but leave flag OFF. Requires OS runners + store submission (design Open Implementation Decisions #1–#2). |

Rationale: the design's own rollout (§15) gates browser-profile import behind a main-process
feature flag and defers real QA. Everything up to that flag is in-repo and testable with mocks
(design §14.3). The external packaging/QA cannot be built or verified in this environment.

## 2. Deviations from the technical design (with rationale)

1. **Zod version**: design §5.3 says `import { z } from "zod/v4"`. The codebase standard is
   `import { z } from "zod"` (zod 3.25.x), and `registerValidatedHandler` is typed against the
   v3 `ZodType`. Mixing v3/v4 `ZodType` across the validated-handler boundary causes TS friction.
   v3 has every capability needed (`strictObject`, `enum`, `discriminatedUnion`, `refine`).
   **Decision: use `import { z } from "zod"` (v3) consistently.** No capability lost.
2. **Model layer stays ciphertext-only** (design §4.2/§8.1) — do NOT take the "encrypt inside
   `AccountCookies.model.ts`" shortcut. All encrypt/decrypt lives in `AccountSessionService`.
   This is the security-correct choice the PRD mandates; it means ~7 read sites + ~3 write sites
   must be routed through the service rather than left untouched.
3. **`SOCIAL_ACCOUNT_LOGIN` and `show:platformpage` stay event-based (`send`+`receive`)** because
   they open a long-lived `BrowserWindow` and stream multiple messages — converting to `invoke`
   would create promises that never resolve. They are hardened with a Zod `.parse()` guard at the
   handler top and route persistence through the service. The simple request/response channels
   (`upload:cookies`, `clean:cookies`) ARE migrated to validated `invoke`.

## 3. File-by-file changes

### New files
| File | Purpose |
|---|---|
| `src/schemas/accountCookies.ts` | Zod cookie schema (normalized cookie), source adapters, session-metadata schema |
| `src/schemas/ipc/browserProfileImport.ts` | Zod IPC input schemas for the 4 new browser-import channels + session metadata |
| `src/schemas/nativeMessaging.ts` | Zod schemas for the extension↔native-host↔main protocol (import_request, import_result) |
| `src/modules/PlatformSessionManifest.ts` | Pure-data platform→domain allowlist + startup validation + `matchesAllowedDomain` |
| `src/modules/accountSession/cookieNormalize.ts` | Netscape/Electron/Chromium/Puppeteer → normalized cookie adapters + dedupe + expiry filter |
| `src/modules/accountSession/partitionResolve.ts` | `persist:social-account-<id>` resolution + validation |
| `src/modules/AccountSessionService.ts` | Sole service that encrypts/decrypts/applies/captures/migrates (extends `BaseModule`) |
| `src/main-process/browserProfileImport/ImportRequestRegistry.ts` | In-memory one-time request store + state machine + token |
| `src/main-process/browserProfileImport/BrowserImportCoordinator.ts` | Wires registry + native-host relay + `AccountSessionService.persistSnapshot` |
| `src/childprocess/browserProfileNativeHost.ts` | Native-messaging child process entry (relay only; no Electron/DB/key access) |
| `src/config/featureFlags.ts` | `BROWSER_PROFILE_IMPORT_ENABLED` flag (main-process; default `false`) |
| `src/views/components/socialaccount/BrowserProfileImportDialog.vue` | Pairing/result dialog |
| `browser-extension/manifest.json`, `background.ts`, `popup.html` | Reviewed-but-disabled MV3 extension skeleton |
| `native-host/aifetchly-browser-import-host.json` | Native-host manifest template (Windows/macOS/Linux paths) |
| Tests under `test/vitest/main/` + `test/vitest/utilitycode/` | Unit + integration coverage |

### Changed files
| File | Change |
|---|---|
| `src/entity/AccountCookies.entity.ts` | Add nullable metadata columns (encryption_version, source, cookie_count, session_status, last_error_code, migration_attempted_at). `synchronize:true` auto-adds them. |
| `src/sql/scraperdb/account_cookies.sql` | Update doc-only schema for consistency. |
| `src/model/AccountCookies.model.ts` | Add ciphertext-only methods: `saveEncryptedSnapshot`, `getRawCookieRow`, `getLegacyCandidateRows`, `updateRowEncrypted`, `markRowInvalid`. Existing `saveAccountCookies`/`getAccountCookies` become ciphertext-passthrough (used only by the service). |
| `src/modules/accountCookiesModule.ts` | Thin delegate; `genPartitionPath` deprecated in favor of service resolver. |
| `src/controller/socialaccount-controller.ts` | Replace random partition, single-URL capture, unawaited plaintext save, `console.log(cookieDetails)`. Use `AccountSessionService` for apply/capture/persist/clear. Multi-domain capture via `session.cookies.get({})` + manifest filter. |
| `src/modules/SearchModule.ts` | `updateAccountCookies` → `accountSessionService.persistSnapshot({source:"worker_refresh"})`. Preflight (l.660-678) + worker-feed (l.947-952) → `service.getDecryptedSnapshot()`. |
| `src/modules/socialAccountModule.ts` | `hasCookies` (l.117-127) → `service.getMetadata()`; never parses cookies. |
| `src/modules/YellowPagesProcessManager.ts` | l.238-240 → `service.getDecryptedSnapshot()`. |
| `src/main-process/communication/googleMaps-ipc.ts` | l.58-65 → service plaintext read. |
| `src/main-process/communication/yandexMaps-ipc.ts` | l.66-72 → service plaintext read. |
| `src/config/skillsRegistry.ts` | l.134-150 → `service.getMetadata()` presence. |
| `src/config/channellist.ts` | Add 5 new channel constants. |
| `src/preload.ts` | Add new channels to `invoke` whitelist; add import-event channel to `receive`+`removeListener`. |
| `src/main-process/communication/socialaccount-ipc.ts` | Migrate `clean:cookies` + `upload:cookies` to validated invoke; harden `login`+`show:platformpage` with Zod guard; add `session:metadata` + 4 browser-import handlers; schedule migration after key fetch. |
| `src/schemas/ipc/socialAccount.ts` | Add `socialAccountSessionMetadataInputSchema` (reuse `socialAccountByIdInputSchema`). |
| `src/views/api/socialaccount.ts` | Typed `windowInvoke` wrappers for new channels; switch `cleanCookies`/`requireCookiesselecttab` to invoke. |
| `src/views/pages/socialaccount/widgets/SocialaccountTable.vue` | Session-status column + "Import from browser profile" action. |
| `src/views/pages/socialaccount/socialaccountdetail.vue` | Import button + status indicator. |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | All new keys, 6 languages. |

### Removed (after verification)
| File | Reason |
|---|---|
| `src/model/accountCookiesdb.ts` | Legacy raw-SQL duplicate, no external callers (verify with `codegraph_callers` first). |

## 4. Commit sequence (auto-commit per logical unit)

1. `feat(schemas): zod cookie + normalization schemas` (+ tests)
2. `feat(manifest): platform session domain manifest` (+ tests)
3. `feat(entity): account_cookies metadata columns` (+ sql doc)
4. `feat(model): ciphertext-only account cookie persistence methods`
5. `feat(service): AccountSessionService encrypt/decrypt/migrate/partition` (+ tests)
6. `refactor(controller): stable partition, multi-domain capture, encrypted save, redact logs`
7. `refactor(search): route worker cookie refresh through AccountSessionService`
8. `refactor(reads): route all cookie read sites through session service`
9. `feat(ipc): validated cookie + session-metadata + browser-import channels` (+ preload whitelist)
10. `feat(ui): session status + browser-profile import dialog` (+ 6-lang i18n)
11. `feat(browser-import): request registry, native-host relay, protocol, feature flag` (+ tests)
12. `chore: remove dead accountCookiesdb.ts`
13. `test: integration coverage + final tsc/vitest gate`

## 5. Test strategy

- **Unit (`test/vitest/utilitycode/`)**: FieldCipher envelope (existing) + cookie normalization/dedupe/expiry/manifest-matching/partition-validation/native-protocol schemas.
- **Service (`test/vitest/main/`)**: encrypted write/decrypt, key-unavailable refusal (no plaintext fallback), GCM tamper → invalid, legacy migration valid/idempotent/bounded/preserves-invalid-rows, partition reuse + cleanup scope.
- **IPC (`test/vitest/main/`)**: every new handler rejects malformed input; metadata response has no `cookies` field; unsupported platform can't start pairing; cancel can't touch another account's request.
- **Integration (`test/vitest/main/`)**: temp SQLite + mocked secret-key service → encrypted round-trip + lazy migration; mocked Electron `Session` → multi-domain capture/filter/clearStorageData args; mocked native transport → import state machine success/deny/expire/replay/oversize/no-eligible.
- **Gate**: `yarn vue-check` (one-shot) + `yarn tsc` (one-shot) + `vitest --config vite.main.config.mjs` + `vitest --config vite.utilityCode.config.mjs`. better-sqlite3 ABI rebuild if needed.

## 6. Explicit non-goals / deferred (call out in final status)

- Signed/published Chromium extension + store submission.
- OS-installer registration of native-host manifest (Windows registry / macOS plist / Linux chrome-native-messaging dirs).
- Real Chrome/Edge/Brave cross-OS QA.
- Database foreign key on `account_cookies.account_id` (design explicitly defers until orphan audit).
