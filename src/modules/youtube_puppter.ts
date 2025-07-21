"use strict";
//import { upload } from 'youtube-videos-uploader'
//import { PuppeteerNodeLaunchOptions } from 'puppeteer';

export type credentials={
    email:string,
    pass:string,
    recoveryemail:string
}

export interface Video {
    path: string;
    title: string;
    description: string;
    tags?: string[];
    language?: string;
    playlist?: string;
    function?: any;
    thumbnail?: string;
    publishType?: 'PRIVATE' | 'UNLISTED' | 'PUBLIC';
    onSuccess?: (url: string) => void;
    skipProcessingWait?: boolean;  
    channelName?: string;
    uploadAsDraft?: boolean;
    isAgeRestriction?: boolean;
    isNotForKid?: boolean;
    isChannelMonetized?: boolean;
    gameTitleSearch?: string;
 
}
export class youtubePuppter{

    // constructor() {
    // }
    uploadVideo(credentials:credentials,videoInfos:Array<Video>){
        //upload (credentials, videoInfos, puppeteerConfig).then(console.log)
    }

    
}