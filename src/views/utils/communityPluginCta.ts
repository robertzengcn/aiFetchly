import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

/**
 * Pure CTA-decision helpers for the Community Plugins page.
 *
 * Extracted from the page component so the 6-outcome affordance matrix and
 * the auth-shaped error matching are unit-testable without mounting the
 * component. The desktop renders the Hub's per-row access decision only —
 * it never re-derives tier (Community Plugin Page PRD §7.7).
 */

export type CommunityCardCta =
  | "install"
  | "installed"
  | "preview"
  | "upgrade"
  | "signin"
  | "none";

/** CTA matrix — driven entirely by the Hub's access decision. */
export function ctaFor(entry: PluginCommunityEntry): CommunityCardCta {
  switch (entry.access.status) {
    case "allowed":
      if (entry.access.installMode === "direct") {
        return entry.installed ? "installed" : "install";
      }
      return "preview"; // allowed + ticket: preview-only in Stage 1
    case "subscription_required":
      return "upgrade";
    case "login_required":
      return "signin";
    default:
      return "none"; // forbidden / unavailable — greyed out
  }
}

/** forbidden/unavailable rows render greyed out with no action. */
export function entryUnavailable(entry: PluginCommunityEntry): boolean {
  return (
    entry.access.status === "forbidden" ||
    entry.access.status === "unavailable"
  );
}

/**
 * Auth-shaped failures get the dedicated "Sign in again" affordance.
 * Matches the phrasings HttpClient throws ("Authentication failed after
 * token refresh retry (HTTP 401/403)", "Token refresh failed", "refresh
 * token unavailable") — keep in sync with src/modules/lib/httpclient.ts.
 */
export function isSessionExpiredMessage(message: string | null): boolean {
  const msg = (message ?? "").toLowerCase();
  return (
    msg.includes("authentication failed") ||
    msg.includes("token refresh") ||
    msg.includes("refresh token") ||
    msg.includes("http 401")
  );
}
