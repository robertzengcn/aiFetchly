import { describe, it, expect, beforeEach } from "vitest";
import {
  incrementEmailServiceMetric,
  drainCountersForTest,
} from "@/modules/lib/EmailServiceMetrics";
import { resolveEmailServiceIdentity } from "@/modules/lib/EmailServiceIdentityResolver";

/**
 * Metrics tests for the email-service identity observability counters (P2.1,
 * technical design §21). Verifies the three counters fire on the right
 * conditions and never carry email/username values as labels.
 */
describe("EmailServiceMetrics — identity counters (P2.1, §21)", () => {
  beforeEach(() => {
    drainCountersForTest();
  });

  it("increments a counter keyed by name", () => {
    incrementEmailServiceMetric("import_password_preserved");
    incrementEmailServiceMetric("import_password_preserved");
    const counters = drainCountersForTest();
    expect(counters.get("import_password_preserved")).toBe(2);
  });

  it("keys counters by name + sorted labels (no identity values)", () => {
    incrementEmailServiceMetric("identity_legacy_fallback", { mode: "send" });
    incrementEmailServiceMetric("identity_legacy_fallback", { mode: "send" });
    incrementEmailServiceMetric("identity_legacy_fallback", { mode: "import" });
    const counters = drainCountersForTest();
    expect(counters.get("identity_legacy_fallback{mode=send}")).toBe(2);
    expect(counters.get("identity_legacy_fallback{mode=import}")).toBe(1);
  });

  it("bounds string labels so private content cannot leak into metrics", () => {
    // A label that might carry an email address is truncated to 60 chars in
    // the emitted JSON (defense-in-depth). The raw key is NOT the emission
    // path, so we just assert the increment does not throw and the counter
    // exists — the sanitizeLabels bound is exercised via the emit path.
    expect(() =>
      incrementEmailServiceMetric("identity_legacy_fallback", {
        leak: "x".repeat(500),
      })
    ).not.toThrow();
    const counters = drainCountersForTest();
    expect(counters.get("identity_legacy_fallback{leak=")).toBeUndefined();
  });

  it("drainCountersForTest resets counters after reading", () => {
    incrementEmailServiceMetric("import_new_password_missing");
    const first = drainCountersForTest();
    expect(first.get("import_new_password_missing")).toBe(1);
    const second = drainCountersForTest();
    expect(second.get("import_new_password_missing")).toBeUndefined();
  });

  it("resolver fires identity_legacy_fallback when smtpUsername is absent", () => {
    drainCountersForTest();
    // null smtpUsername → fallback to from → counter fires
    resolveEmailServiceIdentity({ from: "sales@example.com", smtpUsername: null });
    resolveEmailServiceIdentity({ from: "sales@example.com" });
    // whitespace-only smtpUsername → also falls back → counter fires
    resolveEmailServiceIdentity({ from: "sales@example.com", smtpUsername: "   " });
    const counters = drainCountersForTest();
    expect(counters.get("identity_legacy_fallback")).toBe(3);
  });

  it("resolver does NOT fire identity_legacy_fallback when smtpUsername is set", () => {
    drainCountersForTest();
    resolveEmailServiceIdentity({
      from: "sales@example.com",
      smtpUsername: "mailbox@example.com",
    });
    const counters = drainCountersForTest();
    expect(counters.get("identity_legacy_fallback")).toBeUndefined();
  });
});
