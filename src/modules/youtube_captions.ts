// 'use strict';
// export { };
// import { google } from "googleapis";
// import { OAuth2Client, JWT, Compute, UserRefreshClient, BaseExternalAccountClient, GoogleAuth } from 'googleapis-common';
// const service = google.youtube('v3');
// import * as fs from 'fs';
// export const insertCapptions = (auth: string | OAuth2Client | JWT | Compute | UserRefreshClient | BaseExternalAccountClient | GoogleAuth,
//     sync = true,
//     videoId: string,
//     language: string,
//     name:string,
//     captionpath: string
// ) => {
//     service.captions.insert({
//         auth: auth,
//         part: ['snippet'],
//         sync: sync,
//         requestBody: {
//             snippet: {
//                 videoId: videoId,
//                 language:language,
//                 name:name
//             }
//         },
//         media: {
//             body: fs.createReadStream(captionpath) // Change here to your real video
//         }
//     },function(err, response) {
//         if (err) {
//             console.log(err.stack);
//             console.log('The API returned an error: ' + err);
//             //return;
//             console.log(response);
//         }
        
//     })
// }