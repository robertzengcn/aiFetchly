import { describe, expect, it, vi } from "vitest";

/**
 * PRD D-FR-11: the post-action observation must update the main-process
 * cache (lastObservation + pageRevision) BEFORE the caller classifies the
 * next action, and a failed/older snapshot can never replace a newer one.
 */

vi.mock("@/modules/ManagedBrowserSupervisor", () => ({
  ManagedBrowserSupervisor: vi.fn().mockImplementation(() => ({
    supervise: vi.fn(),
    dispose: vi.fn(),
  })),
}));

import { ManagedBrowserModule } from "@/modules/ManagedBrowserModule";

const SESSION_ID = "mb_postaction0001";

function observationFixture(pageRevision: number, observationId: string) {
  return {
    sessionId: SESSION_ID,
    observationId,
    pageRevision,
    url: "https://www.youtube.com/",
    origin: "https://www.youtube.com",
    title: "Home",
    state: "ready" as const,
    elements: [],
    visibleText: "",
    notices: [{ code: "untrusted_content" as const }],
    truncated: false,
  };
}

function makeModuleWithFakeWorker(actionResult: {
  effect: "known" | "unknown";
  pageRevision: number;
  observation: unknown;
}): ManagedBrowserModule {
  const module = new ManagedBrowserModule({ isAiEnabled: () => true });
  const record = (
    module as unknown as {
      sessions: Map<
        string,
        { client: unknown; state: string; pageRevision: number; lastObservation: unknown }
      >;
    }
  ).sessions.get(SESSION_ID);
  void record;
  // Inject a live session record with a scripted worker client.
  const sessions = (
    module as unknown as {
      sessions: Map<string, Record<string, unknown>>;
    }
  ).sessions;
  sessions.set(SESSION_ID, {
    sessionId: SESSION_ID,
    accountId: 0,
    platformId: 2,
    platformLabel: "YouTube",
    state: "ready",
    pageRevision: 5,
    lastObservation: null,
    client: {
      request: vi.fn().mockResolvedValue({
        type: "ACTION_RESULT",
        protocolVersion: 2,
        sessionId: SESSION_ID,
        requestId: "req-1",
        sequence: 1,
        effect: actionResult.effect,
        pageRevision: actionResult.pageRevision,
        results: [],
        observation: actionResult.observation,
      }),
    },
  });
  return module;
}

describe("post-action observation caching (D-FR-11)", () => {
  it("caches the ACTION_RESULT observation before returning", async () => {
    const fresh = observationFixture(6, "obs-fresh");
    const module = makeModuleWithFakeWorker({
      effect: "known",
      pageRevision: 6,
      observation: fresh,
    });
    const message = await module.runActions(SESSION_ID, {
      actions: [{ type: "scroll", direction: "down", amount: 100 }],
    } as never);
    expect(message.type).toBe("ACTION_RESULT");
    expect(module.getLastObservation(SESSION_ID)).toEqual(fresh);
  });

  it("does not let an older snapshot replace a newer cached one", async () => {
    const current = observationFixture(6, "obs-current");
    const module = new ManagedBrowserModule({ isAiEnabled: () => true });
    const sessions = (
      module as unknown as { sessions: Map<string, Record<string, unknown>> }
    ).sessions;
    sessions.set(SESSION_ID, {
      sessionId: SESSION_ID,
      accountId: 0,
      platformId: 2,
      state: "ready",
      pageRevision: 6,
      lastObservation: current,
      client: {
        request: vi.fn().mockResolvedValue({
          type: "ACTION_RESULT",
          protocolVersion: 2,
          sessionId: SESSION_ID,
          requestId: "req-1",
          sequence: 1,
          effect: "known",
          pageRevision: 4,
          results: [],
          observation: observationFixture(4, "obs-stale"),
        }),
      },
    });
    await module.runActions(SESSION_ID, {
      actions: [{ type: "scroll", direction: "down", amount: 100 }],
    } as never);
    expect(module.getLastObservation(SESSION_ID)).toEqual(current);
  });

  it("keeps the previous cache when the result carries no observation", async () => {
    const current = observationFixture(6, "obs-current");
    const module = new ManagedBrowserModule({ isAiEnabled: () => true });
    const sessions = (
      module as unknown as { sessions: Map<string, Record<string, unknown>> }
    ).sessions;
    sessions.set(SESSION_ID, {
      sessionId: SESSION_ID,
      accountId: 0,
      platformId: 2,
      state: "ready",
      pageRevision: 6,
      lastObservation: current,
      client: {
        request: vi.fn().mockResolvedValue({
          type: "ACTION_RESULT",
          protocolVersion: 2,
          sessionId: SESSION_ID,
          requestId: "req-1",
          sequence: 1,
          effect: "unknown",
          pageRevision: 6,
          results: [],
          observation: null,
        }),
      },
    });
    await module.runActions(SESSION_ID, {
      actions: [{ type: "click", ref: "e_x", pageRevision: 6 }],
    } as never);
    expect(module.getLastObservation(SESSION_ID)).toEqual(current);
  });
});
