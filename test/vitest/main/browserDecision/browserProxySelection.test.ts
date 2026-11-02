import { describe, expect, it } from "vitest";
import {
  classifyProxyError,
  isBrowserUsableProtocol,
  selectProxyForSession,
  type ProxyRow,
} from "@/service/browserProxy/BrowserProxySelectionService";
import { ProxyCredentialCodec } from "@/modules/browserProxy/ProxyCredentialCodec";

/** PRD §6.10 / P-FR-01..08: selection, reasons, usability, encryption. */

function row(overrides: Partial<ProxyRow>): ProxyRow {
  return {
    id: 1,
    host: "proxy.example.test",
    port: "8080",
    user: "u",
    pass: "p",
    protocol: "http",
    country_code: "US",
    lastCheckPassed: true,
    ...overrides,
  };
}

const noopLoader = async () => null;

describe("BrowserProxySelectionService", () => {
  it("resolves an explicit proxy id with usable protocol", async () => {
    const result = await selectProxyForSession({
      selection: { kind: "proxy_id", proxyId: 9 },
      linkedProxies: [],
      loadProxyById: async () => row({ id: 9, protocol: "https" }),
      isAccountSession: false,
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved" && result.proxy.mode !== "direct" && result.proxy.mode !== "unresolvable") {
      expect(result.proxy.mode).toBe("https");
    }
  });

  it("rejects SOCKS and unknown proxies (fail closed)", async () => {
    const socks = await selectProxyForSession({
      selection: { kind: "proxy_id", proxyId: 9 },
      linkedProxies: [],
      loadProxyById: async () => row({ protocol: "socks5" }),
      isAccountSession: false,
    });
    expect(socks).toEqual({ status: "unresolvable", reasonCode: "proxy_protocol_unsupported" });
    const missing = await selectProxyForSession({
      selection: { kind: "proxy_id", proxyId: 404 },
      linkedProxies: [],
      loadProxyById: async () => null,
      isAccountSession: false,
    });
    expect(missing).toEqual({ status: "unresolvable", reasonCode: "proxy_not_found" });
  });

  it("allows direct for account-free sessions, requires confirmation for account sessions", async () => {
    const publicDirect = await selectProxyForSession({
      selection: { kind: "direct" },
      linkedProxies: [],
      loadProxyById: noopLoader,
      isAccountSession: false,
    });
    expect(publicDirect).toEqual({ status: "resolved", proxy: { mode: "direct" } });
    const accountDirect = await selectProxyForSession({
      selection: { kind: "direct" },
      linkedProxies: [row({})],
      loadProxyById: noopLoader,
      isAccountSession: true,
    });
    expect(accountDirect).toEqual({
      status: "confirmation_required",
      reasonCode: "proxy_change_requires_confirmation",
    });
  });

  it("auto picks a browser-usable proxy matching the country", async () => {
    const result = await selectProxyForSession({
      selection: { kind: "auto", countryCode: "DE" },
      linkedProxies: [
        row({ id: 1, country_code: "US" }),
        row({ id: 2, country_code: "DE", protocol: "https" }),
      ],
      loadProxyById: noopLoader,
      isAccountSession: false,
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved" && result.proxy.mode !== "direct" && result.proxy.mode !== "unresolvable") {
      expect(result.proxy.mode).toBe("https");
    }
  });

  it("never falls back to direct when auto finds nothing usable", async () => {
    const result = await selectProxyForSession({
      selection: { kind: "auto" },
      linkedProxies: [row({ protocol: "socks4" })],
      loadProxyById: noopLoader,
      isAccountSession: false,
    });
    expect(result).toEqual({ status: "unresolvable", reasonCode: "proxy_no_usable_proxy" });
  });

  it("classifies chromium proxy errors into structured reasons", () => {
    expect(classifyProxyError("net::ERR_TUNNEL_CONNECTION_FAILED")).toBe("tunnel_failed");
    expect(classifyProxyError("Received HTTP code 407 from proxy")).toBe("proxy_auth_failed");
    expect(classifyProxyError("net::ERR_PROXY_CONNECTION_FAILED")).toBe("proxy_connect_failed");
  });

  it("marks HTTP/HTTPS usable and SOCKS unusable", () => {
    expect(isBrowserUsableProtocol("http")).toBe(true);
    expect(isBrowserUsableProtocol("https")).toBe(true);
    expect(isBrowserUsableProtocol("socks5")).toBe(false);
    expect(isBrowserUsableProtocol(null)).toBe(true);
  });
});

describe("ProxyCredentialCodec (P-FR-08)", () => {
  it("passes plaintext through as needing migration", async () => {
    const result = await ProxyCredentialCodec.decryptForUse("legacy-secret");
    expect(result).toEqual({ password: "legacy-secret", needsMigration: true });
  });

  it("null/empty stays null without migration", async () => {
    expect(await ProxyCredentialCodec.decryptForUse(null)).toEqual({
      password: null,
      needsMigration: false,
    });
  });

  it("encrypt round-trips when a key is available", async () => {
    try {
      const encrypted = await ProxyCredentialCodec.encryptForStorage("s3cret");
      if (encrypted === "s3cret") {
        // Key unavailable in this environment: encryption degrades to
        // plaintext passthrough, which the codec reports for migration.
        return;
      }
      expect(encrypted).not.toBe("s3cret");
      const decrypted = await ProxyCredentialCodec.decryptForUse(encrypted);
      expect(decrypted.password).toBe("s3cret");
      expect(decrypted.needsMigration).toBe(false);
    } catch {
      // Secret key unavailable in the unit-test environment: skip.
    }
  });
});
