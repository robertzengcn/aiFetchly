import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decisionInputSchema,
  decisionResultSchema,
  validateDecisionActionStructure,
} from "@/schemas/api/browserDecision";
import { buildTaskBudget, limitsForRoute } from "@/service/browserDecision/BrowserTaskLimits";
import {
  hostnameAllowedBySuffixes,
  parseUrlIdentity,
  parseUrlIdentityWithOptions,
  registrableDomainOf,
} from "@/service/browserDecision/RegistrableDomain";

const FIXTURE_DIR = resolve(__dirname, "../../../fixtures/browser-decisions/v1");

describe("browser decision contract v1", () => {
  it("accepts the canonical valid request fixture", () => {
    const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "valid-request.json"), "utf8"));
    const parsed = decisionInputSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("accepts the canonical valid result fixture", () => {
    const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "valid-result-fill.json"), "utf8"));
    const parsed = decisionResultSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("rejects a request whose goal exceeds the 2000-char bound", () => {
    const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "valid-request.json"), "utf8"));
    raw.goal = "x".repeat(2001);
    expect(decisionInputSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects a request with more than 120 candidates", () => {
    const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, "valid-request.json"), "utf8"));
    raw.candidates = Array.from({ length: 121 }, (_, i) => ({
      candidate_id: `c${i}`,
      role: "button",
      name: `n${i}`,
      allowed_operations: ["CLICK"],
    }));
    expect(decisionInputSchema.safeParse(raw).success).toBe(false);
  });

  it("validates decided actions against the offered candidates and route", () => {
    const request = decisionInputSchema.parse(
      JSON.parse(readFileSync(resolve(FIXTURE_DIR, "valid-request.json"), "utf8")),
    );
    const result = decisionResultSchema.parse(
      JSON.parse(readFileSync(resolve(FIXTURE_DIR, "valid-result-fill.json"), "utf8")),
    );
    expect(validateDecisionActionStructure(result, request)).toBeNull();
  });

  it("reports the fixture-declared violations for invalid results", () => {
    const request = decisionInputSchema.parse(
      JSON.parse(readFileSync(resolve(FIXTURE_DIR, "valid-request.json"), "utf8")),
    );
    const cases = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, "invalid-results.json"), "utf8"),
    ) as Array<{
      name: string;
      result: unknown;
      expected_violation: string | null;
    }>;
    for (const testCase of cases) {
      const parsed = decisionResultSchema.safeParse(testCase.result);
      if (!parsed.success) {
        // Schema-level rejection is also an acceptable guard for malformed wire data.
        continue;
      }
      expect(
        validateDecisionActionStructure(parsed.data, request),
        testCase.name,
      ).toBe(testCase.expected_violation);
    }
  });
});

describe("BrowserTaskLimits", () => {
  it("uses route-specific budgets: hosted is tighter than custom", () => {
    const hosted = limitsForRoute("hosted");
    const custom = limitsForRoute("chat");
    expect(hosted.activeRuntimeDefaultMs).toBe(120_000);
    expect(custom.activeRuntimeDefaultMs).toBe(300_000);
    expect(hosted.requestTimeoutHardMs).toBe(10_000);
    expect(custom.requestTimeoutHardMs).toBe(30_000);
  });

  it("clamps requested budgets to defaults and hard ceilings", () => {
    const budget = buildTaskBudget("hosted", {
      activeRuntimeMs: 999_999,
      leafSteps: 10,
      decisionRequests: 0,
    });
    expect(budget.activeRuntimeMs).toBe(240_000);
    expect(budget.leafSteps).toBe(10);
    expect(budget.decisionRequests).toBe(45);
  });

  it("never allows a raise above the hard ceiling even in custom mode", () => {
    const budget = buildTaskBudget("native", { requestTimeoutMs: 60_000 });
    expect(budget.requestTimeoutMs).toBe(30_000);
  });
});

describe("RegistrableDomain", () => {
  it("derives eTLD+1 including multi-label public suffixes", () => {
    expect(registrableDomainOf("www.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomainOf("accounts.google.com")).toBe("google.com");
    expect(registrableDomainOf("evil-example.com")).toBe("evil-example.com");
  });

  it("rejects public suffixes, IPs, and single-label hosts", () => {
    expect(registrableDomainOf("co.uk")).toBeNull();
    expect(registrableDomainOf("com")).toBeNull();
    expect(registrableDomainOf("127.0.0.1")).toBeNull();
    expect(registrableDomainOf("localhost")).toBeNull();
  });

  it("parses URL identity and rejects non-HTTP(S)", () => {
    expect(parseUrlIdentity("https://www.example.com/login")?.registrableDomain).toBe("example.com");
    expect(parseUrlIdentity("ftp://www.example.com")).toBeNull();
  });

  it("matches hostnames suffix-exactly", () => {
    expect(hostnameAllowedBySuffixes("www.example.com", ["example.com"])).toBe(true);
    expect(hostnameAllowedBySuffixes("not-example.com", ["example.com"])).toBe(false);
    expect(hostnameAllowedBySuffixes("example.com.evil.test", ["example.com"])).toBe(false);
    expect(hostnameAllowedBySuffixes("www.example.com", [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// X1: registrable-domain hardening (private suffixes, loopback, downgrades)
// ---------------------------------------------------------------------------

describe("RegistrableDomain X1 hardening", () => {
  it("separates tenants on private public suffixes (github.io)", () => {
    const attacker = registrableDomainOf("attacker.github.io");
    const victim = registrableDomainOf("victim.github.io");
    // WITHOUT the private-suffix entries both collapsed to "github.io".
    expect(attacker).toBe("attacker.github.io");
    expect(victim).toBe("victim.github.io");
    expect(attacker).not.toBe(victim);
  });

  it("keeps country second-level suffixes out of registrable domains", () => {
    expect(registrableDomainOf("school.edu.cn")).toBe("school.edu.cn");
    expect(registrableDomainOf("site.co.ke")).toBe("site.co.ke");
    expect(registrableDomainOf("app.herokuapp.com")).toBe("app.herokuapp.com");
  });

  it("loopback and private-name hosts are never registrable", () => {
    expect(registrableDomainOf("localhost")).toBeNull();
    expect(registrableDomainOf("tenant.localhost")).toBeNull();
    expect(registrableDomainOf("service.local")).toBeNull();
    expect(registrableDomainOf("db.internal")).toBeNull();
  });

  it("parseUrlIdentityWithOptions rejects http when httpsOnly is set", () => {
    expect(
      parseUrlIdentityWithOptions("http://example.test/page", {
        httpsOnly: true,
      })
    ).toBeNull();
    expect(
      parseUrlIdentityWithOptions("https://example.test/page", {
        httpsOnly: true,
      })
    ).not.toBeNull();
  });
});

describe("N01 longest-match suffix rules", () => {
  it("isolates tenants under multi-label private suffixes (s3.amazonaws.com)", () => {
    // The audited reproduction: the two-label matcher returned
    // "amazonaws.com" for ALL of these.
    expect(registrableDomainOf("alice.s3.amazonaws.com")).toBe(
      "alice.s3.amazonaws.com"
    );
    expect(registrableDomainOf("bob.s3.amazonaws.com")).toBe(
      "bob.s3.amazonaws.com"
    );
    expect(registrableDomainOf("alice.s3.amazonaws.com")).not.toBe(
      registrableDomainOf("bob.s3.amazonaws.com")
    );
    // The suffix itself is not registrable.
    expect(registrableDomainOf("s3.amazonaws.com")).toBeNull();
  });

  it("matches multi-label rules at any depth (longest first)", () => {
    // s3.dualstack.amazonaws.com is a 4-label rule; a host under it
    // isolates per tenant.
    expect(registrableDomainOf("x.s3.dualstack.amazonaws.com")).toBe(
      "x.s3.dualstack.amazonaws.com"
    );
    // A 2-label rule still matches a 4-label host via longest-match.
    expect(registrableDomainOf("site.web.id")).toBe("site.web.id");
  });

  it("supports wildcard and exception rules", () => {
    // *.ck: the public suffix of foo.bar.ck is bar.ck (any label + ck);
    // the registrable domain is one more label — foo.bar.ck itself.
    expect(registrableDomainOf("foo.bar.ck")).toBe("foo.bar.ck");
    // Sibling tenants under the wildcard are DIFFERENT registrable
    // domains (the audited R01 collision).
    expect(registrableDomainOf("other.bar.ck")).toBe("other.bar.ck");
    expect(registrableDomainOf("foo.bar.ck")).not.toBe(
      registrableDomainOf("other.bar.ck")
    );
    // !www.ck exception: www.ck itself is the registrable domain.
    expect(registrableDomainOf("www.ck")).toBe("www.ck");
    // The wildcard public suffix a.ck is not registrable.
    expect(registrableDomainOf("a.ck")).toBeNull();
  });

  it("still rejects loopback/private-name and single-label hosts", () => {
    expect(registrableDomainOf("localhost")).toBeNull();
    expect(registrableDomainOf("tenant.localhost")).toBeNull();
    expect(registrableDomainOf("service.local")).toBeNull();
    expect(registrableDomainOf("db.internal")).toBeNull();
    expect(registrableDomainOf("example")).toBeNull();
  });
});
