import crypto from "crypto";
import fs from "fs";
import path from "path";
import { log } from "@/modules/Logger";

/** Storage seam consumed by materializer and delivery services. */
export interface EmailOrganizationArtifactBackend {
  put(content: Buffer): Promise<string>;
  get(artifactId: string): Promise<Buffer>;
  exists(artifactId: string): Promise<boolean>;
  purge(artifactId: string): Promise<void>;
  purgeOlderThan(cutoff: Date): Promise<number>;
}

/**
 * Encrypted artifact storage for forward materialization
 * (technical design §9.2). Files live under the user's managed data area
 * (the resolved USERSDBPATH directory — no second database, no renderer
 * paths) and are encrypted with AES-256-GCM using the per-install key from
 * the existing secure-storage mechanism. Layout per artifact file:
 * `[12-byte nonce][ciphertext+tag]`. Writes are atomic (tmp + rename).
 * Opaque artifact IDs are safe to expose; raw paths never leave this class.
 */
export class EmailOrganizationArtifactStore implements EmailOrganizationArtifactBackend {
  private readonly rootDir: string;
  private keyPromise: Promise<Buffer> | null = null;

  constructor(dbpath: string, options?: { rootDirName?: string }) {
    this.rootDir = path.join(dbpath, options?.rootDirName ?? "email-organization-artifacts");
  }

  private async getKey(): Promise<Buffer> {
    if (this.keyPromise === null) {
      this.keyPromise = (async () => {
        const { userSecretKeyService } =
          await import("@/modules/fieldCipher/UserSecretKeyService");
        return await userSecretKeyService.getKey();
      })();
    }
    return await this.keyPromise;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  private pathFor(artifactId: string): string {
    return path.join(this.rootDir, `${artifactId}.enc`);
  }

  /** Encrypts and durably stores bytes; returns the opaque artifact ID. */
  async put(content: Buffer): Promise<string> {
    const key = await this.getKey();
    this.ensureDir();
    const artifactId = crypto.randomUUID();
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([nonce, ciphertext, tag]);
    const target = this.pathFor(artifactId);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, target);
    return artifactId;
  }

  /** Decrypts and returns the artifact bytes. */
  async get(artifactId: string): Promise<Buffer> {
    const key = await this.getKey();
    const target = this.pathFor(artifactId);
    const payload = fs.readFileSync(target);
    if (payload.length < 12 + 16) {
      throw new Error("artifact payload too short");
    }
    const nonce = payload.subarray(0, 12);
    const ciphertext = payload.subarray(12, payload.length - 16);
    const tag = payload.subarray(payload.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async exists(artifactId: string): Promise<boolean> {
    return fs.existsSync(this.pathFor(artifactId));
  }

  async purge(artifactId: string): Promise<void> {
    const target = this.pathFor(artifactId);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (error) {
      log.warn(
        `[EmailOrganizationArtifactStore] purge failed for ${artifactId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Retention sweep: delete artifact files whose mtime is older than the
   * cutoff. Metadata (hashes, manifest) lives in the DB and survives.
   */
  async purgeOlderThan(cutoff: Date): Promise<number> {
    this.ensureDir();
    let purged = 0;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(this.rootDir);
    } catch (error) {
      log.warn(
        "[EmailOrganizationArtifactStore] retention sweep read failed:",
        error instanceof Error ? error.message : String(error)
      );
      return 0;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".enc")) continue;
      const target = path.join(this.rootDir, entry);
      try {
        const stat = fs.statSync(target);
        if (stat.mtimeMs < cutoff.getTime()) {
          fs.unlinkSync(target);
          purged += 1;
        }
      } catch (error) {
        log.warn(
          `[EmailOrganizationArtifactStore] retention sweep failed for ${entry}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    return purged;
  }
}
