# Social Account Password Encryption — Design Spec

**Date:** 2026-06-24
**Status:** Approved (pre-implementation)
**Depends on:** Backend `/api/user/secret-key` endpoint (documented in `marketing/doc/api/secret_key.http`)

## 1. Problem

`SocialAccountEntity.pass` (`src/entity/SocialAccount.entity.ts:22-23`) stores social-media account passwords in plaintext in the local SQLite database. Anyone with read access to the DB file — including malware, backup snoopers, or another OS user — can read every stored password directly.

## 2. Goal

Encrypt the `pass` column at rest using a per-user 32-byte key provided by the backend `/api/user/secret-key` API. The application decrypts transparently on read, so callers (frontend, IPC, workers) see no change in behavior. Decryption never happens without an authenticated session.

## 3. Non-Goals

- Key rotation tooling. Backend v1 never rotates the secret key (per `secret_key.http`); rotation is a manual DB op.
- Batch migration of existing rows. Lazy migration handles legacy plaintext.
- Encrypting other entities or other sensitive fields (cookies, proxy passwords). The utility is reusable for follow-up adoption; only `SocialAccount.pass` is wired up here.
- Replacing the existing `CryptoSource` / `Token` service crypto. Those keep their current responsibilities.
- Electron `safeStorage` integration. Key lives in RAM only.

## 4. Decisions (locked from brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Build reusable utility, apply only to `SocialAccount.pass` now | Foundation for future entities without rework |
| Algorithm | AES-256-GCM | Authenticated encryption; backend doc names it as intended use |
| Key cache | In-memory only (module-level singleton) | Most secure — key never touches disk; one fetch per session |
| Migration | Lazy / on-demand | Legacy plaintext rows return as-is; get encrypted on next save |
| Key-fetch failure | Module fails the operation with a clear error | Never silently store plaintext; never pretend ciphertext is readable |
| Row-decrypt failure | Return `null` for that field, log server-side | One bad row does not break the list view |
| Architecture placement | Module-layer helpers (`SocialAccountModule`) | Matches CLAUDE.md mandate: business logic lives in Module, not Model/IPC |

## 5. Architecture

Three new units under `src/modules/fieldCipher/`, plus wiring in `SocialAccountModule`.

```
┌─────────────────────────────────────────────────────────┐
│  src/modules/fieldCipher/                                │
│                                                          │
│  ┌──────────────┐       ┌────────────────────────┐      │
│  │ FieldCipher  │       │ UserSecretKeyService   │      │
│  │ (pure util)  │       │ (singleton, in-memory)  │      │
│  │              │       │                         │      │
│  │ encrypt()    │◄──────│ getKey(): Promise<Buf>  │      │
│  │ decrypt()    │       │ invalidate()            │      │
│  │ isEncrypted()│       └───────────┬─────────────┘      │
│  └──────────────┘                   │                    │
│                                     │ HTTP GET           │
│                                     ▼                    │
│                        ┌────────────────────────┐        │
│                        │ HttpClient             │        │
│                        │ /api/user/secret-key   │        │
│                        └────────────────────────┘        │
│                                                          │
│  ┌──────────────────────────────────┐                    │
│  │ SecretKeyUnavailableError        │                    │
│  │ (typed error)                    │                    │
│  └──────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────┘

           ▲                           ▲
           │ uses                      │ uses
           │                           │
┌──────────┴────────────┐    ┌─────────┴────────────────┐
│ SocialAccountModule   │    │ HttpClient               │
│                       │    │ (on token refresh →      │
│  encryptPass()        │    │  UserSecretKeyService    │
│  decryptPass()        │    │  .invalidate())          │
│  toDto()              │    └──────────────────────────┘
└───────────────────────┘
```

### 5.1 Components

#### `FieldCipher` — pure utility
- **Location:** `src/modules/fieldCipher/FieldCipher.ts`
- **Responsibilities:** AES-256-GCM encrypt/decrypt, envelope parse/format, envelope detection.
- **No I/O, no state.** Pure functions taking key as parameter.
- **API:**
  - `encrypt(plaintext: string, key: Buffer): string` — returns `ENC1:<base64iv>:<base64ct+tag>`.
  - `decrypt(stored: string, key: Buffer): string` — throws on malformed envelope or GCM tag mismatch.
  - `isEncrypted(value: string): boolean` — cheap prefix check on `ENC1:`.
- **Validation:** `encrypt` requires `key.length === 32`. Throws otherwise.
- **Random IV:** 12-byte cryptographically random IV per `encrypt` call (Node `crypto.randomBytes`).

#### `UserSecretKeyService` — stateful singleton
- **Location:** `src/modules/fieldCipher/UserSecretKeyService.ts`
- **Responsibilities:** Fetch the per-user 32-byte key once per session, cache in memory, invalidate on auth changes.
- **API:**
  - `getKey(): Promise<Buffer>` — returns cached 32-byte key, or fetches via HttpClient.
  - `invalidate(): void` — clears cache. Next `getKey()` re-fetches.
- **Fetch flow:**
  1. Cache hit → return Buffer.
  2. Cache miss → in-flight promise? Await it (dedup concurrent callers).
  3. Otherwise → `HttpClient.get('/api/user/secret-key')` → base64-decode `data.secretKey` → validate `length === 32` → cache → return.
  4. Any failure (network, non-200, missing field, wrong byte length) → throw `SecretKeyUnavailableError`.
- **Not logged in:** HttpClient returns the backend's 403/login-required response. Service throws `SecretKeyUnavailableError`.
- **Singleton:** Exported as a module-level instance (not a class export). Workers do not import this module — workers have no backend session and must not trigger fetches.

#### `SecretKeyUnavailableError` — typed error
- **Location:** `src/modules/fieldCipher/SecretKeyUnavailableError.ts`
- Standard `Error` subclass. Named so callers can `instanceof`-check.

### 5.2 Wiring in `SocialAccountModule`

- Private `encryptPass(plaintext: string | null): Promise<string | null>` — null-safe; returns null for empty input.
- Private `decryptPass(stored: string | null): Promise<string | null>` — null-safe; four branches:
  1. `stored == null` → return null.
  2. `!FieldCipher.isEncrypted(stored)` → return as-is (legacy plaintext, lazy migration).
  3. `FieldCipher.isEncrypted(stored)` → call `UserSecretKeyService.getKey()`:
     - On `SecretKeyUnavailableError` → log `warn`, return null (read stays fail-soft per §8).
     - On success → call `FieldCipher.decrypt`. On any other throw, log `error` with `accountId` and return null.
  4. (Note: `encryptPass` does NOT swallow `SecretKeyUnavailableError` — writes must fail loud.)
- Private `toDto(entity: SocialAccountEntity): Promise<SocialAccountDto>` — single chokepoint mapping entity → response DTO, runs `decryptPass` on `pass`.
- All five read methods (`getSocialAccountList`, `getAccountDetail`, `getAllSocialAccounts`, `getSocialAccountsByStatus`, `getSocialAccountsByPlatform`) route through `toDto`.
- `saveSocialAccount` calls `encryptPass` before writing. On `SecretKeyUnavailableError`, re-throws — never stores plaintext.

### 5.3 HttpClient token-refresh hook

`HttpClient` already refreshes the bearer token on 403. After a successful refresh, it calls `UserSecretKeyService.invalidate()` so the next `getKey()` re-fetches under the new session. One-line addition in the existing refresh path.

## 6. Data Flow

### 6.1 Write path (save account)

```
socialaccountdetail.vue
  → IPC SOCIALACCOUNTSAVE
    → SocialAccountModule.saveSocialAccount(data)
      ↓ data.pass = plaintext from UI input
      → encryptPass(data.pass)
        → UserSecretKeyService.getKey() (cache hit on warm session)
        → FieldCipher.encrypt(plaintext, key)
      ↓ data.pass = "ENC1:<iv>:<ct>"
      → SocialAccountModel.saveSocialAccount(entity)
        → DB row: pass = "ENC1:<iv>:<ct>"
```

### 6.2 Read path (list/detail)

```
Caller → SocialAccountModule.getSocialAccountList(...)
  → SocialAccountModel.getSocialAccountList(...)
    → DB rows: pass = "ENC1:<iv>:<ct>"
  → for each row: toDto(entity)
    → decryptPass(entity.pass)
      → FieldCipher.isEncrypted? yes
      → FieldCipher.decrypt → plaintext
    ↓ DTO pass = plaintext
  → response → IPC → frontend (unchanged behavior)
```

### 6.3 Lazy migration (legacy plaintext row)

```
read → toDto → decryptPass("myOldPassword123")
  → FieldCipher.isEncrypted("myOldPassword123") = false
  → return "myOldPassword123" as-is (NOT null — we know it's a legacy value)
next save → encryptPass("myOldPassword123") → DB now stores "ENC1:..."
```

**Critical asymmetry:**
- `isEncrypted=false` → "treat as plaintext, return it" (legacy compatibility).
- `isEncrypted=true` + GCM tag mismatch → "corrupt or wrong key" → return `null` + log.

This distinction is what makes lazy migration safe: legacy plaintext is never mistaken for corrupt ciphertext.

### 6.4 Key fetch (first call per session)

```
UserSecretKeyService.getKey()
  → cache hit? return Buffer
  → cache miss, in-flight promise exists? await it (dedup)
  → otherwise HttpClient.get('/api/user/secret-key')
    → 200 { status: true, data: { secretKey: "q83v..." } }
    → base64 decode → 32 bytes? validate → cache → return
    → any failure → throw SecretKeyUnavailableError
```

## 7. Envelope Format

```
ENC1:<base64iv>:<base64ciphertext+tag>

ENC1              literal prefix (detection)
:                 separator
<base64iv>        12-byte IV, base64 (16 chars)
:                 separator
<base64ciphertext+tag>
                  ciphertext + 16-byte GCM auth tag, base64
```

Version prefix (`ENC1`) lets the format evolve later without breaking old rows. `isEncrypted` only checks the prefix; `decrypt` parses strictly and throws on malformed input.

## 8. Error Handling

| Class | Trigger | Module behavior |
|---|---|---|
| Key unavailable | Backend down, not logged in, malformed response | Read: every `pass` returns null, list renders, log warn. Write: re-throw, IPC surfaces error to user. |
| Decryption failure | GCM tag mismatch (corrupt row or wrong key) | Return null for that row's pass only, log error with accountId. Other rows unaffected. |
| Legacy plaintext | Row was written before encryption shipped | Return value as-is. Lazy migration: encrypts on next save. Not an error. |

**Error code surface (new, for IPC):**
- Module returns `{ status: false, msg: 'account.encryption_unavailable' }` when save fails due to key unavailability. Frontend uses `t('account.encryption_unavailable')` with English fallback.

**Security boundary rules:**
- Plaintext password exists only in: RAM during the call, IPC response to authenticated renderer, or user input field.
- Never logged. Never sent to backend. Never persisted to disk.

## 9. Security Considerations

- **Authenticated encryption:** AES-256-GCM's auth tag detects tampering and corruption. A bit-flip in the ciphertext causes a deterministic decryption failure, not silent corruption.
- **Random IV per encryption:** 12-byte crypto-random IV prevents the same plaintext producing the same ciphertext across rows.
- **Key in RAM only:** The 32-byte key is never written to disk by this code. On app exit, the OS reclaims the memory. No keyfile, no env var, no ElectronStore.
- **Per-user key scope:** The backend binds the key to the authenticated user. A different user on the same machine has their own key and cannot decrypt this user's rows.
- **Plaintext on the wire:** The secret key travels over HTTPS from backend → app, same as the user's bearer token. The backend already stores it as AES-256-GCM ciphertext (per `secret_key.http`). We rely on HTTPS for transport security; we do not re-engineer that here.
- **No key rotation:** v1 contract. If compromise is suspected, the backend DBA clears the `secret_key` column; the next `/api/user/secret-key` call generates a new key. Note: this renders previously-encrypted `social_accounts.pass` values undecryptable. Users would need to re-enter passwords. This is an accepted limitation for v1.

## 10. Testing

Coverage target: `FieldCipher` and `UserSecretKeyService` at 100% (small, security-critical). `SocialAccountModule` additions at 80%+.

### 10.1 `FieldCipher` (Vitest, pure utility)

- Round-trip: `encrypt` → `decrypt` returns original.
- Wrong key → throws (GCM tag mismatch).
- Tampered ciphertext → throws.
- `isEncrypted` true on `ENC1:...`, false on other strings.
- Invalid key length (31 / 33 bytes) → throws on `encrypt`.
- Empty string input → encrypts and decrypts successfully.
- Envelope format verifiable: matches `ENC1:<b64iv>:<b64ct>`.

### 10.2 `UserSecretKeyService` (Vitest, mock HttpClient)

- First `getKey()` calls HttpClient once, returns 32-byte buffer.
- Second `getKey()` returns cached buffer, no HTTP call.
- `invalidate()` forces re-fetch on next call.
- Backend 4xx / network error → throws `SecretKeyUnavailableError`.
- Malformed response (not base64, wrong byte length, missing `data.secretKey`) → throws.
- Concurrent first calls → one HTTP fetch, both callers get same buffer.

### 10.3 `SocialAccountModule` (Mocha, mock Model + service)

- `saveSocialAccount` with plaintext pass → Model receives `ENC1:...`.
- `saveSocialAccount` with null pass → Model receives null (no encrypt call).
- `saveSocialAccount` when key unavailable → throws, Model NOT called.
- `getSocialAccountList` with ciphertext rows → DTOs contain plaintext.
- `getSocialAccountList` with legacy plaintext rows → DTOs return as-is (lazy migration).
- `getSocialAccountList` with one corrupt row → that row's pass is null, others unaffected, no throw.
- `getSocialAccountList` when key unavailable → all passes null, no throw.
- Parametrized coverage of all five read methods via `toDto` (one test per method is enough since `toDto` is the shared chokepoint).

### 10.4 Fixtures

- Pre-computed 32-byte key + known ciphertext vector for AES-GCM correctness (deterministic IV in test only).
- Mock `SocialAccountModel` returning canned entity arrays.

## 11. File Layout

### New files
```
src/modules/fieldCipher/
├── FieldCipher.ts                    # pure AES-256-GCM utility
├── UserSecretKeyService.ts           # singleton, in-memory cache
├── SecretKeyUnavailableError.ts      # typed error
└── index.ts                          # barrel export
```

### Test files
```
test/vitest/utilitycode/
└── fieldCipher.test.ts               # FieldCipher + UserSecretKeyService

test/modules/
└── socialAccountModule.cipher.test.ts # SocialAccountModule crypto integration
```

### Modified files
- `src/modules/socialAccountModule.ts` — add `toDto`, `encryptPass`, `decryptPass`; wire into 5 read methods + 1 save method.
- `src/modules/lib/httpclient.ts` — call `UserSecretKeyService.invalidate()` after successful token refresh.
- `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` — add `account.encryption_unavailable` key.

### Untouched
- `src/entity/SocialAccount.entity.ts` — column type stays varchar. Ciphertext fits.
- `src/model/SocialAccount.model.ts` — no crypto awareness. Pure data access.
- `src/main-process/communication/socialaccount-ipc.ts` — no changes.
- Frontend components — no changes; they receive plaintext as before.
- Worker processes — no changes; they never touch `pass`.

## 12. Rollout

Each step is one atomic commit, per CLAUDE.md auto-commit rule.

1. `FieldCipher` + tests → commit.
2. `SecretKeyUnavailableError` + `UserSecretKeyService` + tests → commit.
3. i18n key in all 6 language files → commit.
4. `SocialAccountModule` wiring + tests → commit.
5. `HttpClient` token-refresh hook → commit.

## 13. Acceptance Criteria

- [ ] Saving a social account with a password stores `ENC1:...` in the DB, not plaintext.
- [ ] Reading accounts returns plaintext to the frontend (behavior unchanged for end users).
- [ ] A plaintext password written before this feature shipped still reads correctly (lazy migration).
- [ ] Backend unavailable on read → list still renders, password fields blank.
- [ ] Backend unavailable on write → save fails with a clear error, nothing stored.
- [ ] DB inspection confirms no plaintext passwords after first save.
- [ ] Worker processes never import `UserSecretKeyService` (confirmed by import audit).
- [ ] `FieldCipher` and `UserSecretKeyService` test coverage at 100%.
- [ ] `SocialAccountModule` test coverage at 80%+.
