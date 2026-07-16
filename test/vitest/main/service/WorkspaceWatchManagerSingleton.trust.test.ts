/**
 * WorkspaceWatchManagerSingleton — entity-backed sync trust cache tests
 * (Phase 17 / Plan 02 Task 2b).
 *
 * Verifies that:
 *   - The Phase 14 binary approval map is replaced by an entity-backed
 *     AIFetchlySourceTrust cache backing the manager's trustResolver (TRS-02).
 *   - An approved workspace resolves trusted (ALL_TRUE); an absent/false row
 *     resolves false (fail-closed).
 *   - revokeWorkspaceTrust reflects on the next read WITHOUT an app restart
 *     (Pitfall 2 — the Phase 14 stale-until-restart limitation is removed).
 *   - hydrateWorkspaceTrustFromEntity reads the persisted
 *     AIFetchlyWorkspaceTrust entity (the durable source) and fail-closes for
 *     a root with no row.
 *
 * The trust path is exercised via the exported isWorkspaceTrusted predicate
 * (the exact read the manager's sync trustResolver performs). The trust module
 * is mocked for the hydrate cases so the test does not depend on the native
 * better-sqlite3 binding (which cannot dlopen under vitest's loader here).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { fakeGetTrust } = vi.hoisted(() => ({
  fakeGetTrust: vi.fn(),
}));

vi.mock("@/modules/AIFetchlyWorkspaceTrustModule", () => ({
  AIFetchlyWorkspaceTrustModule: class {
    getTrust = (hash: string) => fakeGetTrust(hash);
  },
}));

import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";
import {
  hydrateWorkspaceTrustFromEntity,
  isWorkspaceTrusted,
  markWorkspaceApproved,
  resetTrustCacheForTests,
  revokeWorkspaceTrust,
} from "@/service/workspaceWatch/WorkspaceWatchManagerSingleton";

const ALL_TRUE: AIFetchlySourceTrust = {
  instructions: true,
  commands: true,
  agents: true,
  hooks: true,
  skills: true,
};

describe("WorkspaceWatchManagerSingleton entity-backed trust cache (TRS-02)", () => {
  const RUN = `${process.pid.toString(36)}-${Date.now().toString(36)}`;
  const ws = (n: string): string => `ws-${RUN}-${n}`;

  afterEach(() => {
    resetTrustCacheForTests();
    fakeGetTrust.mockReset();
  });

  it("isWorkspaceTrusted reads the entity-backed cache (not the old approval map)", () => {
    const id = ws("cache");
    expect(isWorkspaceTrusted(id)).toBe(false); // absent → fail-closed
    markWorkspaceApproved(id);
    expect(isWorkspaceTrusted(id)).toBe(true);
  });

  it("an approved workspace resolves trusted (ALL_TRUE block write)", () => {
    const id = ws("approved");
    markWorkspaceApproved(id);
    expect(isWorkspaceTrusted(id)).toBe(true);
  });

  it("an absent row resolves false (fail-closed)", () => {
    expect(isWorkspaceTrusted(ws("never"))).toBe(false);
  });

  it("revoke reflects on the next read WITHOUT an app restart (Pitfall 2)", () => {
    const id = ws("revoke");
    markWorkspaceApproved(id);
    expect(isWorkspaceTrusted(id)).toBe(true);
    revokeWorkspaceTrust(id);
    // The next read (the next worker event's trustResolver call) sees false.
    expect(isWorkspaceTrusted(id)).toBe(false);
  });

  it("hydrateWorkspaceTrustFromEntity reads the persisted entity (TRS-02 durable source)", async () => {
    const id = ws("hydrate");
    const rootPath = `/tmp/aifetchly-trust-sync-${RUN}/hydrate`;
    fakeGetTrust.mockResolvedValue({ ...ALL_TRUE });

    expect(isWorkspaceTrusted(id)).toBe(false); // cache empty before hydrate
    await hydrateWorkspaceTrustFromEntity(id, rootPath);
    expect(isWorkspaceTrusted(id)).toBe(true); // hydrated from the entity
    expect(fakeGetTrust).toHaveBeenCalledTimes(1);
  });

  it("hydrateWorkspaceTrustFromEntity fail-closes for a root with no entity row", async () => {
    const id = ws("hydrate-absent");
    const rootPath = `/tmp/aifetchly-trust-sync-${RUN}/absent`;
    fakeGetTrust.mockResolvedValue(null);
    await hydrateWorkspaceTrustFromEntity(id, rootPath);
    expect(isWorkspaceTrusted(id)).toBe(false);
  });

  it("hydrateWorkspaceTrustFromEntity fail-closes when the entity read throws", async () => {
    const id = ws("hydrate-error");
    const rootPath = `/tmp/aifetchly-trust-sync-${RUN}/error`;
    fakeGetTrust.mockRejectedValue(new Error("db unavailable"));
    await hydrateWorkspaceTrustFromEntity(id, rootPath);
    expect(isWorkspaceTrusted(id)).toBe(false);
  });
});
