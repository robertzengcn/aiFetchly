/**
 * Browser proxy selection and switching (PRD §6.10; technical design §16).
 *
 * Selection rules:
 *   - an explicit `proxy_id` picks that proxy (HTTP/HTTPS only; SOCKS stays
 *     rejected) and yields decrypted credentials for the browser launch;
 *   - `"direct"` connects directly (allowed for account-free sessions; an
 *     account session moving off its linked proxy needs user confirmation —
 *     reported as `proxy_confirmation_required`, never silently applied);
 *   - `auto` picks a browser-usable proxy matching the requested country
 *     (fail-closed to unresolvable when none qualifies — never a silent
 *     direct fallback, PRD P-FR-04).
 */
import { ProxyCredentialCodec } from "@/modules/browserProxy/ProxyCredentialCodec";
import type { ResolvedSessionProxy } from "@/modules/ManagedBrowserModule";

export type BrowserProxySelection =
  | { readonly kind: "proxy_id"; readonly proxyId: number }
  | { readonly kind: "auto"; readonly countryCode?: string }
  | { readonly kind: "direct" };

/** Raw proxy row shape the selector consumes (credentials still encrypted). */
export interface ProxyRow {
  readonly id: number;
  readonly host: string;
  readonly port: string;
  readonly user?: string | null;
  readonly pass?: string | null;
  readonly protocol?: string | null;
  readonly country_code?: string | null;
  readonly lastCheckPassed?: boolean | null;
}

/** Chromium error → structured proxy reason (PRD P-FR-04). */
export function classifyProxyError(message: string): string {
  if (/ERR_TUNNEL_CONNECTION_FAILED/i.test(message)) {
    return "tunnel_failed";
  }
  if (/\b407\b|proxy authentication/i.test(message)) {
    return "proxy_auth_failed";
  }
  if (/ERR_PROXY_CONNECTION_FAILED/i.test(message)) {
    return "proxy_connect_failed";
  }
  return "proxy_connect_failed";
}

/** HTTP/HTTPS are browser-usable; SOCKS is rejected (PRD P-FR-07). */
export function isBrowserUsableProtocol(protocol: string | null | undefined): boolean {
  const normalized = (protocol ?? "http").toLowerCase();
  return normalized === "http" || normalized === "https";
}

export interface ProxySelectionInput {
  readonly selection: BrowserProxySelection;
  /** Account-linked proxies (already loaded; empty for account-free). */
  readonly linkedProxies: readonly ProxyRow[];
  /** Loader for any proxy by id (main process only). */
  readonly loadProxyById: (proxyId: number) => Promise<ProxyRow | null>;
  /**
   * Account sessions keep a consistent proxy: moving to a DIFFERENT proxy
   * or to direct requires user confirmation (PRD P-FR-03). The confirmation
   * card is a UI concern; selection reports the requirement fail-closed.
   */
  readonly isAccountSession: boolean;
}

export type ProxySelectionResult =
  | { readonly status: "resolved"; readonly proxy: ResolvedSessionProxy }
  | { readonly status: "unresolvable"; readonly reasonCode: string }
  | { readonly status: "confirmation_required"; readonly reasonCode: string };

async function toResolvedProxy(row: ProxyRow): Promise<ResolvedSessionProxy> {
  const protocol = (row.protocol ?? "http").toLowerCase();
  const port = Number(row.port);
  const decrypted = await ProxyCredentialCodec.decryptForUse(row.pass ?? null);
  if (!decrypted.password && row.pass) {
    return { mode: "unresolvable", reasonCode: "proxy_resolution_failed" };
  }
  return {
    mode: protocol === "https" ? "https" : "http",
    host: row.host,
    port,
    ...(row.user ? { username: row.user } : {}),
    ...(decrypted.password ? { password: decrypted.password } : {}),
  };
}

export async function selectProxyForSession(
  input: ProxySelectionInput
): Promise<ProxySelectionResult> {
  const { selection, linkedProxies, loadProxyById, isAccountSession } = input;

  if (selection.kind === "direct") {
    if (isAccountSession && linkedProxies.length > 0) {
      // P-FR-03: dropping an account's linked proxy needs confirmation.
      return { status: "confirmation_required", reasonCode: "proxy_change_requires_confirmation" };
    }
    return { status: "resolved", proxy: { mode: "direct" } };
  }

  if (selection.kind === "proxy_id") {
    const row = await loadProxyById(selection.proxyId);
    if (!row) {
      return { status: "unresolvable", reasonCode: "proxy_not_found" };
    }
    if (!isBrowserUsableProtocol(row.protocol)) {
      return { status: "unresolvable", reasonCode: "proxy_protocol_unsupported" };
    }
    if (
      isAccountSession &&
      linkedProxies.length > 0 &&
      !linkedProxies.some((linked) => linked.id === row.id)
    ) {
      return {
        status: "confirmation_required",
        reasonCode: "proxy_change_requires_confirmation",
      };
    }
    return { status: "resolved", proxy: await toResolvedProxy(row) };
  }

  // auto: browser-usable proxy, preferring the requested country and a
  // recent passing check; fall back to any usable one, never to direct.
  const usable = linkedProxies.filter((row) => isBrowserUsableProtocol(row.protocol));
  if (usable.length === 0) {
    return { status: "unresolvable", reasonCode: "proxy_no_usable_proxy" };
  }
  const country = selection.countryCode?.toLowerCase();
  const preferred = country
    ? usable.filter(
        (row) => (row.country_code ?? "").toLowerCase() === country,
      )
    : [];
  const passing = (preferred.length > 0 ? preferred : usable).filter(
    (row) => row.lastCheckPassed !== false,
  );
  const chosen = (passing.length > 0 ? passing : preferred.length > 0 ? preferred : usable)[0];
  if (!chosen) {
    return { status: "unresolvable", reasonCode: "proxy_no_usable_proxy" };
  }
  return { status: "resolved", proxy: await toResolvedProxy(chosen) };
}
