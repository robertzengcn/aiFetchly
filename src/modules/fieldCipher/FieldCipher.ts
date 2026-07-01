import crypto from "crypto";

/**
 * Envelope format: ENC1:<base64iv>:<base64ciphertext+tag>
 *
 * - ENC1: literal version prefix (lets the format evolve without breaking old rows).
 * - <base64iv>: 12-byte GCM IV, base64 (16 chars).
 * - <base64ciphertext+tag>: AES-256-GCM ciphertext + 16-byte auth tag, base64.
 */
const PREFIX = "ENC1";
const IV_LENGTH = 12; // AES-GCM standard IV length
const KEY_LENGTH = 32; // AES-256
const TAG_LENGTH = 16; // AES-GCM auth tag

export class FieldCipher {
  /**
   * Returns true if the stored value looks like an ENC1: envelope.
   * Cheap prefix check only — does not validate the payload.
   */
  static isEncrypted(value: string | null | undefined): boolean {
    return typeof value === "string" && value.startsWith(`${PREFIX}:`);
  }

  /**
   * Encrypts plaintext into an ENC1: envelope using AES-256-GCM.
   * A fresh 12-byte IV is used per call; never reuse an IV with the same key.
   *
   * @throws Error if key.length !== 32.
   */
  static encrypt(plaintext: string, key: Buffer): string {
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `FieldCipher.encrypt: key must be ${KEY_LENGTH} bytes (got ${key.length})`
      );
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      PREFIX,
      iv.toString("base64"),
      Buffer.concat([ciphertext, tag]).toString("base64"),
    ].join(":");
  }

  /**
   * Decrypts an ENC1: envelope back to plaintext.
   *
   * @throws Error if the envelope is malformed.
   * @throws Error if the GCM auth tag does not verify (tampered or wrong key).
   * @throws Error if key.length !== 32.
   */
  static decrypt(stored: string, key: Buffer): string {
    if (key.length !== KEY_LENGTH) {
      throw new Error(
        `FieldCipher.decrypt: key must be ${KEY_LENGTH} bytes (got ${key.length})`
      );
    }

    const parts = stored.split(":");
    if (parts.length !== 3 || parts[0] !== PREFIX) {
      throw new Error(
        `FieldCipher.decrypt: malformed envelope (expected "${PREFIX}:<iv>:<ct>")`
      );
    }

    const iv = Buffer.from(parts[1], "base64");
    const payload = Buffer.from(parts[2], "base64");

    if (iv.length !== IV_LENGTH) {
      throw new Error(
        `FieldCipher.decrypt: IV must be ${IV_LENGTH} bytes (got ${iv.length})`
      );
    }
    if (payload.length < TAG_LENGTH) {
      throw new Error(
        `FieldCipher.decrypt: payload too short to contain a ${TAG_LENGTH}-byte auth tag`
      );
    }

    const ciphertext = payload.subarray(0, payload.length - TAG_LENGTH);
    const tag = payload.subarray(payload.length - TAG_LENGTH);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}
