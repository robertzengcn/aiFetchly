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
  | {
      readonly kind: "proxy_id";
      readonly proxyId: number;
      /** E10/P-FR-03: the requested country for a geo-change check. */
      readonly countryCode?: string;
    }
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
  // F18/P-FR: validate the endpoint BEFORE launch — a nonempty host and
  // a finite integer port in range; anything else must never reach the
  // browser process as a silent NaN/garbage endpoint.
  const host = (row.host ?? "").trim();
  const port = Number(row.port);
  if (
    host.length === 0 ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return { mode: "unresolvable", reasonCode: "proxy_invalid_endpoint" };
  }
  const decrypted = await ProxyCredentialCodec.decryptForUse(row.pass ?? null);
  if (!decrypted.password && row.pass) {
    return { mode: "unresolvable", reasonCode: "proxy_resolution_failed" };
  }
  return {
    mode: protocol === "https" ? "https" : "http",
    host: row.host,
    port,
    // B08: the authoritative row id — health checks and deterministic
    // restore resolve by id, not by re-running a selector.
    proxyId: row.id,
    // N05/P-FR-06: the country drives locale/timezone alignment.
    ...(row.country_code ? { countryCode: row.country_code } : {}),
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
    const linked = linkedProxies.find((l) => l.id === row.id);
    if (
      isAccountSession &&
      linkedProxies.length > 0 &&
      !linkedProxies.some((l) => l.id === row.id)
    ) {
      return {
        status: "confirmation_required",
        reasonCode: "proxy_change_requires_confirmation",
      };
    }
    // E10/P-FR-03: a LINKED proxy in a DIFFERENT country than the
    // requested one requires user confirmation — a geo change moves the
    // account's exit identity.
    if (
      isAccountSession &&
      linked &&
      selection.kind === "proxy_id" &&
      selection.countryCode != null &&
      linked.country_code != null &&
      linked.country_code.toLowerCase() !==
        selection.countryCode.toLowerCase()
    ) {
      return {
        status: "confirmation_required",
        reasonCode: "proxy_change_requires_confirmation",
      };
    }
    const resolved = await toResolvedProxy(row);
    if (resolved.mode === "unresolvable") {
      // F04/P-FR-04: a proxy with unusable credentials must never become
      // a direct connection — preserve the failure status.
      return { status: "unresolvable", reasonCode: resolved.reasonCode ?? "proxy_resolution_failed" };
    }
    return { status: "resolved", proxy: resolved };
  }

  // auto: browser-usable proxy, preferring the requested country and a
  // recent passing check; fall back to any usable one, never to direct.
  // E07/P-FR-01: when a COUNTRY is requested, the selection is
  // country-strict — no usable row from that country fails the request
  // (proxy_no_usable_proxy) instead of silently launching a proxy in
  // another country. A never-checked row (lastCheckPassed undefined) is
  // treated as UNPROVEN and only used when no checked-passing row exists.
  const usable = linkedProxies.filter((row) => isBrowserUsableProtocol(row.protocol));
  if (usable.length === 0) {
    return { status: "unresolvable", reasonCode: "proxy_no_usable_proxy" };
  }
  const country = selection.countryCode?.toLowerCase();
  const countryScoped = country
    ? usable.filter(
        (row) => (row.country_code ?? "").toLowerCase() === country,
      )
    : usable;
  if (country && countryScoped.length === 0) {
    // E07: a country miss NEVER falls through to another country.
    return { status: "unresolvable", reasonCode: "proxy_no_usable_proxy" };
  }
  const checkedPassing = countryScoped.filter(
    (row) => row.lastCheckPassed === true,
  );
  const notFailed = countryScoped.filter(
    (row) => row.lastCheckPassed === null || row.lastCheckPassed === undefined,
  );
  const passing =
    checkedPassing.length > 0
      ? checkedPassing
      : notFailed.length > 0
        ? notFailed
        : countryScoped;
  const chosen = passing[0];
  if (!chosen) {
    return { status: "unresolvable", reasonCode: "proxy_no_usable_proxy" };
  }
  const resolved = await toResolvedProxy(chosen);
  if (resolved.mode === "unresolvable") {
    // F04/P-FR-04: fail-closed for auto-selected proxies too.
    return { status: "unresolvable", reasonCode: resolved.reasonCode ?? "proxy_resolution_failed" };
  }
  return { status: "resolved", proxy: resolved };
}
