import { Repository } from "typeorm";
import { HookAuditEntryEntity } from "@/entity/HookAuditEntry.entity";
import { SqliteDb } from "@/config/SqliteDb";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";

export interface HookAuditRow {
  hookRunId: string;
  hookId: string;
  eventName: string;
  source: string;
  type: string;
  matchQuery: string | null;
  status: string;
  durationMs: number | null;
  reason: string | null;
  timestamp: Date;
}

export interface HookAuditQuery {
  hookId?: string;
  eventName?: string;
  status?: string;
  fromTime?: Date;
  toTime?: Date;
  limit: number;
  offset: number;
}

export interface HookAuditQueryResult {
  rows: HookAuditEntryEntity[];
  total: number;
}

/**
 * Data access for hook audit entries. Append-only: no update method
 * exposed. Main-process only — the constructor throws when
 * `process.env.WORKER_TYPE` is set, which is how worker processes
 * are detected project-wide.
 *
 * Does NOT extend BaseDb because the worker-process guard must run
 * before `super()`, which TypeScript requires to be the first call
 * in a subclass constructor. Standalone class with explicit dbpath
 * resolution instead.
 */
export class HookAuditModel {
  private readonly dbpath: string;

  constructor(dbpath: string) {
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Worker should send data to main process via IPC for database operations."
      );
    }
    const tokenService = new Token();
    const resolved = dbpath || tokenService.getValue(USERSDBPATH) || "";
    if (resolved) {
      this.dbpath = resolved;
    } else {
      // Test environment fallback: use a temp directory (mirrors BaseModule)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const os = require("os") as typeof import("os");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("path") as typeof import("path");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs") as typeof import("fs");
      const tmpDir = path.join(os.tmpdir(), "aifetchly-test");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      this.dbpath = tmpDir;
    }
  }

  private async getRepository(): Promise<Repository<HookAuditEntryEntity>> {
    if (!this.dbpath) throw new Error("Database path not available");
    const db = SqliteDb.getInstance(this.dbpath);
    if (!db.connection.isInitialized) {
      await SqliteDb.ensureInitialized();
    }
    return db.connection.getRepository(HookAuditEntryEntity);
  }

  async insert(row: HookAuditRow): Promise<HookAuditEntryEntity> {
    const repo = await this.getRepository();
    const entity = new HookAuditEntryEntity();
    Object.assign(entity, row);
    return repo.save(entity);
  }

  async query(q: HookAuditQuery): Promise<HookAuditQueryResult> {
    const repo = await this.getRepository();
    const qb = repo.createQueryBuilder("a");

    if (q.hookId) qb.andWhere("a.hookId = :hookId", { hookId: q.hookId });
    if (q.eventName)
      qb.andWhere("a.eventName = :eventName", { eventName: q.eventName });
    if (q.status) qb.andWhere("a.status = :status", { status: q.status });
    if (q.fromTime)
      qb.andWhere("a.timestamp >= :fromTime", { fromTime: q.fromTime });
    if (q.toTime) qb.andWhere("a.timestamp <= :toTime", { toTime: q.toTime });

    qb.orderBy("a.timestamp", "DESC").skip(q.offset).take(q.limit);

    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async clear(): Promise<void> {
    const repo = await this.getRepository();
    await repo.clear();
  }
}
