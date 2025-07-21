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
            // throw new Error("user path not exist")
            this.dbpath = dbpath
            this.sqliteDb = SqliteDb.getInstance(this.dbpath)
        }else{
            console.error("dbpath not found")
        }
        
        }
}