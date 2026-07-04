import { Repository } from "typeorm";
import { HookConfigEntity } from "@/entity/HookConfig.entity";
import { SqliteDb } from "@/config/SqliteDb";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";

/**
 * Data access for persisted user hooks. Main-process only — the
 * constructor throws when `process.env.WORKER_TYPE` is set, which
 * is how worker processes are detected project-wide.
 */
export type NewHookRow = Omit<
  HookConfigEntity,
  | "lastRunAt"
  | "lastRunStatus"
  | "createdAt"
  | "updatedAt"
  | "matcher"
  | "cwd"
  | "statusMessage"
  | "envAllowlist"
> &
  Partial<
    Pick<HookConfigEntity, "matcher" | "cwd" | "statusMessage" | "envAllowlist">
  >;

export type HookPatch = Partial<
  Pick<
    HookConfigEntity,
    | "eventName"
    | "matcher"
    | "hookType"
    | "command"
    | "cwd"
    | "timeoutMs"
    | "failureMode"
    | "statusMessage"
    | "envAllowlist"
    | "enabled"
    | "trusted"
  >
>;

/**
 * Does NOT extend BaseDb because the worker-process guard must run
 * before `super()`, which TypeScript requires to be the first call
 * in a subclass constructor. Standalone class with explicit dbpath
 * resolution instead.
 */
export class HookModel {
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

  private async getRepository(): Promise<Repository<HookConfigEntity>> {
    if (!this.dbpath) throw new Error("Database path not available");
    const db = SqliteDb.getInstance(this.dbpath);
    if (!db.connection.isInitialized) {
      await SqliteDb.ensureInitialized();
    }
    return db.connection.getRepository(HookConfigEntity);
  }

  async create(row: NewHookRow): Promise<HookConfigEntity> {
    const repo = await this.getRepository();
    const entity = new HookConfigEntity();
    Object.assign(entity, row);
    return repo.save(entity);
  }

  async findById(id: string): Promise<HookConfigEntity | null> {
    const repo = await this.getRepository();
    return repo.findOne({ where: { id } });
  }

  async listBySource(source: string): Promise<HookConfigEntity[]> {
    const repo = await this.getRepository();
    return repo.find({ where: { source } });
  }

  async listAll(): Promise<HookConfigEntity[]> {
    const repo = await this.getRepository();
    return repo.find();
  }

  async update(id: string, patch: HookPatch): Promise<HookConfigEntity> {
    const repo = await this.getRepository();
    await repo.update({ id }, patch as Record<string, unknown>);
    const refreshed = await repo.findOne({ where: { id } });
    if (!refreshed) throw new Error(`Hook not found: ${id}`);
    return refreshed;
  }

  async deleteById(id: string): Promise<void> {
    const repo = await this.getRepository();
    await repo.delete({ id });
  }

  async deleteAll(): Promise<void> {
    const repo = await this.getRepository();
    await repo.clear();
  }

  async updateRunStatus(id: string, status: string, at: Date): Promise<void> {
    const repo = await this.getRepository();
    await repo.update({ id }, { lastRunStatus: status, lastRunAt: at });
  }
}
