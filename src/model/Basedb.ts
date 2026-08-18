//import { Scraperdb } from "./scraperdb";
import { Database } from "better-sqlite3";
import { log } from "@/modules/Logger";
import { SqliteDb } from "@/config/SqliteDb";
export abstract class BaseDb {
  protected db!: Database;
  // protected connectionString: string;
  protected sqliteDb: SqliteDb;
  constructor(filepath: string) {
    this.assertNotWorker();
    if (!filepath) {
      // For testing environments, use a temp directory
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
      filepath = tmpDir;
    }
    //const scraperModel = Scraperdb.getInstance(filepath);
    //this.db = scraperModel.getdb();
    this.sqliteDb = SqliteDb.getInstance(filepath);
    this.installConnectionGuards();
  }

  /**
   * Models are frequently constructed while the shared DataSource is still
   * initializing. TypeORM repositories can be created at that point, but any
   * operation that reads entity metadata will fail. Guard every async model
   * entry point centrally so legacy models cannot bypass initialization.
   */
  private installConnectionGuards(): void {
    let prototype: object | null = Object.getPrototypeOf(this) as object;

    while (prototype && prototype !== BaseDb.prototype) {
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (
          methodName === "constructor" ||
          Object.prototype.hasOwnProperty.call(this, methodName)
        ) {
          continue;
        }

        const descriptor = Object.getOwnPropertyDescriptor(
          prototype,
          methodName
        );
        const method = descriptor?.value as
          | ((...args: unknown[]) => Promise<unknown>)
          | undefined;
        if (
          typeof method !== "function" ||
          method.constructor.name !== "AsyncFunction"
        ) {
          continue;
        }

        const guardedMethod = async (...args: unknown[]): Promise<unknown> => {
          await this.ensureConnection();
          return await method.apply(this, args);
        };

        Object.defineProperty(this, methodName, {
          configurable: true,
          enumerable: false,
          value: guardedMethod,
          writable: true,
        });
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
  }

  /**
   * Ensure database connection is initialized before use
   * This should be called before any database operation
   */
  public async ensureConnection(): Promise<void> {
    await SqliteDb.ensureInitialized();
  }

  /**
   * Workers MUST NOT touch the database: they have no Electron `app` context and
   * no DB connection, and must send data to the main process via IPC. This makes
   * the documented rule (CLAUDE.md "Child/Worker Process Database Access") an
   * enforced invariant at the base layer, rather than a per-model convention
   * (previously checked in only ~4 models).
   */
  protected assertNotWorker(): void {
    if (process.env.WORKER_TYPE) {
      throw new Error(
        `Direct database access from worker process is not allowed (worker: ${process.env.WORKER_TYPE}). Workers must send data to the main process via IPC instead.`
      );
    }
  }

  protected log(message: string): void {
    log.info(`[BaseDb]: ${message}`);
  }
}
