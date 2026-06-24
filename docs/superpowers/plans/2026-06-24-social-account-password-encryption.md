# Social Account Password Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt `SocialAccountEntity.pass` at rest with AES-256-GCM using a per-user 32-byte key fetched from the backend `/api/user/secret-key` API, decrypted transparently on read.

**Architecture:** Three new units under `src/modules/fieldCipher/` (`FieldCipher` pure utility, `UserSecretKeyService` singleton with in-memory key cache, `SecretKeyUnavailableError` typed error). `SocialAccountModule` gains `encryptPass`/`decryptPass`/`decryptPasses` helpers that route every read through decryption and every write through encryption. `HttpClient` invalidates the cached key after a successful token refresh. Lazy migration: rows without the `ENC1:` envelope prefix are returned as-is and encrypted on next save.

**Tech Stack:** TypeScript, Node.js `crypto` (AES-256-GCM), TypeORM entities, existing `HttpClient` + `Token` infrastructure, Vitest (utility tests), Mocha + expect.js (module tests).

**Spec:** `docs/superpowers/specs/2026-06-24-social-account-password-encryption-design.md`

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `src/modules/fieldCipher/SecretKeyUnavailableError.ts` | Typed error subclass |
| `src/modules/fieldCipher/FieldCipher.ts` | Pure AES-256-GCM encrypt/decrypt + envelope format |
| `src/modules/fieldCipher/UserSecretKeyService.ts` | Singleton: fetch key once per session, cache in memory, invalidate on auth change |
| `src/modules/fieldCipher/index.ts` | Barrel re-export |
| `test/vitest/utilitycode/fieldCipher.test.ts` | Vitest: FieldCipher + UserSecretKeyService tests |
| `test/modules/socialAccountModule.cipher.test.ts` | Mocha: SocialAccountModule crypto integration |

### Modified files
| Path | Change |
|---|---|
| `src/entityTypes/socialaccount-type.ts` | Widen `pass` to `string \| null` on `SocialAccountListData` (line 20) and `SocialAccountDetailData` (line 31) |
| `src/modules/socialAccountModule.ts` | Add `encryptPass`, `decryptPass`, `decryptPasses` helpers; wire into 5 read methods + 1 save method; detect `SecretKeyUnavailableError` in save catch |
| `src/modules/lib/httpclient.ts` | Call `userSecretKeyService.invalidate()` after successful token refresh in `_refreshTokenAndRetry` (line ~134) and `postStream` (line ~429) |
| `src/views/lang/en.ts` | Add `account.encryption_unavailable` key (line ~691) |
| `src/views/lang/zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` | Same key, translated |

---

## Task 1: `SecretKeyUnavailableError`

**Files:**
- Create: `src/modules/fieldCipher/SecretKeyUnavailableError.ts`

- [ ] **Step 1: Create the error class**

```typescript
// src/modules/fieldCipher/SecretKeyUnavailableError.ts

/**
 * Thrown when the per-user secret key cannot be obtained from the backend
 * (network failure, not logged in, malformed response).
 *
 * Callers MUST treat this as "I cannot perform crypto safely" —
 * - On WRITE: re-throw or surface to user. Never store plaintext.
 * - On READ:  fail-soft (return null) for the encrypted field and keep rendering.
 */
export class SecretKeyUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SecretKeyUnavailableError";
    // Restore prototype chain after ES5 target compilation (tsconfig target)
    Object.setPrototypeOf(this, SecretKeyUnavailableError.prototype);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/fieldCipher/SecretKeyUnavailableError.ts
git commit -m "feat(cipher): add SecretKeyUnavailableError typed error"
```

---

## Task 2: `FieldCipher` — AES-256-GCM utility (TDD)

**Files:**
- Create: `test/vitest/utilitycode/fieldCipher.test.ts`
- Create: `src/modules/fieldCipher/FieldCipher.ts`

**Envelope format:** `ENC1:<base64iv>:<base64ciphertext+tag>`
- 12-byte IV (crypto-random per encrypt).
- AES-256-GCM appends a 16-byte auth tag to the ciphertext (Node `cipher.getAuthTag()`).
- Version prefix lets the format evolve without breaking old rows.

- [ ] **Step 1: Write the failing test file**

Create `test/vitest/utilitycode/fieldCipher.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";

// Deterministic 32-byte key for tests (DO NOT use in production).
const TEST_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex"
);

describe("FieldCipher.isEncrypted", () => {
  it("returns true for an ENC1: envelope", () => {
    expect(FieldCipher.isEncrypted("ENC1:aaaa:bbbb")).toBe(true);
  });

  it("returns false for a plaintext string", () => {
    expect(FieldCipher.isEncrypted("my-password-123")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(FieldCipher.isEncrypted("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(FieldCipher.isEncrypted(null as unknown as string)).toBe(false);
  });

  it("returns false for a different version prefix", () => {
    expect(FieldCipher.isEncrypted("ENC2:aaaa:bbbb")).toBe(false);
  });
});

describe("FieldCipher.encrypt", () => {
  it("produces an ENC1: envelope matching the documented format", () => {
    const out = FieldCipher.encrypt("hello", TEST_KEY);
    expect(out).toMatch(/^ENC1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  it("produces a different ciphertext for the same plaintext (random IV)", () => {
    const a = FieldCipher.encrypt("same", TEST_KEY);
    const b = FieldCipher.encrypt("same", TEST_KEY);
    expect(a).not.toEqual(b);
  });

  it("throws on a 31-byte key", () => {
    const shortKey = Buffer.alloc(31, 0xab);
    expect(() => FieldCipher.encrypt("x", shortKey)).toThrow();
  });

  it("throws on a 33-byte key", () => {
    const longKey = Buffer.alloc(33, 0xab);
    expect(() => FieldCipher.encrypt("x", longKey)).toThrow();
  });

  it("accepts an empty string plaintext", () => {
    const out = FieldCipher.encrypt("", TEST_KEY);
    expect(FieldCipher.isEncrypted(out)).toBe(true);
  });
});

describe("FieldCipher.decrypt", () => {
  it("round-trips an encrypt() output back to the original plaintext", () => {
    const plaintext = "super-secret-password-123!";
    const encrypted = FieldCipher.encrypt(plaintext, TEST_KEY);
    expect(FieldCipher.decrypt(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it("round-trips an empty plaintext", () => {
    const encrypted = FieldCipher.encrypt("", TEST_KEY);
    expect(FieldCipher.decrypt(encrypted, TEST_KEY)).toBe("");
  });

  it("throws when the auth tag does not verify (wrong key)", () => {
    const encrypted = FieldCipher.encrypt("secret", TEST_KEY);
    const wrongKey = Buffer.alloc(32, 0x00);
    expect(() => FieldCipher.decrypt(encrypted, wrongKey)).toThrow();
  });

  it("throws on a tampered ciphertext (bit flipped)", () => {
    const encrypted = FieldCipher.encrypt("secret", TEST_KEY);
    // Flip the last char of the ciphertext portion.
    const parts = encrypted.split(":");
    const tampered = parts[2].slice(0, -2) + (parts[2].slice(-2) === "AA" ? "BB" : "AA");
    const malformed = `${parts[0]}:${parts[1]}:${tampered}`;
    expect(() => FieldCipher.decrypt(malformed, TEST_KEY)).toThrow();
  });

  it("throws on a malformed envelope (missing parts)", () => {
    expect(() => FieldCipher.decrypt("ENC1:onlyonepart", TEST_KEY)).toThrow();
  });

  it("throws on a malformed envelope (wrong prefix)", () => {
    expect(() => FieldCipher.decrypt("ENC2:aa:bb", TEST_KEY)).toThrow();
  });

  it("throws on a 31-byte key", () => {
    const encrypted = FieldCipher.encrypt("x", TEST_KEY);
    const shortKey = Buffer.alloc(31, 0xab);
    expect(() => FieldCipher.decrypt(encrypted, shortKey)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

```bash
yarn vitest-puppeteer -- fieldCipher
```

Expected: FAIL — `Cannot find module '@/modules/fieldCipher/FieldCipher'`.

- [ ] **Step 3: Implement `FieldCipher`**

Create `src/modules/fieldCipher/FieldCipher.ts`:

```typescript
import crypto from "crypto";

/**
 * Envelope format: ENC1:<base64iv>:<base64ciphertext+tag>
 *
 * - ENC1: literal version prefix (lets the format evolve without breaking old rows).
 * - <base64iv>: 12-byte GCM IV, base64 (16 chars).
 * - <base64ciphertext+tag>: AES-256-GCM ciphertext + 16-byte auth tag, base64.
 */
const PREFIX = "ENC1";
const IV_LENGTH = 12; // AES-GCM standard IV length
const KEY_LENGTH = 32; // AES-256
const TAG_LENGTH = 16; // AES-GCM auth tag

export class FieldCipher {
  /**
   * Returns true if the stored value looks like an ENC1: envelope.
   * Cheap prefix check only — does not validate the payload.
   */
  static isEncrypted(value: string | null | undefined): boolean {
    return typeof value === "string" && value.startsWith(`${PREFIX}:`);
  }

  /**
   * Encrypts plaintext into an ENC1: envelope using AES-256-GCM.
   * A fresh 12-byte IV is used per call; never reuse an IV with the same key.
   *
   * @throws Error if key.length !== 32.
   */
  static encrypt(plaintext: string, key: Buffer): string {
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `FieldCipher.encrypt: key must be ${KEY_LENGTH} bytes (got ${key.length})`
      );
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      PREFIX,
      iv.toString("base64"),
      Buffer.concat([ciphertext, tag]).toString("base64"),
    ].join(":");
  }

  /**
   * Decrypts an ENC1: envelope back to plaintext.
   *
   * @throws Error if the envelope is malformed.
   * @throws Error if the GCM auth tag does not verify (tampered or wrong key).
   * @throws Error if key.length !== 32.
   */
  static decrypt(stored: string, key: Buffer): string {
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `FieldCipher.decrypt: key must be ${KEY_LENGTH} bytes (got ${key.length})`
      );
    }

    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== PREFIX) {
      throw new Error(
        `FieldCipher.decrypt: malformed envelope (expected "${PREFIX}:<iv>:<ct>")`
      );
    }

    const iv = Buffer.from(parts[1], "base64");
    const payload = Buffer.from(parts[2], "base64");

    if (iv.length !== IV_LENGTH) {
      throw new Error(
        `FieldCipher.decrypt: IV must be ${IV_LENGTH} bytes (got ${iv.length})`
      );
    }
    if (payload.length < TAG_LENGTH) {
      throw new Error(
        `FieldCipher.decrypt: payload too short to contain a ${TAG_LENGTH}-byte auth tag`
      );
    }

    const ciphertext = payload.subarray(0, payload.length - TAG_LENGTH);
    const tag = payload.subarray(payload.length - TAG_LENGTH);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
```

- [ ] **Step 4: Run the test to verify it passes (GREEN)**

```bash
yarn vitest-puppeteer -- fieldCipher
```

Expected: PASS — all FieldCipher tests green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fieldCipher/FieldCipher.ts test/vitest/utilitycode/fieldCipher.test.ts
git commit -m "feat(cipher): add FieldCipher AES-256-GCM utility with tests"
```

---

## Task 3: `UserSecretKeyService` — singleton key cache (TDD)

**Files:**
- Create: `test/vitest/utilitycode/fieldCipher.test.ts` (append new `describe` blocks)
- Create: `src/modules/fieldCipher/UserSecretKeyService.ts`
- Create: `src/modules/fieldCipher/index.ts` (barrel)

**Singleton pattern:** export both the class (for testability with dependency injection) and a module-level instance (for production use). `HttpClient` imports the singleton.

**Circular import note:** `UserSecretKeyService` imports `HttpClient`; `httpclient.ts` imports `userSecretKeyService` (Task 5). This is safe in ES modules because each module only references the other inside methods, never at module load time.

- [ ] **Step 1: Append the failing test for `UserSecretKeyService`**

Append to `test/vitest/utilitycode/fieldCipher.test.ts`:

```typescript
import { beforeEach, vi } from "vitest";
import {
  UserSecretKeyService,
  userSecretKeyService,
} from "@/modules/fieldCipher/UserSecretKeyService";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";

// A 32-byte base64-encoded key, matching the backend response shape.
const VALID_B64_KEY = Buffer.alloc(32, 0x42).toString("base64");

function makeMockedHttpClient(getImpl: () => Promise<unknown>) {
  return {
    get: vi.fn().mockImplementation(getImpl),
  } as unknown as ConstructorParameters<typeof UserSecretKeyService>[0];
}

describe("UserSecretKeyService.getKey", () => {
  beforeEach(() => {
    userSecretKeyService.invalidate();
  });

  it("returns a 32-byte buffer on first call", async () => {
    const mock = makeMockedHttpClient(async () => ({
      status: true,
      data: { secretKey: VALID_B64_KEY },
    }));
    const service = new UserSecretKeyService(mock);
    const key = await service.getKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    expect(mock.get).toHaveBeenCalledTimes(1);
  });

  it("caches the key — second call does not hit the network", async () => {
    const mock = makeMockedHttpClient(async () => ({
      status: true,
      data: { secretKey: VALID_B64_KEY },
    }));
    const service = new UserSecretKeyService(mock);
    await service.getKey();
    await service.getKey();
    expect(mock.get).toHaveBeenCalledTimes(1);
  });

  it("invalidate() forces re-fetch on next call", async () => {
    const mock = makeMockedHttpClient(async () => ({
      status: true,
      data: { secretKey: VALID_B64_KEY },
    }));
    const service = new UserSecretKeyService(mock);
    await service.getKey();
    service.invalidate();
    await service.getKey();
    expect(mock.get).toHaveBeenCalledTimes(2);
  });

  it("throws SecretKeyUnavailableError on network failure", async () => {
    const mock = makeMockedHttpClient(async () => {
      throw new Error("network down");
    });
    const service = new UserSecretKeyService(mock);
    await expect(service.getKey()).rejects.toBeInstanceOf(
      SecretKeyUnavailableError
    );
  });

  it("throws SecretKeyUnavailableError when response is missing data.secretKey", async () => {
    const mock = makeMockedHttpClient(async () => ({
      status: true,
      data: {},
    }));
    const service = new UserSecretKeyService(mock);
    await expect(service.getKey()).rejects.toBeInstanceOf(
      SecretKeyUnavailableError
    );
  });

  it("throws SecretKeyUnavailableError when key is not 32 bytes", async () => {
    const tooShort = Buffer.alloc(31, 0x42).toString("base64");
    const mock = makeMockedHttpClient(async () => ({
      status: true,
      data: { secretKey: tooShort },
    }));
    const service = new UserSecretKeyService(mock);
    await expect(service.getKey()).rejects.toBeInstanceOf(
      SecretKeyUnavailableError
    );
  });

  it("dedups concurrent first calls into one HTTP fetch", async () => {
    const mock = makeMockedHttpClient(async () => ({
      status: true,
      data: { secretKey: VALID_B64_KEY },
    }));
    const service = new UserSecretKeyService(mock);
    const [a, b] = await Promise.all([service.getKey(), service.getKey()]);
    expect(a.equals(b)).toBe(true);
    expect(mock.get).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight promise after a failed fetch so the next call retries", async () => {
    let calls = 0;
    const mock = makeMockedHttpClient(async () => {
      calls++;
      if (calls === 1) throw new Error("first fails");
      return { status: true, data: { secretKey: VALID_B64_KEY } };
    });
    const service = new UserSecretKeyService(mock);
    await expect(service.getKey()).rejects.toBeInstanceOf(
      SecretKeyUnavailableError
    );
    const key = await service.getKey();
    expect(key.length).toBe(32);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

```bash
yarn vitest-puppeteer -- fieldCipher
```

Expected: FAIL — `Cannot find module '@/modules/fieldCipher/UserSecretKeyService'`.

- [ ] **Step 3: Implement `UserSecretKeyService`**

Create `src/modules/fieldCipher/UserSecretKeyService.ts`:

```typescript
import { HttpClient } from "@/modules/lib/httpclient";
import { SecretKeyUnavailableError } from "./SecretKeyUnavailableError";

const SECRET_KEY_ENDPOINT = "/api/user/secret-key";
const KEY_LENGTH = 32; // AES-256

/**
 * Fetches the per-user 32-byte secret key from the backend and caches it
 * in memory for the lifetime of the process. The key is NEVER persisted
 * to disk by this service.
 *
 * Singleton: use the exported `userSecretKeyService` instance. The class
 * is also exported so tests can inject a mock HttpClient.
 *
 * Workers MUST NOT import this module — workers have no backend session.
 */
export class UserSecretKeyService {
  private cachedKey: Buffer | null = null;
  private inflight: Promise<Buffer> | null = null;

  constructor(private httpClient: HttpClient = new HttpClient()) {}

  /**
   * Returns the cached 32-byte key, fetching it on first call.
   * Concurrent callers await the same in-flight promise (dedup).
   *
   * @throws SecretKeyUnavailableError if the key cannot be obtained.
   */
  async getKey(): Promise<Buffer> {
    if (this.cachedKey) {
      return this.cachedKey;
    }
    if (!this.inflight) {
      this.inflight = this.fetchKey()
        .then((key) => {
          this.cachedKey = key;
          return key;
        })
        .catch((err) => {
          // Clear the in-flight promise so the next call can retry.
          this.inflight = null;
          throw err instanceof SecretKeyUnavailableError
            ? err
            : new SecretKeyUnavailableError(
                "Failed to load secret key from backend",
                err
              );
        })
        .finally(() => {
          // Keep the resolved promise from blocking retries — the cachedKey
          // is already set on success, so we can drop the in-flight handle.
          if (this.cachedKey) {
            this.inflight = null;
          }
        });
    }
    return this.inflight;
  }

  /**
   * Clears the cached key. The next getKey() call re-fetches from the backend.
   * Called by HttpClient after a successful token refresh (the new session
   * may have a different secret key) and on logout/login transitions.
   */
  invalidate(): void {
    this.cachedKey = null;
    this.inflight = null;
  }

  private async fetchKey(): Promise<Buffer> {
    let response: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = await this.httpClient.get<any>(SECRET_KEY_ENDPOINT);
    } catch (err) {
      throw new SecretKeyUnavailableError(
        "Failed to reach secret-key endpoint",
        err
      );
    }

    // Backend envelope: { status: true, data: { secretKey: "base64..." } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (response as any)?.data;
    const secretKey = data?.secretKey;
    if (typeof secretKey !== "string" || secretKey.length === 0) {
      throw new SecretKeyUnavailableError(
        "Secret-key response missing data.secretKey"
      );
    }

    let key: Buffer;
    try {
      key = Buffer.from(secretKey, "base64");
    } catch (err) {
      throw new SecretKeyUnavailableError(
        "Secret-key response is not valid base64",
        err
      );
    }

    if (key.length !== KEY_LENGTH) {
      throw new SecretKeyUnavailableError(
        `Secret key must be ${KEY_LENGTH} bytes (got ${key.length})`
      );
    }

    return key;
  }
}

// Module-level singleton for production use. Tests instantiate the class directly.
export const userSecretKeyService = new UserSecretKeyService();
```

- [ ] **Step 4: Create the barrel export**

Create `src/modules/fieldCipher/index.ts`:

```typescript
export { FieldCipher } from "./FieldCipher";
export { UserSecretKeyService, userSecretKeyService } from "./UserSecretKeyService";
export { SecretKeyUnavailableError } from "./SecretKeyUnavailableError";
```

- [ ] **Step 5: Run the test to verify it passes (GREEN)**

```bash
yarn vitest-puppeteer -- fieldCipher
```

Expected: PASS — all FieldCipher + UserSecretKeyService tests green.

- [ ] **Step 6: Commit**

```bash
git add src/modules/fieldCipher/UserSecretKeyService.ts src/modules/fieldCipher/index.ts test/vitest/utilitycode/fieldCipher.test.ts
git commit -m "feat(cipher): add UserSecretKeyService singleton with in-memory key cache"
```

---

## Task 4: i18n key in all 6 language files

**Files:**
- Modify: `src/views/lang/en.ts` (add key inside the `account:` block at line ~682-691)
- Modify: `src/views/lang/zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` (same key)

- [ ] **Step 1: Add `encryption_unavailable` to `en.ts`**

In `src/views/lang/en.ts`, find the `account:` block (around line 682-691) and add the key as the last entry before the closing brace. Replace this:

```typescript
  account: {
    accountId: "Account ID",
    type: "Account Type",
    usename: "Username",
    useproxy: "Use Proxy",
    cookies_exist: "Cookies Exist",
    select_account_hint:
      "Select account by click the change account button, please select account with cookies exist",
    change_account: "change account",
  },
```

With:

```typescript
  account: {
    accountId: "Account ID",
    type: "Account Type",
    usename: "Username",
    useproxy: "Use Proxy",
    cookies_exist: "Cookies Exist",
    select_account_hint:
      "Select account by click the change account button, please select account with cookies exist",
    change_account: "change account",
    encryption_unavailable:
      "Account encryption service is unavailable. Please check your connection and try again.",
  },
```

- [ ] **Step 2: Add the same key to `zh.ts`**

Find the `account:` block in `src/views/lang/zh.ts` and add (Chinese translation):

```typescript
    encryption_unavailable: "账号加密服务不可用，请检查网络连接后重试。",
```

- [ ] **Step 3: Add the same key to `es.ts`**

Find the `account:` block in `src/views/lang/es.ts` and add (Spanish):

```typescript
    encryption_unavailable:
      "El servicio de cifrado de cuentas no está disponible. Comprueba tu conexión e inténtalo de nuevo.",
```

- [ ] **Step 4: Add the same key to `fr.ts`**

Find the `account:` block in `src/views/lang/fr.ts` and add (French):

```typescript
    encryption_unavailable:
      "Le service de chiffrement des comptes est indisponible. Vérifiez votre connexion et réessayez.",
```

- [ ] **Step 5: Add the same key to `de.ts`**

Find the `account:` block in `src/views/lang/de.ts` and add (German):

```typescript
    encryption_unavailable:
      "Der Kontoverschlüsselungsdienst ist nicht verfügbar. Bitte überprüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
```

- [ ] **Step 6: Add the same key to `ja.ts`**

Find the `account:` block in `src/views/lang/ja.ts` and add (Japanese, using shinjitai per recent commit convention):

```typescript
    encryption_unavailable:
      "アカウント暗号化サービスを利用できません。接続を確認して再試行してください。",
```

- [ ] **Step 7: Verify TypeScript still compiles**

```bash
yarn vue-check 2>&1 | tail -5
```

Expected: no new errors related to the `account` block.

- [ ] **Step 8: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat(i18n): add account.encryption_unavailable key for all 6 languages"
```

---

## Task 5: Widen `pass` type to `string | null`

**Files:**
- Modify: `src/entityTypes/socialaccount-type.ts:20` (`SocialAccountListData.pass`)
- Modify: `src/entityTypes/socialaccount-type.ts:31` (`SocialAccountDetailData.pass`)

These types currently declare `pass: string`, but after encryption the module may return `null` (key unavailable, corrupt row). Widening the type makes that explicit.

- [ ] **Step 1: Widen `SocialAccountListData.pass`**

In `src/entityTypes/socialaccount-type.ts`, replace line 20:

```typescript
    pass:string,
```

with:

```typescript
    pass: string | null,
```

- [ ] **Step 2: Widen `SocialAccountDetailData.pass`**

In the same file, replace line 31:

```typescript
    pass:string,
```

with:

```typescript
    pass: string | null,
```

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
yarn vue-check 2>&1 | tail -10
```

Expected: no new errors. (Frontend already null-checks pass in practice; if any consumer breaks, fix the consumer by adding `?? ""` at the use site.)

- [ ] **Step 4: Commit**

```bash
git add src/entityTypes/socialaccount-type.ts
git commit -m "refactor(types): widen SocialAccount pass to string | null for encryption"
```

---

## Task 6: `SocialAccountModule` crypto wiring (TDD)

**Files:**
- Create: `test/modules/socialAccountModule.cipher.test.ts`
- Modify: `src/modules/socialAccountModule.ts` (add helpers; wire into 5 read methods + 1 save method)

**Wiring map:**
| Method | Change |
|---|---|
| `getSocialAccountList` (line 47) | `pass: account.pass` → `pass: await this.decryptPass(account.pass, account.id)` |
| `getAccountDetail` (line 95) | `pass: account.pass` → `pass: await this.decryptPass(account.pass, account.id)` |
| `getAllSocialAccounts` (line 219) | `return this.socialAccountModel.getAllSocialAccounts()` → `return this.decryptPasses(await this.socialAccountModel.getAllSocialAccounts())` |
| `getSocialAccountsByStatus` (line 226) | Same pattern |
| `getSocialAccountsByPlatform` (line 233) | Same pattern |
| `saveSocialAccount` (line 138-140) | `socialAccount.pass = socialAccountData.pass` → `socialAccount.pass = await this.encryptPass(socialAccountData.pass)` |
| `saveSocialAccount` catch (line 177-183) | Detect `SecretKeyUnavailableError`, return `msg: "account.encryption_unavailable"` |

- [ ] **Step 1: Write the failing test file**

Create `test/modules/socialAccountModule.cipher.test.ts`:

```typescript
'use strict';
import { SocialAccountModule } from "@/modules/socialAccountModule";
import { SocialAccountEntity } from "@/entity/SocialAccount.entity";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";
const expect = require('expect.js');

// We test the module by stubbing the private Model and the secret-key service.
// The module's crypto helpers depend on userSecretKeyService.getKey() —
// we replace that with an in-memory stub so no HttpClient is touched.

const TEST_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex"
);

function makeEntity(overrides: Partial<SocialAccountEntity> = {}): SocialAccountEntity {
  const e = new SocialAccountEntity();
  e.id = 1;
  e.social_type_id = 1;
  e.user = "alice";
  e.pass = null;
  e.status = 1;
  e.name = "Alice";
  e.phone = "";
  e.email = "";
  e.proxy = [];
  Object.assign(e, overrides);
  return e;
}

describe('SocialAccountModule crypto wiring', function () {
  let originalGetKey: typeof userSecretKeyService.getKey;

  beforeEach(function () {
    originalGetKey = userSecretKeyService.getKey.bind(userSecretKeyService);
  });

  afterEach(function () {
    // Restore original implementation.
    (userSecretKeyService as unknown as { getKey: typeof userSecretKeyService.getKey }).getKey = originalGetKey;
    userSecretKeyService.invalidate();
  });

  function stubKeySuccess() {
    (userSecretKeyService as unknown as { getKey: () => Promise<Buffer> }).getKey = async () => TEST_KEY;
  }

  function stubKeyFailure() {
    (userSecretKeyService as unknown as { getKey: () => Promise<Buffer> }).getKey = async () => {
      throw new SecretKeyUnavailableError("stubbed unavailable");
    };
  }

  describe('saveSocialAccount', function () {
    it('encrypts the pass field before handing the entity to the Model', async function () {
      stubKeySuccess();

      let captured: SocialAccountEntity | null = null;
      const mod = new SocialAccountModule();
      // Replace the Model with an in-test double that records what it gets.
      (mod as unknown as { socialAccountModel: { saveSocialAccount: (e: SocialAccountEntity) => Promise<number> } }).socialAccountModel = {
        async saveSocialAccount(e: SocialAccountEntity) {
          captured = e;
          return 42;
        },
      };

      const result = await mod.saveSocialAccount({
        user: "alice",
        pass: "my-password",
        status: 1,
        name: "Alice",
        phone: "",
        email: "",
        proxy: [],
      });

      expect(result.status).to.be(true);
      expect(captured).not.to.be(null);
      expect(FieldCipher.isEncrypted((captured as SocialAccountEntity).pass)).to.be(true);
      expect((captured as SocialAccountEntity).pass).not.to.equal("my-password");
    });

    it('does not encrypt and leaves pass unset when pass is null', async function () {
      stubKeySuccess();

      let captured: SocialAccountEntity | null = null;
      const mod = new SocialAccountModule();
      (mod as unknown as { socialAccountModel: { saveSocialAccount: (e: SocialAccountEntity) => Promise<number> } }).socialAccountModel = {
        async saveSocialAccount(e: SocialAccountEntity) {
          captured = e;
          return 1;
        },
      };

      await mod.saveSocialAccount({
        user: "alice",
        pass: null,
        status: 1,
        name: "Alice",
        phone: "",
        email: "",
        proxy: [],
      });

      // Wiring skips the assignment entirely when pass is null/undefined,
      // so the entity keeps its default (undefined) and is NOT encrypted.
      expect(FieldCipher.isEncrypted((captured as SocialAccountEntity).pass)).to.be(false);
    });

    it('returns account.encryption_unavailable msg when key fetch fails, and does NOT call the Model', async function () {
      stubKeyFailure();

      let modelCalled = false;
      const mod = new SocialAccountModule();
      (mod as unknown as { socialAccountModel: { saveSocialAccount: (e: SocialAccountEntity) => Promise<number> } }).socialAccountModel = {
        async saveSocialAccount() {
          modelCalled = true;
          return 1;
        },
      };

      const result = await mod.saveSocialAccount({
        user: "alice",
        pass: "my-password",
        status: 1,
        name: "Alice",
        phone: "",
        email: "",
        proxy: [],
      });

      expect(result.status).to.be(false);
      expect(result.msg).to.equal("account.encryption_unavailable");
      expect(modelCalled).to.be(false);
    });
  });

  describe('getSocialAccountList', function () {
    it('decrypts encrypted pass rows to plaintext', async function () {
      stubKeySuccess();

      const encryptedPass = FieldCipher.encrypt("plain", TEST_KEY);
      const mod = new SocialAccountModule();
      (mod as unknown as {
        socialAccountModel: { getSocialAccountList: () => Promise<{ records: SocialAccountEntity[]; total: number }> };
        accountCookiesModule: { getAccountCookies: () => Promise<null> };
      }).socialAccountModel = {
        async getSocialAccountList() {
          return { records: [makeEntity({ pass: encryptedPass })], total: 1 };
        },
      };
      (mod as unknown as {
        accountCookiesModule: { getAccountCookies: () => Promise<null> };
      }).accountCookiesModule = {
        async getAccountCookies() { return null; },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect(result.status).to.equal("success");
      const record = (result.data.records || [])[0];
      expect(record.pass).to.equal("plain");
    });

    it('returns legacy plaintext as-is (lazy migration)', async function () {
      stubKeySuccess();

      const mod = new SocialAccountModule();
      (mod as unknown as {
        socialAccountModel: { getSocialAccountList: () => Promise<{ records: SocialAccountEntity[]; total: number }> };
      }).socialAccountModel = {
        async getSocialAccountList() {
          return { records: [makeEntity({ pass: "legacy-plaintext-pw" })], total: 1 };
        },
      };
      (mod as unknown as {
        accountCookiesModule: { getAccountCookies: () => Promise<null> };
      }).accountCookiesModule = {
        async getAccountCookies() { return null; },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      const record = (result.data.records || [])[0];
      expect(record.pass).to.equal("legacy-plaintext-pw");
    });

    it('returns null pass for a corrupt row without throwing, and other rows still decrypt', async function () {
      stubKeySuccess();

      const goodPass = FieldCipher.encrypt("plain", TEST_KEY);
      // Corrupt row: has the ENC1: prefix but a malformed payload.
      const corruptPass = "ENC1:aaaa:bbbb";

      const mod = new SocialAccountModule();
      (mod as unknown as {
        socialAccountModel: { getSocialAccountList: () => Promise<{ records: SocialAccountEntity[]; total: number }> };
      }).socialAccountModel = {
        async getSocialAccountList() {
          return {
            records: [
              makeEntity({ id: 1, pass: goodPass }),
              makeEntity({ id: 2, pass: corruptPass }),
            ],
            total: 2,
          };
        },
      };
      (mod as unknown as {
        accountCookiesModule: { getAccountCookies: () => Promise<null> };
      }).accountCookiesModule = {
        async getAccountCookies() { return null; },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect(result.status).to.equal("success");
      const records = result.data.records || [];
      expect(records[0].pass).to.equal("plain");
      expect(records[1].pass).to.be(null);
    });

    it('returns null pass for every row when key is unavailable, and still renders the list', async function () {
      stubKeyFailure();

      const mod = new SocialAccountModule();
      (mod as unknown as {
        socialAccountModel: { getSocialAccountList: () => Promise<{ records: SocialAccountEntity[]; total: number }> };
      }).socialAccountModel = {
        async getSocialAccountList() {
          return { records: [makeEntity({ pass: FieldCipher.encrypt("plain", TEST_KEY) })], total: 1 };
        },
      };
      (mod as unknown as {
        accountCookiesModule: { getAccountCookies: () => Promise<null> };
      }).accountCookiesModule = {
        async getAccountCookies() { return null; },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect(result.status).to.equal("success");
      expect((result.data.records || [])[0].pass).to.be(null);
    });

    it('passes null pass through unchanged', async function () {
      stubKeySuccess();

      const mod = new SocialAccountModule();
      (mod as unknown as {
        socialAccountModel: { getSocialAccountList: () => Promise<{ records: SocialAccountEntity[]; total: number }> };
      }).socialAccountModel = {
        async getSocialAccountList() {
          return { records: [makeEntity({ pass: null })], total: 1 };
        },
      };
      (mod as unknown as {
        accountCookiesModule: { getAccountCookies: () => Promise<null> };
      }).accountCookiesModule = {
        async getAccountCookies() { return null; },
      };

      const result = await mod.getSocialAccountList(1, 10, "");
      expect((result.data.records || [])[0].pass).to.be(null);
    });
  });

  describe('entity-array read methods (decryptPasses chokepoint)', function () {
    /**
     * Builds a SocialAccountModule whose Model returns one encrypted row
     * and one legacy plaintext row, for any of the three array-returning methods.
     */
    function makeModuleWithArrayStub(
      methodName: 'getAllSocialAccounts' | 'getSocialAccountsByStatus' | 'getSocialAccountsByPlatform'
    ): SocialAccountModule {
      stubKeySuccess();
      const encryptedPass = FieldCipher.encrypt("plain", TEST_KEY);
      const mod = new SocialAccountModule();
      const fakeModel = {
        async [methodName]() {
          return [
            makeEntity({ id: 1, pass: encryptedPass }),
            makeEntity({ id: 2, pass: "legacy" }),
          ];
        },
      };
      (mod as unknown as { socialAccountModel: unknown }).socialAccountModel = fakeModel;
      return mod;
    }

    it('getAllSocialAccounts decrypts encrypted rows and returns legacy rows as-is', async function () {
      const mod = makeModuleWithArrayStub('getAllSocialAccounts');
      const out = await mod.getAllSocialAccounts();
      expect(out[0].pass).to.equal("plain");
      expect(out[1].pass).to.equal("legacy");
    });

    it('getSocialAccountsByStatus decrypts encrypted rows via decryptPasses', async function () {
      const mod = makeModuleWithArrayStub('getSocialAccountsByStatus');
      const out = await mod.getSocialAccountsByStatus(1);
      expect(out[0].pass).to.equal("plain");
      expect(out[1].pass).to.equal("legacy");
    });

    it('getSocialAccountsByPlatform decrypts encrypted rows via decryptPasses', async function () {
      const mod = makeModuleWithArrayStub('getSocialAccountsByPlatform');
      const out = await mod.getSocialAccountsByPlatform(1);
      expect(out[0].pass).to.equal("plain");
      expect(out[1].pass).to.equal("legacy");
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

```bash
yarn test test/modules/socialAccountModule.cipher.test.ts
```

Expected: FAIL — the module currently has no `decryptPass` / `encryptPass` helpers, so plaintext passes through untouched and the "encrypts the pass field" assertion fails (`FieldCipher.isEncrypted(captured.pass)` → false).

- [ ] **Step 3: Add imports to `socialAccountModule.ts`**

Open `src/modules/socialAccountModule.ts`. At the top of the file, after the existing imports (after line 8), add:

```typescript
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";
```

- [ ] **Step 4: Add the three private helpers inside the class**

Inside `class SocialAccountModule`, right after the constructor (before `getSocialAccountList`), add these private methods:

```typescript
    /**
     * Encrypts a plaintext password for storage. Null-safe.
     * @throws SecretKeyUnavailableError if the backend key cannot be obtained.
     */
    private async encryptPass(plaintext: string | null | undefined): Promise<string | null> {
        if (plaintext == null || plaintext === "") {
            return plaintext ?? null;
        }
        const key = await userSecretKeyService.getKey();
        return FieldCipher.encrypt(plaintext, key);
    }

    /**
     * Decrypts a stored pass value. Null-safe and legacy-aware.
     *
     * - null/undefined → null
     * - legacy plaintext (no ENC1: prefix) → returned as-is (lazy migration)
     * - ENC1: envelope → decrypted; on failure logs and returns null
     *
     * Fail-soft on SecretKeyUnavailableError: returns null so list views keep rendering.
     */
    private async decryptPass(stored: string | null | undefined, accountId?: number): Promise<string | null> {
        if (stored == null) {
            return null;
        }
        if (!FieldCipher.isEncrypted(stored)) {
            // Legacy plaintext — return as-is. Next save() will encrypt it.
            return stored;
        }
        try {
            const key = await userSecretKeyService.getKey();
            return FieldCipher.decrypt(stored, key);
        } catch (error) {
            if (error instanceof SecretKeyUnavailableError) {
                console.warn("[SocialAccountModule] decryptPass: secret key unavailable", error.message);
            } else {
                console.error("[SocialAccountModule] decryptPass: failed for account", accountId, error);
            }
            return null;
        }
    }

    /**
     * Applies decryptPass to every entity in an array. Returns NEW objects
     * (does not mutate the input). Used by the entity-array read methods.
     */
    private async decryptPasses(entities: SocialAccountEntity[]): Promise<SocialAccountEntity[]> {
        return Promise.all(
            entities.map(async (e) => ({
                ...e,
                pass: await this.decryptPass(e.pass, e.id),
            }))
        );
    }
```

- [ ] **Step 5: Wire `getSocialAccountList`**

In `getSocialAccountList` (around line 47), replace:

```typescript
                    return {
                        id: account.id,
                        social_type: socialType,
                        social_type_id: account.social_type_id,
                        user: account.user,
                        pass: account.pass,
                        status: account.status,
                        use_proxy: account.proxy && account.proxy.length > 0 ? 1 : 0,
                        cookies: hasCookies
                    };
```

with:

```typescript
                    return {
                        id: account.id,
                        social_type: socialType,
                        social_type_id: account.social_type_id,
                        user: account.user,
                        pass: await this.decryptPass(account.pass, account.id),
                        status: account.status,
                        use_proxy: account.proxy && account.proxy.length > 0 ? 1 : 0,
                        cookies: hasCookies
                    };
```

- [ ] **Step 6: Wire `getAccountDetail`**

In `getAccountDetail` (around line 95), replace:

```typescript
            const detailData: SocialAccountDetailData = {
                id: account.id,
                social_type_id: account.social_type_id,
                user: account.user,
                pass: account.pass,
                status: account.status,
                name: account.name,
                phone: account.phone,
                email: account.email,
                proxy: account.proxy || []
            };
```

with:

```typescript
            const detailData: SocialAccountDetailData = {
                id: account.id,
                social_type_id: account.social_type_id,
                user: account.user,
                pass: await this.decryptPass(account.pass, account.id),
                status: account.status,
                name: account.name,
                phone: account.phone,
                email: account.email,
                proxy: account.proxy || []
            };
```

- [ ] **Step 7: Wire `saveSocialAccount` encrypt + error detection**

In `saveSocialAccount`, replace the pass-assignment block (around line 138-140):

```typescript
            if (socialAccountData.pass) {
                socialAccount.pass = socialAccountData.pass;
            }
```

with:

```typescript
            if (socialAccountData.pass !== undefined && socialAccountData.pass !== null) {
                socialAccount.pass = await this.encryptPass(socialAccountData.pass);
            }
```

Then replace the catch block at the bottom of `saveSocialAccount` (around line 177-183):

```typescript
        } catch (error) {
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: { id: 0 }
            };
        }
```

with:

```typescript
        } catch (error) {
            if (error instanceof SecretKeyUnavailableError) {
                return {
                    status: false,
                    msg: "account.encryption_unavailable",
                    data: { id: 0 }
                };
            }
            return {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred",
                data: { id: 0 }
            };
        }
```

- [ ] **Step 8: Wire the three entity-array read methods**

Replace these three methods (around lines 218-234):

```typescript
    public async getAllSocialAccounts(): Promise<SocialAccountEntity[]> {
        return this.socialAccountModel.getAllSocialAccounts();
    }

    /**
     * Get social accounts by status
     */
    public async getSocialAccountsByStatus(status: number): Promise<SocialAccountEntity[]> {
        return this.socialAccountModel.getSocialAccountsByStatus(status);
    }

    /**
     * Get social accounts by platform
     */
    public async getSocialAccountsByPlatform(socialTypeId: number): Promise<SocialAccountEntity[]> {
        return this.socialAccountModel.getSocialAccountsByPlatform(socialTypeId);
    }
```

with:

```typescript
    public async getAllSocialAccounts(): Promise<SocialAccountEntity[]> {
        return this.decryptPasses(await this.socialAccountModel.getAllSocialAccounts());
    }

    /**
     * Get social accounts by status
     */
    public async getSocialAccountsByStatus(status: number): Promise<SocialAccountEntity[]> {
        return this.decryptPasses(await this.socialAccountModel.getSocialAccountsByStatus(status));
    }

    /**
     * Get social accounts by platform
     */
    public async getSocialAccountsByPlatform(socialTypeId: number): Promise<SocialAccountEntity[]> {
        return this.decryptPasses(await this.socialAccountModel.getSocialAccountsByPlatform(socialTypeId));
    }
```

- [ ] **Step 9: Run the test to verify it passes (GREEN)**

```bash
yarn test test/modules/socialAccountModule.cipher.test.ts
```

Expected: PASS — all SocialAccountModule crypto tests green.

- [ ] **Step 10: Run the full mocha suite to catch regressions**

```bash
yarn test 2>&1 | tail -20
```

Expected: no new failures compared to baseline. (If a pre-existing test asserts `pass: string` exactly, update it to `pass: string | null` or `pass ?? ""`.)

- [ ] **Step 11: Commit**

```bash
git add src/modules/socialAccountModule.ts test/modules/socialAccountModule.cipher.test.ts
git commit -m "feat(socialAccount): encrypt pass at rest and decrypt on read via fieldCipher"
```

---

## Task 7: `HttpClient` token-refresh hook

**Files:**
- Modify: `src/modules/lib/httpclient.ts` (add invalidate call after refresh success in `_refreshTokenAndRetry` and in `postStream`)

**Why:** When the access token refreshes, the user's session context may shift (e.g. logout/login as a different user on the same machine). Invalidating the cached secret key forces the next `getKey()` to re-fetch under the current session.

- [ ] **Step 1: Add the import**

At the top of `src/modules/lib/httpclient.ts`, after line 13 (`import { resolveViteLoginBase } from "@/config/viteLoginUrl";`), add:

```typescript
import { userSecretKeyService } from "@/modules/fieldCipher";
```

- [ ] **Step 2: Add invalidate after `_refreshTokenAndRetry` success**

In `_refreshTokenAndRetry`, find the success block (around lines 127-135):

```typescript
      if (refreshResult.status && refreshResult.data) {
        // Update access token in headers
        this.setHeader(
          "Authorization",
          "Bearer " + refreshResult.data.accessToken
        );

        // Retry the original request with new token
        return this._fetchJSON(endpoint, options);
      } else {
```

Replace with:

```typescript
      if (refreshResult.status && refreshResult.data) {
        // Update access token in headers
        this.setHeader(
          "Authorization",
          "Bearer " + refreshResult.data.accessToken
        );

        // The new session may have a different secret key; drop the cached one.
        userSecretKeyService.invalidate();

        // Retry the original request with new token
        return this._fetchJSON(endpoint, options);
      } else {
```

- [ ] **Step 3: Add invalidate after `postStream` refresh success**

In `postStream`, find the success block (around lines 422-430):

```typescript
          if (refreshResult.status && refreshResult.data) {
            // Update access token in headers
            this.setHeader(
              "Authorization",
              "Bearer " + refreshResult.data.accessToken
            );

            // Retry the original request with new token
            return this.postStream(endpoint, data, options, true);
          } else {
```

Replace with:

```typescript
          if (refreshResult.status && refreshResult.data) {
            // Update access token in headers
            this.setHeader(
              "Authorization",
              "Bearer " + refreshResult.data.accessToken
            );

            // The new session may have a different secret key; drop the cached one.
            userSecretKeyService.invalidate();

            // Retry the original request with new token
            return this.postStream(endpoint, data, options, true);
          } else {
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
yarn vue-check 2>&1 | tail -5
```

Expected: no new errors. (Circular import between `httpclient.ts` and `UserSecretKeyService.ts` is safe — both modules reference each other only inside methods, never at module-load time.)

- [ ] **Step 5: Run both test suites to confirm no regressions**

```bash
yarn vitest-puppeteer -- fieldCipher 2>&1 | tail -10
yarn test test/modules/socialAccountModule.cipher.test.ts 2>&1 | tail -10
```

Expected: both suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/lib/httpclient.ts
git commit -m "feat(httpclient): invalidate cached secret key after token refresh"
```

---

## Task 8: Final verification and import audit

- [ ] **Step 1: Confirm no worker process imports `UserSecretKeyService`**

Run this audit:

```bash
grep -rn "fieldCipher\|UserSecretKeyService\|userSecretKeyService" src/childprocess/ 2>&1
```

Expected: no matches. Workers must not trigger key fetches (they have no backend session). If any match appears, remove the import — workers receive decrypted data via IPC from the main process.

- [ ] **Step 2: Run both full test suites**

```bash
yarn test 2>&1 | tail -20
yarn vitest-puppeteer -- fieldCipher 2>&1 | tail -20
```

Expected: no new failures.

- [ ] **Step 3: Manual smoke test (acceptance criteria)**

In a running dev environment (`yarn dev`):

1. Open the Social Account detail page, save an account with password "test-password-123".
2. Inspect the SQLite DB directly (`sqlite3` CLI or a GUI): `SELECT pass FROM social_accounts WHERE user = '<that user>';` — the value MUST start with `ENC1:` and NOT contain the plaintext.
3. Reload the Social Account list in the UI — the password field shows "test-password-123" (behavior unchanged).
4. Insert a legacy plaintext row directly via SQL (`UPDATE social_accounts SET pass = 'legacy-plaintext' WHERE id = X;`), reload the list — the password field still shows "legacy-plaintext" (lazy migration).
5. Save that legacy row again (any field change) — re-inspect the DB, the value is now `ENC1:...`.

- [ ] **Step 4: Final commit (if any cleanup needed)**

Only commit if something changed during verification. Otherwise this step is a no-op.

---

## Acceptance Criteria Recap

- [ ] Saving an account stores `ENC1:...` in DB, not plaintext.
- [ ] Reading accounts returns plaintext to the frontend (behavior unchanged).
- [ ] Legacy plaintext rows still read correctly (lazy migration).
- [ ] Backend down on read → list renders, password fields blank.
- [ ] Backend down on write → save fails with `account.encryption_unavailable`, nothing stored.
- [ ] DB inspection confirms no plaintext passwords after first save.
- [ ] Workers never import `UserSecretKeyService` (audit confirms).
- [ ] `FieldCipher` and `UserSecretKeyService` tests pass.
- [ ] `SocialAccountModule` crypto tests pass.
