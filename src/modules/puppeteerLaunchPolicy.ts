import type { LaunchOptions, ScreenshotOptions } from "puppeteer";

/**
 * Puppeteer CDP budget when `protocolTimeout` is omitted.
 * See puppeteer-core Connection: `timeout ?? 180_000`.
 */
export const PUPPETEER_DEFAULT_PROTOCOL_TIMEOUT_MS = 180_000;

/**
 * Contact extraction runs `Runtime.callFunctionOn` and `Page.captureScreenshot`
 * against large marketing pages. The default 180s budget is what surfaces as
 * `ProtocolError: ... timed out` on slower Windows machines.
 */
export const CONTACT_EXTRACTION_PROTOCOL_TIMEOUT_MS = 300_000;

const RENDERING_BLOCKER_ARGS: ReadonlySet<string> = new Set([
  "--disable-gpu",
  "--disable-software-rasterizer",
]);

/**
 * Headless Chrome cannot paint when the GPU is disabled and the software
 * rasterizer / Viz compositor are also disabled. `Page.captureScreenshot`
 * then waits until `protocolTimeout`.
 */
export function omitHeadlessRenderingBlockers(
  args: readonly string[]
): string[] {
  const kept: string[] = [];
  for (const arg of args) {
    if (RENDERING_BLOCKER_ARGS.has(arg)) {
      continue;
    }
    if (
      arg.startsWith("--disable-features=") &&
      arg.includes("VizDisplayCompositor")
    ) {
      const features = arg
        .slice("--disable-features=".length)
        .split(",")
        .map((feature) => feature.trim())
        .filter(
          (feature) =>
            feature.length > 0 && feature !== "VizDisplayCompositor"
        );
      if (features.length > 0) {
        kept.push(`--disable-features=${features.join(",")}`);
      }
      continue;
    }
    kept.push(arg);
  }
  return kept;
}

export function finalizePuppeteerLaunchOptions(
  base: LaunchOptions,
  custom?: LaunchOptions
): LaunchOptions {
  const merged: LaunchOptions = {
    ...base,
    ...custom,
    args: [...(base.args ?? []), ...(custom?.args ?? [])],
  };
  if (merged.headless !== false && merged.args) {
    merged.args = omitHeadlessRenderingBlockers(merged.args);
  }
  return merged;
}

/** Viewport JPEG encodes faster than a full-page PNG and stays within CDP time. */
export function contactViewportScreenshotOptions(): ScreenshotOptions & {
  encoding: "base64";
} {
  return {
    encoding: "base64",
    type: "jpeg",
    quality: 55,
    fullPage: false,
    captureBeyondViewport: false,
    optimizeForSpeed: true,
  };
}
