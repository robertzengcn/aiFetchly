import { Database } from 'better-sqlite3';
import { getRecorddatetime } from "@/modules/lib/function";
import { Scraperdb } from "@/model/scraperdb";
import {SearchResEntity} from "@/entityTypes/scrapeType"
//import { SearchResultModel } from "./SearchResult.model";

export class SearchResultdb {
    db: Database;
    searchResultTable = "search_result";
    constructor(filepath:string) {
        const scraperModel = Scraperdb.getInstance(filepath);
        this.db = scraperModel.getdb();
    }
    //save search task
    public saveResult(data:SearchResEntity): number | bigint {
        const recordtime = getRecorddatetime();
        const stmt = this.db.prepare(
            `INSERT INTO ` +
            this.searchResultTable +
            `(keyword_id,link,title,snippet,visible_link,record_time) VALUES (?,?,?,?,?,?)`
        );
        const info = stmt.run(
            data.keyword_id,
            data.link,
            data.title,
            data.snippet,
            data.visible_link,
            recordtime
        );
        return info.lastInsertRowid;
    }
    public listSearchresult(keywords:number[],page:number,size:number): SearchResEntity[] {
        //join search keyword array with comma
        const placeholders = keywords.map(() => '?').join(',');
        const stmt = this.db.prepare(
            `SELECT * FROM ` + this.searchResultTable+` WHERE keyword_id IN (${placeholders}) LIMIT ? OFFSET ?`  
        );
        const res = stmt.all(...keywords,size,page) as SearchResEntity[];
        return res;
    }
    //count search result by keyword id
    public countSearchResult(keywords:Array<number>):number{
        const placeholders = keywords.map(() => '?').join(',');
        const stmt = this.db.prepare(
            `SELECT COUNT(*) FROM ` + this.searchResultTable+` WHERE keyword_id IN (${placeholders})`  
        );
        const res = stmt.get(...keywords) as { 'COUNT(*)': number };
        return res['COUNT(*)'];
    }
}