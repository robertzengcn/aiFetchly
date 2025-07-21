//import { Scraperdb } from "./scraperdb";
import { Database } from 'better-sqlite3';
import {SqliteDb} from "@/config/SqliteDb"
export abstract class BaseDb {
    protected db: Database;
    // protected connectionString: string;
    protected sqliteDb:SqliteDb
     constructor(filepath:string) {
        if(filepath){
        //const scraperModel = Scraperdb.getInstance(filepath);
        //this.db = scraperModel.getdb();
       this.sqliteDb = SqliteDb.getInstance(filepath)
        }
    }
    

    

    protected log(message: string): void {
        console.log(`[BaseDb]: ${message}`);
    }
    

}

