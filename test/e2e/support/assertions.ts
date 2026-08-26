/**
 * Teardown assertions shared across Electron E2E specs (design §16).
 *
 * Centralizes the "no unexpected renderer pageerror, no network violation"
 * checks. Each spec may register a per-test allowlist of expected error
 * substrings for the specific scenario (e.g. an AI transport failure test
 * expects a recoverable error in the renderer console).
 */

import * as fs from "fs";
import { expect } from "@playwright/test";
import type { LaunchedApp } from "../fixtures/electronApp";

export interface TeardownOptions {
  /** Substrings of renderer pageerror messages that are expected for this test. */
  readonly expectedErrorSubstrings?: readonly string[];
  /**
   * External origins the renderer attempts to reach at startup (e.g. the Roboto
   * font CDN). These are still aborted by the route guard (no actual external
   * contact — isolation preserved) but are not treated as violations.
   */
  readonly expectedExternalOrigins?: readonly string[];
}

/** Known external origins the app always reaches at startup (aborted in E2E). */
export const EXPECTED_STARTUP_EXTERNAL_ORIGINS: readonly string[] = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  // Local-AI-runtime catalog manifest poll (main-process fetch at startup).
  // The E2E network guard DENIES it — this is the recorded attempt only.
  "https://github.com",
];

/**
 * Assert no unexpected renderer page errors, no renderer network violations,
 * and no main-process network violations were recorded during the test.
 */
export function assertCleanTeardown(
  app: LaunchedApp,
  options: TeardownOptions = {}
): void {
  const expectedErr = options.expectedErrorSubstrings ?? [];

  const unexpectedPageErrors = app
    .pageErrors()
    .filter((err) => !expectedErr.some((sub) => err.message.includes(sub)));
  expect(
    unexpectedPageErrors,
    `unexpected renderer page errors: ${unexpectedPageErrors
      .map((e) => e.message)
      .join(" | ")}`
  ).toEqual([]);

  // Real external attempts are captured explicitly by the renderer route guard
  // (rendererViolations) and the main-process guard (network-violations.jsonl)
  // below. The route aborts every non-loopback request, so "violations" are
  // attempts, not actual contact — isolation holds regardless. Filter out the
  // known startup CDNs (fonts) the app always polls.
  const expectedExternal = new Set(
    (options.expectedExternalOrigins ?? []).concat(
      EXPECTED_STARTUP_EXTERNAL_ORIGINS
    )
  );
  const unexpectedRendererViolations = app
    .rendererViolations()
    .filter((v) => !expectedExternal.has(v.origin));
  expect(
    unexpectedRendererViolations,
    `renderer attempted disallowed external requests: ${JSON.stringify(
      unexpectedRendererViolations
    )}`
  ).toEqual([]);

  // Main-process network guard violations. Filtered by the SAME expected
  // origin allowlist as the renderer side: known app startup polls (fonts,
  // the local-AI-runtime manifest on github.com) are recorded by the guard
  // — the guard still DENIES them, isolation holds — and must not fail
  // unrelated suites.
  let mainViolations = "";
  try {
    mainViolations = fs.readFileSync(
      app.testRoot.networkViolationsPath,
      "utf8"
    );
  } catch {
    mainViolations = "";
  }
  const unexpectedMainViolations = mainViolations
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      try {
        const parsed = JSON.parse(line) as { origin?: string };
        return !expectedExternal.has(parsed.origin ?? "");
      } catch {
        return true; // unparseable guard lines stay visible
      }
    });
  expect(
    unexpectedMainViolations,
    "main-process network guard recorded violations"
  ).toEqual([]);
}
