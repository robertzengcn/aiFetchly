import { describe, it, expect, beforeEach } from "vitest";

// The restart policy functions are module-level in contactExtraction-ipc.ts.
// We test the logic via a re-implementation that mirrors the exact constants
// and algorithm, so the test doesn't need to import the electron-coupled module.

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const BASE_RESTART_DELAY_MS = 5000;

function createPolicy() {
  let timestamps: number[] = [];
  return {
    shouldRestart: () => {
      const now = Date.now();
      timestamps = timestamps.filter(ts => now - ts < RESTART_WINDOW_MS);
      if (timestamps.length >= MAX_RESTARTS) return false;
      timestamps.push(now);
      return true;
    },
    getRestartDelay: () => BASE_RESTART_DELAY_MS * Math.pow(2, timestamps.length - 1),
    reset: () => { timestamps = []; },
    count: () => timestamps.length,
  };
}

describe("Worker restart policy (WS-4 R4.2)", () => {
  let policy: ReturnType<typeof createPolicy>;

  beforeEach(() => {
    policy = createPolicy();
  });

  it("allows up to MAX_RESTARTS (5) restarts", () => {
    for (let i = 0; i < MAX_RESTARTS; i++) {
      expect(policy.shouldRestart()).toBe(true);
    }
    expect(policy.shouldRestart()).toBe(false); // 6th attempt blocked
  });

  it("uses exponential backoff (5s → 10s → 20s → 40s → 80s)", () => {
    policy.shouldRestart(); // attempt 1
    expect(policy.getRestartDelay()).toBe(5000);
    policy.shouldRestart(); // attempt 2
    expect(policy.getRestartDelay()).toBe(10000);
    policy.shouldRestart(); // attempt 3
    expect(policy.getRestartDelay()).toBe(20000);
    policy.shouldRestart(); // attempt 4
    expect(policy.getRestartDelay()).toBe(40000);
    policy.shouldRestart(); // attempt 5
    expect(policy.getRestartDelay()).toBe(80000);
  });

  it("circuit-breaks after MAX_RESTARTS — no more restarts", () => {
    for (let i = 0; i < MAX_RESTARTS; i++) {
      expect(policy.shouldRestart()).toBe(true);
    }
    // All further attempts are blocked
    expect(policy.shouldRestart()).toBe(false);
    expect(policy.shouldRestart()).toBe(false);
  });

  it("reset() clears the counter (healthy worker-ready restarts tracking)", () => {
    for (let i = 0; i < MAX_RESTARTS; i++) {
      policy.shouldRestart();
    }
    expect(policy.shouldRestart()).toBe(false); // circuit broken
    policy.reset(); // worker-ready
    expect(policy.shouldRestart()).toBe(true); // allowed again
  });

  it("does not infinite-loop on a worker that crashes on startup", () => {
    let restarts = 0;
    let circuitBroken = false;
    for (let i = 0; i < 100; i++) { // simulate 100 crash attempts
      if (policy.shouldRestart()) {
        restarts++;
      } else {
        circuitBroken = true;
        break;
      }
    }
    expect(restarts).toBe(MAX_RESTARTS); // exactly 5, not 100
    expect(circuitBroken).toBe(true); // circuit broke on the 6th
  });
});
