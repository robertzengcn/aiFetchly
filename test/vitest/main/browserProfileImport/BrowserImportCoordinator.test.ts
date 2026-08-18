import { describe, it, expect } from "vitest";
import {
  BrowserImportCoordinator,
  type NativeHostTransport,
} from "@/main-process/browserProfileImport/BrowserImportCoordinator";
import { ImportRequestRegistry } from "@/main-process/browserProfileImport/ImportRequestRegistry";
import type { AccountSessionService } from "@/modules/AccountSessionService";
import type { PersistSnapshotOutcome } from "@/modules/AccountSessionService";
import { CookieServiceError } from "@/modules/AccountSessionService";

type CapturingTransport = NativeHostTransport & { announced: unknown[] };

function capturingTransport(): CapturingTransport {
  const t: CapturingTransport = {
    announced: [],
    async announceRequest(req) {
      t.announced.push(req);
    },
  };
  return t;
}

function serviceStub(
  persist: (input: {
    cookies: unknown[];
  }) => PersistSnapshotOutcome | Promise<PersistSnapshotOutcome>
): AccountSessionService {
  return {
    async getOrCreatePartition() {
      return "persist:social-account-1";
    },
    async persistSnapshot(input: { cookies: unknown[] }) {
      return persist(input);
    },
  } as unknown as AccountSessionService;
}

function makeCoordinator(
  opts: {
    enabled?: boolean;
    platformId?: number | undefined;
    service?: AccountSessionService;
    persist?: PersistSnapshotOutcome;
  } = {}
) {
  const transport = capturingTransport();
  const defaultOutcome: PersistSnapshotOutcome = {
    importedCookieCount: 2,
    rejectedCounts: {
      outside_allowed_domains: 0,
      expired: 0,
      malformed: 0,
      duplicate: 0,
      oversize: 0,
      invalid_samesite: 0,
    },
  };
  const service =
    opts.service ?? serviceStub(() => opts.persist ?? defaultOutcome);
  // Treat platformId as "explicitly undefined" only when the key is present;
  // absence defaults to youtube (2).
  const platformId = Object.prototype.hasOwnProperty.call(opts, "platformId")
    ? opts.platformId
    : 2;
  const coordinator = new BrowserImportCoordinator({
    registry: new ImportRequestRegistry(),
    service,
    transport,
    enabled: () => opts.enabled ?? true,
    platformResolver: async () => platformId,
  });
  return { coordinator, transport };
}

describe("BrowserImportCoordinator.availability", () => {
  it("reports feature_disabled when the flag is off", async () => {
    const { coordinator } = makeCoordinator({ enabled: false });
    const avail = await coordinator.availability(1);
    expect(avail.enabled).toBe(false);
    expect(avail.reason).toBe("feature_disabled");
  });

  it("reports enabled with approved domains for an import-enabled platform", async () => {
    const { coordinator } = makeCoordinator({ enabled: true, platformId: 2 });
    const avail = await coordinator.availability(1);
    expect(avail.enabled).toBe(true);
    expect(avail.platformId).toBe(2);
    expect(avail.approvedDomains).toEqual([
      "youtube.com",
      "google.com",
      "accounts.google.com",
    ]);
    expect(avail.verificationUrl).toBeDefined();
  });

  it("reports platform_unsupported for a platform whose manifest disables import", async () => {
    const { coordinator } = makeCoordinator({ enabled: true, platformId: 3 }); // bilibili
    const avail = await coordinator.availability(1);
    expect(avail.enabled).toBe(false);
    expect(avail.reason).toBe("platform_unsupported");
  });

  it("reports account_not_found when the platform cannot be resolved", async () => {
    const { coordinator } = makeCoordinator({
      enabled: true,
      platformId: undefined,
    });
    const avail = await coordinator.availability(1);
    expect(avail.enabled).toBe(false);
    expect(avail.reason).toBe("account_not_found");
  });
});

describe("BrowserImportCoordinator.startPairing + cancel", () => {
  it("creates a request, announces to the native host, and returns pairing info", async () => {
    const { coordinator, transport } = makeCoordinator({
      enabled: true,
      platformId: 2,
    });
    const info = await coordinator.startPairing(1);
    expect(info.requestId.length).toBeGreaterThan(0);
    expect(info.approvedDomains).toContain("youtube.com");
    expect(info.verificationUrl).toBeDefined();
    expect(transport.announced).toHaveLength(1);
    expect((transport.announced[0] as { platformId: number }).platformId).toBe(
      2
    );
  });

  it("throws when the feature is disabled", async () => {
    const { coordinator } = makeCoordinator({ enabled: false });
    await expect(coordinator.startPairing(1)).rejects.toThrow();
  });

  it("cancel removes the pending request", async () => {
    const { coordinator } = makeCoordinator({ enabled: true, platformId: 2 });
    const info = await coordinator.startPairing(1);
    expect(await coordinator.cancel(info.requestId)).toBe(true);
    expect(await coordinator.cancel(info.requestId)).toBe(false);
  });
});

describe("BrowserImportCoordinator.receiveImportResult", () => {
  const buildResult = (requestId: string, requestSecret: string) => ({
    version: 1,
    type: "import_result" as const,
    requestId,
    requestSecret,
    cookies: [
      {
        domain: ".youtube.com",
        name: "SID",
        value: "secret-value",
        secure: true,
        path: "/",
        sameSite: "lax",
        expirationDate: 4_000_000_000,
      },
    ],
    extensionVersion: "1.0.0",
  });

  it("consumes a valid result and returns success with counts (no cookie values)", async () => {
    const { coordinator, transport } = makeCoordinator({
      enabled: true,
      platformId: 2,
    });
    const info = await coordinator.startPairing(1);
    const secret = (transport.announced[0] as { requestSecret: string })
      .requestSecret;
    const result = await coordinator.receiveImportResult(
      buildResult(info.requestId, secret)
    );
    expect(result.state).toBe("success");
    expect(result.importedCookieCount).toBe(2);
    if (result.state === "success" || result.state === "partial_success") {
      expect(result.verificationUrl).toBeDefined();
    }
    // The result must never carry cookie values.
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("reports partial_success when some cookies are rejected", async () => {
    const { coordinator, transport } = makeCoordinator({
      enabled: true,
      platformId: 2,
      persist: {
        importedCookieCount: 1,
        rejectedCounts: {
          outside_allowed_domains: 2,
          expired: 0,
          malformed: 0,
          duplicate: 0,
          oversize: 0,
          invalid_samesite: 0,
        },
      },
    });
    const info = await coordinator.startPairing(1);
    const secret = (transport.announced[0] as { requestSecret: string })
      .requestSecret;
    const result = await coordinator.receiveImportResult(
      buildResult(info.requestId, secret)
    );
    expect(result.state).toBe("partial_success");
  });

  it("returns request_expired for an unknown request", async () => {
    const { coordinator } = makeCoordinator({ enabled: true, platformId: 2 });
    const result = await coordinator.receiveImportResult(
      buildResult("does-not-exist", "bogus-secret-0123")
    );
    expect(result.state).toBe("request_expired");
    expect(result.importedCookieCount).toBe(0);
  });

  it("maps a KEY_UNAVAILABLE service error to key_unavailable", async () => {
    const failing = serviceStub(() => {
      throw new CookieServiceError("KEY_UNAVAILABLE");
    });
    const { coordinator, transport } = makeCoordinator({
      enabled: true,
      platformId: 2,
      service: failing,
    });
    const info = await coordinator.startPairing(1);
    const secret = (transport.announced[0] as { requestSecret: string })
      .requestSecret;
    const result = await coordinator.receiveImportResult(
      buildResult(info.requestId, secret)
    );
    expect(result.state).toBe("key_unavailable");
  });

  it("maps NO_ALLOWED_COOKIES to no_eligible_cookies", async () => {
    const failing = serviceStub(() => {
      throw new CookieServiceError("NO_ALLOWED_COOKIES");
    });
    const { coordinator, transport } = makeCoordinator({
      enabled: true,
      platformId: 2,
      service: failing,
    });
    const info = await coordinator.startPairing(1);
    const secret = (transport.announced[0] as { requestSecret: string })
      .requestSecret;
    const result = await coordinator.receiveImportResult(
      buildResult(info.requestId, secret)
    );
    expect(result.state).toBe("no_eligible_cookies");
    expect(result.importedCookieCount).toBe(0);
  });

  it("maps a generic persistence error to storage_failed", async () => {
    const failing = serviceStub(() => {
      throw new Error("disk full");
    });
    const { coordinator, transport } = makeCoordinator({
      enabled: true,
      platformId: 2,
      service: failing,
    });
    const info = await coordinator.startPairing(1);
    const secret = (transport.announced[0] as { requestSecret: string })
      .requestSecret;
    const result = await coordinator.receiveImportResult(
      buildResult(info.requestId, secret)
    );
    expect(result.state).toBe("storage_failed");
  });

  it("rejects a malformed wire payload (throws)", async () => {
    const { coordinator } = makeCoordinator({ enabled: true, platformId: 2 });
    await expect(
      coordinator.receiveImportResult({ type: "nope" })
    ).rejects.toThrow();
  });
});
