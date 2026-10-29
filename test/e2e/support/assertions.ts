/**
 * Teardown assertions shared across Electron E2E specs (design §16).
 *
 * Centralizes the "no unexpected renderer pageerror, no network violation"
 * checks. Each spec may register a per-test allowlist of expected error
 * substrings for the specific scenario (e.g. an AI transport failure test
 * expects a recoverable error in the renderer console).
 */

import * as fs from "fs";
import { expect, type Locator, type Page } from "@playwright/test";
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

/**
 * Audit V04: decoded-render assertion. Tile/card counts alone do not
 * establish that an image DECODED — a failed protocol load keeps the wrapper
 * in the DOM while the <img> stays empty. Every <img> matched inside `scope`
 * must finish decoding (non-zero natural dimensions). Images that simply
 * have not STARTED their lazy load yet report complete=false and settle —
 * so this polls rather than asserting instanteously; a genuinely broken
 * load never leaves that state.
 */
export async function assertImagesDecoded(
  scope: Locator,
  options: { minCount?: number; timeout?: number } = {}
): Promise<void> {
  const minCount = options.minCount ?? 0;
  const timeout = options.timeout ?? 15_000;

  const readImages = async (): Promise<{
    total: number;
    broken: Array<{ src: string; complete: boolean; naturalWidth: number }>;
  }> =>
    scope.locator("img").evaluateAll((elements) =>
      elements.map((element) => {
        const img = element as HTMLImageElement;
        return {
          src: img.currentSrc || img.src,
          complete: img.complete,
          naturalWidth: img.naturalWidth,
        };
      })
    );

  const initial = await readImages();
  const brokenInitially = initial.filter(
    (state) => !state.complete || state.naturalWidth === 0
  );
  expect(
    initial.length,
    `expected >=${minCount} <img> elements inside the asserted scope`
  ).toBeGreaterThanOrEqual(minCount);
  if (brokenInitially.length === 0) {
    return;
  }

  try {
    await expect
      .poll(
        async () => {
          const states = await readImages();
          return states.filter(
            (state) => !state.complete || state.naturalWidth === 0
          ).length;
        },
        { timeout, intervals: [250, 500, 1_000] }
      )
      .toBe(0);
  } catch {
    const states = await readImages();
    const broken = states.filter(
      (state) => !state.complete || state.naturalWidth === 0
    );
    throw new Error(
      `images failed to decode within ${timeout}ms: ${JSON.stringify(broken)}`
    );
  }
}

/**
 * Audit V04: icon-font serving assertion. When the dev server blocks the
 * hoisted @mdi/font path the DOM keeps rendering (tofu glyphs) and text-only
 * assertions keep passing. Discover every @font-face src the renderer
 * document actually references for Material Design Icons and fetch it through
 * the real page path (subject to the renderer network guard) — each must
 * return 200.
 */
export async function assertIconFontsServed(page: Page): Promise<void> {
  const fontUrls: string[] = await page.evaluate(() => {
    const urls: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin (dev-only sheet) — skip
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue("font-family");
        if (!family.toLowerCase().includes("material design icons")) continue;
        const src = rule.style.getPropertyValue("src");
        for (const match of src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
          urls.push(
            new URL(match[2], sheet.href ?? window.location.href).href
          );
        }
      }
    }
    return Array.from(new Set(urls));
  });
  expect(
    fontUrls.length,
    "no MDI @font-face src discovered in the renderer document"
  ).toBeGreaterThanOrEqual(1);
  for (const url of fontUrls) {
    const status: number = await page.evaluate(async (fontUrl) => {
      try {
        return (await fetch(fontUrl)).status;
      } catch {
        return -1;
      }
    }, url);
    expect(status, `MDI font request failed: ${url}`).toBe(200);
  }
}
