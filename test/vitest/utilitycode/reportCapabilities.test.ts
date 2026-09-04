"use strict";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref, effectScope } from "vue";

const capsMock = vi.fn();
vi.mock("@/views/api/aiContentReport", () => ({
  getAIContentReportCapabilities: (...a: unknown[]) => capsMock(...a),
  createAIContentReport: vi.fn(),
}));

import { useReportCapabilities } from "@/views/utils/reportCapabilities";
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

/**
 * `useReportCapabilities` registers scope disposal (onScopeDispose), so it
 * must run inside an active effect scope. Run it in one and return the
 * composable handle plus a dispose function (no DOM needed — this suite runs
 * in the node environment).
 */
function mountWithComposable(hasEligibleOutput: () => boolean): {
  caps: ReturnType<typeof useReportCapabilities>;
  unmount: () => void;
} {
  const scope = effectScope();
  let handle!: ReturnType<typeof useReportCapabilities>;
  scope.run(() => {
    handle = useReportCapabilities({
      hasEligibleOutput,
      retryDelayMs: 0,
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves enabled capabilities on the first fetch (no behavior change)", async () => {
    capsMock.mockResolvedValueOnce(enabledCaps());
    const { caps, unmount } = mountWithComposable(() => false);
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
    const { caps, unmount } = mountWithComposable(() => eligible.value);

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(caps.capabilities.value).not.toBeNull());
    // Fail-closed envelope arrived: button must be grey at this point.
    expect(caps.capabilities.value?.conversationReporting.enabled).toBe(false);
    const callsAfterMount = capsMock.mock.calls.length;
    expect(callsAfterMount).toBe(1);

    // The user now loads a history conversation with eligible content.
    eligible.value = true;
    await vi.advanceTimersByTimeAsync(5000);

    // A retry must have happened once eligible content existed.
    await vi.waitFor(() =>
      expect(capsMock.mock.calls.length).toBeGreaterThan(callsAfterMount)
    );
    unmount();
  });

  it("enables the button only after the retry resolves enabled:true (end-to-end recovery)", async () => {
    capsMock
      .mockResolvedValueOnce(failClosedCaps())
      .mockResolvedValueOnce(enabledCaps());
    const eligible = ref(false);
    const { caps, unmount } = mountWithComposable(() => eligible.value);

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(false)
    );

    eligible.value = true;
    await vi.advanceTimersByTimeAsync(5000);

    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(true)
    );
    unmount();
  });

  it("stops retrying after the attempt cap when the backend keeps failing", async () => {
    capsMock.mockResolvedValue(failClosedCaps());
    const eligible = ref(false);
    const { unmount } = mountWithComposable(() => eligible.value);

    await vi.advanceTimersByTimeAsync(0);
    const eligibleCalls = capsMock.mock.calls.length;

    eligible.value = true;
    // Advance far past the last scheduled backoff.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    const finalCalls = capsMock.mock.calls.length;
    expect(finalCalls).toBeGreaterThan(eligibleCalls);
    expect(finalCalls - eligibleCalls).toBeLessThanOrEqual(5);
    unmount();
  });

  it("does not retry when there is no eligible content (no hammering an empty chat)", async () => {
    capsMock.mockResolvedValueOnce(failClosedCaps());
    const { unmount } = mountWithComposable(() => false);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(capsMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not retry when capabilities are already resolved enabled:true", async () => {
    capsMock.mockResolvedValueOnce(enabledCaps());
    const { unmount } = mountWithComposable(() => true);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(capsMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("recovers when the mount-time IPC itself throws (null capabilities)", async () => {
    capsMock
      .mockRejectedValueOnce(new Error("windowInvoke threw"))
      .mockResolvedValueOnce(enabledCaps());
    const eligible = ref(false);
    const { caps, unmount } = mountWithComposable(() => eligible.value);

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(caps.capabilities.value).toBeNull());

    eligible.value = true;
    await vi.advanceTimersByTimeAsync(5000);

    await vi.waitFor(() =>
      expect(caps.capabilities.value?.conversationReporting.enabled).toBe(true)
    );
    unmount();
  });
});
