import { HttpClient } from "@/modules/lib/httpclient";
import { SecretKeyUnavailableError } from "./SecretKeyUnavailableError";

const SECRET_KEY_ENDPOINT = "/api/user/secret-key";
const KEY_LENGTH = 32; // AES-256

/**
 * Fetches the per-user 32-byte secret key from the backend and caches it
 * in memory for the lifetime of the process. The key is NEVER persisted
 * to disk by this service.
 *
 * Singleton: use the exported `userSecretKeyService` instance. The class
 * is also exported so tests can inject a mock HttpClient.
 *
 * Workers MUST NOT import this module — workers have no backend session.
 */
export class UserSecretKeyService {
  private cachedKey: Buffer | null = null;
  private inflight: Promise<Buffer> | null = null;
  private generation = 0;
  private httpClient: HttpClient | null;

  // Lazy default: defer the `new HttpClient()` call until the first key
  // fetch. This avoids a circular-init crash at module load time:
  //   httpclient.ts -> fieldCipher -> UserSecretKeyService -> httpclient
  // where the default-param form `new HttpClient()` would otherwise run
  // during the module's top-level singleton instantiation and touch
  // HttpClient while its class declaration is still in the TDZ.
  constructor(httpClient?: HttpClient) {
    this.httpClient = httpClient ?? null;
  }

  private getHttpClient(): HttpClient {
    if (!this.httpClient) {
      // Deferred instantiation. At module-eval time, the constructor only
      // stores null — so the module-level singleton below does NOT touch
      // HttpClient during its own initialization (which would re-enter
      // httpclient.ts mid-load and crash with a TDZ ReferenceError).
      // By the time getKey() runs here, httpclient.ts has finished loading.
      this.httpClient = new HttpClient();
    }
    return this.httpClient;
  }

  /**
   * Returns the cached 32-byte key, fetching it on first call.
   * Concurrent callers await the same in-flight promise (dedup).
   *
   * @throws SecretKeyUnavailableError if the key cannot be obtained.
   */
  async getKey(): Promise<Buffer> {
    if (this.cachedKey) {
      return this.cachedKey;
    }
    if (!this.inflight) {
      // Capture the generation at fetch start so the .then() callback can detect
      // if invalidate() fired while the HTTP request was in flight. If it did,
      // the returned key is stale (or belongs to a different session) and must
      // NOT be cached.
      const fetchGeneration = this.generation;
      this.inflight = this.fetchKey()
        .then((key) => {
          if (fetchGeneration !== this.generation) {
            // Stale result — invalidate() bumped the generation while we were
            // in flight. Zero and discard the key.
            key.fill(0);
            this.inflight = null;
            throw new SecretKeyUnavailableError(
              "Secret-key response discarded: session changed during fetch"
            );
          }
          this.cachedKey = key;
          // Clear the in-flight handle on success so the next call sees the
          // cache (not a stale resolved promise).
          this.inflight = null;
          return key;
        })
        .catch((err) => {
          // Clear the in-flight promise so the next call can retry.
          this.inflight = null;
          throw err instanceof SecretKeyUnavailableError
            ? err
            : new SecretKeyUnavailableError(
                "Failed to load secret key from backend",
                err
              );
        });
    }
    return this.inflight;
  }

  /**
   * Clears the cached key. The next getKey() call re-fetches from the backend.
   * Called by HttpClient after a successful token refresh (the new session
   * may have a different secret key) and on logout/login transitions.
   */
  invalidate(): void {
    // Bump the generation so any in-flight fetch's .then() callback can detect
    // that its result is stale and refuse to cache it.
    this.generation++;
    // Zero the key buffer before dropping the reference so the bytes do not
    // linger in the heap until GC. Standard hygiene for symmetric key material.
    if (this.cachedKey) {
      this.cachedKey.fill(0);
    }
    this.cachedKey = null;
    this.inflight = null;
  }

  private async fetchKey(): Promise<Buffer> {
    let response: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = await this.getHttpClient().get<any>(SECRET_KEY_ENDPOINT);
    } catch (err) {
      throw new SecretKeyUnavailableError(
        "Failed to reach secret-key endpoint",
        err
      );
    }

    // Backend envelope: { status: true, data: { secretKey: "base64..." } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = response as any;
    if (!r || r.status !== true) {
      throw new SecretKeyUnavailableError(
        "Secret-key request rejected by backend"
      );
    }
    const secretKey = r.data?.secretKey;
    if (typeof secretKey !== "string" || secretKey.length === 0) {
      throw new SecretKeyUnavailableError(
        "Secret-key response missing data.secretKey"
      );
    }

    let key: Buffer;
    try {
      key = Buffer.from(secretKey, "base64");
    } catch (err) {
      throw new SecretKeyUnavailableError(
        "Secret-key response is not valid base64",
        err
      );
    }

    if (key.length !== KEY_LENGTH) {
      throw new SecretKeyUnavailableError(
        `Secret key must be ${KEY_LENGTH} bytes (got ${key.length})`
      );
    }

    return key;
  }
}

// Module-level singleton for production use. Tests instantiate the class directly.
export const userSecretKeyService = new UserSecretKeyService();
