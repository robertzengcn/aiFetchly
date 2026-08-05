import { AccountCookiesModel } from "@/model/AccountCookies.model";
import { SocialAccountModule } from "@/modules/socialAccountModule";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import os from "os";
import nodePath from "path";
import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import {
  userSecretKeyService,
  type UserSecretKeyService,
} from "@/modules/fieldCipher/UserSecretKeyService";
import { SecretKeyUnavailableError } from "@/modules/fieldCipher/SecretKeyUnavailableError";
import { normalizeCookieBatch } from "@/modules/accountSession/cookieNormalize";
import type { CookieAdapterSource } from "@/modules/accountSession/cookieNormalize";
import {
  resolvePartition,
  isValidPersistentPartition,
} from "@/modules/accountSession/partitionResolve";
import {
  getPlatformManifest,
  makeDomainMatcher,
} from "@/modules/PlatformSessionManifest";
import {
  type NormalizedCookie,
  type AccountSessionMetadata,
  type SessionStatus,
  type StoredCookieSource,
  type CookieErrorCode,
  type CookieMigrationSummary,
  type PersistSnapshotInput,
  type RejectCounts,
  type SafeCookieRejectReason,
} from "@/schemas/accountCookies";
import { log } from "@/modules/Logger";

/**
 * AccountSessionService is the ONLY application service permitted to
 * (technical design §4.2):
 *   - decrypt persisted account cookies
 *   - apply cookies to an Electron Session
 *   - capture cookies from an Electron Session
 *   - run account-cookie migration
 *   - accept imported / worker-refreshed cookies for persistent storage
 *
 * The model layer stores ciphertext + non-secret metadata only. Renderer code
 * receives only `AccountSessionMetadata`.
 *
 * Electron coupling is intentionally minimal and injected: `apply`/`capture`
 * receive a `CookieSessionLike` and `clear` uses an injectable
 * `sessionFromPartition`, so the service is unit/integration-testable without
 * a real Electron runtime.
 */

/** Structural subset of Electron.Session used by this service. */
export interface CookieSessionLike {
  cookies: {
    get(filter?: unknown): Promise<unknown[]>;
    set(details: unknown): Promise<void>;
  };
  clearStorageData(options?: unknown): Promise<void>;
}

export type SessionFromPartition = (partition: string) => CookieSessionLike;

export interface AccountSessionServiceOptions {
  secretKeyService?: UserSecretKeyService;
  cookiesModel?: AccountCookiesModel;
  /** Resolves an account id to its platform id (defaults to SocialAccountModule). */
  platformResolver?: (accountId: number) => Promise<number | undefined>;
  /** Used by clearAccountSession; defaults to Electron's session.fromPartition. */
  sessionFromPartition?: SessionFromPartition;
}

export interface SnapshotReadResult {
  cookies: NormalizedCookie[];
  status: SessionStatus;
}

export interface PersistSnapshotOutcome {
  importedCookieCount: number;
  rejectedCounts: RejectCounts;
}

export class CookieServiceError extends Error {
  constructor(public readonly code: CookieErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CookieServiceError";
  }
}

/** Renderer-facing importSource excludes worker_refresh. */
function toRendererSource(
  source: StoredCookieSource | null | undefined
): AccountSessionMetadata["importSource"] {
  if (
    source === "manual_login" ||
    source === "netscape_file" ||
    source === "browser_profile"
  ) {
    return source;
  }
  return null;
}

/** Map a PersistSnapshotInput.source to the normalizer adapter. */
function adapterForSource(source: StoredCookieSource): CookieAdapterSource {
  // Electron session capture + extension API emit chromium-shape cookies.
  // Netscape file upload + Puppeteer worker refresh emit CookiesType.
  return source === "netscape_file" || source === "worker_refresh"
    ? "netscape"
    : "chromium";
}

const ENCRYPTION_VERSION = 1;

/**
 * Resolve the user DB path for the default model. Mirrors BaseModule's logic
 * but is invoked lazily (only when no cookiesModel is injected), so test
 * suites that inject a temp-DB model never trigger a SqliteDb singleton path
 * switch. Token/electron-store are required lazily to keep this module loadable
 * in non-Electron test contexts.
 */
function resolveUserDbPath(): string {
  try {
    const dbpath = new Token().getValue(USERSDBPATH);
    if (dbpath) {
      return dbpath;
    }
  } catch {
    // fall through to tmpdir fallback
  }
  return nodePath.join(os.tmpdir(), "aifetchly-test");
}

export class AccountSessionService {
  private readonly cookiesModel: AccountCookiesModel;
  private readonly secretKeyService: UserSecretKeyService;
  private readonly platformResolver: (
    accountId: number
  ) => Promise<number | undefined>;
  private readonly sessionFromPartition: SessionFromPartition;

  constructor(options: AccountSessionServiceOptions = {}) {
    this.cookiesModel =
      options.cookiesModel ?? new AccountCookiesModel(resolveUserDbPath());
    this.secretKeyService = options.secretKeyService ?? userSecretKeyService;
    this.sessionFromPartition =
      options.sessionFromPartition ??
      ((partition: string) => {
        // Lazy require so this module loads in test contexts without Electron.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require("electron") as {
          session: { fromPartition: (p: string) => CookieSessionLike };
        };
        return electron.session.fromPartition(partition);
      });

    this.platformResolver =
      options.platformResolver ??
      (async (accountId: number) => {
        try {
          const mod = new SocialAccountModule();
          const resp = await mod.getAccountDetail(accountId);
          return resp.status === "success"
            ? resp.data?.social_type_id
            : undefined;
        } catch (err) {
          log.warn(
            `AccountSessionService: platform resolve failed for account ${accountId}`
          );
          return undefined;
        }
      });
  }

  // ---------- reads ----------

  /**
   * Decrypt (or parse, for legacy rows) the stored snapshot. Never throws for
   * key/cipher problems — returns a safe status instead so callers degrade
   * gracefully.
   */
  async getDecryptedSnapshot(accountId: number): Promise<SnapshotReadResult> {
    const row = await this.cookiesModel.getAccountCookies(accountId);
    if (!row || !row.cookies) {
      return { cookies: [], status: "missing" };
    }

    if (FieldCipher.isEncrypted(row.cookies)) {
      let key;
      try {
        key = await this.secretKeyService.getKey();
      } catch {
        // Can't decrypt without key; not permanently invalid — retry later.
        return { cookies: [], status: "migration_pending" };
      }
      let plaintext: string;
      try {
        plaintext = FieldCipher.decrypt(row.cookies, key);
      } catch {
        await this.safeMarkInvalid(accountId, "CIPHER_INVALID");
        return { cookies: [], status: "invalid" };
      }
      const normalized = this.tryNormalize(plaintext);
      if (!normalized.ok) {
        await this.safeMarkInvalid(accountId, "CIPHER_INVALID");
        return { cookies: [], status: "invalid" };
      }
      return { cookies: normalized.cookies, status: "available" };
    }

    // Legacy plaintext row — still usable (so login windows work pre-migration)
    // but flagged for an encryption rewrite.
    const normalized = this.tryNormalize(row.cookies);
    if (!normalized.ok) {
      await this.safeMarkInvalid(accountId, "LEGACY_INVALID");
      return { cookies: [], status: "invalid" };
    }
    return { cookies: normalized.cookies, status: "migration_pending" };
  }

  /** Renderer-safe metadata. Never decrypts, never returns cookie data. */
  async getMetadata(accountId: number): Promise<AccountSessionMetadata> {
    const row = await this.cookiesModel.getAccountCookies(accountId);
    if (!row) {
      return {
        hasCookies: false,
        cookieCount: 0,
        lastUpdatedAt: null,
        importSource: null,
        sessionStatus: "missing",
      };
    }
    const cookieCount = row.cookie_count ?? 0;
    const sessionStatus: SessionStatus =
      row.session_status ??
      (FieldCipher.isEncrypted(row.cookies)
        ? "available"
        : "migration_pending");
    const lastUpdatedAt = row.updatedAt
      ? new Date(row.updatedAt).toISOString()
      : row.record_time ?? null;
    return {
      hasCookies: cookieCount > 0,
      cookieCount,
      lastUpdatedAt,
      importSource: toRendererSource(row.source),
      sessionStatus,
    };
  }

  // ---------- partitions ----------

  async getOrCreatePartition(accountId: number): Promise<string> {
    const row = await this.cookiesModel.getAccountCookies(accountId);
    return resolvePartition(accountId, row?.partition_path);
  }

  // ---------- writes ----------

  /**
   * Normalize, allowlist-filter, dedupe, encrypt, and persist a snapshot.
   * Resolves the platform manifest itself; the caller supplies only the raw
   * cookies + source + the partition to persist (resolved by the caller via
   * getOrCreatePartition, since the caller owns the live session).
   *
   * @throws CookieServiceError(KEY_UNAVAILABLE) when the key cannot be obtained.
   * @throws CookieServiceError(NO_ALLOWED_COOKIES) when zero cookies survive
   *   filtering — the existing snapshot is NOT replaced with empty data.
   */
  async persistSnapshot(
    input: PersistSnapshotInput
  ): Promise<PersistSnapshotOutcome> {
    const platformId = await this.platformResolver(input.accountId);
    const manifest = platformId ? getPlatformManifest(platformId) : undefined;
    const matchesDomain = manifest
      ? makeDomainMatcher(platformId as number)
      : undefined;

    const result = normalizeCookieBatch(
      input.cookies,
      adapterForSource(input.source),
      { matchesDomain }
    );

    if (result.accepted.length === 0) {
      // Never replace an existing snapshot with empty data.
      throw new CookieServiceError("NO_ALLOWED_COOKIES");
    }

    let key: Buffer;
    try {
      key = await this.secretKeyService.getKey();
    } catch (err) {
      throw new CookieServiceError(
        "KEY_UNAVAILABLE",
        err instanceof SecretKeyUnavailableError
          ? "secret key unavailable"
          : undefined
      );
    }

    const ciphertext = FieldCipher.encrypt(
      JSON.stringify(result.accepted),
      key
    );

    await this.cookiesModel.saveEncryptedSnapshot(input.accountId, {
      cookies: ciphertext,
      partitionPath: input.partitionPath,
      source: input.source,
      cookieCount: result.accepted.length,
      sessionStatus: "available",
      encryptionVersion: ENCRYPTION_VERSION,
      errorCode: null,
    });

    return {
      importedCookieCount: result.accepted.length,
      rejectedCounts: result.rejected,
    };
  }

  // ---------- Electron session lifecycle ----------

  /**
   * Apply the stored snapshot to an Electron session before loadURL. Processes
   * cookies independently so one malformed cookie cannot block the rest.
   */
  async applySnapshotToSession(
    accountId: number,
    session: CookieSessionLike
  ): Promise<{ applied: number; failed: number }> {
    const { cookies } = await this.getDecryptedSnapshot(accountId);
    let applied = 0;
    let failed = 0;
    for (const cookie of cookies) {
      try {
        await session.cookies.set(this.toElectronSetDetails(cookie));
        applied++;
      } catch {
        // Aggregate metric only — never log the cookie object or value.
        failed++;
      }
    }
    return { applied, failed };
  }

  /**
   * Capture all cookies from a live session, filter through the platform
   * manifest, and persist an encrypted snapshot. Used by the manual-login
   * window close handler.
   */
  async captureSessionSnapshot(
    accountId: number,
    session: CookieSessionLike
  ): Promise<PersistSnapshotOutcome> {
    const raw = await session.cookies.get({});
    const partitionPath = await this.getOrCreatePartition(accountId);
    return this.persistSnapshot({
      accountId,
      cookies: raw as unknown[],
      source: "manual_login",
      partitionPath,
    });
  }

  /**
   * Delete the encrypted snapshot and clear only this account's partition
   * storage. Idempotent. Never clears the default session.
   */
  async clearAccountSession(accountId: number): Promise<void> {
    const row = await this.cookiesModel.getAccountCookies(accountId);
    await this.cookiesModel.deleteAccountCookies(accountId);
    const partition = resolvePartition(accountId, row?.partition_path);
    if (!isValidPersistentPartition(partition)) {
      // Should be unreachable; resolvePartition always returns a valid partition.
      return;
    }
    const session = this.sessionFromPartition(partition);
    await session.clearStorageData({
      storages: [
        "cookies",
        "localstorage",
        "indexdb",
        "serviceworkers",
        "cachestorage",
      ],
    });
  }

  // ---------- migration ----------

  async migrateLegacySnapshots(): Promise<CookieMigrationSummary> {
    const summary: CookieMigrationSummary = {
      scanned: 0,
      migrated: 0,
      invalid: 0,
      deferredKeyUnavailable: 0,
      persistenceFailed: 0,
      alreadyEncrypted: 0,
    };

    let key: Buffer;
    try {
      key = await this.secretKeyService.getKey();
    } catch {
      // No key => count all candidates as deferred and exit (do not loop).
      const candidates = await this.cookiesModel.getLegacyCandidateRows(100000);
      summary.scanned = candidates.length;
      summary.deferredKeyUnavailable = candidates.length;
      return summary;
    }

    const BATCH = 50;
    let noProgressRuns = 0;
    while (noProgressRuns < 1) {
      const candidates = await this.cookiesModel.getLegacyCandidateRows(BATCH);
      if (candidates.length === 0) {
        break;
      }
      summary.scanned += candidates.length;
      let progress = false;

      for (const row of candidates) {
        if (FieldCipher.isEncrypted(row.cookies)) {
          summary.alreadyEncrypted++;
          progress = true;
          continue;
        }
        const normalized = this.tryNormalize(row.cookies);
        if (!normalized.ok) {
          await this.safeMarkInvalid(row.account_id, "LEGACY_INVALID");
          summary.invalid++;
          progress = true;
          continue;
        }
        try {
          const ciphertext = FieldCipher.encrypt(
            JSON.stringify(normalized.cookies),
            key
          );
          await this.cookiesModel.saveEncryptedSnapshot(row.account_id, {
            cookies: ciphertext,
            partitionPath: resolvePartition(row.account_id, row.partition_path),
            source: row.source ?? "manual_login",
            cookieCount: normalized.cookies.length,
            sessionStatus: "available",
            encryptionVersion: ENCRYPTION_VERSION,
            errorCode: null,
          });
          summary.migrated++;
          progress = true;
        } catch {
          // Transient DB/persistence failure — leave the row for a later retry.
          summary.persistenceFailed++;
        }
      }

      if (progress) {
        noProgressRuns = 0;
      } else {
        noProgressRuns++;
      }
    }

    return summary;
  }

  // ---------- internals ----------

  private tryNormalize(
    plaintext: string
  ): { ok: true; cookies: NormalizedCookie[] } | { ok: false } {
    try {
      const parsed: unknown = JSON.parse(plaintext);
      if (!Array.isArray(parsed)) {
        return { ok: false };
      }
      const result = normalizeCookieBatch(parsed, "legacy", {});
      return { ok: true, cookies: result.accepted };
    } catch {
      return { ok: false };
    }
  }

  private async safeMarkInvalid(
    accountId: number,
    code: CookieErrorCode
  ): Promise<void> {
    try {
      await this.cookiesModel.markRowInvalid(accountId, code);
    } catch (err) {
      log.warn(
        `AccountSessionService: failed to mark account ${accountId} invalid (${code})`
      );
    }
  }

  /**
   * Build an Electron `cookies.set()` detail object from a normalized cookie.
   * Mirrors the production-proven logic previously inlined in the controller:
   *   - __Host- prefix => omit domain (host-only, secure)
   *   - __Secure- prefix => force httpOnly
   *   - https URL when secure or SameSite=None
   */
  private toElectronSetDetails(
    cookie: NormalizedCookie
  ): Record<string, unknown> {
    const host = cookie.domain.replace(/^\./, "");
    const useHttps = cookie.secure || cookie.sameSite === "no_restriction";
    const details: Record<string, unknown> = {
      url: `http${useHttps ? "s" : ""}://${host}${cookie.path}`,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite ?? "lax",
    };
    if (cookie.expirationDate !== undefined) {
      details.expirationDate = cookie.expirationDate;
    }
    if (cookie.hostOnly !== undefined) {
      details.hostOnly = cookie.hostOnly;
    }
    if (!cookie.name.startsWith("__Host-")) {
      details.domain = cookie.domain;
    }
    if (cookie.name.startsWith("__Secure-")) {
      details.httpOnly = true;
    }
    return details;
  }
}

// Re-export reject-reason type for callers building UI tallies.
export type { SafeCookieRejectReason };
