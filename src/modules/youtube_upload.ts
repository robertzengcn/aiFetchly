// "use strict";
// export {};
// import { google } from "googleapis";
// const service = google.youtube('v3');
// const OAuth2 = google.auth.OAuth2;
// const fs = require('fs');

// export const youtubecategoryIds = {
//     Entertainment: "24",
//     Education: "27",
//     ScienceTechnology: "28"
//   }

// //upload video to youtube
// export const uploadVideo = (auth,title:string,description:string,videopath:string,privacy='public',category:string,language:string,thumbFilePath?:string) => {
   
    
//     service.videos.insert(
//         {
//             auth: auth,
//             part: ['snippet,contentDetails,status'],
//             requestBody: {
//                 // Video title and description
//                 snippet: {
//                     title: title,
//                     description:description,
//                     categoryId: category,
//                     defaultLanguage: language,
//                     defaultAudioLanguage: language
//                 },
//                 // I set to private for tests
//                 status: {
//                     privacyStatus: privacy
//                 }
//             },

//             // Create the readable stream to upload the video
//             media: {
//                 body: fs.createReadStream(videopath) // Change here to your real video
//             }
//         },
//         (error, data) => {
//             if (error) {
//                 console.log(error.stack);
//                 throw new Error(error);
//             }
//             console.log('https://www.youtube.com/watch?v=' + data.data.id);
//             if(thumbFilePath){
//                 console.log('Video uploaded. Uploading the thumbnail now.')
//                 service.thumbnails.set({
//                   auth: auth,
//                   videoId: data.data.id,
//                   media: {
//                     body: fs.createReadStream(thumbFilePath)
//                   },
//                 }, function(err, response) {
//                   if (err) {
//                     console.log('The API returned an error: ' + err);
//                     return;
//                   }
//                   console.log(response.data)
//                 })  
//             }
//             return data.data.id;
//         }
//     );
// };


// module.exports = { uploadVideo };