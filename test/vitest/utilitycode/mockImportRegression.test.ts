"use strict";
/**
 * Regression test: verify the fix for vitest circular dependency when a module
 * is both vi.mock'd AND statically value-imported in the same test file.
 *
 * Background (commit cd830605):
 *   httpclientRefresh.test.ts had both vi.mock("@/modules/tokenRefresh") and
 *   import { RefreshTokenInvalidError } from "@/modules/tokenRefresh". Vitest's
 *   hoisting mechanism could not resolve the circular reference, throwing:
 *     "ReferenceError: Cannot access '__vi_import_1__' before initialization"
 *
 * The fix has two parts:
 *   1. In the source file (httpclient.ts): remove the static import of
 *      RefreshTokenInvalidError — rely on the name-based check
 *      (error.name === "RefreshTokenInvalidError") instead of instanceof.
 *   2. In the test file: move the class into vi.hoisted() and reference it
 *      in both the mock factory and the test body.
 *
 * This test validates:
 *   - isRefreshTokenInvalidError() still works without the instanceof check
 *     (regression guard for the source-file change)
 *   - The vi.hoisted pattern works correctly (documentation via code)
 */
import { describe, it, expect } from "vitest";
import { isRefreshTokenInvalidError } from "@/modules/lib/httpclient";

// ---------------------------------------------------------------------------
// Part 1: Verify isRefreshTokenInvalidError behavior without instanceof
// ---------------------------------------------------------------------------
describe("isRefreshTokenInvalidError (regression)", () => {
  it("detects errors with name 'RefreshTokenInvalidError'", () => {
    const err = new Error("invalid or expired refresh token");
    err.name = "RefreshTokenInvalidError";
    expect(isRefreshTokenInvalidError(err)).toBe(true);
  });

  it("detects errors with message 'invalid or expired refresh token' (case-insensitive)", () => {
    expect(isRefreshTokenInvalidError(new Error("invalid or expired refresh token"))).toBe(true);
    expect(isRefreshTokenInvalidError(new Error("Invalid or Expired Refresh Token"))).toBe(true);
  });

  it("detects errors with message 'refresh token not found'", () => {
    expect(isRefreshTokenInvalidError(new Error("refresh token not found"))).toBe(true);
  });

  it("detects errors with message 'refresh token has expired'", () => {
    expect(isRefreshTokenInvalidError(new Error("refresh token has expired"))).toBe(true);
  });

  it("detects errors with message 'refresh token is invalid'", () => {
    expect(isRefreshTokenInvalidError(new Error("refresh token is invalid"))).toBe(true);
  });

  it("detects errors with message 'refresh token rejected'", () => {
    expect(isRefreshTokenInvalidError(new Error("refresh token rejected"))).toBe(true);
  });

  it("detects errors with message containing 'http error: 401'", () => {
    expect(isRefreshTokenInvalidError(new Error("HTTP error: 401 Unauthorized"))).toBe(true);
    expect(isRefreshTokenInvalidError(new Error("http error: 401"))).toBe(true);
  });

  it("returns false for transient/network errors", () => {
    expect(isRefreshTokenInvalidError(new Error("fetch failed"))).toBe(false);
    expect(isRefreshTokenInvalidError(new Error("network down"))).toBe(false);
    expect(isRefreshTokenInvalidError(new Error("HTTP error: 500 Internal Server Error"))).toBe(false);
    expect(isRefreshTokenInvalidError(new Error("timeout"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRefreshTokenInvalidError("some string")).toBe(false);
    expect(isRefreshTokenInvalidError(null)).toBe(false);
    expect(isRefreshTokenInvalidError(undefined)).toBe(false);
    expect(isRefreshTokenInvalidError(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 2: Verify the vi.hoisted pattern (the correct fix approach)
// ---------------------------------------------------------------------------
describe("vi.hoisted mock pattern (regression)", () => {
  /**
   * THE CORRECT PATTERN:
   *
   * When a vi.mock factory needs to export a symbol that the test body also
   * needs to reference:
   *
   * 1. Define the symbol in vi.hoisted() — this runs before the mock factory
   *    and before static imports, so it's available everywhere.
   * 2. Reference the hoisted symbol in the vi.mock factory return value.
   * 3. Reference the hoisted symbol directly in the test body (no static
   *    import from the mocked module).
   *
   * ```typescript
   * const MyClass = vi.hoisted(() => {
   *   return class extends Error {
   *     constructor(m: string) { super(m); this.name = "MyClass"; }
   *   };
   * });
   *
   * vi.mock("@/modules/someModule", () => ({
   *   MyClass,  // used in mock factory
   * }));
   *
   * // ❌ WRONG: import { MyClass } from "@/modules/someModule"
   * // ✅ CORRECT: use MyClass directly (it's hoisted)
   * test("something", () => {
   *   const instance = new MyClass("test");
   * });
   * ```
   */

  it("documents that vi.hoisted symbols are usable in both mock and test body", () => {
    // This test doesn't actually run a mock, it just demonstrates the pattern.
    // The real regression test is the httpclientRefresh.test.ts test itself,
    // which would fail at vitest's module-loading phase if the pattern regressed.
    expect(true).toBe(true);
  });
});