import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AccountCookiesModel } from "@/model/AccountCookies.model";
import { AccountCookiesEntity } from "@/entity/AccountCookies.entity";
import {
  AccountSessionService,
  type CookieSessionLike,
} from "@/modules/AccountSessionService";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";
import type { UserSecretKeyService } from "@/modules/fieldCipher/UserSecretKeyService";
import type { NormalizedCookie } from "@/schemas/accountCookies";

// Unique on-disk dir so parallel test files (separate vitest workers, each
// with its own in-memory SqliteDb singleton) don't collide on scraper.db.
const tmpDir = path.join(os.tmpdir(), "aifetchly-account-session-test");

/** Build a raw account_cookies row with arbitrary (ciphertext/plaintext) bytes. */
function rawRow(
  accountId: number,
  cookies: string,
  partition = "persist:legacy"
): AccountCookiesEntity {
  const e = new AccountCookiesEntity();
  e.account_id = accountId;
  e.cookies = cookies;
  e.partition_path = partition;
  return e;
}

const KEY = Buffer.alloc(32, 7); // deterministic 32-byte test key

function fakeKeyService(throwKey = false): UserSecretKeyService {
  return {
    getKey: throwKey
      ? async () => {
          throw new SecretKeyUnavailableError("test: no key");
        }
      : async () => KEY,
  } as unknown as UserSecretKeyService;
}

function makeFakeSession() {
  const stored: Record<string, unknown>[] = [];
  let clearCalls = 0;
  const session: CookieSessionLike = {
    cookies: {
      get: async () => stored.map((s) => ({ ...s })),
      set: async (d: unknown) => {
        stored.push(d as Record<string, unknown>);
      },
    },
    clearStorageData: async () => {
      clearCalls++;
    },
  };
  return { session, stored, clearCalls: () => clearCalls };
}

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

async function newService(
  opts: {
    throwKey?: boolean;
    platformId?: number;
    sessionFromPartition?: (p: string) => CookieSessionLike;
  } = {}
) {
  const model = new AccountCookiesModel(tmpDir);
  await SqliteDb.ensureInitialized();
  const service = new AccountSessionService({
    secretKeyService: fakeKeyService(opts.throwKey === true),
    cookiesModel: model,
    platformResolver: async () => opts.platformId,
    ...(opts.sessionFromPartition
      ? { sessionFromPartition: opts.sessionFromPartition }
      : {}),
  });
  return { service, model };
}

const ytCookies: NormalizedCookie[] = [
  {
    domain: "youtube.com",
    path: "/",
    name: "SID",
    value: "yt-session-value",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    expirationDate: 4_000_000_000,
  },
  {
    domain: "accounts.google.com",
    path: "/",
    name: "SSID",
    value: "google-sso",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    expirationDate: 4_000_000_000,
  },
];

describe("AccountSessionService persistence", () => {
  it("encrypts on write and decrypts on read (round-trip)", async () => {
    const { service, model } = await newService();
    const out = await service.persistSnapshot({
      accountId: 1,
      cookies: ytCookies as unknown[],
      source: "manual_login",
      partitionPath: "persist:social-account-1",
    });
    expect(out.importedCookieCount).toBe(2);

    const row = await model.getAccountCookies(1);
    expect(row?.cookies.startsWith("ENC1:")).toBe(true);
    // Plaintext values must not appear in the stored row.
    expect(row?.cookies.includes("yt-session-value")).toBe(false);

    const meta = await service.getMetadata(1);
    expect(meta).toMatchObject({
      hasCookies: true,
      cookieCount: 2,
      importSource: "manual_login",
      sessionStatus: "available",
    });
    expect(meta.lastUpdatedAt).not.toBeNull();

    const read = await service.getDecryptedSnapshot(1);
    expect(read.status).toBe("available");
    expect(read.cookies).toHaveLength(2);
    expect(read.cookies.some((c) => c.value === "yt-session-value")).toBe(true);
  });

  it("refuses to write without a key and leaves existing data intact (no plaintext fallback)", async () => {
    const { service, model } = await newService();
    await service.persistSnapshot({
      accountId: 2,
      cookies: ytCookies as unknown[],
      source: "manual_login",
      partitionPath: "persist:social-account-2",
    });
    const before = await model.getAccountCookies(2);

    const noKeyService = await newService({ throwKey: true });
    await expect(
      noKeyService.service.persistSnapshot({
        accountId: 2,
        cookies: ytCookies as unknown[],
        source: "browser_profile",
        partitionPath: "persist:social-account-2",
      })
    ).rejects.toMatchObject({ code: "KEY_UNAVAILABLE" });

    const after = await model.getAccountCookies(2);
    expect(after?.cookies).toBe(before?.cookies); // unchanged
  });

  it("marks a tampered ENC1 row invalid and returns no cookies", async () => {
    const { service, model } = await newService();
    // Insert a tampered envelope directly via the deprecated raw upsert.
    // (12-byte zero IV base64 + a payload too short to hold the 16-byte GCM tag.)
    await model.saveAccountCookies(
      rawRow(3, "ENC1:AAAAAAAAAAAAAAAA:deadbeef", "persist:social-account-3")
    );
    const read = await service.getDecryptedSnapshot(3);
    expect(read.status).toBe("invalid");
    expect(read.cookies).toHaveLength(0);

    const meta = await service.getMetadata(3);
    expect(meta.sessionStatus).toBe("invalid");
  });

  it("does NOT replace an existing snapshot when zero cookies survive filtering", async () => {
    const { service } = await newService({ platformId: 2 }); // youtube manifest
    await service.persistSnapshot({
      accountId: 4,
      cookies: ytCookies as unknown[],
      source: "manual_login",
      partitionPath: "persist:social-account-4",
    });
    // Now attempt a write where every cookie is outside the allowlist.
    const evil: NormalizedCookie[] = [
      {
        domain: "evil.com",
        path: "/",
        name: "x",
        value: "y",
        secure: true,
        httpOnly: false,
      },
    ];
    await expect(
      service.persistSnapshot({
        accountId: 4,
        cookies: evil as unknown[],
        source: "browser_profile",
        partitionPath: "persist:social-account-4",
      })
    ).rejects.toMatchObject({ code: "NO_ALLOWED_COOKIES" });
    // Existing usable session is preserved.
    const read = await service.getDecryptedSnapshot(4);
    expect(read.status).toBe("available");
    expect(read.cookies).toHaveLength(2);
  });

  it("filters persisted cookies through the platform manifest", async () => {
    const { service } = await newService({ platformId: 2 });
    const mixed: NormalizedCookie[] = [
      ...ytCookies,
      {
        domain: "evil.com",
        path: "/",
        name: "tracker",
        value: "leak",
        secure: true,
        httpOnly: false,
      },
    ];
    const out = await service.persistSnapshot({
      accountId: 5,
      cookies: mixed as unknown[],
      source: "browser_profile",
      partitionPath: "persist:social-account-5",
    });
    expect(out.importedCookieCount).toBe(2);
    expect(out.rejectedCounts.outside_allowed_domains).toBe(1);
    const read = await service.getDecryptedSnapshot(5);
    expect(read.cookies.every((c) => !c.domain.includes("evil"))).toBe(true);
  });
});

describe("AccountSessionService partition + clear", () => {
  it("reuses a stored valid persist: partition and creates a deterministic one when absent", async () => {
    const { service, model } = await newService();
    // No row yet -> deterministic partition.
    expect(await service.getOrCreatePartition(7)).toBe(
      "persist:social-account-7"
    );
    // Seed a row with a legacy valid partition; it must be reused.
    await model.saveAccountCookies(rawRow(7, "[]", "persist:path/legacy-7"));
    expect(await service.getOrCreatePartition(7)).toBe("persist:path/legacy-7");
  });

  it("clear deletes the row and clears only the account partition", async () => {
    const cleared: string[] = [];
    const { service } = await newService({
      sessionFromPartition: (p) => ({
        cookies: { get: async () => [], set: async () => undefined },
        clearStorageData: async () => {
          cleared.push(p);
        },
      }),
    });
    await service.persistSnapshot({
      accountId: 8,
      cookies: ytCookies as unknown[],
      source: "manual_login",
      partitionPath: "persist:social-account-8",
    });
    await service.clearAccountSession(8);
    expect(cleared).toEqual(["persist:social-account-8"]);
    const meta = await service.getMetadata(8);
    expect(meta.sessionStatus).toBe("missing");
  });
});

describe("AccountSessionService migration", () => {
  it("encrypts a legacy plaintext row, is idempotent, and preserves invalid rows", async () => {
    const { service, model } = await newService();
    // Valid legacy row (Electron-shape JSON).
    await model.saveAccountCookies(
      rawRow(
        10,
        JSON.stringify([
          {
            domain: ".youtube.com",
            path: "/",
            name: "SID",
            value: "legacy",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: 4_000_000_000,
          },
        ]),
        "persist:path/legacy-10"
      )
    );
    // Invalid legacy row (not a cookie array).
    await model.saveAccountCookies(
      rawRow(11, "this is not json {{{", "persist:path/legacy-11")
    );

    const s1 = await service.migrateLegacySnapshots();
    expect(s1.migrated).toBe(1);
    expect(s1.invalid).toBe(1);

    const row = await model.getAccountCookies(10);
    expect(row?.cookies.startsWith("ENC1:")).toBe(true);
    expect(row?.session_status).toBe("available");

    const invalidRow = await model.getAccountCookies(11);
    expect(invalidRow?.session_status).toBe("invalid");
    // Invalid row's original bytes are preserved for recovery.
    expect(invalidRow?.cookies).toBe("this is not json {{{");

    // Idempotent: rerun migrates nothing new.
    const s2 = await service.migrateLegacySnapshots();
    expect(s2.migrated).toBe(0);
  });

  it("defers all candidates when the key is unavailable", async () => {
    const { model } = await newService();
    await model.saveAccountCookies(
      rawRow(12, JSON.stringify(ytCookies), "persist:path/legacy-12")
    );
    const noKeyService = await newService({ throwKey: true });
    const summary = await noKeyService.service.migrateLegacySnapshots();
    expect(summary.deferredKeyUnavailable).toBeGreaterThan(0);
    // Row left untouched (still plaintext).
    const row = await model.getAccountCookies(12);
    expect(row?.cookies.startsWith("ENC1:")).toBe(false);
  });
});

describe("AccountSessionService Electron session lifecycle", () => {
  it("applies decrypted cookies to a session and captures them back filtered", async () => {
    const fake = makeFakeSession();
    const { service } = await newService({ platformId: 2 });
    await service.persistSnapshot({
      accountId: 20,
      cookies: ytCookies as unknown[],
      source: "manual_login",
      partitionPath: "persist:social-account-20",
    });
    const applied = await service.applySnapshotToSession(20, fake.session);
    expect(applied.applied).toBe(2);
    expect(applied.failed).toBe(0);

    // Now capture: inject an outside-allowlist cookie into the live session.
    fake.stored.push({
      domain: ".evil.com",
      path: "/",
      name: "tracker",
      value: "leak",
      secure: true,
      httpOnly: false,
      sameSite: "lax",
      expirationDate: 4_000_000_000,
    });
    const captured = await service.captureSessionSnapshot(20, fake.session);
    expect(captured.importedCookieCount).toBe(2); // evil cookie rejected
    expect(captured.rejectedCounts.outside_allowed_domains).toBe(1);
  });
});

// Ensure FieldCipher round-trips with the test key (sanity for the envelope).
describe("FieldCipher envelope sanity", () => {
  it("encrypt/decrypt round-trips and detects tampering", () => {
    const ct = FieldCipher.encrypt("hello", KEY);
    expect(ct.startsWith("ENC1:")).toBe(true);
    expect(FieldCipher.decrypt(ct, KEY)).toBe("hello");
    const tampered = ct.slice(0, -2) + "AA";
    expect(() => FieldCipher.decrypt(tampered, KEY)).toThrow();
  });
});
