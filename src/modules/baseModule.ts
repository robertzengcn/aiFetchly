import { Token } from "@/modules/token"
import { USERSDBPATH } from '@/config/usersetting';
import {SqliteDb} from "@/config/SqliteDb"
export abstract class BaseModule {
    protected dbpath: string
   protected sqliteDb:SqliteDb
    constructor() {
        const tokenService = new Token()
        const dbpath = tokenService.getValue(USERSDBPATH)
        if (dbpath) {
            this.dbpath = dbpath
            this.sqliteDb = SqliteDb.getInstance(this.dbpath)
        }else{
            // For testing environments, use a temp directory
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const os = require('os') as typeof import('os');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const path = require('path') as typeof import('path');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('fs') as typeof import('fs');

            // Create a temp directory for test databases
            const tmpDir = path.join(os.tmpdir(), 'aifetchly-test');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            this.dbpath = tmpDir;
            this.sqliteDb = SqliteDb.getInstance(this.dbpath);
        }

        }

    /**
     * Ensure database connection is initialized before use
     * This should be called before any database operation
     */
    public async ensureConnection(): Promise<void> {
        if (!this.sqliteDb.connection.isInitialized) {
            await this.sqliteDb.connection.initialize();
        }
    }
}