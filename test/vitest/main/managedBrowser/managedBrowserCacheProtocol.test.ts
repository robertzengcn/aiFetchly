import { describe, expect, it } from "vitest";

import {
  bucketForDurationMs,
  managedBrowserCacheInboundSchema,
  managedBrowserCacheOutboundSchema,
} from "@/schemas/worker/managedBrowserCache";

/**
 * Cache maintenance worker wire protocol (design §13.9). Both directions are
 * strict unions: unknown fields, wrong protocol versions, and unsafe
 * payloads must never validate. NO sessionId exists on this protocol.
 */

const TOKEN_A = "a".repeat(24);
const TOKEN_B = "b".repeat(24);

function inboundBase(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    requestId: "req-cache-1",
    sequence: 1,
  };
}

function outboundBase(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    requestId: "req-cache-1",
    sequence: 1,
  };
}

describe("cache worker inbound schema", () => {
  it("accepts every documented operation", () => {
    const cases: Array<Record<string, unknown>> = [
      {
        ...inboundBase(),
        type: "SCAN_SCOPE",
        managedRoot: "/r/managed-browser-cache/v1",
        scopePath: `/r/managed-browser-cache/v1/${TOKEN_A}`,
      },
      {
        ...inboundBase(),
        type: "SCAN_ALL",
        managedRoot: "/r/managed-browser-cache/v1",
      },
      {
        ...inboundBase(),
        type: "DELETE_QUEUED_SCOPE",
        managedRoot: "/r/managed-browser-cache/v1",
        queuePath: `/r/managed-browser-cache/v1/deleting/del-abcdef12`,
      },
      {
        ...inboundBase(),
        type: "PLAN_EVICTION",
        managedRoot: "/r/managed-browser-cache/v1",
        maxTotalBytes: 500,
        perScopeTargetBytes: 200,
        inactiveRetentionDays: 30,
        activeScopeTokens: [TOKEN_A, TOKEN_B],
      },
      {
        ...inboundBase(),
        type: "CANCEL_BEFORE_DELETE",
        planId: "plan-abc123def456",
      },
      { ...inboundBase(), type: "SHUTDOWN" },
    ];
    const schema = managedBrowserCacheInboundSchema();
    for (const message of cases) {
      expect(schema.safeParse(message).success, message.type as string).toBe(
        true
      );
    }
  });

  it("rejects unknown fields (strict), wrong versions, and session fields", () => {
    const schema = managedBrowserCacheInboundSchema();
    expect(
      schema.safeParse({
        ...inboundBase(),
        type: "SCAN_ALL",
        managedRoot: "/r/managed-browser-cache/v1",
        extra: "no",
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...inboundBase(),
        protocolVersion: 2,
        type: "SHUTDOWN",
      }).success
    ).toBe(false);
    // sessionId must NOT exist on this protocol.
    expect(
      schema.safeParse({
        ...inboundBase(),
        type: "SHUTDOWN",
        sessionId: "mb_session0000001",
      }).success
    ).toBe(false);
    // Path bounds are wire-level; the token GRAMMAR is enforced by the
    // worker's CachePathValidator (not the wire schema) so bad tokens get
    // a clean cache_path_invalid result instead of a protocol drop.
    expect(
      schema.safeParse({
        ...inboundBase(),
        type: "SCAN_SCOPE",
        managedRoot: "/r/managed-browser-cache/v1",
        scopePath: `/${"x".repeat(2000)}`,
      }).success
    ).toBe(false);
  });

  it("bounds plan inputs", () => {
    const schema = managedBrowserCacheInboundSchema();
    const plan = {
      ...inboundBase(),
      type: "PLAN_EVICTION",
      managedRoot: "/r/managed-browser-cache/v1",
      maxTotalBytes: 500,
      perScopeTargetBytes: 200,
      inactiveRetentionDays: 30,
      activeScopeTokens: [],
    };
    expect(
      schema.safeParse({ ...plan, inactiveRetentionDays: -1 }).success
    ).toBe(false);
    expect(schema.safeParse({ ...plan, maxTotalBytes: 0 }).success).toBe(false);
    expect(
      schema.safeParse({ ...plan, activeScopeTokens: ["not-hex"] }).success
    ).toBe(false);
  });
});

describe("cache worker outbound schema", () => {
  it("accepts WORKER_READY without a sessionId and with a pid", () => {
    const schema = managedBrowserCacheOutboundSchema();
    expect(
      schema.safeParse({
        protocolVersion: 1,
        requestId: "evt-cache-worker-ready",
        sequence: 1,
        type: "WORKER_READY",
        workerPid: 4242,
      }).success
    ).toBe(true);
  });

  it("accepts ok and error result shapes", () => {
    const schema = managedBrowserCacheOutboundSchema();
    expect(
      schema.safeParse({
        ...outboundBase(),
        type: "SCAN_SCOPE_RESULT",
        result: {
          status: "ok",
          approximateBytes: 1024,
          fileCount: 4,
          durationBucket: "under_1s",
          truncated: false,
        },
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        ...outboundBase(),
        type: "SCAN_SCOPE_RESULT",
        result: { status: "error", reasonCode: "cache_path_invalid" },
      }).success
    ).toBe(true);
  });

  it("rejects invalid duration buckets, scope tokens, and unknown reason codes", () => {
    const schema = managedBrowserCacheOutboundSchema();
    expect(
      schema.safeParse({
        ...outboundBase(),
        type: "SCAN_SCOPE_RESULT",
        result: {
          status: "ok",
          approximateBytes: 1,
          fileCount: 1,
          durationBucket: "under_2s",
          truncated: false,
        },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...outboundBase(),
        type: "SCAN_ALL_RESULT",
        result: {
          status: "ok",
          scopes: [
            {
              scopeToken: "ZZZ",
              approximateBytes: 1,
              fileCount: 1,
              lastModifiedEpochMs: 1,
            },
          ],
          truncated: false,
          durationBucket: "under_1s",
        },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...outboundBase(),
        type: "WORKER_ERROR",
        code: "/etc/passwd",
        message: "nope",
      }).success
    ).toBe(false);
  });

  it("rejects paths or filenames smuggled into plan results", () => {
    const schema = managedBrowserCacheOutboundSchema();
    expect(
      schema.safeParse({
        ...outboundBase(),
        type: "PLAN_EVICTION_RESULT",
        result: {
          status: "ok",
          planId: "plan-abc123def456",
          plannedBytes: 10,
          entries: [{ scopeToken: "/etc/passwd" }],
          durationBucket: "under_1s",
        },
      }).success
    ).toBe(false);
  });
});

describe("bucketForDurationMs", () => {
  it("maps elapsed ms to coarse buckets", () => {
    expect(bucketForDurationMs(0)).toBe("under_1s");
    expect(bucketForDurationMs(999)).toBe("under_1s");
    expect(bucketForDurationMs(1_000)).toBe("under_5s");
    expect(bucketForDurationMs(4_999)).toBe("under_5s");
    expect(bucketForDurationMs(5_000)).toBe("under_20s");
    expect(bucketForDurationMs(19_999)).toBe("under_20s");
    expect(bucketForDurationMs(20_000)).toBe("over_20s");
  });
});
