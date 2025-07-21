import { Database } from 'better-sqlite3';
//import { getRecorddatetime } from "@/modules/lib/function";
import { Scraperdb } from "@/model/scraperdb";
import {KeywordEntity} from "@/entityTypes/keywords-type"
export class SearchKeyworddb {
    db: Database;
    searchKeywordTable = "search_keyword";
   
    constructor(filepath:string) {
      const scraperModel = Scraperdb.getInstance(filepath);
      this.db = scraperModel.getdb();
    }
    
    //save search task
    public saveSearchKeyword(keyword: string,taskId:number): number | bigint {
  
    //   const recordtime = getRecorddatetime();
    
        const stmt = this.db.prepare(
          `INSERT INTO ` +
            this.searchKeywordTable +
            ` (keyword,task_id) VALUES (?,?)`
        );
        const info = stmt.run(
          keyword,
          taskId
        );
        return info.lastInsertRowid;
    }

    //get keyword id by keyword string and task id
    public getKeywordId(keyword: string,taskId:number): number | bigint {
      const stmt = this.db.prepare(
        `SELECT id FROM ` + this.searchKeywordTable + ` WHERE keyword=? and task_id=?`
      );
      const info = stmt.get(keyword,taskId) as {id:number};
      if(info){
      return info.id;
      }else{
        return 0
      }
    }
    //get keywords by task id
    public getkeywrodsbyTask(taskId:number):Array<string>{
      const stmt = this.db.prepare(
        `SELECT keyword FROM ` + this.searchKeywordTable + ` WHERE task_id=?`
      );
      const keywordArr=stmt.all(taskId) as Array<{keyword:string}>;
      const res:Array<string>=[]
      keywordArr.forEach((item)=>{
     //   console.log(item)
        res.push(item.keyword)
      })
      // console.log(res)
      return res;
    }
    //get keywords entity by task id
    public getkeywrodsEntitybyTask(taskId:number):Array<KeywordEntity>{
      const stmt = this.db.prepare(
        `SELECT * FROM ` + this.searchKeywordTable + ` WHERE task_id=?`
      );
      const keywordArr=stmt.all(taskId) as Array<KeywordEntity>;
      return keywordArr;
    }
    //get keywords entity by keyword id
    public getkeywrodsEntitybyId(keywordId:number):KeywordEntity{
      const stmt = this.db.prepare(
        `SELECT * FROM ` + this.searchKeywordTable + ` WHERE id=?`
      );
      const keyword=stmt.get(keywordId) as KeywordEntity;
      return keyword;
    }
}