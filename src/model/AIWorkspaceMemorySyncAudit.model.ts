import { BaseDb } from "@/model/Basedb";
import { AIWorkspaceMemorySyncAuditEntity } from "@/entity/AIWorkspaceMemorySyncAudit.entity";
import { Repository, LessThan, In } from "typeorm";
import { randomUUID } from "crypto";

export interface SyncAuditCreateFields {
  readonly scopeId: string;
  readonly memoryId?: string | null;
  readonly relativePath?: string | null;
  readonly action: string;
  readonly actor: string;
  readonly outcome: string;
  readonly previousHash?: string | null;
  readonly nextHash?: string | null;
  readonly diagnosticCode?: string | null;
  readonly message?: string | null;
}

/** Retention policy (design §8.5): newest 5,000 events or 90 days. */
const MAX_AUDIT_ROWS = 5000;
const AUDIT_RETENTION_DAYS = 90;

/**
 * Append-only, content-free audit trail for portable memory operations.
 * Never stores memory titles/bodies/secrets — only hashes, codes, and
 * sanitized messages (design D-07).
 */
export class AIWorkspaceMemorySyncAuditModel extends BaseDb {
  public repository: Repository<AIWorkspaceMemorySyncAuditEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Worker should send data to main process via IPC."
      );
    }
    this.repository = this.sqliteDb.connection.getRepository(
      AIWorkspaceMemorySyncAuditEntity
    );
  }

  async append(
    input: SyncAuditCreateFields
  ): Promise<AIWorkspaceMemorySyncAuditEntity> {
    const e = new AIWorkspaceMemorySyncAuditEntity();
    e.eventId = `pmem-event-${randomUUID()}`;
    e.scopeId = input.scopeId;
    e.memoryId = input.memoryId ?? null;
    e.relativePath = input.relativePath ?? null;
    e.action = input.action;
    e.actor = input.actor;
    e.outcome = input.outcome;
    e.previousHash = input.previousHash ?? null;
    e.nextHash = input.nextHash ?? null;
    e.diagnosticCode = input.diagnosticCode ?? null;
    e.message = input.message ? sanitizeAuditMessage(input.message) : null;
    return this.repository.save(e);
  }

  async listByScope(
    scopeId: string,
    limit = 100
  ): Promise<AIWorkspaceMemorySyncAuditEntity[]> {
    return this.repository.find({
      where: { scopeId },
      order: { createdAt: "DESC" },
      take: Math.max(1, Math.min(limit, 500)),
    });
  }

  /** Move every audit row from one scope to another (scope merge step 4). */
  async reassignScope(fromScopeId: string, toScopeId: string): Promise<number> {
    const r = await this.repository.update(
      { scopeId: fromScopeId },
      { scopeId: toScopeId }
    );
    return r.affected ?? 0;
  }

  /**
   * Best-effort retention cleanup after a successful synchronization.
   * Failures are swallowed — cleanup must never block sync.
   */
  async enforceRetention(now: Date = new Date()): Promise<void> {
    try {
      const cutoff = new Date(
        now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );
      await this.repository.delete({ createdAt: LessThan(cutoff) });
      const total = await this.repository.count();
      if (total > MAX_AUDIT_ROWS) {
        const oldest = await this.repository.find({
          order: { createdAt: "ASC" },
          take: total - MAX_AUDIT_ROWS,
        });
        if (oldest.length > 0) {
          await this.repository.delete({
            eventId: In(oldest.map((e) => e.eventId)),
          } as never);
        }
      }
    } catch {
      // Retention is advisory; never propagate.
    }
  }
}

function sanitizeAuditMessage(message: string): string {
  // Strip anything resembling a secret pattern and cap length.
  let out = message.replace(
    /\b(sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
    "[REDACTED]"
  );
  if (out.length > 1000) out = out.slice(0, 1000);
  return out;
}
