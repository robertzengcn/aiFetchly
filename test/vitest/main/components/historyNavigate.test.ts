import { describe, expect, it, vi } from "vitest";
import {
  navigateToHistorySource,
  type HistoryNavigateDeps,
} from "@/views/utils/historyNavigate";

function makeDeps(
  overrides: Partial<HistoryNavigateDeps> = {}
): { deps: HistoryNavigateDeps; state: { scrolled: number; unavailable: number; loads: number } } {
  const state = { scrolled: 0, unavailable: 0, loads: 0 };
  let selection: string | null = "conv-a";
  let older = true;
  const mounted = new Set<string>();
  const deps: HistoryNavigateDeps = {
    getSelectionId: () => selection,
    hasOlder: () => older,
    isLoadingOlder: () => false,
    loadOlder: async () => {
      state.loads += 1;
    },
    nextFrame: async () => undefined,
    queryMessageElement: (id) =>
      mounted.has(id) ? ({} as HTMLElement) : null,
    scrollToElement: () => {
      state.scrolled += 1;
    },
    showUnavailable: () => {
      state.unavailable += 1;
    },
    ...overrides,
  };
  return {
    deps,
    state,
  };
}

/**
 * B13: archive Navigate loads a bounded window around the source, surfaces
 * unavailable sources safely, and aborts on selection change.
 */
describe("navigateToHistorySource (B13)", () => {
  it("scrolls immediately when the source is mounted", async () => {
    const { deps, state } = makeDeps({
      queryMessageElement: (id) =>
        id === "m-1" ? ({} as HTMLElement) : null,
    });
    const outcome = await navigateToHistorySource("m-1", "conv-a", deps);
    expect(outcome).toBe("scrolled");
    expect(state.scrolled).toBe(1);
    expect(state.loads).toBe(0);
  });

  it("pages boundedly until a source beyond the loaded window mounts", async () => {
    let loads = 0;
    const mounted = new Set<string>(["m-new"]);
    const { deps, state } = makeDeps({
      loadOlder: async () => {
        loads += 1;
        state.loads += 1;
        if (loads === 3) mounted.add("m-old");
      },
      queryMessageElement: (id) =>
        mounted.has(id) ? ({} as HTMLElement) : null,
    });
    const outcome = await navigateToHistorySource("m-old", "conv-a", deps);
    expect(outcome).toBe("scrolled");
    expect(loads).toBe(3);
    expect(state.loads).toBeLessThanOrEqual(8);
  });

  it("surfaces unavailable sources safely after the bound", async () => {
    const { deps, state } = makeDeps();
    const outcome = await navigateToHistorySource("m-gone", "conv-a", deps, 3);
    expect(outcome).toBe("unavailable");
    expect(state.unavailable).toBe(1);
    expect(state.scrolled).toBe(0);
    expect(state.loads).toBe(3);
  });

  it("aborts on selection change during retrieval without notice", async () => {
    let selection: string | null = "conv-a";
    const { deps, state } = makeDeps({
      getSelectionId: () => selection,
      loadOlder: async () => {
        state.loads += 1;
        selection = "conv-b";
      },
    });
    const outcome = await navigateToHistorySource("m-old", "conv-a", deps);
    expect(outcome).toBe("aborted");
    expect(state.unavailable).toBe(0);
    expect(state.scrolled).toBe(0);
  });
});
