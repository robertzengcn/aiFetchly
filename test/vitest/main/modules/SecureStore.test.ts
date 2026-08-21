import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared in-memory backing for the electron-store mock so tests can seed legacy
// values and assert on-disk state.
const memStore = vi.hoisted(() => new Map<string, unknown>());

// Controllable safeStorage availability.
const safeStorageState = vi.hoisted(() => ({ available: true }));

vi.mock("electron-store", () => ({
  default: class {
    get(key: string): unknown {
      return memStore.get(key);
    }
    set(key: string, value: unknown): void {
      memStore.set(key, value);
    }
    has(key: string): boolean {
      return memStore.has(key);
    }
    delete(key: string): void {
      memStore.delete(key);
    }
    clear(): void {
      memStore.clear();
    }
    // mimic electron-store's public `.store` getter (all data)
    get store(): Record<string, unknown> {
      return Object.fromEntries(memStore.entries());
    }
  },
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    // Deterministic, reversible fake encryption (NOT the plaintext).
    encryptString: (plain: string): Buffer =>
      Buffer.from("REV:" + [...plain].reverse().join("")),
    decryptString: (buf: Buffer): string => {
      const s = buf.toString();
      const body = s.startsWith("REV:") ? s.slice(4) : s;
      return [...body].reverse().join("");
    },
  },
}));

import {
  SecureStore,
  isSensitiveKey,
  isSecureStoreEnabled,
} from "@/modules/SecureStore";

describe("isSensitiveKey", () => {
  it("flags token/secret/password/cookie/apikey keys", () => {
    expect(isSensitiveKey("auth-token")).toBe(true);
    expect(isSensitiveKey("user-social-market-token")).toBe(true);
    expect(isSensitiveKey("refreshToken")).toBe(true);
    expect(isSensitiveKey("api_secret")).toBe(true);
    expect(isSensitiveKey("userPassword")).toBe(true);
    expect(isSensitiveKey("sessionCookie")).toBe(true);
    expect(isSensitiveKey("apikey")).toBe(true);
    expect(isSensitiveKey("api_key")).toBe(true);
  });

  it("leaves non-sensitive keys alone", () => {
    expect(isSensitiveKey("usersDbPath")).toBe(false);
    expect(isSensitiveKey("userId")).toBe(false);
    expect(isSensitiveKey("language")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isSensitiveKey("AUTH-TOKEN")).toBe(true);
    expect(isSensitiveKey("TOKEN")).toBe(true);
  });
});

describe("isSecureStoreEnabled", () => {
  it("defaults to disabled", () => {
    delete process.env.AIFETCHLY_ENCRYPT_STORE;
    expect(isSecureStoreEnabled()).toBe(false);
  });
  it("is enabled only when the flag is exactly '1'", () => {
    process.env.AIFETCHLY_ENCRYPT_STORE = "1";
    expect(isSecureStoreEnabled()).toBe(true);
    process.env.AIFETCHLY_ENCRYPT_STORE = "true";
    expect(isSecureStoreEnabled()).toBe(false);
    delete process.env.AIFETCHLY_ENCRYPT_STORE;
  });
});

describe("SecureStore (safeStorage available)", () => {
  beforeEach(() => {
    memStore.clear();
    safeStorageState.available = true;
  });

  it("round-trips a sensitive value through encryption", () => {
    const s = new SecureStore({ name: "test" });
    s.setValue("auth-token", "secret-value");
    const onDisk = memStore.get("auth-token");
    // The on-disk value must NOT contain the plaintext secret.
    expect(typeof onDisk).toBe("string");
    expect(onDisk as string).toMatch(/^enc:v1:/);
    expect(onDisk as string).not.toContain("secret-value");
    // ...and getValue recovers it.
    expect(s.getValue("auth-token")).toBe("secret-value");
  });

  it("stores non-sensitive values verbatim", () => {
    const s = new SecureStore({ name: "test" });
    s.setValue("usersDbPath", "/var/lib/aifetchly/db");
    expect(memStore.get("usersDbPath")).toBe("/var/lib/aifetchly/db");
    expect(s.getValue("usersDbPath")).toBe("/var/lib/aifetchly/db");
  });

  it("returns pre-migration plaintext sensitive values untouched (graceful)", () => {
    memStore.set("auth-token", "legacy-plaintext-token");
    const s = new SecureStore({ name: "test" });
    expect(s.getValue("auth-token")).toBe("legacy-plaintext-token");
  });

  it("migratePlaintextValues re-wraps legacy plaintext and returns the count", () => {
    memStore.set("auth-token", "legacy-plaintext-token");
    memStore.set("usersDbPath", "/path"); // non-sensitive, skipped
    const s = new SecureStore({ name: "test" });
    const migrated = s.migratePlaintextValues();
    expect(migrated).toBe(1);
    const onDisk = memStore.get("auth-token") as string;
    expect(onDisk).toMatch(/^enc:v1:/);
    expect(onDisk).not.toContain("legacy-plaintext-token");
    expect(s.getValue("auth-token")).toBe("legacy-plaintext-token");
  });

  it("migratePlaintextValues is idempotent (already-wrapped values skipped)", () => {
    const s = new SecureStore({ name: "test" });
    s.setValue("auth-token", "v1"); // writes encrypted
    expect(s.migratePlaintextValues()).toBe(0);
    expect(s.getValue("auth-token")).toBe("v1");
  });

  it("delete and clear work through the wrapper", () => {
    const s = new SecureStore({ name: "test" });
    s.setValue("auth-token", "x");
    s.setValue("keep", "y");
    s.deleteValue("auth-token");
    expect(s.getValue("auth-token")).toBeUndefined();
    expect(memStore.get("keep")).toBe("y");
    s.clearStore();
    expect(memStore.get("keep")).toBeUndefined();
  });
});

describe("SecureStore (safeStorage unavailable)", () => {
  beforeEach(() => {
    memStore.clear();
    safeStorageState.available = false;
  });

  it("stores sensitive values as plaintext when encryption is unavailable", () => {
    const s = new SecureStore({ name: "test" });
    s.setValue("auth-token", "secret-value");
    expect(memStore.get("auth-token")).toBe("secret-value");
    expect(s.getValue("auth-token")).toBe("secret-value");
  });

  it("migratePlaintextValues is a no-op when unavailable", () => {
    memStore.set("auth-token", "legacy");
    const s = new SecureStore({ name: "test" });
    expect(s.migratePlaintextValues()).toBe(0);
    expect(memStore.get("auth-token")).toBe("legacy");
  });
});
