import { describe, expect, it, vi } from "vitest";
import { selectProxyForSession } from "@/service/browserProxy/BrowserProxySelectionService";

/** E07/P-FR-01: country-strict auto selection; never-checked rows are
 * unproven; a country miss fails instead of launching another country. */

function row(overrides: {
  id: number;
  country_code?: string | null;
  lastCheckPassed?: boolean | null;
  protocol?: string | null;
}) {
  return {
    id: overrides.id,
    host: `p${overrides.id}.test`,
    port: "8080",
    user: null,
    pass: null,
    protocol: overrides.protocol ?? "http",
    country_code: overrides.country_code ?? null,
    lastCheckPassed: overrides.lastCheckPassed ?? null,
  };
}

const noCredentialCodec = () => {
  vi.doMock("@/modules/browserProxy/ProxyCredentialCodec", () => ({
    ProxyCredentialCodec: {
      decryptForUse: async (stored: string | null | undefined) => ({
        password: stored,
        needsMigration: false,
      }),
      encryptForStorage: async (v: string) => v,
    },
  }));
};

describe("selectProxyForSession country-strict auto (E07)", () => {
  it("a country miss is proxy_no_usable_proxy — never another country", async () => {
    noCredentialCodec();
    const { selectProxyForSession: select } = await import(
      "@/service/browserProxy/BrowserProxySelectionService"
    );
    const result = await select({
      selection: { kind: "auto", countryCode: "US" },
      linkedProxies: [row({ id: 1, country_code: "DE" })],
      loadProxyById: async () => null,
      isAccountSession: false,
    });
    expect(result.status).toBe("unresolvable");
    if (result.status === "unresolvable") {
      expect(result.reasonCode).toBe("proxy_no_usable_proxy");
    }
  });

  it("a matching country resolves; a never-checked row is unproven but usable", async () => {
    noCredentialCodec();
    const { selectProxyForSession: select } = await import(
      "@/service/browserProxy/BrowserProxySelectionService"
    );
    const result = await select({
      selection: { kind: "auto", countryCode: "de" },
      linkedProxies: [
        row({ id: 1, country_code: "US", lastCheckPassed: true }),
        row({ id: 2, country_code: "DE", lastCheckPassed: null }),
        row({ id: 3, country_code: "DE", lastCheckPassed: false }),
      ],
      loadProxyById: async () => null,
      isAccountSession: false,
    });
    expect(result.status).toBe("resolved");
    if (
      result.status === "resolved" &&
      result.proxy.mode !== "direct" &&
      result.proxy.mode !== "unresolvable"
    ) {
      expect(result.proxy.host).toBe("p2.test");
    }
  });

  it("a checked-passing row outranks an unproven row in the same country", async () => {
    noCredentialCodec();
    const { selectProxyForSession: select } = await import(
      "@/service/browserProxy/BrowserProxySelectionService"
    );
    const result = await select({
      selection: { kind: "auto", countryCode: "DE" },
      linkedProxies: [
        row({ id: 1, country_code: "DE", lastCheckPassed: null }),
        row({ id: 2, country_code: "DE", lastCheckPassed: true }),
      ],
      loadProxyById: async () => null,
      isAccountSession: false,
    });
    expect(result.status).toBe("resolved");
    if (
      result.status === "resolved" &&
      result.proxy.mode !== "direct" &&
      result.proxy.mode !== "unresolvable"
    ) {
      expect(result.proxy.host).toBe("p2.test");
    }
  });
});
