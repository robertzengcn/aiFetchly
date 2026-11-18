/**
 * Native decision transport (B03/D-FR-02–04; design §§5.2–5.4/9.3).
 *
 * The generic HttpClient is HOSTED-bound: its URL builder prepends the
 * hosted base and its headers carry hosted authentication state — a
 * native profile sent through it lands on the WRONG destination with the
 * WRONG credential. This transport posts to the EXACT validated profile
 * endpoint with ONLY the explicitly selected credential:
 *   - apiKeyRef "chat"  → the user's chat provider credential (Bearer);
 *   - apiKeyRef "none"  → the client refuses at construction (N01) and
 *     never reaches transport.
 * No hosted cookies/tokens/headers ever ride a native request, and the
 * endpoint must be an absolute HTTPS URL (HTTP is refused — the native
 * route carries credentials).
 */

export class NativeEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeEndpointError";
  }
}

/** Validate the native endpoint: absolute HTTPS, non-empty path allowed. */
export function validateNativeEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new NativeEndpointError("native_endpoint_invalid");
  }
  if (url.protocol !== "https:") {
    throw new NativeEndpointError("native_endpoint_insecure");
  }
  if (!url.hostname || url.hostname === "") {
    throw new NativeEndpointError("native_endpoint_invalid");
  }
  return url;
}

/**
 * POST the typed decision question to the EXACT native endpoint. The
 * credential is passed explicitly by the caller (the route bundle), never
 * resolved inside the transport from hosted state.
 */
export async function postNativeDecision(
  endpoint: string,
  body: unknown,
  credential: { readonly apiKey: string | null },
  signal: AbortSignal
): Promise<unknown> {
  const url = validateNativeEndpoint(endpoint);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (credential.apiKey) {
    headers.Authorization = `Bearer ${credential.apiKey}`;
  }
  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
    // N05/D-AC-11: redirects are REFUSED — the initial HTTPS validation
    // must hold for the FINAL destination too; a redirect could otherwise
    // carry the credential to a different origin.
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("native_request_failed_redirect");
  }
  if (!response.ok) {
    // The status surfaces as a typed reason upstream (native 401/403/404).
    throw new Error(`native_request_failed_${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("native_request_invalid_json");
  }
}
