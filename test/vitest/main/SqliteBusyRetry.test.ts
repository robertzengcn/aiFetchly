import { describe, expect, test, vi } from "vitest";
import {
  isSqliteBusyError,
  runWithSqliteBusyRetry,
} from "@/utils/sqliteBusyRetry";

describe("sqliteBusyRetry", () => {
  test("detects TypeORM-wrapped SQLite busy errors", () => {
    const error = {
      message: "SqliteError: database is locked",
      code: "SQLITE_BUSY",
      driverError: {
        code: "SQLITE_BUSY",
      },
    };

    expect(isSqliteBusyError(error)).toBe(true);
  });

  test("retries busy errors and returns the successful result", async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce({ driverError: { code: "SQLITE_BUSY" } })
      .mockResolvedValueOnce(42);
    const onRetry = vi.fn();

    await expect(
      runWithSqliteBusyRetry(operation, {
        maxAttempts: 2,
        delayMs: 0,
        onRetry,
      })
    ).resolves.toBe(42);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(
      2,
      2,
      0,
      expect.objectContaining({
        driverError: expect.objectContaining({ code: "SQLITE_BUSY" }),
      })
    );
  });

  test("does not retry non-SQLite busy errors", async () => {
    const error = new Error("validation failed");
    const operation = vi.fn<() => Promise<number>>().mockRejectedValue(error);

    await expect(
      runWithSqliteBusyRetry(operation, { maxAttempts: 3, delayMs: 0 })
    ).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(1);
  });
});
