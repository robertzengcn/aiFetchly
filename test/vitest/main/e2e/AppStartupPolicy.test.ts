import { describe, it, expect } from "vitest";
import { resolveAppStartupPolicy } from "@/main-process/startup/AppStartupPolicy";

describe("AppStartupPolicy", () => {
  it("enables every side effect in production/dev (no E2E flag)", () => {
    const policy = resolveAppStartupPolicy({}, false);
    expect(policy.registerProtocol).toBe(true);
    expect(policy.acquireSingleInstanceLock).toBe(true);
    expect(policy.initializeUpdates).toBe(true);
    expect(policy.installDevTools).toBe(true);
    expect(policy.startSchedulers).toBe(true);
    expect(policy.inspectOrphanedTasks).toBe(true);
    expect(policy.connectMarketingWebSocket).toBe(true);
    expect(policy.startTokenRefresh).toBe(true);
    expect(policy.startDevBrowserBridge).toBe(true);
    expect(policy.scanGlobalExtensions).toBe(true);
  });

  it("disables every external side effect when AIFETCHLY_E2E=1", () => {
    const policy = resolveAppStartupPolicy({ AIFETCHLY_E2E: "1" }, false);
    expect(policy.registerProtocol).toBe(false);
    expect(policy.acquireSingleInstanceLock).toBe(false);
    expect(policy.initializeUpdates).toBe(false);
    expect(policy.installDevTools).toBe(false);
    expect(policy.startSchedulers).toBe(false);
    expect(policy.inspectOrphanedTasks).toBe(false);
    expect(policy.connectMarketingWebSocket).toBe(false);
    expect(policy.startTokenRefresh).toBe(false);
    expect(policy.startDevBrowserBridge).toBe(false);
    expect(policy.scanGlobalExtensions).toBe(false);
  });

  it("treats packaged builds without the flag as production", () => {
    const policy = resolveAppStartupPolicy({}, true);
    expect(policy.startSchedulers).toBe(true);
    expect(policy.connectMarketingWebSocket).toBe(true);
  });

  it("rejects the E2E policy in packaged builds even when AIFETCHLY_E2E=1", () => {
    // Design acceptance #12: a shipped app must never honor the E2E override.
    const policy = resolveAppStartupPolicy({ AIFETCHLY_E2E: "1" }, true);
    expect(policy.startSchedulers).toBe(true);
    expect(policy.registerProtocol).toBe(true);
    expect(policy.connectMarketingWebSocket).toBe(true);
  });

  it("requires the exact sentinel '1'", () => {
    expect(
      resolveAppStartupPolicy({ AIFETCHLY_E2E: "true" }, false).startSchedulers
    ).toBe(true);
    expect(
      resolveAppStartupPolicy({ AIFETCHLY_E2E: "0" }, false).startSchedulers
    ).toBe(true);
  });
});
