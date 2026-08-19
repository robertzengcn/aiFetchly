import { describe, it, expect, vi } from "vitest";
import { useApiCall } from "@/views/composables/useApiCall";

describe("useApiCall", () => {
  it("returns the resolved value and ends not-loading on success", async () => {
    const { run, loading, error, hasError } = useApiCall(async () => 42);

    const result = await run();

    expect(result).toBe(42);
    expect(loading.value).toBe(false);
    expect(error.value).toBeNull();
    expect(hasError.value).toBe(false);
  });

  it("captures errors into `error`, fires onError, and returns undefined", async () => {
    const onError = vi.fn();
    const { run, error, hasError } = useApiCall(
      async () => {
        throw new Error("boom");
      },
      { onError }
    );

    const result = await run();

    expect(result).toBeUndefined();
    expect(error.value).toBe("boom");
    expect(hasError.value).toBe(true);
    expect(onError).toHaveBeenCalledWith("boom");
  });

  it("stringifies non-Error rejections", async () => {
    const { run, error } = useApiCall(async () => {
      throw "plain string failure"; // eslint-disable-line no-throw-literal
    });

    await run();

    expect(error.value).toBe("plain string failure");
  });

  it("sets loading true during the call and false after", async () => {
    let resolve!: (v: number) => void;
    const { run, loading } = useApiCall(
      () => new Promise<number>((r) => (resolve = r))
    );

    const promise = run();
    expect(loading.value).toBe(true);

    resolve(7);
    await promise;

    expect(loading.value).toBe(false);
  });

  it("resets error at the start of each run", async () => {
    let shouldFail = true;
    const { run, error } = useApiCall(async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("first");
      }
      return "ok";
    });

    await run();
    expect(error.value).toBe("first");

    const result = await run();
    expect(result).toBe("ok");
    expect(error.value).toBeNull();
  });

  it("does not re-throw (no unhandled rejection for the caller)", async () => {
    const { run } = useApiCall(async () => {
      throw new Error("handled");
    });
    // Should resolve, not reject.
    await expect(run()).resolves.toBeUndefined();
  });
});
