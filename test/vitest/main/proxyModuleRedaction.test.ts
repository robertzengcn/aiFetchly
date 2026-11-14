import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * B10/P-FR-07: renderer-facing proxy reads NEVER carry the password —
 * the list carries `hasPassword`, and `getProxyDetailSafe` redacts the
 * stored (encrypted or legacy PLAINTEXT) secret. Main-process consumers
 * keep the raw `getProxyDetail`.
 */

// No USERSDBPATH: both BaseModule and BaseDb fall back to the SAME
// resolveTestDbPath() temp dir, so model + module share one database.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "";
    }
    setValue(): void {}
  },
}));

// A fixed 32-byte key so encrypt/decrypt round-trips in tests (the real
// service fetches from a backend that is absent here).
vi.mock("@/modules/fieldCipher/UserSecretKeyService", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/modules/fieldCipher/UserSecretKeyService")>();
  const spiedInstance = {
    ...original.userSecretKeyService,
    getKey: async (): Promise<Buffer> => Buffer.alloc(32, 0x42),
    invalidate: (): void => {},
  };
  return {
    ...original,
    userSecretKeyService: spiedInstance,
    UserSecretKeyService: original.UserSecretKeyService,
  };
});

import { SqliteDb } from "@/config/SqliteDb";
import { ProxyModel } from "@/model/Proxy.model";
import { ProxyModule } from "@/modules/ProxyModule";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

beforeEach(() => {
  resetDbSingleton();
});

describe("ProxyModule renderer redaction (B10)", () => {
  it("the list carries hasPassword and never a password value", async () => {
    const model = new ProxyModel("");
    await model.saveProxy({
      host: "list-redaction.test",
      port: "8080",
      user: "alice",
      pass: "supersecret-list-password",
      protocol: "http",
      country_code: "DE",
    });
    const module = new ProxyModule();
    const resp = await module.getProxylist(1, 10, "");
    expect(resp.status).toBe(true);
    const record = resp.data.records[0] as Record<string, unknown>;
    expect(record.host).toBe("list-redaction.test");
    expect(record.password).toBeUndefined();
    expect(record.hasPassword).toBe(true);
    // The plaintext never crosses the renderer channel.
    expect(JSON.stringify(resp)).not.toContain("supersecret-list-password");
  });

  it("getProxyDetailSafe returns hasPassword and never the stored secret", async () => {
    const model = new ProxyModel("");
    const saved = await model.saveProxy({
      host: "detail-safe.test",
      port: "3128",
      user: "bob",
      pass: "supersecret-detail-password",
      protocol: "https",
      country_code: "US",
    });
    const module = new ProxyModule();
    const resp = await module.getProxyDetailSafe(saved.id);
    expect(resp.status).toBe(true);
    const data = resp.data as Record<string, unknown>;
    expect(data.host).toBe("detail-safe.test");
    expect(data.pass).toBeUndefined();
    expect(data.hasPassword).toBe(true);
    expect(JSON.stringify(resp)).not.toContain("supersecret-detail-password");
    // The at-rest value is a FieldCipher blob, not the plaintext.
    const raw = await model.getProxyById(saved.id);
    expect(raw?.pass).not.toBe("supersecret-detail-password");
  });

  it("getProxyDetail (internal) keeps the at-rest value for main-process use", async () => {
    const model = new ProxyModel("");
    const saved = await model.saveProxy({
      host: "internal.test",
      port: "8080",
      user: "carol",
      pass: "supersecret-internal-password",
      protocol: "http",
      country_code: "FR",
    });
    const module = new ProxyModule();
    const resp = await module.getProxyDetail(saved.id);
    expect(resp.status).toBe(true);
    const pass = (resp.data as Record<string, unknown>).pass as string;
    // The INTERNAL path keeps the at-rest blob (decryptable only in the
    // main process) — the plaintext is not exposed either way.
    expect(pass).toBeTruthy();
    expect(pass).not.toBe("supersecret-internal-password");
  });
});
