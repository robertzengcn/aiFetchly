import { BaseDb } from "@/model/Basedb";
import type { Repository } from "typeorm";
import { AccountCookiesEntity } from "@/entity/AccountCookies.entity";
import { getRecorddatetime } from "@/modules/lib/function";
import type {
  StoredCookieSource,
  SessionStatus,
  CookieErrorCode,
} from "@/schemas/accountCookies";

/**
 * Defensive guard: the model must never be touched from a worker/child process.
 * Workers have no Electron APIs, no DB connection ownership, and must not see
 * ciphertext or metadata. They send results to main via IPC instead.
 * (Mandatory rule: Child/Worker Process Database Access.)
 */
function assertNotWorker(method: string): void {
  if (process.env.WORKER_TYPE) {
    throw new Error(
      `AccountCookiesModel.${method}: database access from a worker process is not allowed. ` +
        "Send cookie data to the main process via IPC instead."
    );
  }
}

/**
 * Encrypted-snapshot write payload. `cookies` is ALREADY the ENC1 ciphertext
 * envelope produced by AccountSessionService — the model never encrypts or
 * decrypts; it persists ciphertext + non-secret metadata only.
 */
export interface EncryptedSnapshotRow {
  cookies: string;
  partitionPath: string;
  source: StoredCookieSource;
  cookieCount: number;
  sessionStatus: SessionStatus;
  encryptionVersion: number;
  errorCode: CookieErrorCode | null;
}

export class AccountCookiesModel extends BaseDb {
  private repository: Repository<AccountCookiesEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(AccountCookiesEntity);
  }

  /**
   * Get the raw stored row for an account. The `cookies` field is ciphertext
   * (ENC1) for migrated rows or plaintext JSON for legacy rows. Only
   * AccountSessionService interprets / decrypts it.
   */
  async getAccountCookies(
    accountid: number
  ): Promise<AccountCookiesEntity | null> {
    assertNotWorker("getAccountCookies");
    return this.repository.findOne({ where: { account_id: accountid } });
  }

  /**
   * Persist an already-encrypted snapshot (ciphertext + metadata) for an
   * account. Application-level upsert: one row per account_id.
   */
  async saveEncryptedSnapshot(
    accountId: number,
    row: EncryptedSnapshotRow
  ): Promise<number> {
    assertNotWorker("saveEncryptedSnapshot");
    if (!accountId) {
      throw new Error("account id empty");
    }
    const recordtime = getRecorddatetime();
    const now = new Date();
    const existing = await this.getAccountCookies(accountId);

    const metadata = {
      cookies: row.cookies,
      partition_path: row.partitionPath,
      source: row.source,
      cookie_count: row.cookieCount,
      session_status: row.sessionStatus,
      encryption_version: row.encryptionVersion,
      last_error_code: row.errorCode,
      record_time: recordtime,
      updatedAt: now,
    };

    if (existing) {
      await this.repository.update({ id: existing.id }, metadata);
      return existing.id;
    }
    const entity = new AccountCookiesEntity();
    entity.account_id = accountId;
    Object.assign(entity, metadata);
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  /**
   * Return up to `limit` rows whose `cookies` value is NOT an ENC1 envelope
   * (i.e. legacy plaintext candidates) for the background migration.
   */
  async getLegacyCandidateRows(limit: number): Promise<AccountCookiesEntity[]> {
    assertNotWorker("getLegacyCandidateRows");
    return this.repository
      .createQueryBuilder("row")
      .where("row.cookies NOT LIKE :enc", { enc: "ENC1:%" })
      .take(limit)
      .getMany();
  }

  /**
   * Mark a legacy row invalid WITHOUT touching its cookies column (preserve the
   * original bytes for recovery). Sets a bounded error code only.
   */
  async markRowInvalid(
    accountId: number,
    errorCode: CookieErrorCode
  ): Promise<void> {
    assertNotWorker("markRowInvalid");
    const existing = await this.getAccountCookies(accountId);
    if (!existing) {
      return;
    }
    await this.repository.update(
      { id: existing.id },
      {
        session_status: "invalid",
        last_error_code: errorCode,
        migration_attempted_at: getRecorddatetime(),
        updatedAt: new Date(),
      }
    );
  }

  /**
   * @deprecated Legacy plaintext upsert. Production writes now go through
   * AccountSessionService.persistSnapshot -> saveEncryptedSnapshot. Retained
   * for the test harness and any unmigrated caller; callers MUST pass an
   * already-encrypted `cookies` string.
   */
  async saveAccountCookies(
    accountcookies: AccountCookiesEntity
  ): Promise<number> {
    assertNotWorker("saveAccountCookies");
    if (!accountcookies.account_id) {
      throw new Error(`account id empty`);
    }

    const recordtime = getRecorddatetime();
    const now = new Date();
    const existingCookies = await this.getAccountCookies(
      accountcookies.account_id
    );

    if (existingCookies) {
      await this.repository.update(
        { id: existingCookies.id },
        {
          cookies: accountcookies.cookies,
          partition_path: accountcookies.partition_path,
          record_time: recordtime,
          updatedAt: now,
        }
      );
      return existingCookies.id;
    } else {
      accountcookies.record_time = recordtime;
      accountcookies.updatedAt = now;
      const savedCookies = await this.repository.save(accountcookies);
      return savedCookies.id;
    }
  }

  async deleteAccountCookies(accountid: number): Promise<number> {
    assertNotWorker("deleteAccountCookies");
    const result = await this.repository.delete({ account_id: accountid });
    return result.affected || 0;
  }
}
