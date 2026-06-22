/**
 * Secret redaction for plugin source URIs and error messages.
 * Source of truth: Spec §9 (security requirements, item 9).
 *
 * These helpers strip credentials that may leak via git/npm/HTTP error
 * messages, redirect URLs, and basic-auth userinfo. They never aim to be a
 * general-purpose logger — they are applied at the boundary where fetcher
 * errors reach the renderer or the diagnostics bundle.
 */

const QUERY_TOKEN_RE = /([?&][^=?&]+=)([^&]*)/g;
const BASIC_AUTH_RE = /:\/\/[^/@:]+:[^/@]+@/g;
const AUTH_TOKEN_RE = /(_authToken\s*=\s*)([^\s,;]+)/g;
const BEARER_RE = /(Authorization:\s*Bearer\s+)([^\s,;]+)/g;

export function redactUri(uri: string): string {
  let out = uri.replace(BASIC_AUTH_RE, "://[redacted]@");
  out = out.replace(QUERY_TOKEN_RE, "$1[redacted]");
  return out;
}

export function redactMessage(message: string): string {
  let out = message.replace(BASIC_AUTH_RE, "://[redacted]@");
  out = out.replace(QUERY_TOKEN_RE, "$1[redacted]");
  out = out.replace(AUTH_TOKEN_RE, "$1[redacted]");
  out = out.replace(BEARER_RE, "$1[redacted]");
  return out;
}
