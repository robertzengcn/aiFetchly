import { Token } from "@/modules/token";
import { USER_LOCAL_AI_PROVIDER_API_KEY } from "@/config/usersetting";

/**
 * Encrypted storage for the local provider API key.
 *
 * The key lives in its own Token slot, separate from the non-secret provider
 * config JSON. Only the main process ever reads the plaintext value (when
 * building a provider client for a chat request). Renderer reads go through
 * `AIProviderSettingsService`, which exposes only `apiKeyConfigured: boolean`.
 */
export class AIProviderSecretService {
  constructor(private readonly token: Token = new Token()) {}

  /** Plaintext API key, or "" when none is stored. */
  getApiKey(): string {
    return this.token.getValue(USER_LOCAL_AI_PROVIDER_API_KEY);
  }

  /** Encrypt and store the API key. Empty values are rejected (use clear). */
  setApiKey(value: string): void {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.clearApiKey();
      return;
    }
    this.token.setValue(USER_LOCAL_AI_PROVIDER_API_KEY, trimmed);
  }

  /** Permanently delete the stored API key. */
  clearApiKey(): void {
    this.token.deleteValue(USER_LOCAL_AI_PROVIDER_API_KEY);
  }

  /** True when a non-empty API key is stored. */
  hasApiKey(): boolean {
    return this.getApiKey().trim().length > 0;
  }
}
