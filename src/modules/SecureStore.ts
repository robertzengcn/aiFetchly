import Store from "electron-store";
import { safeStorage } from "electron";
import { log } from "@/modules/Logger";

/**
 * At-rest secret encryption via Electron safeStorage.
 *
 * Threat (docs/prd/architecture-remediation-prd.md WS-1 R1.1): secrets written
 * to electron-store are readable from the user's userData directory. safeStorage
 * binds encryption to OS user credentials (macOS Keychain / Windows DPAPI /
 * Linux libsecret), restoring the protection the commented-out `keytar` gave.
 *
 * Status: opt-in behind `AIFETCHLY_ENCRYPT_STORE=1`. `Token` already encrypts
 * with `CryptoSource` before reaching the store; enabling this adds a safeStorage
 * layer on top. See docs/adr/0001-secret-storage-safestorage.md for the cutover.
 */

/** Substrings that mark a store key as sensitive (encrypted at rest). */
const SENSITIVE_KEY_SUBSTRINGS = [
  "token",
  "secret",
  "password",
  "cookie",
  "apikey",
  "api_key",
] as const;

/** Prefix marking a value already wrapped by safeStorage (deterministic detection). */
const ENCRYPTED_PREFIX = "enc:v1:";

/** Feature flag: opt into safeStorage encryption of sensitive values. */
export const SECURE_STORE_FLAG = "AIFETCHLY_ENCRYPT_STORE";

export function isSecureStoreEnabled(): boolean {
  return process.env[SECURE_STORE_FLAG] === "1";
}

/** Pure: does this key name look like it holds a secret? */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_SUBSTRINGS.some((s) => k.includes(s));
}

function isEncryptedValue(raw: unknown): raw is string {
  return typeof raw === "string" && raw.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Wraps electron-store and encrypts sensitive values with safeStorage.
 *
 * Migration-safe: getValue only attempts decryption on values carrying the
 * `enc:v1:` marker, so pre-existing plaintext (or CryptoSource-encrypted JSON)
 * values are returned untouched until {@link migratePlaintextValues} re-wraps them.
 */
export class SecureStore {
  private store: Store;
  private readonly encryptionAvailable: boolean;

  constructor(options: unknown) {
    this.store = new Store(options as never);
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();
    if (!this.encryptionAvailable) {
      log.warn(
        "SecureStore: safeStorage unavailable; sensitive values will be stored plaintext."
      );
    }
  }

  setValue(key: string, value: string): void {
    if (isSensitiveKey(key) && this.encryptionAvailable) {
      const encrypted = safeStorage.encryptString(value).toString("base64");
      this.store.set(key, ENCRYPTED_PREFIX + encrypted);
    } else {
      this.store.set(key, value);
    }
  }

  getValue(key: string): unknown {
    const raw = this.store.get(key);
    if (isEncryptedValue(raw) && this.encryptionAvailable) {
      try {
        const buf = Buffer.from(raw.slice(ENCRYPTED_PREFIX.length), "base64");
        return safeStorage.decryptString(buf);
      } catch (err) {
        // Should not happen for marker-prefixed values; surface it but don't crash.
        log.error(`SecureStore: failed to decrypt key "${key}":`, err);
        return raw;
      }
    }
    return raw;
  }

  deleteValue(key: string): void {
    this.store.delete(key);
  }

  clearStore(): void {
    this.store.clear();
  }

  /**
   * One-time migration: re-encrypt sensitive string values that are not yet
   * safeStorage-wrapped. Returns the count of migrated keys. No-op when
   * safeStorage is unavailable.
   */
  migratePlaintextValues(): number {
    if (!this.encryptionAvailable) return 0;
    const all = (this.store as unknown as { store: Record<string, unknown> }).store;
    let migrated = 0;
    for (const [key, raw] of Object.entries(all)) {
      if (typeof raw !== "string" || !isSensitiveKey(key)) continue;
      if (isEncryptedValue(raw)) continue; // already wrapped
      this.setValue(key, raw);
      migrated++;
    }
    return migrated;
  }
}
