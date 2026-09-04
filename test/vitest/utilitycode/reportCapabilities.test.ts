"use strict";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref, effectScope } from "vue";

const capsMock = vi.fn();
vi.mock("@/views/api/aiContentReport", () => ({
  getAIContentReportCapabilities: (...a: unknown[]) => capsMock(...a),
  createAIContentReport: vi.fn(),
}));

import {
  useReportCapabilities,
  resetReportCapabilitiesForTest,
  type UseReportCapabilitiesOptions,
} from "@/views/utils/reportCapabilities";
import type { AIContentReportCapabilities } from "@/entityTypes/aiContentReportTypes";

/** A valid enabled-capabilities envelope, as the main process returns it. */
function enabledCaps(): AIContentReportCapabilities {
  return {
    acceptedSchemaVersions: [1, 2],
    conversationReporting: {
      enabled: true,
      maxAIItems: 10,
      maxUserItems: 10,
      maxTotalItems: 20,
      maxItemTextChars: 8000,
      maxAggregateTextChars: 32000,
      maxImages: 3,
    },
  };
}

/** The main process's fail-closed envelope, as it crosses IPC on failure. */
function failClosedCaps(): AIContentReportCapabilities {
  return {
    ...enabledCaps(),
    conversationReporting: {
      ...enabledCaps().conversationReporting,
      enabled: false,
    },
  };
}

/** Zero-delay fast chain so the whole schedule runs within one advance(0). */
const TEST_RETRY_DELAYS = [0, 0, 0, 0] as const;
/** Slow-poll tail far enough away to assert it does NOT fire early. */
const TEST_SLOW_POLL_MS = 10_000;

/**
 * `useReportCapabilities` registers scope disposal (onScopeDispose), so it
 * must run inside an active effect scope. Run it in one and return the
 * composable handle plus a dispose function (no DOM needed — this suite runs
 * in the node environment).
 */
function mountWithComposable(
  options: Pick<UseReportCapabilitiesOptions, "hasEligibleOutput"> &
    Partial<UseReportCapabilitiesOptions>
): {
  caps: ReturnType<typeof useReportCapabilities>;
  unmount: () => void;
} {
  const scope = effectScope();
  let handle!: ReturnType<typeof useReportCapabilities>;
  scope.run(() => {
    handle = useReportCapabilities({
      retryDelays: TEST_RETRY_DELAYS,
      slowPollMs: TEST_SLOW_POLL_MS,
      ...options,
    });
  });
  return {
    caps: handle,
    unmount: () => scope.stop(),
  };
}

describe("useReportCapabilities (conversation-report capability retry)", () => {
  beforeEach(() => {
    capsMock.mockReset();
    resetReportCapabilitiesForTest();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves enabled capabilities on the first fetch (no behavior change)", async () => {
    capsMock.mockResolvedValueOnce(enabledCaps());
    const { caps, unmount } = mountWithComposable({
      hasEligibleOutput: () => false,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(true)
    );
    expect(caps.loading.value).toBe(false);
    expect(capsMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("retries after a mount-time failure when eligible content appears (the reported bug)", async () => {
    // Simulate the logged reality: the mount-time fetch fails (backend 502 /
    // network blip) and the service fail-closes to enabled:false.
    capsMock.mockResolvedValueOnce(failClosedCaps());
    const eligible = ref(false);
    const { caps, unmount } = mountWithComposable({
      hasEligibleOutput: () => eligible.value,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(caps.capabilities.value).not.toBeNull());
    // Fail-closed envelope arrived: button must be grey at this point.
    expect(caps.capabilities.value?.conversationReporting.enabled).toBe(false);
    expect(capsMock).toHaveBeenCalledTimes(1);

    // The user now loads a history conversation with eligible content.
    eligible.value = true;
    await vi.advanceTimersByTimeAsync(0);

    // A retry must have happened once eligible content existed.
    await vi.waitFor(() =>
      expect(capsMock.mock.calls.length).toBeGreaterThan(1)
    );
    unmount();
  });

  it("enables the button only after the retry resolves enabled:true (end-to-end recovery)", async () => {
    capsMock
      .mockResolvedValueOnce(failClosedCaps())
      .mockResolvedValueOnce(enabledCaps());
    const eligible = ref(false);
    const { caps, unmount } = mountWithComposable({
      hasEligibleOutput: () => eligible.value,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(false)
    );

    eligible.value = true;
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(true)
    );
    unmount();
  });

  // Review fix (2026-09-05): the retry budget previously re-armed only on a
  // false→true eligibility transition. Switching between two conversations
  // that BOTH hold eligible output is a true→true transition — no watcher
  // fired, the exhausted chain never re-armed, and the button stayed grey
  // forever: a residual instance of the original bug.
  it("re-arms the exhausted chain when the conversation changes while eligibility stays true", async () => {
    capsMock.mockResolvedValue(failClosedCaps());
    const conversationId = ref("conv-a");
    const { unmount } = mountWithComposable({
      hasEligibleOutput: () => true,
      rearmKey: () => conversationId.value,
    });

    // Initial fetch + the whole zero-delay fast chain exhaust.
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(capsMock).toHaveBeenCalledTimes(5));

    // The slow-poll tail is pending at +10s — advance only half the
    // interval (with shouldAdvanceTime, real-time drift also ticks the
    // fake clock, so leave a generous margin below the boundary).
    await vi.advanceTimersByTimeAsync(Math.floor(TEST_SLOW_POLL_MS / 2));
    expect(capsMock).toHaveBeenCalledTimes(5);

    // Switch to another conversation that also has eligible output.
    conversationId.value = "conv-b";
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() =>
      expect(capsMock.mock.calls.length).toBeGreaterThanOrEqual(6)
    );
    unmount();
  });

  // Review fix (2026-09-05): an outage outlasting the ~82s fast chain
  // previously never healed until the user switched conversations again.
  // The slow-poll tail keeps re-asking at a TTL-aligned interval.
  it("keeps slow-polling after the fast chain exhausts, healing a longer outage", async () => {
    capsMock
      .mockResolvedValueOnce(failClosedCaps())
      .mockResolvedValueOnce(failClosedCaps())
      .mockResolvedValueOnce(failClosedCaps())
      .mockResolvedValueOnce(failClosedCaps())
      .mockResolvedValueOnce(failClosedCaps())
      .mockResolvedValueOnce(enabledCaps());
    const { caps, unmount } = mountWithComposable({
      hasEligibleOutput: () => true,
    });

    // Initial fetch + 4 fast retries, all fail-closed.
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(capsMock).toHaveBeenCalledTimes(5));
    expect(caps.capabilities.value?.conversationReporting.enabled).toBe(false);

    // The tail fires at slowPollMs and the healed backend answers enabled.
    await vi.advanceTimersByTimeAsync(TEST_SLOW_POLL_MS);
    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(true)
    );
    expect(capsMock).toHaveBeenCalledTimes(6);

    // Enabled → the tail stops. No runaway refetching.
    await vi.advanceTimersByTimeAsync(TEST_SLOW_POLL_MS * 3);
    expect(capsMock).toHaveBeenCalledTimes(6);
    unmount();
  });

  it("caps the fast chain at its schedule before the slow-poll tail", async () => {
    capsMock.mockResolvedValue(failClosedCaps());
    const eligible = ref(false);
    const { unmount } = mountWithComposable({
      hasEligibleOutput: () => eligible.value,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(capsMock).toHaveBeenCalledTimes(1); // initial fetch only

    eligible.value = true; // history conversation loaded
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(capsMock).toHaveBeenCalledTimes(5)); // +4 fast

    // Nothing between the chain end and the first slow poll (half the
    // interval — generous margin for shouldAdvanceTime real-time drift).
    await vi.advanceTimersByTimeAsync(Math.floor(TEST_SLOW_POLL_MS / 2));
    expect(capsMock).toHaveBeenCalledTimes(5);
    unmount();
  });

  // Review fix (2026-09-05): AiChatV2 and AiChatBox are both always mounted,
  // each with its own composable instance. Without a shared in-flight
  // promise, their overlapping mount fetches and retry chains doubled the
  // IPC/HTTP volume against a down backend.
  it("collapses concurrent fetches from separate instances into one call", async () => {
    let resolveCaps!: (value: AIContentReportCapabilities) => void;
    capsMock.mockImplementation(
      () =>
        new Promise<AIContentReportCapabilities>((resolve) => {
          resolveCaps = resolve;
        })
    );
    const first = mountWithComposable({ hasEligibleOutput: () => false });
    const second = mountWithComposable({ hasEligibleOutput: () => false });

    await vi.advanceTimersByTimeAsync(0);
    // Both instances' mount fetches shared one in-flight promise.
    expect(capsMock).toHaveBeenCalledTimes(1);

    resolveCaps(failClosedCaps());
    await vi.waitFor(() =>
      expect(first.caps.capabilities.value?.conversationReporting.enabled).toBe(
        false
      )
    );
    expect(second.caps.capabilities.value?.conversationReporting.enabled).toBe(
      false
    );
    // No eligibility → no retries from either instance.
    await vi.advanceTimersByTimeAsync(TEST_SLOW_POLL_MS * 2);
    expect(capsMock).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
  });

  it("does not retry when there is no eligible content (no hammering an empty chat)", async () => {
    capsMock.mockResolvedValueOnce(failClosedCaps());
    const { unmount } = mountWithComposable({ hasEligibleOutput: () => false });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(capsMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not retry when capabilities are already resolved enabled:true", async () => {
    capsMock.mockResolvedValueOnce(enabledCaps());
    const { unmount } = mountWithComposable({ hasEligibleOutput: () => true });

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(capsMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("recovers when the mount-time IPC itself throws (null capabilities)", async () => {
    capsMock
      .mockRejectedValueOnce(new Error("windowInvoke threw"))
      .mockResolvedValueOnce(enabledCaps());
    const eligible = ref(false);
    const { caps, unmount } = mountWithComposable({
      hasEligibleOutput: () => eligible.value,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(caps.capabilities.value).toBeNull());

    eligible.value = true;
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(true)
    );
    unmount();
  });
});
