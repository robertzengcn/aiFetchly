"use strict";
export {};
// import { debug } from "console";
// import { debug } from "console";
// import {ScrapeManager,SMstruct} from "../node_socialmk";
// import { RemoteSource } from "./remotesource"
// import {Scraperdb} from "../model/scraperdb";
// const debug = require('debug')('index');
// // var Scraper = require("./src/modules/social_scraper");

// export type ScrapeConfig={
//   // which search engine to scrape
//   // platform: "facebook",
//   // an array of keywords to scrape
//   keywords?: Array<string>,
//   // the number of pages to scrape for each keyword
//   num_pages?: number,

//   // OPTIONAL PARAMS BELOW:
//   // google_settings: {
//   //     gl: 'us', // The gl parameter determines the Google country to use for the query.
//   //     hl: 'fr', // The hl parameter determines the Google UI language to return results.
//   //     start: 0, // Determines the results offset to use, defaults to 0.
//   //     num: 100, // Determines the number of results to show, defaults to 10. Maximum is 100.
//   // },
//   // instead of keywords you can specify a keyword_file. this overwrites the keywords array
//   keyword_file?: string,
//   // how long to sleep between requests. a random sleep interval within the range [a,b]
//   // is drawn before every request. empty string for no sleeping.
//   sleep_range?: Array<number>,
//   // path to output file, data will be stored in JSON
//   output_file?: string,
//   // whether to prevent images, css, fonts from being loaded
//   // will speed up scraping a great deal
//   block_assets: boolean,
//   // check if headless chrome escapes common detection techniques
//   // this is a quick test and should be used for debugging
//   test_evasion?: boolean,
//   apply_evasion_techniques: boolean,
//   // log ip address data
//   log_ip_address?: boolean,
//   // log http headers
//   log_http_headers?: boolean,
//   platform: string,
//   user?:string,
//   pass?: string,
//   tmppath?:string,
//   taskid?:number,
//   resulttaskid?:number,
//   taskrunid?:number
// }
// export async function Login(browser_config:SMstruct, scrape_config:ScrapeConfig) {
//   // scrape config overwrites the browser_config
//   Object.assign(browser_config, scrape_config);

//   var scraper = new ScrapeManager(browser_config);
//   // var remoteConfig=await scraper.getRemoteConfig();
//   await scraper.start();

//   var results = await scraper.login(scrape_config);

//   await scraper.quit();

//   return results;
// }
// //get data urls
// export async function Searchdata(browser_config:SMstruct, scrape_config:ScrapeConfig) {
//   // scrape config overwrites the browser_config
//   Object.assign(browser_config, scrape_config);
//   // debug(browser_config)
//   const scraper = new ScrapeManager(browser_config);
//   // var remoteConfig=await scraper.getRemoteConfig();
//   console.log("scraper task id"+scraper.taskid)
//   await scraper.start();
//   await scraper.searchdata(scrape_config);

//   await scraper.quit();
// }
// /**
//  * get link from remote and download video
//  * @param browser_config 
//  * @param scrape_config 
//  */
// export async function Downloadvideo(browser_config:SMstruct, scrape_config:ScrapeConfig) {
//   Object.assign(browser_config, scrape_config);
//   const scropeNum=5;
//   // var scraper = new ScrapeManager(browser_config);
//   const remoteSourmodel = new RemoteSource();
//   debug("result task id is "+scrape_config.resulttaskid)
//   if(!scrape_config.resulttaskid){
//     throw new Error("result_taskid is null")
//   }
//   const linklist=await remoteSourmodel.Getscrapyinfolist(scrape_config.resulttaskid,scropeNum)
//   debug(linklist)
//   if(!linklist){
//     throw new Error("video link list is null")   
//   }
//   if(linklist.length<1){
//     throw new Error("link list is empty")
//   }
//   var scraper = new ScrapeManager(browser_config);
 
//   scraper.downloadPlatomvideo(linklist)

// }
// export async function Sqlinit(){
//   const scraperdb=Scraperdb.getInstance();
//   scraperdb.init();
// }


