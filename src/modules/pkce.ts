/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) helpers for the desktop auth
 * handoff.
 *
 * The desktop app generates a high-entropy `code_verifier`, derives a
 * `code_challenge` via base64url(SHA-256(verifier)), and sends only the
 * challenge to the web app at the start of the flow. The web app mints an
 * authorization code bound to that challenge. When the desktop app redeems
 * the code at POST /api/desktop-auth/exchange it presents the original
 * verifier, which the backend hashes and compares — proving possession of
 * the verifier and defeating any interception of the authorization code
 * in transit.
 *
 * The verifier MUST be >= 43 chars and <= 128 chars of the base64url
 * alphabet (RFC 7636 §4.1). We generate 32 random bytes → 43 base64url
 * chars, the minimum acceptable length.
 *
 * `state` is an opaque anti-CSRF token. We use 16 random bytes (>= 128 bits)
 * base64url-encoded (22 chars unpadded).
 *
 * Crypto uses Node's `crypto` module (available in Electron main process).
 * Pure, no side effects, safe to unit test.
 */

import { randomBytes, createHash } from "crypto";

/** base64url WITHOUT padding, per RFC 7636 / RFC 4648 §5. */
export function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Generates a 32-byte-random PKCE code_verifier, base64url-encoded (43 chars,
 * no padding). This is the minimum acceptable verifier length per RFC 7636
 * and the exact length the web validator expects.
 *
 * @returns base64url-encoded verifier (43 chars, base64url alphabet only)
 */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/**
 * Derives the S256 code_challenge from a verifier:
 *
 *     code_challenge = base64url( SHA256( code_verifier ) )
 *
 * The challenge travels to the web app (and ultimately the backend) and
 * is stored alongside the authorization code. At exchange time the
 * backend recomputes this from the presented verifier and compares.
 *
 * @param verifier - base64url verifier produced by generateCodeVerifier()
 * @returns base64url S256 challenge (43 chars)
 */
export function deriveCodeChallenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

/**
 * Generates the opaque `state` value used for CSRF protection. The value
 * is generated locally, stored in pendingDesktopAuth, and compared on
 * callback. Any mismatch ⇒ the callback is rejected.
 *
 * 16 random bytes → 22 base64url chars (>= 128 bits of entropy).
 *
 * @returns base64url state token (22 chars)
 */
export function generateState(): string {
  return base64url(randomBytes(16));
}
