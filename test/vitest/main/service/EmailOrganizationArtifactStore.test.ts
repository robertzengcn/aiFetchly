import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailOrganizationArtifactStore } from "@/service/emailOrganization/EmailOrganizationArtifactStore";

// Mock the per-install key source BEFORE importing anything that lazily
// imports it, so the real AES-256-GCM store runs against a deterministic key.
const FIXED_KEY = Buffer.alloc(32, 7);
vi.mock("@/modules/fieldCipher/UserSecretKeyService", () => ({
  userSecretKeyService: {
    getKey: async (): Promise<Buffer> => Buffer.from(FIXED_KEY),
  },
}));
import { vi } from "vitest";

let dbpath = "";
let store: EmailOrganizationArtifactStore;

describe("EmailOrganizationArtifactStore (real AES-256-GCM)", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-artifact-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    store = new EmailOrganizationArtifactStore(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("round-trips bytes through AES-256-GCM and stores ciphertext on disk", async () => {
    const plaintext = Buffer.from("forwarded body with sensitive content", "utf8");
    const id = await store.put(plaintext);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const decrypted = await store.get(id);
    expect(decrypted.equals(plaintext)).toBe(true);
    // The stored file is encrypted: nonce prefix + ciphertext, not plaintext.
    const raw = fs.readFileSync(path.join(dbpath, "email-organization-artifacts", `${id}.enc`));
    expect(raw.length).toBeGreaterThan(plaintext.length);
    expect(raw.includes(plaintext.subarray(0, 10))).toBe(false);
  });

  it("rejects a tampered payload (GCM auth tag mismatch)", async () => {
    const id = await store.put(Buffer.from("tamper target", "utf8"));
    const file = path.join(dbpath, "email-organization-artifacts", `${id}.enc`);
    const raw = fs.readFileSync(file);
    raw[raw.length - 20] = raw[raw.length - 20] ^ 0xff; // flip one ciphertext byte
    fs.writeFileSync(file, raw);
    await expect(store.get(id)).rejects.toThrow();
  });

  it("rejects a too-short payload with a clear error", async () => {
    const id = await store.put(Buffer.from("x", "utf8"));
    const file = path.join(dbpath, "email-organization-artifacts", `${id}.enc`);
    fs.writeFileSync(file, Buffer.from([1, 2, 3]));
    await expect(store.get(id)).rejects.toThrow("artifact payload too short");
  });

  it("rejects non-UUID artifact ids before touching the filesystem", async () => {
    await expect(store.get("../../etc/passwd")).rejects.toThrow("invalid artifact id");
    await expect(store.exists("not-a-uuid")).rejects.toThrow("invalid artifact id");
  });

  it("purges artifacts and reports existence honestly", async () => {
    const id = await store.put(Buffer.from("to be purged", "utf8"));
    expect(await store.exists(id)).toBe(true);
    await store.purge(id);
    expect(await store.exists(id)).toBe(false);
    await expect(store.get(id)).rejects.toThrow();
  });

  it("purgeOlderThan removes only stale .enc files and returns the count", async () => {
    const staleId = await store.put(Buffer.from("stale", "utf8"));
    const freshId = await store.put(Buffer.from("fresh", "utf8"));
    const staleFile = path.join(dbpath, "email-organization-artifacts", `${staleId}.enc`);
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(staleFile, past, past);

    const purged = await store.purgeOlderThan(new Date(Date.now() - 24 * 60 * 60 * 1000));
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await store.exists(staleId)).toBe(false);
    expect(await store.exists(freshId)).toBe(true);
  });
});
