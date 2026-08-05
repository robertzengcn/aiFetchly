import { describe, it, expect } from "vitest";
import {
  normalizedCookieSchema,
  accountSessionMetadataSchema,
  cookieImportResultSchema,
  cookieMigrationSummarySchema,
  storedCookieSourceSchema,
  persistSnapshotInputSchema,
} from "@/schemas/accountCookies";

describe("normalizedCookieSchema", () => {
  it("accepts a fully-specified cookie and defaults path/httpOnly", () => {
    const parsed = normalizedCookieSchema.parse({
      domain: "youtube.com",
      name: "SID",
      value: "v",
      secure: true,
    });
    expect(parsed.path).toBe("/");
    expect(parsed.httpOnly).toBe(false);
    expect(parsed.domain).toBe("youtube.com");
  });

  it("rejects empty domain and oversize value", () => {
    expect(() =>
      normalizedCookieSchema.parse({
        domain: "",
        name: "x",
        value: "v",
        secure: true,
      })
    ).toThrow();
    expect(() =>
      normalizedCookieSchema.parse({
        domain: "a.com",
        name: "x",
        value: "x".repeat(16385),
        secure: true,
      })
    ).toThrow();
  });

  it("rejects unknown keys (strictObject)", () => {
    expect(() =>
      normalizedCookieSchema.parse({
        domain: "a.com",
        name: "x",
        value: "v",
        secure: true,
        extra: "nope",
      })
    ).toThrow();
  });
});

describe("accountSessionMetadataSchema", () => {
  it("accepts a complete metadata object", () => {
    const m = accountSessionMetadataSchema.parse({
      hasCookies: true,
      cookieCount: 3,
      lastUpdatedAt: "2026-08-05T00:00:00.000Z",
      importSource: "browser_profile",
      sessionStatus: "available",
    });
    expect(m.cookieCount).toBe(3);
  });

  it("accepts null importSource / lastUpdatedAt for empty accounts", () => {
    const m = accountSessionMetadataSchema.parse({
      hasCookies: false,
      cookieCount: 0,
      lastUpdatedAt: null,
      importSource: null,
      sessionStatus: "missing",
    });
    expect(m.importSource).toBeNull();
  });

  it("rejects worker_refresh as a renderer importSource", () => {
    expect(() =>
      accountSessionMetadataSchema.parse({
        hasCookies: true,
        cookieCount: 1,
        lastUpdatedAt: null,
        importSource: "worker_refresh",
        sessionStatus: "available",
      })
    ).toThrow();
  });

  it("never allows a cookies field through (renderer safety)", () => {
    const payload = {
      hasCookies: true,
      cookieCount: 1,
      lastUpdatedAt: null,
      importSource: null,
      sessionStatus: "available",
      cookies: [{ name: "leak" }],
    };
    expect(() => accountSessionMetadataSchema.parse(payload)).toThrow();
  });
});

describe("cookieImportResultSchema", () => {
  it("accepts a success variant", () => {
    const r = cookieImportResultSchema.parse({
      state: "success",
      importedCookieCount: 5,
      rejectedCookieCounts: { expired: 1 },
      verificationUrl: "https://www.youtube.com/",
    });
    expect(r.state).toBe("success");
  });

  it("accepts a failure variant with importedCookieCount 0", () => {
    const r = cookieImportResultSchema.parse({
      state: "permission_denied",
      importedCookieCount: 0,
      rejectedCookieCounts: {},
    });
    expect(r.state).toBe("permission_denied");
  });

  it("rejects a failure variant claiming a nonzero import count", () => {
    expect(() =>
      cookieImportResultSchema.parse({
        state: "no_eligible_cookies",
        importedCookieCount: 3,
        rejectedCookieCounts: {},
      })
    ).toThrow();
  });
});

describe("misc schemas", () => {
  it("storedCookieSourceSchema includes worker_refresh", () => {
    expect(storedCookieSourceSchema.parse("worker_refresh")).toBe(
      "worker_refresh"
    );
  });

  it("persistSnapshotInputSchema validates a write request", () => {
    const r = persistSnapshotInputSchema.parse({
      accountId: 7,
      cookies: [{ domain: "a.com", name: "x", value: "v", secure: true }],
      source: "manual_login",
      partitionPath: "persist:social-account-7",
    });
    expect(r.accountId).toBe(7);
  });

  it("cookieMigrationSummarySchema validates safe counts", () => {
    const r = cookieMigrationSummarySchema.parse({
      scanned: 10,
      migrated: 8,
      invalid: 1,
      deferredKeyUnavailable: 1,
      persistenceFailed: 0,
      alreadyEncrypted: 5,
    });
    expect(r.migrated).toBe(8);
  });
});
