import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Review finding D7: three seam/contract gaps that block deterministic
 * testing of paths that currently depend on wall-clock `new Date()` or a
 * hard-coded audit module the test cannot replace.
 *
 *  1. auditModuleFactory — the audit modules in delivery/generation services
 *     are constructed as instance fields, never injectable. A test cannot
 *     drive audit-write failure or capture audit payloads without a real DB.
 *  2. clock injection — `new Date()` / `Date.now()` at audit-row and lease
 *     sites is not injectable; the budget's `now` exists only for the
 *     deadline, not for the audit/reservation timestamps.
 *  3. freshness_stale named constant — the delivery service compares
 *     `claim.reason === "freshness_stale"` as a bare string literal in three
 *     places; the constant lives as a string in the model. A typo anywhere
 *     silently breaks the §9.3 retry path.
 *
 * These are source-contract guards (mirrors EmailReplyPreDraftPolicy's gate
 * ordering structural test): they fail at compile time if the contract is
 * violated, before any runtime behavior is exercised.
 */

const DELIVERY_SRC = path.resolve(
  __dirname,
  "../../../../src/service/emailReply/EmailReplyDeliveryService.ts"
);
const GENERATION_SRC = path.resolve(
  __dirname,
  "../../../../src/service/emailReply/EmailReplyDraftGenerationService.ts"
);
const MODEL_SRC = path.resolve(
  __dirname,
  "../../../../src/model/EmailReplyDraft.model.ts"
);

function readSrc(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("D7 — seam/contract fixes (source-contract guards)", () => {
  // ----- D7.3: freshness_stale named constant -----

  it("model exports a FRESHNESS_STALE constant equal to the literal", () => {
    const model = readSrc(MODEL_SRC);
    expect(model).toMatch(/export const FRESHNESS_STALE = "freshness_stale"/);
  });

  it("delivery service imports + uses FRESHNESS_STALE instead of the bare literal", () => {
    const delivery = readSrc(DELIVERY_SRC);
    expect(delivery).toMatch(/FRESHNESS_STALE/);
    // Import must reference the model.
    expect(delivery).toContain('from "@/model/EmailReplyDraft.model"');
    // No bare literal comparisons remain against freshness_stale.
    expect(delivery).not.toMatch(/===\s*"freshness_stale"/);
    expect(delivery).not.toMatch(/"freshness_stale"\s*===/);
  });

  it("model's own return sites use the constant, not the bare literal", () => {
    const model = readSrc(MODEL_SRC);
    // The claim fence returns `reason: FRESHNESS_STALE` instead of the bare
    // string. At least one return site must use the constant.
    expect(model).toMatch(/reason:\s*FRESHNESS_STALE/);
  });

  // ----- D7.1: auditModuleFactory seam -----

  it("delivery service exposes an injectable auditModuleFactory seam", () => {
    const delivery = readSrc(DELIVERY_SRC);
    expect(delivery).toMatch(/auditModuleFactory/i);
    // The constructor must accept the factory option.
    expect(delivery).toMatch(/readonly auditModuleFactory\??:/);
  });

  it("generation service exposes injectable reply/auto audit-module factories", () => {
    const gen = readSrc(GENERATION_SRC);
    expect(gen).toMatch(/replyAuditModuleFactory/);
    expect(gen).toMatch(/autoAuditModuleFactory/);
    // The constructor must accept both factory options.
    expect(gen).toMatch(/readonly replyAuditModuleFactory\??:/);
    expect(gen).toMatch(/readonly autoAuditModuleFactory\??:/);
  });

  // ----- D7.2: clock injection -----

  it("delivery service accepts an injectable clock (now seam)", () => {
    const delivery = readSrc(DELIVERY_SRC);
    expect(delivery).toMatch(/readonly now\??:\s*\(\)\s*=>\s*number/);
  });

  it("generation service routes its audit/reservation timestamps through the injectable clock", () => {
    const gen = readSrc(GENERATION_SRC);
    // The budgetOptions.now (already present for the deadline) must also be
    // reused at the reservation/commit/release timestamps — no bare new Date()
    // at those sites.
    expect(gen).toMatch(/this\.nowForInvocation\(\)/);
    // No bare `new Date()` remains at the three known sites (457, 1155, 1730).
    expect(gen).not.toMatch(/now:\s*new Date\(\)/);
  });
});
