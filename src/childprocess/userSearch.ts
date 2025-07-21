import { Usersearchdata } from "@/entityTypes/searchControlType"
import { ScrapeManager } from "@/childprocess/scrapeManager"
import { SMstruct, SearchDataParam,ResultParseItemType } from "@/entityTypes/scrapeType"
import { Cluster } from "puppeteer-cluster"
import { SearhEnginer } from "@/config/searchSetting"
import { ToArray } from "@/modules/lib/function"
import { CustomError } from "@/modules/customError"
import {SearchDataRun} from "@/entityTypes/scrapeType"
// import { ProxyController } from "@/controller/proxy-controller";
import {proxyEntityToUrl,getEnumKeyByValue} from "@/modules/lib/function"
import { ProxyParseItem} from "@/entityTypes/proxyType"

export class UserSearch {
    public async searchData(data: Usersearchdata,callback?: (arg: ResultParseItemType) => void):Promise<void> {

        const proxyStrList:Array<string> = []
        console.log("proxy are following")
       // console.log(data.proxys)
        if (data.proxys) {
               data.proxys.forEach((value, key) => {
                   const proxyitem:ProxyParseItem = {
                       host: value.host,
                       port: value.port,
                       user: value.user,
                       pass: value.pass,
                       protocol: value.protocol
                   }
                   const proxyStr=proxyEntityToUrl(proxyitem)
                   proxyStrList.push(proxyStr)
               })
           }
        //    if(data.cookies){
        //     for(const cookie of data.cookies){
        //         // const cookieStr=cookie.map((value)=>value.name+"="+value.value).join(";")
        //         // proxyStrList.push(cookieStr)
        //     }
        //    }
       
        const smConfig: SMstruct = {
            headless: data.notShowBrowser,
            debug_level: 1,
            puppeteer_cluster_config: {
                timeout: 30 * 60 * 1000, // max timeout set to 10 minutes
                monitor: true,
                //concurrency: Cluster.CONCURRENCY_BROWSER,
                //concurrency:data.concurrency, // one scraper per tab
               maxConcurrency: data.concurrency, // scrape with 1 tab
               
            },
            num_pages: data.num_pages,
            proxies: proxyStrList,
            debug_log_path:data.debug_log_path,
            save_html:true

        }
        const keywords = data.keywords
        const scraper = new ScrapeManager(smConfig)
        // Convert SearhEnginer to key-value format for easier validation
        
        // const searchEngineMap = {};
        // const searchEngineArray = ToArray(SearhEnginer);
        // searchEngineArray.forEach(engine => {
        //     searchEngineMap[engine] = true;
        // });
       const SeachEnginArr = ToArray(SearhEnginer)
        let enginer = ""
        // console.log(SeachEnginArr)
        SeachEnginArr.forEach(async (value, key) => {
            if (Number(data.searchEnginer) === key+1) {
                enginer = value
            }
        })
        
        // const enginer=getEnumKeyByValue(SearhEnginer,data.searchEnginer)
        if(!enginer){
            throw new CustomError("search enginer is incorrect:"+data.searchEnginer,20240801112434)
        }

        // await scraper.start()
        const searchDataParam: SearchDataParam = {
            keywords: keywords,
            engine: enginer,
            cookies:data.cookies
            //useLocalbrowserdata:data.useLocalbrowserdata
        }
       const results = await scraper.searchdata(searchDataParam)
        //console.log(results)
        if(callback){
            for(const result of results){
            callback(result)
            }
        }
        //return results
    }

}