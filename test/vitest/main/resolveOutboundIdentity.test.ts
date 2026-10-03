import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { resolveOutboundIdentity } from "@/service/outboundEmail/resolveOutboundSender";

/**
 * Direct unit coverage for resolveOutboundIdentity (§13.2 effective-identity
 * resolution). The resolver is fail-closed: it walks ONLY the explicitly named
 * service ids (preferred first, then candidates) and returns null when none
 * resolve — it must NOT scan all active services as a fallback (adversarial
 * F2+F4: scanning an unrelated service could bind a different identity and
 * surface as a confusing sender_identity_changed failure at delivery time).
 *
 * Each test gets an isolated temp DB so the process-wide SqliteDb singleton
 * never collides with other suites (avoiding the SQLITE_BUSY shared-DB flake).
 */
const tmpDir = path.join(os.tmpdir(), "aifetchly-resolve-outbound-identity");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
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

async function seedService(
  id: number,
  from: string,
  opts: {
    smtpUsername?: string | null;
    replyTo?: string | null;
    status?: number;
  } = {}
): Promise<void> {
  const model = new EmailServiceModel(tmpDir);
  const entity = new EmailServiceEntity();
  entity.id = id;
  entity.name = `svc-${id}`;
  entity.from = from;
  entity.smtpUsername = opts.smtpUsername ?? null;
  entity.replyTo = opts.replyTo ?? null;
  entity.password = "pass";
  entity.host = "smtp.example.com";
  entity.port = "465";
  entity.ssl = 1;
  entity.status = opts.status ?? 1;
  await model.create(entity);
}

describe("resolveOutboundIdentity — fail-closed effective identity", () => {
  it("resolves the preferred service's full identity", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedService(7, "owner@svc.com", {
      smtpUsername: "api-login@svc.com",
      replyTo: "replies@svc.com",
    });

    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: 7,
      serviceIds: [],
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.emailServiceId).toBe(7);
    expect(resolved!.smtpUsername).toBe("api-login@svc.com");
    expect(resolved!.senderAddress).toBe("owner@svc.com");
    expect(resolved!.replyToAddress).toBe("replies@svc.com");
  });

  it("falls back smtpUsername to the from address when the service has no explicit smtpUsername", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedService(8, "owner@svc.com", {
      smtpUsername: null,
      replyTo: null,
    });

    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: 8,
      serviceIds: [],
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.smtpUsername).toBe("owner@svc.com");
    // No replyTo → null (not the from address).
    expect(resolved!.replyToAddress).toBeNull();
  });

  it("normalizes a blank replyTo to null", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedService(9, "owner@svc.com", {
      replyTo: "   ",
    });

    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: 9,
      serviceIds: [],
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.replyToAddress).toBeNull();
  });

  it("falls through preferred to a candidate service id when preferred does not resolve", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    // Preferred id 404 does not exist; candidate id 10 does.
    await seedService(10, "fallback@svc.com", {
      smtpUsername: "fb-login@svc.com",
    });

    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: 404,
      serviceIds: [10],
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.emailServiceId).toBe(10);
    expect(resolved!.senderAddress).toBe("fallback@svc.com");
  });

  it("returns null when NO named service resolves, even if an unrelated active service exists (regression lock for the removed scan-all fallback)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    // An active service exists, but is NOT named in preferred or serviceIds.
    await seedService(11, "unrelated@svc.com");

    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: 404,
      serviceIds: [405],
    });

    // Must NOT pick up service 11 — fail closed when no NAMED service resolves.
    expect(resolved).toBeNull();
  });

  it("returns null when the preferred service row has an empty from address", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedService(12, "");

    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: 12,
      serviceIds: [],
    });

    expect(resolved).toBeNull();
  });

  it("returns null when given no service ids at all", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: null,
      serviceIds: [],
    });

    expect(resolved).toBeNull();
  });

  it("deduplicates ids so preferred + serviceIds overlap resolves once", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedService(13, "owner@svc.com", {
      smtpUsername: "api-login@svc.com",
      replyTo: "replies@svc.com",
    });

    // preferredServiceId 13 also appears in serviceIds — still resolves service 13.
    const resolved = await resolveOutboundIdentity({
      dbpath: tmpDir,
      preferredServiceId: 13,
      serviceIds: [13],
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.emailServiceId).toBe(13);
  });
});
