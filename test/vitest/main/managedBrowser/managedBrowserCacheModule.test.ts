import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ManagedBrowserCacheModule,
  type CacheDeleteOutcome,
  type CacheMaintenanceClient,
} from "@/modules/ManagedBrowserCacheModule";
import type { CacheAccountScope } from "@/service/ManagedBrowserCacheScopeService";
import type { SafeBrowserChatNotice } from "@/entityTypes/managedBrowserTypes";

/**
 * ManagedBrowserCacheModule (design §13.6, §13.8) — active-scope registry,
 * single-use clear confirmations, atomic rename into the deletion queue, and
 * deferred clears that fire when an active session releases its scope.
 */

const ACCOUNT_A = 101;
const ACCOUNT_B = 102;

function tokenFor(accountId: number): string {
  return accountId.toString(16).padStart(24, "0");
}

class FakeScopeService {
  public disabled = false;

  public constructor(private readonly managedRoot: string) {}

  public async deriveAccountScope(
    accountId: number
  ): Promise<CacheAccountScope> {
    if (this.disabled) {
      return { status: "disabled", reasonCode: "secret_key_unavailable" };
    }
    return {
      status: "ok",
      cacheRoot: path.dirname(this.managedRoot),
      managedRoot: this.managedRoot,
      scopePath: path.join(this.managedRoot, tokenFor(accountId)),
      scopeToken: tokenFor(accountId),
    };
  }

  public async buildPersistentCachePolicy(
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ): Promise<
    | { enabled: false; reasonCode: string }
    | {
        enabled: true;
        cachePath: string;
        scopeToken: string;
        namespace: string;
      }
  > {
    if (!cacheEnabled) {
      return { enabled: false, reasonCode: "cache_disabled_by_setting" };
    }
    const scope = await this.deriveAccountScope(accountId);
    if (scope.status !== "ok") {
      return { enabled: false, reasonCode: scope.reasonCode };
    }
    const namespace = `chrome-${chromeMajor}-linux-x64-schema-1`;
    return {
      enabled: true,
      cachePath: path.join(scope.scopePath, namespace, "http-cache"),
      scopeToken: scope.scopeToken,
      namespace,
    };
  }
}

class FakeMaintenance {
  public readonly scanCalls: string[] = [];
  public readonly deleteCalls: string[] = [];
  public nextDelete: CacheDeleteOutcome = {
    status: "ok",
    approximateDeletedBytes: 4096,
  };

  public async scanScope(input: { scopePath: string }) {
    this.scanCalls.push(input.scopePath);
    return { status: "ok" as const, approximateBytes: 2048 };
  }

  public async deleteQueuedScope(input: { queuePath: string }) {
    this.deleteCalls.push(input.queuePath);
    if (this.nextDelete.status === "ok") {
      await rm(input.queuePath, { recursive: true, force: true });
    }
    return this.nextDelete;
  }

  public async shutdown(): Promise<void> {
    /* fake */
  }
}

interface Harness {
  module: ManagedBrowserCacheModule;
  scope: FakeScopeService;
  maintenance: FakeMaintenance;
  notices: SafeBrowserChatNotice[];
  managedRoot: string;
  stopCalls: number[];
  stopResult: boolean;
}

let tmpRoot: string;

function makeHarness(): Harness {
  const managedRoot = path.join(tmpRoot, "v1");
  const scope = new FakeScopeService(managedRoot);
  const maintenance = new FakeMaintenance();
  const notices: SafeBrowserChatNotice[] = [];
  const stopCalls: number[] = [];
  const harness: Harness = {
    scope,
    maintenance,
    notices,
    managedRoot,
    stopCalls,
    stopResult: true,
    module: null as unknown as ManagedBrowserCacheModule,
  };
  harness.module = new ManagedBrowserCacheModule({
    scopeService: scope,
    maintenance: maintenance as unknown as CacheMaintenanceClient,
    noticeSink: (notice) => notices.push(notice),
    rename: (from, to) =>
      import("node:fs/promises").then((fs) => fs.rename(from, to)),
    mkdir: (p) =>
      import("node:fs/promises").then((fs) =>
        fs.mkdir(p, { recursive: true }).then(() => undefined)
      ),
    readdir: (p) => import("node:fs/promises").then((fs) => fs.readdir(p)),
    pathExists: (p) =>
      import("node:fs/promises").then((fs) =>
        fs.stat(p).then(
          () => true,
          () => false
        )
      ),
    stopSessionForAccount: async (accountId: number) => {
      stopCalls.push(accountId);
      return harness.stopResult;
    },
  });
  return harness;
}

async function seedScope(h: Harness, accountId: number): Promise<string> {
  const scopePath = path.join(h.managedRoot, tokenFor(accountId));
  await mkdir(path.join(scopePath, "chrome-120-linux-x64-schema-1"), {
    recursive: true,
  });
  await writeFile(
    path.join(scopePath, "chrome-120-linux-x64-schema-1", "cache-data.bin"),
    "x".repeat(64),
    "utf8"
  );
  return scopePath;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listDeleting(h: Harness): Promise<string[]> {
  const dir = path.join(h.managedRoot, "deleting");
  if (!(await pathExists(dir))) {
    return [];
  }
  return readdir(dir);
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mb-cache-module-test-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Active-scope registry (§13.6)
// ---------------------------------------------------------------------------

describe("active scope registry", () => {
  it("tracks CACHE_OPENED / CACHE_RELEASED in getStatus", async () => {
    const h = makeHarness();
    expect((await h.module.getStatus(ACCOUNT_A))?.active).toBe(false);

    h.module.onCacheOpened({
      sessionId: "mb_session0000001",
      accountId: ACCOUNT_A,
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });
    const status = await h.module.getStatus(ACCOUNT_A);
    expect(status?.active).toBe(true);
    expect(status?.scope).toBe("account");
    expect(status?.accountId).toBe(ACCOUNT_A);
    expect(status?.approximateBytes).toBe(2048);

    h.module.onCacheReleased("mb_session0000001");
    expect((await h.module.getStatus(ACCOUNT_A))?.active).toBe(false);
  });

  it("releases the scope on session terminal (safety net)", async () => {
    const h = makeHarness();
    h.module.onCacheOpened({
      sessionId: "mb_session0000001",
      accountId: ACCOUNT_A,
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });
    h.module.onSessionTerminal("mb_session0000001");
    expect((await h.module.getStatus(ACCOUNT_A))?.active).toBe(false);
  });

  it("returns null status when the scope ladder is disabled", async () => {
    const h = makeHarness();
    h.scope.disabled = true;
    expect(await h.module.getStatus(ACCOUNT_A)).toBeNull();
  });

  it("delegates buildPersistentCachePolicy to the scope service", async () => {
    const h = makeHarness();
    const policy = await h.module.buildPersistentCachePolicy(
      ACCOUNT_A,
      120,
      true
    );
    expect(policy).toEqual({
      enabled: true,
      cachePath: path.join(
        h.managedRoot,
        tokenFor(ACCOUNT_A),
        "chrome-120-linux-x64-schema-1",
        "http-cache"
      ),
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });
  });
});

// ---------------------------------------------------------------------------
// Confirmation registry (single-use)
// ---------------------------------------------------------------------------

describe("clear confirmations", () => {
  it("rejects an unknown confirmationId", async () => {
    const h = makeHarness();
    await seedScope(h, ACCOUNT_A);
    await expect(
      h.module.clearCache({
        scope: "account",
        accountId: ACCOUNT_A,
        activeSessionDecision: "defer",
        confirmationId: "never-issued",
      })
    ).rejects.toMatchObject({ code: "approval_required" });
  });

  it("consumes the confirmation exactly once", async () => {
    const h = makeHarness();
    await seedScope(h, ACCOUNT_A);
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });
    const first = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "defer",
      confirmationId,
    });
    expect(first.state).toBe("cleared");
    await expect(
      h.module.clearCache({
        scope: "account",
        accountId: ACCOUNT_A,
        activeSessionDecision: "defer",
        confirmationId,
      })
    ).rejects.toMatchObject({ code: "approval_required" });
  });

  it("expires stale confirmations", async () => {
    const h = makeHarness();
    await seedScope(h, ACCOUNT_A);
    let clock = 1_000_000;
    h.module.setClockForTests(() => clock);
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });
    clock += 11 * 60 * 1000; // past the 10-minute TTL
    await expect(
      h.module.clearCache({
        scope: "account",
        accountId: ACCOUNT_A,
        activeSessionDecision: "defer",
        confirmationId,
      })
    ).rejects.toMatchObject({ code: "approval_expired" });
  });

  it("rejects a confirmation issued for a different scope", async () => {
    const h = makeHarness();
    await seedScope(h, ACCOUNT_A);
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_B,
    });
    await expect(
      h.module.clearCache({
        scope: "account",
        accountId: ACCOUNT_A,
        activeSessionDecision: "defer",
        confirmationId,
      })
    ).rejects.toMatchObject({ code: "approval_required" });
  });
});

// ---------------------------------------------------------------------------
// clearCache — account scope (§13.8)
// ---------------------------------------------------------------------------

describe("clearCache account scope", () => {
  it("clears an inactive scope via the deletion queue and reports bytes", async () => {
    const h = makeHarness();
    const scopePath = await seedScope(h, ACCOUNT_A);
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });

    const result = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "defer",
      confirmationId,
    });

    expect(result).toEqual({
      state: "cleared",
      scope: "account",
      approximateDeletedBytes: 4096,
      savedLoginSessionPreserved: true,
      reasonCode: null,
    });
    expect(await pathExists(scopePath)).toBe(false);
    expect(await listDeleting(h)).toEqual([]);
    expect(h.notices.map((n) => n.type)).toContain("cache_clear_completed");
    expect((await h.module.getStatus(ACCOUNT_A))?.lastClearedAt).toBeTruthy();
  });

  it("reports empty (idempotent) when the scope does not exist", async () => {
    const h = makeHarness();
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });
    const result = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "defer",
      confirmationId,
    });
    expect(result).toEqual({
      state: "empty",
      scope: "account",
      approximateDeletedBytes: 0,
      savedLoginSessionPreserved: true,
      reasonCode: null,
    });
    expect(h.maintenance.deleteCalls).toHaveLength(0);
  });

  it("cancels without touching the filesystem", async () => {
    const h = makeHarness();
    const scopePath = await seedScope(h, ACCOUNT_A);
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });
    const result = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "cancel",
      confirmationId,
    });
    expect(result.state).toBe("cancelled");
    expect(await pathExists(scopePath)).toBe(true);
    expect(h.maintenance.deleteCalls).toHaveLength(0);
  });

  it("defers when the scope is active and fires the clear after release", async () => {
    const h = makeHarness();
    const scopePath = await seedScope(h, ACCOUNT_A);
    h.module.onCacheOpened({
      sessionId: "mb_session0000001",
      accountId: ACCOUNT_A,
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });

    const result = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "defer",
      confirmationId,
    });

    expect(result).toEqual({
      state: "deferred",
      scope: "account",
      approximateDeletedBytes: 0,
      savedLoginSessionPreserved: true,
      reasonCode: "cache_scope_active",
    });
    expect(await pathExists(scopePath)).toBe(true);
    expect((await h.module.getStatus(ACCOUNT_A))?.pendingClear).toBe(true);
    expect(h.notices.map((n) => n.type)).toContain("cache_clear_deferred");

    // Session ends → deferred clear fires automatically.
    h.module.onCacheReleased("mb_session0000001");
    await vi.waitFor(async () => {
      expect(await pathExists(scopePath)).toBe(false);
    });
    expect((await h.module.getStatus(ACCOUNT_A))?.pendingClear).toBe(false);
    expect(h.notices.map((n) => n.type)).toContain("cache_clear_completed");
  });

  it("stop_and_clear stops the session then clears", async () => {
    const h = makeHarness();
    const scopePath = await seedScope(h, ACCOUNT_A);
    h.module.onCacheOpened({
      sessionId: "mb_session0000001",
      accountId: ACCOUNT_A,
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });

    // The stopper simulates ManagedBrowserModule.stop(): releasing the scope
    // synchronously before resolving.
    const result = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "stop_and_clear",
      confirmationId,
    });

    expect(h.stopCalls).toEqual([ACCOUNT_A]);
    expect(result.state).toBe("cleared");
    expect(await pathExists(scopePath)).toBe(false);
  });

  it("falls back to deferred when the session cannot be stopped", async () => {
    const h = makeHarness();
    const scopePath = await seedScope(h, ACCOUNT_A);
    h.module.onCacheOpened({
      sessionId: "mb_session0000001",
      accountId: ACCOUNT_A,
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });
    h.stopResult = false;
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });

    const result = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "stop_and_clear",
      confirmationId,
    });

    expect(result.state).toBe("deferred");
    expect(result.reasonCode).toBe("cache_scope_active");
    expect(await pathExists(scopePath)).toBe(true);
  });

  it("reports cache_maintenance_pending when the maintenance worker fails", async () => {
    const h = makeHarness();
    const scopePath = await seedScope(h, ACCOUNT_A);
    h.maintenance.nextDelete = {
      status: "error",
      reasonCode: "cache_maintenance_failed",
    };
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });

    const result = await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "defer",
      confirmationId,
    });

    expect(result).toEqual({
      state: "cleared",
      scope: "account",
      approximateDeletedBytes: 0,
      savedLoginSessionPreserved: true,
      reasonCode: "cache_maintenance_pending",
    });
    // The rename already happened: the queue entry is on disk for recovery.
    expect(await pathExists(scopePath)).toBe(false);
    expect(await listDeleting(h)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clearCache — all scopes
// ---------------------------------------------------------------------------

describe("clearCache all scopes", () => {
  it("skips active scopes when decision is skip_active", async () => {
    const h = makeHarness();
    const activePath = await seedScope(h, ACCOUNT_A);
    const inactivePath = await seedScope(h, ACCOUNT_B);
    h.module.onCacheOpened({
      sessionId: "mb_session0000001",
      accountId: ACCOUNT_A,
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });
    const confirmationId = h.module.issueClearConfirmation({ scope: "all" });

    const result = await h.module.clearCache({
      scope: "all",
      activeSessionDecision: "skip_active",
      confirmationId,
    });

    expect(result.state).toBe("cleared");
    expect(result.scope).toBe("all");
    expect(result.approximateDeletedBytes).toBe(4096);
    expect(result.reasonCode).toBe("cache_scope_active");
    expect(await pathExists(activePath)).toBe(true);
    expect(await pathExists(inactivePath)).toBe(false);
  });

  it("clears everything when no scope is active", async () => {
    const h = makeHarness();
    const a = await seedScope(h, ACCOUNT_A);
    const b = await seedScope(h, ACCOUNT_B);
    const confirmationId = h.module.issueClearConfirmation({ scope: "all" });
    const result = await h.module.clearCache({
      scope: "all",
      activeSessionDecision: "skip_active",
      confirmationId,
    });
    expect(result.state).toBe("cleared");
    expect(result.reasonCode).toBe(null);
    expect(await pathExists(a)).toBe(false);
    expect(await pathExists(b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------

describe("queue helpers", () => {
  it("queueAccountRemoval deletes the scope without a confirmation", async () => {
    const h = makeHarness();
    const scopePath = await seedScope(h, ACCOUNT_A);
    await h.module.queueAccountRemoval(ACCOUNT_A);
    expect(await pathExists(scopePath)).toBe(false);
    expect(h.maintenance.deleteCalls).toHaveLength(1);
  });

  it("queueAllForShutdown clears inactive scopes and skips active ones", async () => {
    const h = makeHarness();
    const activePath = await seedScope(h, ACCOUNT_A);
    const inactivePath = await seedScope(h, ACCOUNT_B);
    h.module.onCacheOpened({
      sessionId: "mb_session0000001",
      accountId: ACCOUNT_A,
      scopeToken: tokenFor(ACCOUNT_A),
      namespace: "chrome-120-linux-x64-schema-1",
    });

    await h.module.queueAllForShutdown();

    expect(await pathExists(activePath)).toBe(true);
    expect(await pathExists(inactivePath)).toBe(false);
  });

  it("resumePendingDeletions retries leftover queue entries (crash recovery)", async () => {
    const h = makeHarness();
    // A crash mid-deletion left a recognizable queue entry behind.
    const leftover = path.join(h.managedRoot, "deleting", "del-leftover1234");
    await mkdir(leftover, { recursive: true });
    await writeFile(path.join(leftover, "stale.bin"), "x", "utf8");

    await h.module.resumePendingDeletions();

    expect(h.maintenance.deleteCalls).toEqual([leftover]);
    expect(await pathExists(leftover)).toBe(false);
  });

  it("resumePendingDeletions ignores malformed queue entry names", async () => {
    const h = makeHarness();
    const evil = path.join(h.managedRoot, "deleting", "..%2Fescape");
    await mkdir(path.join(h.managedRoot, "deleting"), { recursive: true });
    await mkdir(evil, { recursive: true });

    await h.module.resumePendingDeletions();

    expect(h.maintenance.deleteCalls).toHaveLength(0);
    expect(await pathExists(evil)).toBe(true);
    await rm(evil, { recursive: true, force: true });
  });

  it("recovers a failed deletion on the next resume pass", async () => {
    const h = makeHarness();
    await seedScope(h, ACCOUNT_A);
    h.maintenance.nextDelete = {
      status: "error",
      reasonCode: "cache_maintenance_failed",
    };
    const confirmationId = h.module.issueClearConfirmation({
      scope: "account",
      accountId: ACCOUNT_A,
    });
    await h.module.clearCache({
      scope: "account",
      accountId: ACCOUNT_A,
      activeSessionDecision: "defer",
      confirmationId,
    });
    expect(await listDeleting(h)).toHaveLength(1);

    // Maintenance recovers.
    h.maintenance.nextDelete = {
      status: "ok",
      approximateDeletedBytes: 4096,
    };
    await h.module.resumePendingDeletions();
    expect(await listDeleting(h)).toEqual([]);
  });
});
