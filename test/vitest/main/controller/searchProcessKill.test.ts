import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:child_process so we can assert killPidViaOs invokes execFile (not exec),
// with an argv array and no shell.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], cb?: (e: unknown) => void) => {
      cb?.(null);
      return undefined;
    }
  ),
}));

import { execFile } from "node:child_process";
import {
  buildKillCommand,
  killPidViaOs,
} from "@/controller/searchProcessKill";

describe("buildKillCommand", () => {
  it("builds a posix kill argv with no shell interpolation", () => {
    const { cmd, args } = buildKillCommand(12345, "linux");
    expect(cmd).toBe("kill");
    expect(args).toEqual(["-9", "12345"]);
  });

  it("builds a darwin kill argv identical to linux", () => {
    const { cmd, args } = buildKillCommand(7, "darwin");
    expect(cmd).toBe("kill");
    expect(args).toEqual(["-9", "7"]);
  });

  it("builds a win32 taskkill argv", () => {
    const { cmd, args } = buildKillCommand(12345, "win32");
    expect(cmd).toBe("taskkill");
    expect(args).toEqual(["/PID", "12345", "/F"]);
  });

  it("rejects non-positive, non-integer, or NaN pids (defense-in-depth)", () => {
    expect(() => buildKillCommand(0, "linux")).toThrow();
    expect(() => buildKillCommand(-1, "linux")).toThrow();
    expect(() => buildKillCommand(1.5, "linux")).toThrow();
    expect(() => buildKillCommand(NaN, "linux")).toThrow();
    // injection attempts through a numeric channel must fail before reaching the OS
    expect(() =>
      buildKillCommand(Number("1; rm -rf /"), "linux")
    ).toThrow();
  });

  it("never produces a shell-interpolated string for the pid", () => {
    // The argv form is the security guarantee: pid is an isolated element,
    // never concatenated into a command string.
    for (const platform of ["linux", "darwin", "win32"]) {
      const { args } = buildKillCommand(99991, platform);
      expect(args.some((a) => a.includes(" "))).toBe(false);
      expect(args).toContain("99991");
    }
  });
});

describe("killPidViaOs", () => {
  beforeEach(() => {
    vi.mocked(execFile).mockClear();
  });

  it("invokes execFile (not exec) with a posix argv", () => {
    killPidViaOs(4242, "linux");
    expect(execFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(execFile).mock.calls[0];
    expect(cmd).toBe("kill");
    expect(args).toEqual(["-9", "4242"]);
  });

  it("invokes execFile with a win32 argv", () => {
    killPidViaOs(4242, "win32");
    const [cmd, args] = vi.mocked(execFile).mock.calls[0];
    expect(cmd).toBe("taskkill");
    expect(args).toEqual(["/PID", "4242", "/F"]);
  });

  it("passes a callback as the third argument", () => {
    killPidViaOs(99, "linux");
    const third = vi.mocked(execFile).mock.calls[0]?.[2];
    expect(typeof third).toBe("function");
  });
});
