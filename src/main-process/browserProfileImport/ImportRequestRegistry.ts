import crypto from "crypto";
import { REQUEST_SECRET_BYTES } from "@/schemas/nativeMessaging";

/**
 * In-memory, single-use browser-profile import request registry (design §9.3).
 *
 * Each request is bound to (accountId, platformId, allowedDomains) and carries
 * an unpredictable one-time `requestSecret` (32 random bytes, base64url). A
 * request may persist at most ONE response: `consume()` atomically validates
 * secret + platform + expiry + replay, then deletes the entry. Entries are also
 * removed on cancel, timeout, or process shutdown. Nothing here is persisted to
 * disk and `requestSecret` is never logged.
 *
 * Main-process memory only. Not exported to the renderer.
 */

export type ImportRequestState =
  | "awaiting_extension"
  | "receiving"
  | "consumed"
  | "cancelled"
  | "expired";

export interface PendingBrowserProfileImport {
  requestId: string;
  /** Opaque to callers; returned once at creation, never logged, never stored. */
  requestSecret: string;
  accountId: number;
  platformId: number;
  allowedDomains: readonly string[];
  expiresAtMs: number;
  state: ImportRequestState;
}

export interface CreatedRequest {
  requestId: string;
  requestSecret: string;
  expiresAtMs: number;
}

export class ImportRequestValidationError extends Error {
  constructor(
    public readonly code:
      | "REQUEST_NOT_FOUND"
      | "REQUEST_EXPIRED"
      | "SECRET_INVALID"
      | "REQUEST_NOT_AWAITING",
    message?: string
  ) {
    super(message ?? code);
    this.name = "ImportRequestValidationError";
  }
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes (design §7.6.3)

export class ImportRequestRegistry {
  private readonly requests = new Map<string, PendingBrowserProfileImport>();

  /** Number of active requests (test/diagnostic only). */
  size(): number {
    return this.requests.size;
  }

  /**
   * Create a new one-time import request bound to the account + platform.
   * Returns the requestId + requestSecret + expiry. The secret is only ever
   * shared with the caller that will relay it to the native host.
   */
  create(
    accountId: number,
    platformId: number,
    allowedDomains: readonly string[],
    ttlMs: number = DEFAULT_TTL_MS,
    now: number = Date.now()
  ): CreatedRequest {
    const requestId = crypto.randomUUID();
    const requestSecret = crypto
      .randomBytes(REQUEST_SECRET_BYTES)
      .toString("base64url");
    const expiresAtMs = now + ttlMs;
    this.requests.set(requestId, {
      requestId,
      requestSecret,
      accountId,
      platformId,
      allowedDomains,
      expiresAtMs,
      state: "awaiting_extension",
    });
    return { requestId, requestSecret, expiresAtMs };
  }

  /** Look up a pending request without consuming it (does not reveal secret). */
  peek(requestId: string): PendingBrowserProfileImport | undefined {
    return this.requests.get(requestId);
  }

  /** User-initiated cancel. Returns true if a pending request was removed. */
  cancel(requestId: string): boolean {
    const req = this.requests.get(requestId);
    if (!req) {
      return false;
    }
    this.requests.delete(requestId);
    return true;
  }

  /**
   * Atomically validate + consume a one-time response. On success the entry is
   * deleted (no replay) and the bound account/platform/domains are returned so
   * the coordinator can persist cookies. On any failure the entry state is
   * advanced appropriately and an ImportRequestValidationError is thrown.
   *
   * The platform is bound at creation; the result message carries no platformId
   * (design §9.5), so the secret + requestId + expiry authenticate the response.
   */
  consume(
    requestId: string,
    requestSecret: string,
    now: number = Date.now()
  ): PendingBrowserProfileImport {
    const req = this.requests.get(requestId);
    if (!req) {
      throw new ImportRequestValidationError("REQUEST_NOT_FOUND");
    }

    if (now > req.expiresAtMs) {
      req.state = "expired";
      this.requests.delete(requestId);
      throw new ImportRequestValidationError("REQUEST_EXPIRED");
    }

    // Constant-time-ish secret comparison to avoid timing leaks. Compare the
    // UTF-8 BYTE lengths (not the JS string .length, which counts UTF-16 code
    // units): a same-code-unit-length string containing surrogates could pass
    // the guard but produce a different byte length, making timingSafeEqual
    // throw RangeError instead of returning the intended SECRET_INVALID result.
    const expectedSecret = Buffer.from(req.requestSecret);
    const suppliedSecret = Buffer.from(requestSecret);
    const secretOk =
      expectedSecret.length === suppliedSecret.length &&
      crypto.timingSafeEqual(expectedSecret, suppliedSecret);
    if (!secretOk) {
      // Leave the entry so the legitimate extension can still retry within TTL.
      throw new ImportRequestValidationError("SECRET_INVALID");
    }

    if (req.state !== "awaiting_extension") {
      throw new ImportRequestValidationError("REQUEST_NOT_AWAITING");
    }

    req.state = "consumed";
    const bound = { ...req };
    this.requests.delete(requestId);
    return bound;
  }

  /** Drop expired entries. Returns the number removed. */
  pruneExpired(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, req] of this.requests) {
      if (now > req.expiresAtMs) {
        req.state = "expired";
        this.requests.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
