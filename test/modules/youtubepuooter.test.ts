'use strict';
import {youtubePuppter,credentials,Video} from '../../src/modules/youtube_puppter';
const appRoot = require('app-root-path');
import * as path from "path";

// describe('Module Puppter Youtube upload', function(){
//     it('upload-video', function(){
//         const youtubeModel=new youtubePuppter()
//         const credentials:credentials={
//             email:"",
//             pass:"",
//             recoveryemail:""
//         }
//         const onVideoUploadSuccess = (videoUrl) => {
//             console.log('videoUrl', videoUrl)
//         }
//     const videopath=path.resolve(appRoot+"/tmp/test/test2.flv")
//     const videoInfo:Video={
//         title:"Life in Southeast Asia",
//         description:"How is life in Southeast Asia? Let me take a video to show everyone",
//         path:videopath,
//         tags:["southeast asia","travel","life"],
//         language:"Chinese",
//         publishType: 'PUBLIC',
//         onSuccess:onVideoUploadSuccess
//     }
//     const puppeteerConfig={
//         headless:false,
//         executablePath: '/usr/bin/google-chrome',
//         ignoreDefaultArgs:['--enable-automation', '--disable-extensions', '--disable-default-apps', '--disable-component-extensions-with-background-pages']
//     }
   
//     youtubeModel.uploadVideo(credentials,[videoInfo],puppeteerConfig)
// });
// })