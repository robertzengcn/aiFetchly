/**
 * SkillCredentialService — fail-closed OS-backed secret storage for skill
 * credentials (design §13, PRD §19).
 *
 * - Electron `safeStorage` (DPAPI / Keychain / libsecret) encrypts the value;
 *   only an opaque binding id + metadata ever reach SQLite or logs.
 * - When OS encryption is unavailable the service REFUSES persistent storage
 *   (SECURE_STORAGE_UNAVAILABLE) — an optional session-only mode is the
 *   caller's explicit choice, never a silent downgrade.
 * - Secret values are never logged, never echoed back, and injected only
 *   into the environment of one approved child process.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface StoredCredentialStatus {
  readonly installationId: string;
  readonly environmentVariable: string;
  readonly configured: boolean;
  readonly storedAt: string | null;
}

interface EncryptedRecord {
  readonly v: 1;
  readonly installationId: string;
  readonly environmentVariable: string;
  readonly encryptedBase64: string;
  readonly storedAt: string;
}

export type CredentialStoreResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "SECURE_STORAGE_UNAVAILABLE"; readonly message: string };

export class SkillCredentialService {
  private readonly storePath: string;

  constructor(storeRoot?: string) {
    const root =
      storeRoot ??
      process.env.AIFETCHLY_SKILL_CREDENTIAL_STORE ??
      path.join(os.homedir(), ".aifetchly", "skill-state");
    fs.mkdirSync(root, { recursive: true });
    this.storePath = path.join(root, "credentials.json");
  }

  private safeStorage(): {
    encryptString: (plain: string) => Buffer;
    decryptString: (encrypted: Buffer) => string;
    isEncryptionAvailable: () => boolean;
  } | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { safeStorage } = require("electron") as typeof import("electron");
      return safeStorage;
    } catch {
      return null;
    }
  }

  private readAll(): Map<string, EncryptedRecord> {
    const out = new Map<string, EncryptedRecord>();
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.storePath, "utf-8")
      ) as Record<string, EncryptedRecord>;
      for (const [key, record] of Object.entries(raw)) {
        if (record && record.v === 1) out.set(key, record);
      }
    } catch {
      /* missing/corrupt store starts empty */
    }
    return out;
  }

  private writeAll(records: Map<string, EncryptedRecord>): void {
    const plain: Record<string, EncryptedRecord> = {};
    for (const [key, record] of records) plain[key] = record;
    fs.writeFileSync(this.storePath, JSON.stringify(plain, null, 2), {
      mode: 0o600,
    });
  }

  private key(installationId: string, environmentVariable: string): string {
    return `${installationId}:${environmentVariable}`;
  }

  /**
   * Store one credential for an installation. FAIL CLOSED when OS-backed
   * encryption is unavailable (design §13: no plaintext downgrade).
   */
  store(
    installationId: string,
    environmentVariable: string,
    value: string
  ): CredentialStoreResult {
    const safeStorage = this.safeStorage();
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      return {
        ok: false,
        code: "SECURE_STORAGE_UNAVAILABLE",
        message:
          "OS-backed secure storage is unavailable on this system; the " +
          "credential was NOT stored. Enable the platform secret service " +
          "(Keychain / DPAPI / libsecret) and try again.",
      };
    }
    const records = this.readAll();
    records.set(this.key(installationId, environmentVariable), {
      v: 1,
      installationId,
      environmentVariable,
      encryptedBase64: safeStorage.encryptString(value).toString("base64"),
      storedAt: new Date().toISOString(),
    });
    this.writeAll(records);
    return { ok: true };
  }

  /**
   * Retrieve a credential for injection into ONE approved child process.
   * Never log or return this value anywhere except the child environment.
   */
  retrieve(
    installationId: string,
    environmentVariable: string
  ): string | null {
    const safeStorage = this.safeStorage();
    if (!safeStorage) return null;
    const record = this.readAll().get(
      this.key(installationId, environmentVariable)
    );
    if (!record) return null;
    try {
      return safeStorage.decryptString(
        Buffer.from(record.encryptedBase64, "base64")
      );
    } catch {
      return null;
    }
  }

  /** Status without ever revealing the value (§19.2). */
  isConfigured(
    installationId: string,
    environmentVariable: string
  ): StoredCredentialStatus {
    const record = this.readAll().get(
      this.key(installationId, environmentVariable)
    );
    return {
      installationId,
      environmentVariable,
      configured: Boolean(record),
      storedAt: record?.storedAt ?? null,
    };
  }

  delete(installationId: string, environmentVariable?: string): number {
    const records = this.readAll();
    let removed = 0;
    for (const key of [...records.keys()]) {
      if (
        key.startsWith(`${installationId}:`) &&
        (environmentVariable === undefined ||
          key === this.key(installationId, environmentVariable))
      ) {
        records.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) this.writeAll(records);
    return removed;
  }
}
