import { Video } from '@/modules/interface/Video';
import { Downloader } from "@/modules/bilibili/downloader";
import * as path from "path"
import {videoScraper} from "@/entityTypes/videoType"

// import * as sanitize from "filenamify";
import { default as sanitize } from "filenamify";

export class bilibiliVideo implements Video {
  constructor(){
         
 }
    public async checkRequirement():Promise<boolean>{
      // console.log("check requirement")
      return true

    }

    public getPackagepath():string{
      return ""
    }

    public async download(link:string,videopath:string,cookies:string) {
        if (!link) {
            throw new Error("link is empty")
          }
          const downloader = new Downloader();
          downloader.getVideoUrl(link);
          if (!downloader.url) {
            throw new Error("video url invalid");
          }
          await downloader.getAid();
      
          const videores = await downloader.getInfo();
         
          // const downloadPath ='/home/robertzeng/downloadtest';
          const filename = Math.random().toString(20).slice(2);
          const { data, fallback } = await downloader.getData();
      
          const target = data.durl || data.result.durl;
          const quality = data.quality || data.result.quality,
            qualityArray = {
              112: "1080P+",
              80: "1080P",
              74: "720P60",
              64: "720P",
              48: "720P",
              32: "480P",
              16: "360P",
              15: "360P",
            };
          const videoQuantity = qualityArray[quality] || "unknown";
          
          if (fallback) {
            throw new Error("error happen when get video data");
          }
          // debug("echo target");
          // debug(target);
        const result: Array<string> = [];
        target.forEach((element, part) => {
            const file = path.join(videopath, `${sanitize(filename)}-${part}.flv`);

            const state = downloader.downloadByIndex(
                part,
                file,
                (progress, index) => {
                    const { speed, eta, percentage } = progress; //显示进度条
                    // console.log("speed: " + Math.round(speed / 1e3) + "KB/s");
                    // console.log(`eta:${eta}s`);
                }
            );
            result.push(file)
        });
        return result;
    }
  }