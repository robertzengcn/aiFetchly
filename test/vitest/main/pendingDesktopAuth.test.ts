/**
 * Unit tests for src/modules/pendingDesktopAuth.ts.
 *
 * Verifies:
 *   - set/get round-trips fields correctly.
 *   - clear() empties the slot.
 *   - isMatchingState() accepts exact matches, rejects mismatches, and
 *     returns false when no handoff is pending.
 *   - TTL expiry: after the TTL, getPendingDesktopAuth() returns null and
 *     isMatchingState() returns false, even without an explicit clear.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setPendingDesktopAuth,
  getPendingDesktopAuth,
  isMatchingState,
  clearPendingDesktopAuth,
  PENDING_DESKTOP_AUTH_TTL_MS,
} from "@/modules/pendingDesktopAuth";

beforeEach(() => {
  clearPendingDesktopAuth();
});

afterEach(() => {
  clearPendingDesktopAuth();
  vi.useRealTimers();
});

describe("pendingDesktopAuth", () => {
  const sample = {
    codeVerifier: "v".repeat(43),
    codeChallenge: "c".repeat(43),
    state: "s".repeat(22),
    redirectUri: "http://127.0.0.1:50000/auth/callback",
  };

  it("round-trips fields via set/get", () => {
    setPendingDesktopAuth(sample);
    const got = getPendingDesktopAuth();
    expect(got).not.toBeNull();
    expect(got?.codeVerifier).toBe(sample.codeVerifier);
    expect(got?.codeChallenge).toBe(sample.codeChallenge);
    expect(got?.state).toBe(sample.state);
    expect(got?.redirectUri).toBe(sample.redirectUri);
    expect(typeof got?.expiresAt).toBe("number");
  });

  it("returns null when nothing is set", () => {
    expect(getPendingDesktopAuth()).toBeNull();
  });

  it("clear empties the slot", () => {
    setPendingDesktopAuth(sample);
    clearPendingDesktopAuth();
    expect(getPendingDesktopAuth()).toBeNull();
  });

  it("set overwrites previous pending handoff", () => {
    setPendingDesktopAuth(sample);
    setPendingDesktopAuth({ ...sample, state: "x".repeat(22) });
    expect(getPendingDesktopAuth()?.state).toBe("x".repeat(22));
  });

  describe("isMatchingState", () => {
    it("accepts exact match", () => {
      setPendingDesktopAuth(sample);
      expect(isMatchingState(sample.state)).toBe(true);
    });

    it("rejects mismatch", () => {
      setPendingDesktopAuth(sample);
      expect(isMatchingState("0".repeat(22))).toBe(false);
    });

    it("rejects when nothing is pending", () => {
      expect(isMatchingState(sample.state)).toBe(false);
    });

    it("rejects different-length state (defends against truncation)", () => {
      setPendingDesktopAuth(sample);
      expect(isMatchingState(sample.state.slice(0, 10))).toBe(false);
    });
  });

  describe("TTL expiry", () => {
    it("expires after PENDING_DESKTOP_AUTH_TTL_MS", () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      setPendingDesktopAuth(sample);
      expect(getPendingDesktopAuth()).not.toBeNull();

      // Advance to 1ms before expiry: still valid.
      vi.setSystemTime(now + PENDING_DESKTOP_AUTH_TTL_MS - 1);
      expect(getPendingDesktopAuth()).not.toBeNull();

      // Advance to expiry: null.
      vi.setSystemTime(now + PENDING_DESKTOP_AUTH_TTL_MS + 1);
      expect(getPendingDesktopAuth()).toBeNull();
      expect(isMatchingState(sample.state)).toBe(false);
    });
  });
});
