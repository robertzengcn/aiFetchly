// 'use strict';
// export { };
// import { Observer } from './subject';
// //import { ScrapeVideo } from './socialScraper';
// // import {Scraperdb} from "../model/scraperdb";
// import { RemoteSource } from "./remotesource";
// import { Videoedit } from "./videoedit";
// // const debug = require("debug")("Observer:videodownloadObserver");
// //const appRoot = require('app-root-path');
// import * as path from "path";
// import { Videodb } from "@/model/videodb";
// import { Token } from "@/modules/token"
// import { USERSDBPATH } from "@/config/usersetting";

// export class videodownloadObserver implements Observer {
    
//     update(type: string, data: any) {
//         switch (type) {
//             case 'downloadvideoend':
//                 this.videodownloadend(data as ScrapeVideo);
//                 break;
//             default:
//                 break;
//         }
//     }
//     async videodownloadend(data: ScrapeVideo) {
//         // debug(data);
//         //save data to video db
//         // const scraperDb = Scraperdb.getInstance(); 
//         //move follow code to main process
//         // const tokenService = new Token()
//         // const dbpath = await tokenService.getValue(USERSDBPATH)
//         // if (dbpath) {
//         //     const videoDb = new Videodb(dbpath);
//         //     //const vemodel=new Videoedit();
//         //     //const outputpath=path.resolve(appRoot+"/tmp/video/filterwater/")
//         //     //const outputpathfilename=outputpath+path.sep+Math.random().toString(16).slice(2)+".mp4"
//         //     //save video data to db
//         //     videoDb.saveVideo(data.video)
//         //     //update remote data
//         //     const remoteSourmodel = new RemoteSource();
//         //     if (data.scrapeinfo.id) {
//         //         remoteSourmodel.Updateprocesstime(data.scrapeinfo.id);
//         //     }
//         // }
//     }
// }