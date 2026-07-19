import { describe, it, expect } from "vitest";
import {
  proxyListSchema,
  proxyGetSchema,
  proxyCreateSchema,
  proxyUpdateSchema,
  proxyDeleteSchema,
  proxyImportSchema,
  proxyCheckSchema,
  proxyRemoveFailedSchema,
  toSafeProxySummary,
  normalizePort,
  normalizeProtocol,
  normalizeHost,
  mapBasicStatus,
  mapGooglePassStatus,
  runWithConcurrency,
} from "@/entityTypes/proxyAiToolTypes";

describe("proxy normalizers", () => {
  it("normalizes numeric and string ports to a 1-65535 string", () => {
    expect(normalizePort(8080)).toBe("8080");
    expect(normalizePort("1080")).toBe("1080");
    expect(normalizePort(" 80 ")).toBe("80");
    expect(normalizePort(0)).toBeUndefined();
    expect(normalizePort(65536)).toBeUndefined();
    expect(normalizePort("abc")).toBeUndefined();
    expect(normalizePort(1.5)).toBeUndefined();
  });

  it("normalizes protocols case-insensitively and rejects unknown", () => {
    expect(normalizeProtocol("SOCKS5")).toBe("socks5");
    expect(normalizeProtocol(" http ")).toBe("http");
    expect(normalizeProtocol("vpn")).toBeUndefined();
    expect(normalizeProtocol(undefined)).toBeUndefined();
  });

  it("normalizes hosts and rejects whitespace/path/query", () => {
    expect(normalizeHost("proxy.example.com")).toBe("proxy.example.com");
    expect(normalizeHost("[::1]")).toBe("[::1]");
    expect(normalizeHost("host/path")).toBeUndefined();
    expect(normalizeHost("host?x=1")).toBeUndefined();
    expect(normalizeHost("a b")).toBeUndefined();
    expect(normalizeHost("   ")).toBeUndefined();
  });
});

describe("proxy status mapping", () => {
  it("treats status 1 as pass only when a checktime exists", () => {
    expect(mapBasicStatus(1, true)).toBe("pass");
    expect(mapBasicStatus(1, false)).toBe("unknown");
    expect(mapBasicStatus(2, true)).toBe("failure");
    expect(mapBasicStatus(undefined, false)).toBe("unknown");
  });

  it("maps google pass numerics", () => {
    expect(mapGooglePassStatus(1)).toBe("pass");
    expect(mapGooglePassStatus(2)).toBe("fail");
    expect(mapGooglePassStatus(undefined)).toBe("not_checked");
  });
});

describe("toSafeProxySummary redaction", () => {
  it("maps list shape (username/password) and redacts password", () => {
    const summary = toSafeProxySummary({
      id: 12,
      host: "proxy.example.com",
      port: "1080",
      protocol: "socks5",
      username: "demo",
      password: "secret",
      country_code: "US",
      addtime: "2026-07-19",
      checktime: "2026-07-20",
      status: 1,
      googlePass: 2,
    });
    expect(summary).toMatchObject({
      id: 12,
      host: "proxy.example.com",
      port: "1080",
      protocol: "socks5",
      username: "demo",
      hasPassword: true,
      countryCode: "US",
      status: "pass",
      googlePass: "fail",
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret");
    // No credential field keys may exist (status:"pass" value is fine).
    const asObject = JSON.parse(serialized) as Record<string, unknown>;
    expect(asObject).not.toHaveProperty("password");
    expect(asObject).not.toHaveProperty("pass");
  });

  it("maps detail shape (user/pass) and redacts pass", () => {
    const summary = toSafeProxySummary({
      id: 5,
      host: "1.2.3.4",
      port: 8080,
      user: "u",
      pass: "supersecret",
    });
    expect(summary.hasPassword).toBe(true);
    expect(summary.username).toBe("u");
    const serialized = JSON.stringify(summary);
    const asObject = JSON.parse(serialized) as Record<string, unknown>;
    expect(asObject).not.toHaveProperty("pass");
    expect(serialized).not.toContain("supersecret");
  });

  it("throws when id/host/port missing", () => {
    expect(() => toSafeProxySummary({ host: "x", port: "1" })).toThrow();
  });
});

describe("proxy Zod schemas", () => {
  it("create schema normalizes numeric port to string", () => {
    const parsed = proxyCreateSchema.parse({
      host: "proxy.example.com",
      port: 1080,
      protocol: "SOCKS5",
    });
    expect(parsed.port).toBe("1080");
    expect(parsed.protocol).toBe("socks5");
  });

  it("create schema rejects bad port and protocol", () => {
    expect(() =>
      proxyCreateSchema.parse({ host: "h", port: 0, protocol: "http" })
    ).toThrow();
    expect(() =>
      proxyCreateSchema.parse({ host: "h", port: 80, protocol: "vpn" })
    ).toThrow();
  });

  it("update schema rejects an empty patch", () => {
    expect(() => proxyUpdateSchema.parse({ proxy_id: 5 })).toThrow();
  });

  it("update schema accepts a single-field patch with nullable clear", () => {
    const parsed = proxyUpdateSchema.parse({
      proxy_id: 5,
      user: null,
      pass: null,
    });
    expect(parsed.user).toBeNull();
    expect(parsed.pass).toBeNull();
  });

  it("import schema enforces max 500", () => {
    const tooMany = {
      proxies: Array.from({ length: 501 }, () => ({
        host: "h",
        port: 80,
        protocol: "http",
      })),
    };
    expect(() => proxyImportSchema.parse(tooMany)).toThrow();
  });

  it("list schema applies pagination defaults", () => {
    expect(proxyListSchema.parse({})).toMatchObject({ page: 0, size: 20 });
  });

  it("get schema rejects non-positive id", () => {
    expect(() => proxyGetSchema.parse({ proxy_id: 0 })).toThrow();
  });

  it("delete schema parses optional expected fields", () => {
    expect(proxyDeleteSchema.parse({ proxy_id: 9 }).proxy_id).toBe(9);
    expect(
      proxyDeleteSchema.parse({ proxy_id: 9, expected_port: 8080 })
        .expected_port
    ).toBe("8080");
  });

  it("check schema requires exactly one target selector", () => {
    expect(() => proxyCheckSchema.parse({})).toThrow();
    expect(() =>
      proxyCheckSchema.parse({
        proxy_ids: [1],
        check_all: true,
        mode: "both",
      })
    ).toThrow();
    const ok = proxyCheckSchema.parse({ proxy_ids: [1, 2] });
    expect(ok.timeout_ms).toBe(15000);
    expect(ok.concurrency).toBe(3);
    expect(ok.mode).toBe("both");
  });

  it("check schema clamps via schema bounds", () => {
    expect(() =>
      proxyCheckSchema.parse({ proxy_ids: [1], timeout_ms: 50 })
    ).toThrow();
    expect(() =>
      proxyCheckSchema.parse({ proxy_ids: [1], concurrency: 99 })
    ).toThrow();
  });

  it("remove_failed schema applies defaults", () => {
    expect(proxyRemoveFailedSchema.parse({})).toMatchObject({
      failureType: "basic",
      dry_run: false,
      max_delete: 100,
    });
  });
});

describe("runWithConcurrency", () => {
  it("awaits all workers before resolving and preserves order", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return item * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("continues after a worker rejects and records undefined", async () => {
    const results = await runWithConcurrency([1, 2, 3], 3, async (item) => {
      if (item === 2) {
        throw new Error("boom");
      }
      return item;
    });
    expect(results).toEqual([1, undefined, 3]);
  });
});
