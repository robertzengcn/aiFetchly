// import { Database } from 'sqlite3';
import Database from 'better-sqlite3';
import { log } from "@/modules/Logger";
//const Database = require('better-sqlite3');
// import DatabaseConstructor,{Database}from 'better-sqlite3';
import * as fs from 'fs';
// const debug = require("debug")("scraperdb");
//import appRoot from 'app-root-path';
import * as path from 'path';


export class Scraperdb {
    private static instance: Scraperdb;
    dbname="scraper.db";
    db;
    pathdb!:string
    isDevelopment = process.env.NODE_ENV !== 'production';
    private constructor(filepath:string) {
        
        // debug(dbpath) 
        // this.dbname = "scraper.db";
        //const dbpath = path.join(filepath, this.dbname)
        if(!filepath||filepath.length==0){
            log.info("no filepath")
            return
        }
        this.pathdb = this.getdbpath(filepath)
        log.info("path db is"+this.pathdb)
        // if (fs.existsSync(dbpath)) {
        //     this.init()
        // }
        // debug(this.dbname)
        this.db = new Database(this.pathdb, { verbose: log.info});
        this.db.pragma('journal_mode = WAL');
    }


    public static getInstance(filepath:string): Scraperdb {
        if (!Scraperdb.instance) {
            Scraperdb.instance = new Scraperdb(filepath);
        }
        return Scraperdb.instance;
    }
    init() {
        //this.createTables();
    }
    //get database
    getdb(){
        return this.db;
    }
    getdbpath(filepath){
        return path.join(filepath, this.dbname)
    }
    /**
     * create video table
     */
    createTables() {
        // const dbpath: string = path.resolve(appRoot + "/tmp/db/");

        if (!fs.existsSync(this.pathdb)) {
            fs.mkdirSync(this.pathdb, { recursive: true });
        }
        // console.log(appRoot.path)
        //const tablepath = path.join(import.meta.env.BASE_URL ,"sql/scraperdb/");
        //console.log(tablepath )
        let sqlFilePath = '';
        if(this.isDevelopment){
            sqlFilePath = path.join(__dirname, '../../dist/sql/scraperdb/');
        }else{
            // process.resourcesPath is available in packaged Electron apps
            const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
            if (resourcesPath) {
                sqlFilePath = path.join(resourcesPath, 'dist/sql/scraperdb/');
            } else {
                sqlFilePath = path.join(__dirname, '../../dist/sql/scraperdb/');
            }
        }
        log.info(sqlFilePath)
        fs.readdir(sqlFilePath, (err, files) => {
            log.info(files)
            // debug(files)
            if(files){
            files.forEach(file => {
                this.db.exec(fs.readFileSync(path.join(sqlFilePath, file), 'utf8').toString());
                log.info(file+"created")
            });
        }
            // console.log("finish")
        });
    }  
}

  
    


