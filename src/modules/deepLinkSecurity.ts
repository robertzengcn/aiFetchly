/**
 * Deep-link URL security validators for the desktop auth handoff.
 *
 * Extracted from background.ts so they can be unit-tested in isolation
 * without booting the full Electron main-process module graph.
 *
 * Under the secure auth handoff the ONLY acceptable deep-link shape is:
 *
 *     <protocolScheme>://auth/callback?code=<code>&state=<state>
 *
 * The legacy shape that carried bearer tokens in the query
 * (`?token=...&refresh_token=...`) is rejected unconditionally — that
 * path is what this refactor eliminates (see
 * docs/custom-protocol-auth-handoff-security-fix.md).
 */

/**
 * Returns true iff `url` contains any of the bearer-token query keys that
 * the legacy insecure handoff used. The new flow only ever carries `code`
 * and `state`; presence of any token key is a hard reject.
 *
 * Matches both snake_case and camelCase variants. Match is anchored to
 * query boundaries (? or &) so values like `?notoken=1` or path segments
 * containing the literal string `token` do NOT trip the check.
 */
export function urlContainsTokenParams(url: string): boolean {
  const tokenPattern =
    /[?&](token|access_token|refresh_token|refreshToken|expiresIn|expires_in|refreshExpiresIn|refresh_expires_in)=/i;
  return tokenPattern.test(url);
}

/**
 * Validate deep link URL origin to prevent malicious token injection.
 *
 * Protocol must match `protocolScheme` exactly (case-insensitive, no
 * trailing colon). Host must be `auth` and pathname must be `/callback`,
 * `/auth/callback`, or `/` (platforms that include the host in the path).
 */
export function isValidDeepLinkOrigin(
  parsedUrl: URL,
  protocolScheme: string
): boolean {
  const urlProtocol = parsedUrl.protocol.toLowerCase().replace(/:$/, "");
  if (urlProtocol !== protocolScheme.toLowerCase()) {
    return false;
  }

  const host = parsedUrl.hostname.toLowerCase();
  const pathname = parsedUrl.pathname.toLowerCase();
  const isCallbackPath =
    (host === "auth" && (pathname === "/callback" || pathname === "/")) ||
    pathname === "/auth/callback";
  if (!isCallbackPath) {
    return false;
  }

  return true;
}

/**
 * Returns true iff the URL's query string contains ONLY `code` and `state`.
 * Any extra query key is treated as suspicious.
 */
export function urlHasOnlyCodeAndState(parsedUrl: URL): boolean {
  const keys = Array.from(parsedUrl.searchParams.keys());
  return (
    keys.length === 2 &&
    keys.includes("code") &&
    keys.includes("state") &&
    !!parsedUrl.searchParams.get("code") &&
    !!parsedUrl.searchParams.get("state")
  );
}
