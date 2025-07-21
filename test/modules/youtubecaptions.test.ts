'use strict';
// import {authorize} from '../../src/modules/google_auth';
// import {insertCapptions} from '../../src/modules/youtube_captions';
const appRoot = require('app-root-path');
import * as path from "path";
const fs = require('fs');

describe('Module Youtube Captions', function(){
    
    //test insert youtube captions
    it('insert-captions', function(){
       
        // fs.readFile(path.resolve(appRoot+"/tmp/client_secret_909593013988-qaggscg7gntilse2k5k3jj1qveb419i8.apps.googleusercontent.com.json"), function processClientSecrets(err, content) {
        //     if (err) {
        //     throw new Error('Error loading client secret file: ' + err); 
        //     }
        //     const title="Southeast Asian Story Captions";
        //     const videoId="Yol0AdF0aLw";
        //     const language='zh-CN';
            
        //     const captionpath=path.resolve(appRoot+"/tmp/test/test.srt");
        //     // Authorize a client with the loaded credentials, then call the YouTube API.
        //     authorize(JSON.parse(content), (auth) => insertCapptions(auth, false,videoId,language,title,captionpath));
        //   });
    
    });
});