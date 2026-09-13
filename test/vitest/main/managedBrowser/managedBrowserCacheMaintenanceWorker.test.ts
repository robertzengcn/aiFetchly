import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ManagedBrowserCacheMaintenanceWorker,
  type CacheMessageBase,
} from "@/childprocess/managed-browser-cache/ManagedBrowserCacheMaintenanceWorker";
import type { ManagedBrowserCacheOutboundMessage } from "@/schemas/worker/managedBrowserCache";

/**
 * Maintenance worker handler tests (design §13.9): path guards, idempotent
 * deletes, duration buckets, the two-phase eviction plan table, and reply
 * shapes (aggregate counts + safe reason codes only).
 */

const NOW = 1_800_000_000_000;
const TOKEN_A = "a".repeat(24);

interface Sent extends Array<ManagedBrowserCacheOutboundMessage> {
  /* alias */
}

let tmpRoot: string;
let managedRoot: string;
let sent: Sent;
let sequence: number;
let worker: ManagedBrowserCacheMaintenanceWorker;

function makeBase(requestId: string): CacheMessageBase {
  sequence += 1;
  return { protocolVersion: 1, requestId, sequence };
}

function buildWorker(
  overrides: { rm?: (p: string) => Promise<void> } = {}
): ManagedBrowserCacheMaintenanceWorker {
  return new ManagedBrowserCacheMaintenanceWorker({
    send: (message) => sent.push(message),
    makeBase,
    rm:
      overrides.rm ??
      ((p) => rm(p, { recursive: true, force: true }).then(() => undefined)),
    randomId: () => "fixed-random-1234",
    now: () => NOW,
  });
}

async function seedScope(token: string, bytes: number): Promise<string> {
  const scopePath = path.join(managedRoot, token);
  await mkdir(scopePath, { recursive: true });
  await writeFile(path.join(scopePath, "cache.bin"), "x".repeat(bytes), "utf8");
  return scopePath;
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mb-cache-maintworker-"));
  managedRoot = path.join(
    tmpRoot,
    "app-cache",
    "aifetchly",
    "managed-browser-cache",
    "v1"
  );
  await mkdir(path.join(managedRoot, "deleting"), { recursive: true });
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("handleScanScope", () => {
  it("replies with aggregate counts and a duration bucket", async () => {
    sent = [];
    sequence = 0;
    worker = buildWorker();
    const scopePath = await seedScope(TOKEN_A, 64);
    await worker.handleScanScope({
      protocolVersion: 1,
      requestId: "req-test-0001",
      sequence: 1,
      type: "SCAN_SCOPE",
      managedRoot,
      scopePath,
    });
    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message.type).toBe("SCAN_SCOPE_RESULT");
    if (message.type !== "SCAN_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "ok",
      approximateBytes: 64,
      fileCount: 1,
      durationBucket: "under_1s",
      truncated: false,
    });
  });

  it("rejects an invalid scope path with a safe reason code", async () => {
    sent = [];
    worker = buildWorker();
    await worker.handleScanScope({
      protocolVersion: 1,
      requestId: "req-test-0002",
      sequence: 1,
      type: "SCAN_SCOPE",
      managedRoot,
      scopePath: path.join(managedRoot, "101"),
    });
    const message = sent[0];
    expect(message.type).toBe("SCAN_SCOPE_RESULT");
    if (message.type !== "SCAN_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "error",
      reasonCode: "cache_path_invalid",
    });
  });

  it("rejects a planted symlink scope", async () => {
    sent = [];
    worker = buildWorker();
    const outside = path.join(tmpRoot, "outside-evil");
    await mkdir(outside, { recursive: true });
    const linkToken = "b".repeat(24);
    await symlink(outside, path.join(managedRoot, linkToken));
    await worker.handleScanScope({
      protocolVersion: 1,
      requestId: "req-test-0003",
      sequence: 1,
      type: "SCAN_SCOPE",
      managedRoot,
      scopePath: path.join(managedRoot, linkToken),
    });
    const message = sent[0];
    if (message.type !== "SCAN_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "error",
      reasonCode: "cache_symlink_rejected",
    });
    await rm(path.join(managedRoot, linkToken), { force: true });
  });

  it("rejects an invalid managed root", async () => {
    sent = [];
    worker = buildWorker();
    await worker.handleScanScope({
      protocolVersion: 1,
      requestId: "req-test-0004",
      sequence: 1,
      type: "SCAN_SCOPE",
      managedRoot: os.tmpdir(),
      scopePath: path.join(os.tmpdir(), TOKEN_A),
    });
    const message = sent[0];
    if (message.type !== "SCAN_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "error",
      reasonCode: "cache_root_invalid",
    });
  });
});

describe("handleDeleteQueuedScope", () => {
  it("deletes a queue entry and reports its scanned bytes", async () => {
    sent = [];
    worker = buildWorker();
    const queuePath = path.join(managedRoot, "deleting", "del-testentry01");
    await mkdir(queuePath, { recursive: true });
    await writeFile(path.join(queuePath, "data.bin"), "x".repeat(128), "utf8");

    await worker.handleDeleteQueuedScope({
      protocolVersion: 1,
      requestId: "req-test-0005",
      sequence: 1,
      type: "DELETE_QUEUED_SCOPE",
      managedRoot,
      queuePath,
    });
    const message = sent[0];
    if (message.type !== "DELETE_QUEUED_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "ok",
      approximateDeletedBytes: 128,
      fileCount: 1,
      durationBucket: "under_1s",
    });
    await expect(stat(queuePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("is idempotent for an already-deleted entry", async () => {
    sent = [];
    worker = buildWorker();
    await worker.handleDeleteQueuedScope({
      protocolVersion: 1,
      requestId: "req-test-0006",
      sequence: 1,
      type: "DELETE_QUEUED_SCOPE",
      managedRoot,
      queuePath: path.join(managedRoot, "deleting", "del-missing001"),
    });
    const message = sent[0];
    if (message.type !== "DELETE_QUEUED_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "ok",
      approximateDeletedBytes: 0,
      fileCount: 0,
      durationBucket: "under_1s",
    });
  });

  it("reports cache_delete_failed when rm throws", async () => {
    sent = [];
    worker = buildWorker({
      rm: async () => {
        throw new Error("EBUSY");
      },
    });
    const queuePath = path.join(managedRoot, "deleting", "del-busy000001");
    await mkdir(queuePath, { recursive: true });
    await worker.handleDeleteQueuedScope({
      protocolVersion: 1,
      requestId: "req-test-0007",
      sequence: 1,
      type: "DELETE_QUEUED_SCOPE",
      managedRoot,
      queuePath,
    });
    const message = sent[0];
    if (message.type !== "DELETE_QUEUED_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "error",
      reasonCode: "cache_delete_failed",
    });
    await rm(queuePath, { recursive: true, force: true });
  });

  it("rejects a queue path outside the deleting directory", async () => {
    sent = [];
    worker = buildWorker();
    await worker.handleDeleteQueuedScope({
      protocolVersion: 1,
      requestId: "req-test-0008",
      sequence: 1,
      type: "DELETE_QUEUED_SCOPE",
      managedRoot,
      queuePath: path.join(managedRoot, TOKEN_A),
    });
    const message = sent[0];
    if (message.type !== "DELETE_QUEUED_SCOPE_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "error",
      reasonCode: "cache_path_invalid",
    });
  });
});

describe("two-phase eviction planning", () => {
  it("plans, cancels once, and treats unknown plans as not-cancelled", async () => {
    sent = [];
    worker = buildWorker();
    // Hermetic root: only ONE over-target scope, so the plan is exactly
    // that scope regardless of what earlier tests seeded elsewhere.
    const planRoot = path.join(tmpRoot, "plan", "managed-browser-cache", "v1");
    const planScopePath = path.join(planRoot, "c".repeat(24));
    await mkdir(planScopePath, { recursive: true });
    await writeFile(
      path.join(planScopePath, "cache.bin"),
      "x".repeat(300),
      "utf8"
    );
    await worker.handlePlanEviction({
      protocolVersion: 1,
      requestId: "req-test-0009",
      sequence: 1,
      type: "PLAN_EVICTION",
      managedRoot: planRoot,
      maxTotalBytes: 100,
      perScopeTargetBytes: 100,
      inactiveRetentionDays: 30,
      activeScopeTokens: [],
    });
    const planMessage = sent[0];
    if (planMessage.type !== "PLAN_EVICTION_RESULT") {
      throw new Error("unreachable");
    }
    if (planMessage.result.status !== "ok") {
      throw new Error("plan failed");
    }
    expect(planMessage.result.planId).toMatch(/^plan-[a-z0-9-]{6,32}$/);
    expect(planMessage.result.entries).toHaveLength(1);
    expect(planMessage.result.entries[0].scopeToken).toBe("c".repeat(24));

    worker.handleCancelBeforeDelete({
      protocolVersion: 1,
      requestId: "req-test-0010",
      sequence: 2,
      type: "CANCEL_BEFORE_DELETE",
      planId: planMessage.result.planId,
    });
    let cancelMessage = sent[1];
    if (cancelMessage.type !== "CANCEL_BEFORE_DELETE_RESULT") {
      throw new Error("unreachable");
    }
    expect(cancelMessage.result).toEqual({ status: "ok", cancelled: true });

    // Second cancel: unknown plan — not an error.
    worker.handleCancelBeforeDelete({
      protocolVersion: 1,
      requestId: "req-test-0011",
      sequence: 3,
      type: "CANCEL_BEFORE_DELETE",
      planId: planMessage.result.planId,
    });
    cancelMessage = sent[2];
    if (cancelMessage.type !== "CANCEL_BEFORE_DELETE_RESULT") {
      throw new Error("unreachable");
    }
    expect(cancelMessage.result).toEqual({ status: "ok", cancelled: false });
  });

  it("refuses to plan an invalid root", async () => {
    sent = [];
    worker = buildWorker();
    await worker.handlePlanEviction({
      protocolVersion: 1,
      requestId: "req-test-0012",
      sequence: 1,
      type: "PLAN_EVICTION",
      managedRoot: os.homedir(),
      maxTotalBytes: 100,
      perScopeTargetBytes: 100,
      inactiveRetentionDays: 30,
      activeScopeTokens: [],
    });
    const message = sent[0];
    if (message.type !== "PLAN_EVICTION_RESULT") {
      throw new Error("unreachable");
    }
    expect(message.result).toEqual({
      status: "error",
      reasonCode: "cache_root_invalid",
    });
  });
});

describe("handleShutdown", () => {
  it("replies with a bare SHUTDOWN_ACK", () => {
    sent = [];
    worker = buildWorker();
    worker.handleShutdown({
      protocolVersion: 1,
      requestId: "req-test-0013",
      sequence: 1,
      type: "SHUTDOWN",
    });
    expect(sent[0].type).toBe("SHUTDOWN_ACK");
  });
});
