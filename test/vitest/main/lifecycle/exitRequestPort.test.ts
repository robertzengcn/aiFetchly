import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  bindExitRequestor,
  isExitRequestorBound,
  requestAppExit,
  setUpdateRestartAction,
  takeUpdateRestartAction,
} from "@/main-process/lifecycle/exitRequestPort";

/**
 * exitRequestPort tests (design §12): binding semantics, never-throwing
 * request dispatch, and exactly-once consumption of the update-restart
 * terminal action.
 */

describe("exitRequestPort", () => {
  beforeEach(() => {
    bindExitRequestor(null as unknown as never); // reset binding
    setUpdateRestartAction(null);
  });

  it("is unbound until background.ts binds it", () => {
    expect(isExitRequestorBound()).toBe(false);
    bindExitRequestor(async () => undefined);
    expect(isExitRequestorBound()).toBe(true);
  });

  it("dispatches requests to the bound implementation", async () => {
    const requestor = vi.fn(async () => undefined);
    bindExitRequestor(requestor);
    await requestAppExit("update-restart");
    expect(requestor).toHaveBeenCalledWith("update-restart");
  });

  it("a throwing requestor never rejects (exit requests must not leak)", async () => {
    bindExitRequestor(async () => {
      throw new Error("boom");
    });
    await expect(requestAppExit("tray")).resolves.toBeUndefined();
  });

  it("an unbound port is a silent no-op", async () => {
    await expect(requestAppExit("programmatic")).resolves.toBeUndefined();
  });

  it("the update-restart action is consumed exactly once", () => {
    expect(takeUpdateRestartAction()).toBeNull();
    const action = vi.fn();
    setUpdateRestartAction(action);
    expect(takeUpdateRestartAction()).toBe(action);
    expect(takeUpdateRestartAction()).toBeNull(); // consumed
  });
});
