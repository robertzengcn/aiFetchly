//import { Scraperdb } from "./scraperdb";
import { Database } from 'better-sqlite3';
import {SqliteDb} from "@/config/SqliteDb"
export abstract class BaseDb {
    protected db: Database;
    // protected connectionString: string;
    protected sqliteDb:SqliteDb
     constructor(filepath:string) {
        if(!filepath){
            // For testing environments, use a temp directory
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const os = require('os') as NodeJS.OS;
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const path = require('path') as typeof import('path');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('fs') as typeof import('fs');
            const tmpDir = path.join(os.tmpdir(), 'aifetchly-test');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }
            filepath = tmpDir;
        }
        //const scraperModel = Scraperdb.getInstance(filepath);
        //this.db = scraperModel.getdb();
       this.sqliteDb = SqliteDb.getInstance(filepath)
    }
    

    

    protected log(message: string): void {
        console.log(`[BaseDb]: ${message}`);
    }
    

}

