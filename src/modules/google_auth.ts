// "use strict";
// export {};
// import * as fs from 'fs';
// // import { google } from 'googleapis';
// import * as readline from 'readline';
// const OAuth2 = google.auth.OAuth2;

// // If modifying these scopes, delete your previously saved credentials
// // at ~/.credentials/upload_app_session.json
// const SCOPES = [
//     'https://www.googleapis.com/auth/youtube.upload',
//     'https://www.googleapis.com/auth/youtube.readonly',
//     'https://www.googleapis.com/auth/youtube.force-ssl',
//     'https://www.googleapis.com/auth/youtubepartner'
// ];
// const TOKEN_DIR =
//     (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) +
//     '/.credentials/';
// const TOKEN_PATH = TOKEN_DIR + 'upload_app_session.json';

// export interface credentials {
//     installed: Installed
//   }
  
// export interface Installed {
//     client_id: string
//     project_id: string
//     auth_uri: string
//     token_uri: string
//     auth_provider_x509_cert_url: string
//     client_secret: string
//     redirect_uris: string[]
//   }
// export const authorize = async (credentials:credentials, callback) => {
    
//     const clientSecret = credentials.installed.client_secret;
//     const clientId = credentials.installed.client_id;
//     const redirectUrl = credentials.installed.redirect_uris[0];
   
//     const oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);
//     // let oauth:any={};
//     // Check if we have previously stored a token.
//     // await fs.readFile(TOKEN_PATH, (error, token) => {
//     //     if (error) {
//     //         oauth=getNewToken(oauth2Client);
//     //     } else {
//     //         oauth2Client.credentials = JSON.parse(token.toString());
//     //         console.log(oauth2Client)
//     //         oauth=oauth2Client;
//     //     }
//     // });
//     // let token=fs.readFileSync(TOKEN_PATH,'utf8')
//     // if (!token) {
//     //    getNewToken(oauth2Client);
//     //    token=fs.readFileSync(TOKEN_PATH,'utf8')
//     // }
//     //     oauth2Client.credentials = JSON.parse(token.toString());
        
     
//     //     return oauth2Client;
//     const tokenPath=TOKEN_DIR+clientId+'.json';
//     console.log("read token from "+tokenPath)
//     fs.readFile(tokenPath, function(err, token) {
//         if (err) {
            
//           getNewToken(oauth2Client, callback,clientId);
//         }else{

//           oauth2Client.credentials = JSON.parse(token.toString());
//           console.log("parse token:")
//           console.log(oauth2Client.credentials)
//           const cdate = new Date();
//           const timestamp = cdate.getMilliseconds();
//           if(oauth2Client.credentials.expiry_date&&oauth2Client.credentials.expiry_date<timestamp){
//             console.log("token expire")
//             getNewToken(oauth2Client, callback,clientId);
//             return;       
//           }
//         console.log("auth finish")
//         callback(oauth2Client);
//         }
//     });
  

// };
// export const cb=(error) => {console.log(error)}

// const getNewToken = (oauth2Client,callback,client_id) => {
//     const authUrl = oauth2Client.generateAuthUrl({
//         access_type: 'offline',
//         scope: SCOPES
//     });
//     console.log('Authorize this app by visiting this url: ', authUrl);
//     const rl = readline.createInterface({
//         input: process.stdin,
//         output: process.stdout
//     });
//     rl.question('Enter the code from that page here: ', code => {
//         rl.close();
//         oauth2Client.getToken(code, (error, token) => {
//             if (error) {
//                     throw new Error(
//                         'Error while trying to retrieve access token'
//                     )  
//             }
//             oauth2Client.credentials = token;
//             storeToken(token,client_id);
//             callback(oauth2Client);
//         });
//     });
// };

// const storeToken = (token,client_id:string) => {
//     try {
//         fs.mkdirSync(TOKEN_DIR);
//     } catch (error) {
//         if (error instanceof Error) {
//         //if (error.code != 'EEXIST') {
//             throw error;
//         //} 
//     }
//     }
//     const tokenPath=TOKEN_DIR+client_id+'.json';
//     fs.writeFile(tokenPath, JSON.stringify(token), error => {
//         if (error) throw error;
//         console.log('Token stored to ' + tokenPath);
//     });
// };

// // module.exports = { authorize };