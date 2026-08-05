
// filepath: /path/to/AccountCookies.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import AuditableEntity from "@/entity/Auditable.entity"
import type {
  StoredCookieSource,
  SessionStatus,
  CookieErrorCode,
} from "@/schemas/accountCookies";

/**
 * `cookies` holds the ENC1 ciphertext envelope (ENC1:<iv>:<ct+tag>) after
 * migration. Legacy rows may still contain plaintext JSON until the
 * AccountSessionService migration rewrites them. The model layer treats this
 * column as opaque ciphertext; only AccountSessionService decrypts it.
 *
 * The nullable metadata columns below are NON-SECRET and exist only to support
 * UI status display and safe diagnostics. `last_error_code` is a bounded enum
 * string — it must never hold a raw exception message, cookie value, URL, or
 * path.
 */
@Entity('account_cookies')
export class AccountCookiesEntity extends AuditableEntity{
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  account_id: number;

  /** ENC1 envelope after migration; plaintext JSON only for unmigrated rows. */
  @Column({ type: 'text' })
  cookies: string;

  @Column({ type: 'text' })
  partition_path: string;

  @Column({ type: 'text', nullable: true })
  record_time: string;

  /** 1 for FieldCipher ENC1. Null for legacy plaintext rows. */
  @Column({ type: 'integer', nullable: true })
  encryption_version: number | null;

  /** Where this snapshot came from. Null for legacy rows. */
  @Column({ type: 'text', nullable: true })
  source: StoredCookieSource | null;

  /** Count of cookies in the encrypted snapshot (UI display). */
  @Column({ type: 'integer', nullable: true })
  cookie_count: number | null;

  /** Availability state shown to the user. Null until first evaluated. */
  @Column({ type: 'text', nullable: true })
  session_status: SessionStatus | null;

  /** Bounded error code (never raw errors / cookie values / paths). */
  @Column({ type: 'text', nullable: true })
  last_error_code: CookieErrorCode | null;

  /** ISO timestamp of the last migration attempt on this row. */
  @Column({ type: 'text', nullable: true })
  migration_attempted_at: string | null;
}
