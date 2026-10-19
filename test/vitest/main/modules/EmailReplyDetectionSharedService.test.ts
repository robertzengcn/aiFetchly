import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  EmailReplyDetectionService,
  getSharedEmailReplyDetectionService,
  resetSharedEmailReplyDetectionService,
} from "@/service/emailReceive/EmailReplyDetectionService";

/**
 * Review finding D6: the detection service's in-memory cache, single-flight
 * map, and per-mailbox probe lock are INSTANCE state. All three production
 * construction sites (generation, delivery, detection module) previously
 * constructed a FRESH EmailReplyDetectionService per outer-service instance,
 * and the outer services are themselves constructed per request — so the
 * cache layer could never hit across requests and every draft check re-probed
 * the mailbox.
 *
 * The fix: ONE process-wide memoized instance, resolved through a lazily
 * constructed getter (never `new` at module top level — BaseModule TDZ under
 * vi.mock). Injected test seams keep precedence, so the existing
 * detection-exercising suites (which all inject `detectionServiceFactory`)
 * are unaffected by the shared singleton.
 *
 * These tests assert the structural fix (instance sharing + source contract).
 * The cache-hit behavior itself is covered by EmailReplyDetectionCache.test.ts;
 * D6 only proves the instances that SHOULD share one cache actually do.
 */

const GENERATION_SRC = path.resolve(
  __dirname,
  "../../../../src/service/emailReply/EmailReplyDraftGenerationService.ts"
);
const DELIVERY_SRC = path.resolve(
  __dirname,
  "../../../../src/service/emailReply/EmailReplyDeliveryService.ts"
);
const MODULE_SRC = path.resolve(
  __dirname,
  "../../../../src/modules/EmailReplyDetectionModule.ts"
);
const SERVICE_SRC = path.resolve(
  __dirname,
  "../../../../src/service/emailReceive/EmailReplyDetectionService.ts"
);

function readSrc(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("D6 — shared memoized EmailReplyDetectionService across requests", () => {
  beforeEach(() => {
    resetSharedEmailReplyDetectionService();
  });
  afterEach(() => {
    resetSharedEmailReplyDetectionService();
  });

  it("getSharedEmailReplyDetectionService memoizes ONE instance process-wide", () => {
    const a = getSharedEmailReplyDetectionService();
    const b = getSharedEmailReplyDetectionService();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(EmailReplyDetectionService);
  });

  it("resetSharedEmailReplyDetectionService drops the memo (test hook)", () => {
    const a = getSharedEmailReplyDetectionService();
    resetSharedEmailReplyDetectionService();
    const b = getSharedEmailReplyDetectionService();
    expect(a).not.toBe(b);
  });

  it("resetSharedEmailReplyDetectionService(optionalInstance) seeds the memo", () => {
    const seeded = new EmailReplyDetectionService();
    resetSharedEmailReplyDetectionService(seeded);
    expect(getSharedEmailReplyDetectionService()).toBe(seeded);
  });

  it("two per-request consumers of the shared getter resolve the SAME instance", () => {
    // Simulate the per-request pattern the fix targets: each "request"
    // constructs its own outer service, which resolves detection through the
    // shared getter (as the production fallbacks now do). Before D6 each
    // outer service held its OWN detection instance; after D6 they share.
    const consumerAholder: { svc: EmailReplyDetectionService | null } = {
      svc: null,
    };
    const consumerBholder: { svc: EmailReplyDetectionService | null } = {
      svc: null,
    };
    consumerAholder.svc = getSharedEmailReplyDetectionService();
    consumerBholder.svc = getSharedEmailReplyDetectionService();
    expect(consumerAholder.svc).toBe(consumerBholder.svc);
  });

  // ----- Source contracts (structural guard, mirrors PreDraftPolicy) -----

  it("source contract: service exports the shared getter + reset hook", () => {
    const service = readSrc(SERVICE_SRC);
    expect(service).toMatch(
      /export function getSharedEmailReplyDetectionService\(\)/
    );
    expect(service).toMatch(
      /export function resetSharedEmailReplyDetectionService\(/
    );
  });

  it("source contract: the shared instance is resolved lazily, never constructed at module eval time", () => {
    const service = readSrc(SERVICE_SRC);
    // Module-level holder + lazy getter, no top-level (column-0) `new` of the
    // service class — the BaseModule TDZ landmine under vi.mock.
    expect(service).toMatch(
      /let sharedEmailReplyDetectionService: EmailReplyDetectionService \| null = null/
    );
    expect(service).not.toMatch(/^new EmailReplyDetectionService\(/m);
  });

  it("source contract: all three production fallbacks use the shared getter, not bare `new`", () => {
    const gen = readSrc(GENERATION_SRC);
    expect(gen).toContain("getSharedEmailReplyDetectionService()");
    expect(gen).not.toContain("new EmailReplyDetectionService()");

    const delivery = readSrc(DELIVERY_SRC);
    expect(delivery).toContain("getSharedEmailReplyDetectionService()");
    expect(delivery).not.toContain("new EmailReplyDetectionService()");

    const module = readSrc(MODULE_SRC);
    expect(module).toContain("getSharedEmailReplyDetectionService()");
    expect(module).not.toContain("new EmailReplyDetectionService()");
  });

  it("source contract: injected detectionServiceFactory still takes precedence in outer services", () => {
    // The factory seam must still be consulted first so tests that inject a
    // fake detection service are not polluted by the shared singleton.
    const gen = readSrc(GENERATION_SRC);
    expect(gen).toMatch(/this\.detectionServiceFactory/);
    const delivery = readSrc(DELIVERY_SRC);
    expect(delivery).toMatch(/this\.detectionServiceFactory/);
  });

  it("source contract: EmailReplyDetectionModule's service seam still takes precedence", () => {
    const module = readSrc(MODULE_SRC);
    // Constructor-injected service must win over the shared getter.
    expect(module).toMatch(/options\?\.service/);
  });
});
