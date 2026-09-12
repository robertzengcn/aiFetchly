import { describe, expect, it, vi } from "vitest";
import {
  ApplicationLifecycleService,
  type CleanupRunner,
} from "@/main-process/lifecycle/ApplicationLifecycleService";
import type { ApplicationLifecycleStateChangedEvent } from "@/entityTypes/applicationLifecycleTypes";

/**
 * State-machine arbitration tests for the application lifecycle service
 * (technical design §4): re-entrant quit, stale dialog tokens,
 * hide/restore, final-exit guard, terminal-intent arbitration.
 * PRD coverage: AC-01, AC-03, AC-08.
 */

function deferredCleanup(): {
  runner: CleanupRunner;
  resolve: (clean: boolean) => void;
  reject: (err: Error) => void;
  spy: ReturnType<typeof vi.fn>;
} {
  let resolve!: (clean: boolean) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<{ clean: boolean }>((res, rej) => {
    resolve = (clean: boolean) => res({ clean });
    reject = rej;
  });
  const spy = vi.fn(() => promise);
  return { runner: spy as unknown as CleanupRunner, resolve, reject, spy };
}

describe("ApplicationLifecycleService — close-choice tokens (FR-01, AC-01, AC-08)", () => {
  it("issues one token per pending dialog; repeated closes reuse it", () => {
    const svc = new ApplicationLifecycleService();
    const first = svc.beginCloseChoice();
    expect(first.result).toBe("issued");
    const second = svc.beginCloseChoice();
    expect(second.result).toBe("dialog-open");
    if (first.result === "issued" && second.result === "dialog-open") {
      expect(second.token).toBe(first.token);
    }
  });

  it("cancel consumes the token and keeps the window visible", () => {
    const svc = new ApplicationLifecycleService();
    const issued = svc.beginCloseChoice();
    expect(issued.result).toBe("issued");
    const token = issued.result === "issued" ? issued.token : "";
    const res = svc.submitCloseChoice(token, "cancel");
    expect(res).toEqual({ result: "accepted", choice: "cancel" });
    expect(svc.getState()).toBe("visible");
    // Token is consumed: a second submission is stale.
    expect(svc.submitCloseChoice(token, "hide").result).toBe("stale");
  });

  it("rejects submissions for a stale/unknown token", () => {
    const svc = new ApplicationLifecycleService();
    expect(svc.submitCloseChoice("not-a-live-token", "exit").result).toBe(
      "stale"
    );
  });

  it("hide requires a ready tray; without one it degrades to cancel", () => {
    const svc = new ApplicationLifecycleService();
    const issued = svc.beginCloseChoice();
    const token = issued.result === "issued" ? issued.token : "";
    const res = svc.submitCloseChoice(token, "hide");
    expect(res).toEqual({ result: "accepted", choice: "cancel" });
    expect(svc.getState()).toBe("visible");
  });

  it("hide with a ready tray moves to hidden", () => {
    const svc = new ApplicationLifecycleService();
    svc.setBackgroundAvailable(true);
    const issued = svc.beginCloseChoice();
    const token = issued.result === "issued" ? issued.token : "";
    const res = svc.submitCloseChoice(token, "hide");
    expect(res).toEqual({ result: "accepted", choice: "hide" });
    expect(svc.getState()).toBe("hidden");
  });

  it("exit from the dialog synchronously enters quitting", () => {
    const svc = new ApplicationLifecycleService();
    const { runner } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const issued = svc.beginCloseChoice();
    const token = issued.result === "issued" ? issued.token : "";
    const res = svc.submitCloseChoice(token, "exit");
    expect(res).toEqual({ result: "accepted", choice: "exit" });
    // Synchronous — no await needed to observe the freeze (design §4).
    expect(svc.getState()).toBe("quitting");
    expect(svc.isQuitting()).toBe(true);
  });

  it("a close request while quitting does not open a dialog", () => {
    const svc = new ApplicationLifecycleService();
    const { runner } = deferredCleanup();
    svc.setCleanupRunner(runner);
    svc.requestExit("tray");
    expect(svc.beginCloseChoice().result).toBe("quitting");
  });

  it("exit from another source invalidates the pending token", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const issued = svc.beginCloseChoice();
    const token = issued.result === "issued" ? issued.token : "";
    const exitPromise = svc.requestExit("tray");
    // Late dialog response cannot revive or hide a quitting app (§4).
    expect(svc.submitCloseChoice(token, "hide").result).toBe("stale");
    resolve(true);
    const outcome = await exitPromise;
    expect(outcome.clean).toBe(true);
  });

  it("tracks renderer acknowledgement per token", () => {
    const svc = new ApplicationLifecycleService();
    const issued = svc.beginCloseChoice();
    const token = issued.result === "issued" ? issued.token : "";
    expect(svc.hasRendererAcknowledged()).toBe(false);
    expect(svc.acknowledgeCloseChoice("wrong-token")).toBe(false);
    expect(svc.acknowledgeCloseChoice(token)).toBe(true);
    expect(svc.hasRendererAcknowledged()).toBe(true);
  });
});

describe("ApplicationLifecycleService — background mode (FR-02, FR-03, AC-02, AC-03)", () => {
  it("hideToTray refuses without tray readiness", () => {
    const svc = new ApplicationLifecycleService();
    expect(svc.hideToTray()).toBe(false);
    expect(svc.getState()).toBe("visible");
  });

  it("hideToTray then restore round-trips hidden -> visible", () => {
    const svc = new ApplicationLifecycleService();
    svc.setBackgroundAvailable(true);
    expect(svc.hideToTray()).toBe(true);
    expect(svc.getState()).toBe("hidden");
    expect(svc.restoreFromTray()).toBe(true);
    expect(svc.getState()).toBe("visible");
  });

  it("restore only applies from hidden", () => {
    const svc = new ApplicationLifecycleService();
    expect(svc.restoreFromTray()).toBe(false);
  });
});

describe("ApplicationLifecycleService — exit arbitration (FR-04, FR-05, AC-08)", () => {
  it("requestExit sets quitting synchronously before the first await", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const promise = svc.requestExit("application-menu");
    expect(svc.getState()).toBe("quitting");
    expect(svc.getPhase()).toBe("freeze");
    resolve(true);
    const outcome = await promise;
    expect(outcome.clean).toBe(true);
    expect(outcome.reason).toBe("application-menu");
    expect(outcome.intent).toBe("quit");
  });

  it("repeated exit requests join the same promise and run cleanup once", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve, spy } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const p1 = svc.requestExit("tray");
    const p2 = svc.requestExit("application-menu");
    const p3 = svc.requestExit("programmatic");
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    resolve(true);
    await p1;
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("first terminal intent wins: ordinary quit does not overwrite update-restart", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const updatePromise = svc.requestExit("update-restart");
    const quitPromise = svc.requestExit("tray");
    expect(quitPromise).toBe(updatePromise);
    resolve(true);
    const outcome = await updatePromise;
    expect(outcome.intent).toBe("update-restart");
    expect(svc.getTerminalIntent()).toBe("update-restart");
  });

  it("first terminal intent wins: late update request does not upgrade a quit", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const quitPromise = svc.requestExit("tray");
    const updatePromise = svc.requestExit("update-restart");
    expect(updatePromise).toBe(quitPromise);
    resolve(true);
    expect((await quitPromise).intent).toBe("quit");
  });

  it("cleanup rejection resolves unclean instead of throwing", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, reject } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const promise = svc.requestExit("programmatic");
    reject(new Error("boom"));
    const outcome = await promise;
    expect(outcome.clean).toBe(false);
  });

  it("without a cleanup runner the exit is clean (early startup path)", async () => {
    const svc = new ApplicationLifecycleService();
    const outcome = await svc.requestExit("programmatic");
    expect(outcome.clean).toBe(true);
  });
});

describe("ApplicationLifecycleService — final-exit guard (design §4)", () => {
  it("authorizeFinalExit flips quitting -> ready-to-exit exactly once", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const promise = svc.requestExit("tray");
    resolve(true);
    await promise;
    expect(svc.isFinalExitAuthorized()).toBe(false);
    svc.authorizeFinalExit();
    expect(svc.getState()).toBe("ready-to-exit");
    expect(svc.isFinalExitAuthorized()).toBe(true);
  });

  it("ignores illegal revival transitions after quitting", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    svc.requestExit("tray");
    expect(svc.restoreFromTray()).toBe(false);
    expect(svc.hideToTray()).toBe(false);
    resolve(true);
    svc.authorizeFinalExit();
    // ready-to-exit is terminal: further transitions are ignored.
    svc.authorizeFinalExit();
    expect(svc.getState()).toBe("ready-to-exit");
  });

  it("ready-to-exit still reports isQuitting so gates keep blocking", async () => {
    const svc = new ApplicationLifecycleService();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const p = svc.requestExit("tray");
    resolve(true);
    await p;
    svc.authorizeFinalExit();
    expect(svc.isQuitting()).toBe(true);
  });
});

describe("ApplicationLifecycleService — state events (FR-04, design §10)", () => {
  it("emits state-changed events with a user-facing phase key", async () => {
    const svc = new ApplicationLifecycleService();
    const events: ApplicationLifecycleStateChangedEvent[] = [];
    svc.addStateListener((e) => events.push(e));
    svc.setBackgroundAvailable(true);
    svc.hideToTray();
    svc.restoreFromTray();
    const { runner, resolve } = deferredCleanup();
    svc.setCleanupRunner(runner);
    const p = svc.requestExit("tray");
    resolve(true);
    await p;
    svc.authorizeFinalExit();

    const states = events.map((e) => e.state);
    expect(states).toContain("hidden");
    expect(states).toContain("visible");
    expect(states).toContain("quitting");
    expect(states).toContain("ready-to-exit");
    const last = events[events.length - 1];
    expect(last.phaseKey).toBe("exiting");
  });

  it("listener errors do not break the machine", () => {
    const svc = new ApplicationLifecycleService();
    svc.addStateListener(() => {
      throw new Error("listener bug");
    });
    expect(() => svc.hideToTray()).not.toThrow();
  });

  it("removeStateListener stops delivery", () => {
    const svc = new ApplicationLifecycleService();
    const seen: string[] = [];
    const listener = (e: ApplicationLifecycleStateChangedEvent): void => {
      seen.push(e.state);
    };
    svc.addStateListener(listener);
    svc.setBackgroundAvailable(true);
    svc.hideToTray();
    svc.removeStateListener(listener);
    svc.restoreFromTray();
    expect(seen).toEqual(["hidden"]);
  });
});

describe("ApplicationLifecycleService — shutdown phases (FR-04)", () => {
  it("setPhase updates the phase only while quitting", () => {
    const svc = new ApplicationLifecycleService();
    svc.setPhase("graceful-stop");
    expect(svc.getPhase()).toBe("idle"); // ignored while visible
    const { runner } = deferredCleanup();
    svc.setCleanupRunner(runner);
    svc.requestExit("tray");
    svc.setPhase("graceful-stop");
    expect(svc.getPhase()).toBe("graceful-stop");
    svc.setPhase("force-stop");
    expect(svc.getPhase()).toBe("force-stop");
  });
});
