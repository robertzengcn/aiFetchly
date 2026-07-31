import { describe, expect, it, vi } from "vitest";
import {
  acquireSingleInstanceLock,
  SingleInstanceApp,
} from "@/main-process/singleInstanceGuard";

function makeApp(acquired: boolean): SingleInstanceApp {
  return {
    requestSingleInstanceLock: vi.fn(() => acquired),
    quit: vi.fn(),
  };
}

describe("single-instance guard", () => {
  it("keeps the first process running when the lock is acquired", () => {
    const app = makeApp(true);

    expect(acquireSingleInstanceLock(app)).toBe(true);
    expect(vi.mocked(app.requestSingleInstanceLock)).toHaveBeenCalledOnce();
    expect(vi.mocked(app.quit)).not.toHaveBeenCalled();
  });

  it("quits a second process when the lock is already owned", () => {
    const app = makeApp(false);

    expect(acquireSingleInstanceLock(app)).toBe(false);
    expect(vi.mocked(app.requestSingleInstanceLock)).toHaveBeenCalledOnce();
    expect(vi.mocked(app.quit)).toHaveBeenCalledOnce();
  });
});
