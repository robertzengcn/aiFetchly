import * as fs from "fs";
import * as path from "path";
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

  it("aborts initialize() in background.ts before app.whenReady() when the single-instance lock is not acquired", () => {
    const backgroundSource = fs.readFileSync(
      path.resolve(__dirname, "../../../src/background.ts"),
      "utf8"
    );

    expect(backgroundSource).toContain("function makeSingleInstance(): boolean");
    expect(backgroundSource).toMatch(
      /if\s*\(\s*startupPolicy\.acquireSingleInstanceLock\s*\)\s*\{\s*if\s*\(\s*!makeSingleInstance\(\)\s*\)\s*\{[\s\S]*?return;\s*\}/
    );
  });
});
