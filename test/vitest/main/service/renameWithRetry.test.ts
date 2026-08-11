import { describe, expect, test, vi } from "vitest";
import { renameWithRetry } from "@/service/localAiRuntime/renameWithRetry";

function errWithCode(code: string): NodeJS.ErrnoException {
  const e = new Error(`mock ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe("renameWithRetry", () => {
  test("succeeds on the first attempt without sleeping", async () => {
    const rename = vi.fn(async () => undefined);
    const sleep = vi.fn<[ms: number], Promise<void>>(async () => undefined);
    await renameWithRetry("a", "b", { rename, sleep, maxAttempts: 5 });
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("retries transient EPERM then succeeds", async () => {
    const rename = vi.fn<[string, string], Promise<void>>();
    rename
      .mockRejectedValueOnce(errWithCode("EPERM"))
      .mockRejectedValueOnce(errWithCode("ENOTEMPTY"))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn<[ms: number], Promise<void>>(async () => undefined);
    await renameWithRetry("a", "b", { rename, sleep, maxAttempts: 5 });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // exponential backoff: 100, 200
    expect(sleep.mock.calls[0][0]).toBe(100);
    expect(sleep.mock.calls[1][0]).toBe(200);
  });

  test("rethrows a non-transient error immediately", async () => {
    const rename = vi.fn(async () => {
      throw errWithCode("ENOENT");
    });
    const sleep = vi.fn<[ms: number], Promise<void>>(async () => undefined);
    await expect(
      renameWithRetry("a", "b", { rename, sleep, maxAttempts: 5 })
    ).rejects.toThrow("mock ENOENT");
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("rejects with the last transient error when the budget is exhausted", async () => {
    const rename = vi.fn(async () => {
      throw errWithCode("EACCES");
    });
    const sleep = vi.fn<[ms: number], Promise<void>>(async () => undefined);
    await expect(
      renameWithRetry("a", "b", { rename, sleep, maxAttempts: 3 })
    ).rejects.toThrow("mock EACCES");
    expect(rename).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
