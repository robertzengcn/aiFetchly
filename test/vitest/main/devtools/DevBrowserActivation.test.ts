"use strict";
import { describe, expect, it } from "vitest";
import {
  resolveDevBrowserActivation,
  LOOPBACK_HOSTS,
} from "@/main-process/devtools/DevBrowserActivation";

const BASE_ENV = {
  AIFETCHLY_DEV_BROWSER_BRIDGE: "1",
  AIFETCHLY_DEV_BROWSER_BRIDGE_HOST: "127.0.0.1",
  AIFETCHLY_DEV_BROWSER_BRIDGE_PORT: "37621",
};

const DEV_SERVER_URL = "http://localhost:5173/";

describe("resolveDevBrowserActivation — dev-only gate", () => {
  it("is disabled when app is packaged even if env flag is present (FR-1.2)", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: true,
      env: { ...BASE_ENV },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/packag/i);
  });

  it("is disabled when env flag is absent (FR-1.1)", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: {},
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/flag|env|disabled/i);
  });

  it("is disabled when env flag is present but not '1'", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { AIFETCHLY_DEV_BROWSER_BRIDGE: "0" },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(false);
  });

  it("is enabled in dev when flag is '1' and host is loopback", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { ...BASE_ENV },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config?.host).toBe("127.0.0.1");
    expect(result.config?.port).toBe(37621);
  });
});

describe("resolveDevBrowserActivation — loopback binding (FR-1.3, NFR-1)", () => {
  it("accepts 127.0.0.1 and localhost", () => {
    for (const host of LOOPBACK_HOSTS) {
      const result = resolveDevBrowserActivation({
        isPackaged: false,
        env: { ...BASE_ENV, AIFETCHLY_DEV_BROWSER_BRIDGE_HOST: host },
        devServerUrl: DEV_SERVER_URL,
      });
      expect(result.enabled, `host ${host} should be enabled`).toBe(true);
    }
  });

  it("rejects non-loopback hosts even in dev with the flag", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { ...BASE_ENV, AIFETCHLY_DEV_BROWSER_BRIDGE_HOST: "0.0.0.0" },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/loopback|host/i);
  });

  it("rejects an external network interface host", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { ...BASE_ENV, AIFETCHLY_DEV_BROWSER_BRIDGE_HOST: "192.168.1.5" },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(false);
  });
});

describe("resolveDevBrowserActivation — allowed origin derivation", () => {
  it("derives allowed origin from the Vite dev server URL when not overridden", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { ...BASE_ENV },
      devServerUrl: "http://localhost:5173/some/path",
    });
    expect(result.enabled).toBe(true);
    expect(result.config?.allowedOrigin).toBe("http://localhost:5173");
  });

  it("prefers an explicit allowed-origin env override", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: {
        ...BASE_ENV,
        AIFETCHLY_DEV_BROWSER_BRIDGE_ALLOWED_ORIGIN: "http://127.0.0.1:5173",
      },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(true);
    expect(result.config?.allowedOrigin).toBe("http://127.0.0.1:5173");
  });

  it("is disabled when no origin can be derived (no dev server URL, no override)", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { ...BASE_ENV },
      devServerUrl: undefined,
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toMatch(/origin/i);
  });
});

describe("resolveDevBrowserActivation — port handling", () => {
  it("falls back to the default port when env port is invalid", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { ...BASE_ENV, AIFETCHLY_DEV_BROWSER_BRIDGE_PORT: "not-a-number" },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(true);
    expect(result.config?.port).toBe(37621);
  });

  it("falls back to the default port when env port is out of range", () => {
    const result = resolveDevBrowserActivation({
      isPackaged: false,
      env: { ...BASE_ENV, AIFETCHLY_DEV_BROWSER_BRIDGE_PORT: "99999" },
      devServerUrl: DEV_SERVER_URL,
    });
    expect(result.enabled).toBe(true);
    expect(result.config?.port).toBe(37621);
  });
});
