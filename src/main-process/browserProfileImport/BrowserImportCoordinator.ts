import {
  ImportRequestRegistry,
  ImportRequestValidationError,
} from "./ImportRequestRegistry";
import {
  AccountSessionService,
  CookieServiceError,
} from "@/modules/AccountSessionService";
import { SocialAccountModule } from "@/modules/socialAccountModule";
import { getPlatformManifest } from "@/modules/PlatformSessionManifest";
import { isBrowserProfileImportEnabled } from "@/config/featureFlags";
import { emptyRejectCounts } from "@/modules/accountSession/cookieNormalize";
import {
  nativeImportResultSchema,
  type NativeImportResult,
} from "@/schemas/nativeMessaging";
import type {
  CookieImportResult,
  RejectCounts,
} from "@/schemas/accountCookies";
import { log } from "@/modules/Logger";

/**
 * Orchestrates the browser-profile import state machine (design §9.3) entirely
 * in the main process. The renderer may query availability and start/cancel
 * pairing, but every trust decision (flag, platform manifest, one-time token,
 * allowlist filtering, encryption) is made here.
 *
 * The native host is a TRANSPORT boundary only; this coordinator re-validates
 * every result before persistence.
 */

export interface BrowserImportAvailability {
  enabled: boolean;
  platformId?: number;
  platformName?: string;
  approvedDomains?: readonly string[];
  verificationUrl?: string;
  reason?: "feature_disabled" | "platform_unsupported" | "account_not_found";
}

export interface PairingInfo {
  requestId: string;
  expiresAtMs: number;
  approvedDomains: readonly string[];
  verificationUrl: string;
}

/** Transport used to announce a pending request to the native host. No-op when
 *  the feature is off or the host is not installed. */
export interface NativeHostTransport {
  announceRequest(req: {
    requestId: string;
    requestSecret: string;
    platformId: number;
    allowedDomains: readonly string[];
    expiresAt: string;
  }): Promise<void>;
}

export interface CoordinatorDeps {
  registry?: ImportRequestRegistry;
  service?: AccountSessionService;
  platformResolver?: (accountId: number) => Promise<number | undefined>;
  transport?: NativeHostTransport;
  enabled?: () => boolean;
}

function sumRejects(r: RejectCounts): number {
  return Object.values(r).reduce((a, b) => a + b, 0);
}

export class BrowserImportCoordinator {
  private readonly registry: ImportRequestRegistry;
  private readonly service: AccountSessionService;
  private readonly transport: NativeHostTransport;
  private readonly enabled: () => boolean;
  private readonly platformResolver: (
    accountId: number
  ) => Promise<number | undefined>;

  constructor(deps: CoordinatorDeps = {}) {
    this.registry = deps.registry ?? new ImportRequestRegistry();
    this.service = deps.service ?? new AccountSessionService();
    this.transport = deps.transport ?? {
      async announceRequest() {
        /* no-op */
      },
    };
    this.enabled = deps.enabled ?? isBrowserProfileImportEnabled;
    this.platformResolver =
      deps.platformResolver ??
      (async (accountId: number) => {
        try {
          const mod = new SocialAccountModule();
          const resp = await mod.getAccountDetail(accountId);
          return resp.status === "success"
            ? resp.data?.social_type_id
            : undefined;
        } catch {
          return undefined;
        }
      });
  }

  async availability(accountId: number): Promise<BrowserImportAvailability> {
    if (!this.enabled()) {
      return { enabled: false, reason: "feature_disabled" };
    }
    const platformId = await this.platformResolver(accountId);
    if (!platformId) {
      return { enabled: false, reason: "account_not_found" };
    }
    const manifest = getPlatformManifest(platformId);
    if (!manifest?.browserProfileImportEnabled) {
      return { enabled: false, reason: "platform_unsupported", platformId };
    }
    return {
      enabled: true,
      platformId,
      platformName: manifest.platformName,
      approvedDomains: manifest.allowedDomainSuffixes,
      verificationUrl: manifest.verificationUrl,
    };
  }

  /** Create a one-time pairing request. Throws if import is unavailable. */
  async startPairing(accountId: number): Promise<PairingInfo> {
    const avail = await this.availability(accountId);
    if (
      !avail.enabled ||
      avail.platformId == null ||
      !avail.approvedDomains ||
      !avail.verificationUrl
    ) {
      throw new Error(
        `browser-profile import unavailable (${avail.reason ?? "unknown"})`
      );
    }
    const created = this.registry.create(
      accountId,
      avail.platformId,
      avail.approvedDomains
    );
    // Inform the native host (no-op when the host is absent). Failures here do
    // not leak cookie data; they just mean the extension cannot pair yet.
    try {
      await this.transport.announceRequest({
        requestId: created.requestId,
        requestSecret: created.requestSecret,
        platformId: avail.platformId,
        allowedDomains: avail.approvedDomains,
        expiresAt: new Date(created.expiresAtMs).toISOString(),
      });
    } catch (err) {
      log.warn(
        `[browser-import] native-host announce failed: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
    }
    return {
      requestId: created.requestId,
      expiresAtMs: created.expiresAtMs,
      approvedDomains: avail.approvedDomains,
      verificationUrl: avail.verificationUrl,
    };
  }

  async cancel(requestId: string): Promise<boolean> {
    return this.registry.cancel(requestId);
  }

  /**
   * Receive a validated native-host import result, consume the one-time
   * request, and persist cookies through the encrypted storage layer. Returns a
   * safe CookieImportResult (never cookie values/names). Throws only on protocol
   * shape violations (the caller maps those to a safe envelope).
   */
  async receiveImportResult(raw: unknown): Promise<CookieImportResult> {
    // Re-validate the wire shape (transport boundary, not trust boundary).
    const msg: NativeImportResult = nativeImportResultSchema.parse(raw);

    let pending;
    try {
      pending = this.registry.consume(msg.requestId, msg.requestSecret);
    } catch (err) {
      if (err instanceof ImportRequestValidationError) {
        return {
          state: "request_expired",
          importedCookieCount: 0,
          rejectedCookieCounts: emptyRejectCounts(),
        };
      }
      throw err;
    }

    try {
      const partitionPath = await this.service.getOrCreatePartition(
        pending.accountId
      );
      const outcome = await this.service.persistSnapshot({
        accountId: pending.accountId,
        cookies: msg.cookies as unknown[],
        source: "browser_profile",
        partitionPath,
      });
      const manifest = getPlatformManifest(pending.platformId);
      const rejected = sumRejects(outcome.rejectedCounts);
      const state: "success" | "partial_success" =
        outcome.importedCookieCount > 0 && rejected > 0
          ? "partial_success"
          : "success";
      return {
        state,
        importedCookieCount: outcome.importedCookieCount,
        rejectedCookieCounts: outcome.rejectedCounts,
        verificationUrl: manifest?.verificationUrl ?? "",
      };
    } catch (err) {
      const errState:
        | "key_unavailable"
        | "no_eligible_cookies"
        | "storage_failed" =
        err instanceof CookieServiceError && err.code === "KEY_UNAVAILABLE"
          ? "key_unavailable"
          : err instanceof CookieServiceError &&
            err.code === "NO_ALLOWED_COOKIES"
          ? "no_eligible_cookies"
          : "storage_failed";
      return {
        state: errState,
        importedCookieCount: 0,
        rejectedCookieCounts: emptyRejectCounts(),
      };
    }
  }
}
