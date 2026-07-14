import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import { SqliteDb } from "@/config/SqliteDb";

/**
 * WS-5 R5.2: The constructor resolves the DB path (a lightweight Token read)
 * but does NOT touch the DB singleton (SqliteDb.getInstance) or the filesystem
 * (fs.mkdirSync) — those are deferred to ensureConnection(). This makes
 * `new SomeModule()` non-destructive: no DB connection, no directory creation.
 *
 * The 71 subclasses that use `this.dbpath` in their constructors still work
 * (the path is available from the Token read). Only `this.sqliteDb` is deferred
 * (used by 5 modules — they must call ensureConnection first, which they do).
 */
export abstract class BaseModule {
  protected dbpath: string;
  protected sqliteDb: SqliteDb;
  private dbInitialized = false;

  constructor() {
    // Resolve the DB path via Token (lightweight electron-store read).
    // Do NOT call SqliteDb.getInstance or fs.mkdirSync here — deferred to
    // ensureConnection() so construction is non-destructive in tests.
    const tokenService = new Token();
    const dbpath = tokenService.getValue(USERSDBPATH);
    this.dbpath = dbpath || "";
  }

  /**
   * Ensure database connection is initialized before use.
   * This should be called before any database operation.
   *
   * WS-5 R5.2: the DB singleton + temp-dir creation (previously in the
   * constructor) are resolved here on first call (idempotent via dbInitialized).
   */
  public async ensureConnection(): Promise<void> {
    if (!this.dbInitialized) {
      if (!this.dbpath) {
        // Deferred from the constructor: create a temp directory for test/dev
        // environments where USERSDBPATH is not set.
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
      this.sqliteDb = SqliteDb.getInstance(this.dbpath);
      this.dbInitialized = true;
    }
    await SqliteDb.ensureInitialized();
  }
}
