/**
 * Regression for CI run #529 "Lint and unit tests" failure:
 *
 *   EnvironmentTeardownError: Cannot load
 *   '/node_modules/electron-store/index.js' imported from
 *   src/modules/electronstoreservice.ts after the environment was torn down.
 *   ❯ HttpClient.setheaderToken src/modules/lib/httpclient.ts
 *
 * HttpClient's constructor calls `void this.setheaderToken()` (fire-and-forget)
 * and setheaderToken() lazily `await import("@/modules/token")`, which
 * transitively loads electronstoreservice → electron-store. When a mocked or
 * still-in-flight request outlives its test file, that dynamic import rejects
 * after Vitest tore down the environment, producing an unhandled rejection
 * that failed the whole run. setheaderToken() must treat a teardown-induced
 * module-load failure as "no token" (the Authorization header is best-effort)
 * instead of crashing.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getName: vi.fn(() => "aiFetchly"),
    getPath: vi.fn(() => "/tmp/test"),
  },
  BrowserWindow: vi.fn(),
}));

import { HttpClient } from "@/modules/lib/httpclient";

// Access the private-static classifier under test (TypeScript private is
// compile-time only). Keeps the production guard honest without simulating a
// real Vitest teardown (which a vi.mock factory cannot do cleanly).
type TeardownClassifier = {
  isModuleTeardownError: (error: unknown) => boolean;
};
const classifier = HttpClient as unknown as TeardownClassifier;

describe("HttpClient.setheaderToken teardown resilience", () => {
  it("classifies Vitest EnvironmentTeardownError by name", () => {
    const err = new Error(
      "Cannot load '/node_modules/electron-store/index.js' imported from " +
        "src/modules/electronstoreservice.ts after the environment was torn down."
    );
    err.name = "EnvironmentTeardownError";
    expect(classifier.isModuleTeardownError(err)).toBe(true);
  });

  it("classifies teardown by message even without the error name", () => {
    const err = new Error(
      "Cannot load '/node_modules/electron-store/index.js' imported from " +
        "src/modules/token.ts after the environment was torn down."
    );
    expect(classifier.isModuleTeardownError(err)).toBe(true);
  });

  it("does not swallow unrelated module-resolution failures", () => {
    expect(
      classifier.isModuleTeardownError(
        new Error("Cannot find module '@/modules/token'")
      )
    ).toBe(false);
    expect(classifier.isModuleTeardownError(new Error("boom"))).toBe(false);
    expect(classifier.isModuleTeardownError("not-an-error")).toBe(false);
  });

  it("setheaderToken resolves (no unhandled rejection) for the default client", async () => {
    // With electron mocked and no token module override, the lazy import
    // resolves to the real Token (backed by the mocked electron-store). The
    // method must resolve without throwing regardless of token presence.
    const client = new HttpClient();
    await expect(client.setheaderToken()).resolves.toBeUndefined();
  });
});
