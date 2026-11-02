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
