import { log } from "@/modules/Logger";

/**
 * Renderer navigation security.
 *
 * Threat: without a `will-navigate` guard, the renderer can navigate to an
 * attacker-controlled origin. Because the privileged preload is injected by
 * origin-agnostic window config, `window.api` would be re-exposed on the
 * attacker page. We block any navigation/redirect whose target is not a
 * first-party origin.
 *
 * See docs/prd/architecture-remediation-prd.md WS-1 R1.2.
 */

export interface TrustedNavigationOptions {
  /** First-party origins allowed to navigate (e.g. the Vite dev-server origin). */
  trustedOrigins?: readonly string[];
  /** First-party protocols beyond the built-ins (e.g. "aifetchly:"). */
  trustedProtocols?: readonly string[];
}

/** Protocols that are always first-party (production assets + Electron internals). */
const BUILTIN_TRUSTED_PROTOCOLS: ReadonlySet<string> = new Set([
  "file:",
  "about:",
]);

/**
 * Pure decision: is `url` a trusted first-party navigation target?
 *
 * Returns false for malformed URLs, external origins, and known XSS vectors
 * (`data:`, `javascript:`). The protocol is lowercased by the URL parser, so
 * callers should pass lowercased entries in `trustedProtocols`.
 */
export function isTrustedNavigation(
  url: string,
  options: TrustedNavigationOptions = {}
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (BUILTIN_TRUSTED_PROTOCOLS.has(parsed.protocol)) return true;
  if (options.trustedProtocols?.includes(parsed.protocol)) return true;
  if (options.trustedOrigins?.includes(parsed.origin)) return true;
  return false;
}

/**
 * Build the `will-navigate`/`will-redirect` listener that blocks untrusted
 * targets. Returned so the pure decision is independently unit-tested.
 */
export function createNavigationGuardHandler(
  options: TrustedNavigationOptions = {}
): (event: { preventDefault: () => void }, url: string) => void {
  return (event, url) => {
    if (!isTrustedNavigation(url, options)) {
      log.warn(`[security] blocked navigation to ${url}`);
      event.preventDefault();
    }
  };
}
