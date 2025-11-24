import { Token } from "@/modules/token"
import { RemoteSource } from "@/modules/remotesource"
import {USERSDBPATH,TOKENNAME,USERLOGPATH, USEREMAIL,USERNAME} from '@/config/usersetting';
import { BrowserWindow } from 'electron';
import { NATIVATECOMMAND } from '@/config/channellist';
import type { NativateDatatype } from '@/entityTypes/commonType';

export class User {
    //private tokenname= "social-market-token";
    public async Signout(){
        try {
            const remoteModel = new RemoteSource()
            await remoteModel.removeRemoteToken()
        } catch (error) {
            console.error("Error removing remote token:", error);
            // Continue with local cleanup even if remote token removal fails
        }
        
        // Clear all user tokens and data
        const token = new Token();
        token.setValue(TOKENNAME, "");
        token.setValue(USERSDBPATH, "");
        token.setValue(USERSDBPATH, "");
        token.setValue(USERLOGPATH, "");
        token.setValue(USEREMAIL, "");
        token.setValue(USERNAME, "");
        
        // Navigate to login page via IPC
        try {
            const allWindows = BrowserWindow.getAllWindows();
            if (allWindows.length > 0) {
                const mainWindow = allWindows[0];
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(NATIVATECOMMAND, { 
                        path: 'login' 
                    } as NativateDatatype);
                }
            }
        } catch (ipcError) {
            console.error('Failed to send navigation command to renderer:', ipcError);
        }
    }
}