import { FieldCipher } from "@/modules/fieldCipher/FieldCipher";
import { userSecretKeyService } from "@/modules/fieldCipher";

/**
 * Proxy credential encryption at rest (PRD P-FR-08).
 *
 * `proxy.pass` historically stored plaintext. New writes are encrypted with
 * FieldCipher (same envelope as `social_accounts.pass`), and reads migrate
 * legacy plaintext rows lazily: decrypt-for-use in the main process only,
 * never returned to the renderer or the LLM.
 */
export class ProxyCredentialCodec {
  /** Encrypt a plaintext proxy password for storage. Null-safe. */
  public static async encryptForStorage(
    plaintext: string | null | undefined
  ): Promise<string | null> {
    if (plaintext == null || plaintext === "") {
      return plaintext ?? null;
    }
    if (FieldCipher.isEncrypted(plaintext)) {
      return plaintext;
    }
    const key = await userSecretKeyService.getKey();
    return FieldCipher.encrypt(plaintext, key);
  }

  /**
   * Decrypt a stored proxy password for main-process use (browser launch).
   * Legacy plaintext rows return as-is and are reported for lazy migration.
   */
  public static async decryptForUse(
    stored: string | null | undefined
  ): Promise<{ password: string | null; needsMigration: boolean }> {
    if (stored == null || stored === "") {
      return { password: stored ?? null, needsMigration: false };
    }
    if (!FieldCipher.isEncrypted(stored)) {
      return { password: stored, needsMigration: true };
    }
    try {
      const key = await userSecretKeyService.getKey();
      return { password: FieldCipher.decrypt(stored, key), needsMigration: false };
    } catch {
      // Fail closed: an undecryptable password never reaches the wire as
      // plaintext; the caller treats the proxy as unusable.
      return { password: null, needsMigration: false };
    }
  }
}
