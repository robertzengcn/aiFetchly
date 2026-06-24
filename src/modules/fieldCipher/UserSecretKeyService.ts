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

  constructor(private httpClient: HttpClient = new HttpClient()) {}

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
      this.inflight = this.fetchKey()
        .then((key) => {
          this.cachedKey = key;
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
        })
        .finally(() => {
          // Keep the resolved promise from blocking retries — the cachedKey
          // is already set on success, so we can drop the in-flight handle.
          if (this.cachedKey) {
            this.inflight = null;
          }
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
    this.cachedKey = null;
    this.inflight = null;
  }

  private async fetchKey(): Promise<Buffer> {
    let response: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = await this.httpClient.get<any>(SECRET_KEY_ENDPOINT);
    } catch (err) {
      throw new SecretKeyUnavailableError(
        "Failed to reach secret-key endpoint",
        err
      );
    }

    // Backend envelope: { status: true, data: { secretKey: "base64..." } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (response as any)?.data;
    const secretKey = data?.secretKey;
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
