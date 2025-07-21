'use strict';
// import {authorize,credentials} from '../../src/modules/google_auth';
// import {uploadVideo,youtubecategoryIds} from '../../src/modules/youtube_upload';
const appRoot = require('app-root-path');
import * as path from "path";
const fs = require('fs');

// describe('Module Youtubeupload', function(){
//     //test google auth
//     it('google-auth', function(){
//         const client_secret_file:string=path.resolve(appRoot+"/tmp/test/client_secret.json");
//         fs.readFile(client_secret_file, (error, content) => {
//             if (error) {
//                 console.log('Error loading client secret file: ' + error);
//                 throw new Error('Error loading client secret file: ' + error);
//             }
//             // Authorize a client with the loaded credentials
//             const auth=authorize(JSON.parse(content) as credentials,console.log);
//             console.log(auth)

//         });
//     });
//     //test youtube upload video
//     it('youtube-upload', function(){
//         //  let auth=authorize(JSON.parse(fs.readFileSync(path.resolve(appRoot+"/tmp/test/client_secret.json")) as any))
//         // // console.log(auth)
//         // uploadVideo(auth,"test title","test description",path.resolve(appRoot+"/tmp/test/test.flv"));
//         fs.readFile(path.resolve(appRoot+"/tmp/client_secret_909593013988-qaggscg7gntilse2k5k3jj1qveb419i8.apps.googleusercontent.com.json"), function processClientSecrets(err, content) {
//             if (err) {
//             throw new Error('Error loading client secret file: ' + err);
              
//             }
//             const title="Southeast Asian Story";
//             const description="The southeaset Asian story is a story of rapid economic growth and development.";
//             const videopath=path.resolve(appRoot+"/tmp/test/Southeast-Asian-Story.flv");
//             // Authorize a client with the loaded credentials, then call the YouTube API.
//             authorize(JSON.parse(content), (auth) => uploadVideo(auth, title, description, videopath,'public',"24",'en'));
//           });
    
//     });
// });