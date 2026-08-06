import { describe, it, expect } from "vitest";
import {
  ImportRequestRegistry,
  ImportRequestValidationError,
} from "@/main-process/browserProfileImport/ImportRequestRegistry";

describe("ImportRequestRegistry", () => {
  const now = 1_700_000_000_000;
  const ttl = 5 * 60 * 1000;

  it("create returns a requestId + opaque secret + expiry", () => {
    const reg = new ImportRequestRegistry();
    const created = reg.create(1, 2, ["youtube.com"], ttl, now);
    expect(created.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.requestSecret.length).toBeGreaterThan(40);
    expect(created.expiresAtMs).toBe(now + ttl);
    expect(reg.size()).toBe(1);
  });

  it("consume with the correct secret returns the bound request and deletes it", () => {
    const reg = new ImportRequestRegistry();
    const created = reg.create(7, 2, ["youtube.com", "google.com"], ttl, now);
    const pending = reg.consume(created.requestId, created.requestSecret, now);
    expect(pending.accountId).toBe(7);
    expect(pending.platformId).toBe(2);
    expect(pending.allowedDomains).toContain("google.com");
    expect(reg.size()).toBe(0);
  });

  it("a consumed request cannot be replayed (one-time)", () => {
    const reg = new ImportRequestRegistry();
    const created = reg.create(1, 2, ["youtube.com"], ttl, now);
    reg.consume(created.requestId, created.requestSecret, now);
    expect(() =>
      reg.consume(created.requestId, created.requestSecret, now)
    ).toThrow(ImportRequestValidationError);
  });

  it("a wrong secret is rejected but the entry stays for a legitimate retry", () => {
    const reg = new ImportRequestRegistry();
    const created = reg.create(1, 2, ["youtube.com"], ttl, now);
    expect(() => reg.consume(created.requestId, "wrong", now)).toThrow();
    // Entry still present; correct secret still works.
    const pending = reg.consume(created.requestId, created.requestSecret, now);
    expect(pending.accountId).toBe(1);
  });

  it("expires after the TTL and rejects consume", () => {
    const reg = new ImportRequestRegistry();
    const created = reg.create(1, 2, ["youtube.com"], ttl, now);
    expect(() =>
      reg.consume(created.requestId, created.requestSecret, now + ttl + 1)
    ).toThrow(ImportRequestValidationError);
    expect(reg.size()).toBe(0);
  });

  it("rejects a same-length wrong secret via timingSafeEqual (not the length guard)", () => {
    const reg = new ImportRequestRegistry();
    const created = reg.create(1, 2, ["youtube.com"], ttl, now);
    // Flip one byte of the base64url secret: same length, different value, so
    // the comparison reaches crypto.timingSafeEqual rather than the length guard.
    const sameLenWrong =
      created.requestSecret[0] === "A"
        ? "B" + created.requestSecret.slice(1)
        : "A" + created.requestSecret.slice(1);
    expect(sameLenWrong.length).toBe(created.requestSecret.length);
    expect(sameLenWrong).not.toBe(created.requestSecret);
    expect(() => reg.consume(created.requestId, sameLenWrong, now)).toThrow(
      ImportRequestValidationError
    );
    // Entry still present for a legitimate retry within TTL.
    const pending = reg.consume(created.requestId, created.requestSecret, now);
    expect(pending.accountId).toBe(1);
  });

  it("cancel removes a pending request", () => {
    const reg = new ImportRequestRegistry();
    const created = reg.create(1, 2, ["youtube.com"], ttl, now);
    expect(reg.cancel(created.requestId)).toBe(true);
    expect(reg.size()).toBe(0);
    // consuming after cancel fails
    expect(() =>
      reg.consume(created.requestId, created.requestSecret, now)
    ).toThrow();
  });

  it("cancel returns false for an unknown request", () => {
    const reg = new ImportRequestRegistry();
    expect(reg.cancel("nope")).toBe(false);
  });

  it("pruneExpired drops only stale entries", () => {
    const reg = new ImportRequestRegistry();
    const a = reg.create(1, 2, ["youtube.com"], ttl, now);
    reg.create(2, 2, ["youtube.com"], ttl, now + 1000); // expires later
    expect(reg.pruneExpired(now + ttl + 1)).toBe(1);
    expect(reg.peek(a.requestId)).toBeUndefined();
    expect(reg.size()).toBe(1);
  });
});
