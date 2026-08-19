import { Token } from "@/modules/token"
import { RemoteSource } from "@/modules/remotesource"
import { USERSDBPATH, TOKENNAME, USERLOGPATH, USEREMAIL, USERNAME, REFRESHTOKEN, TOKENEXPIRY, REFRESHTOKENEXPIRY } from '@/config/usersetting';
import { log } from "@/modules/Logger";
import { BrowserWindow } from 'electron';
import { NATIVATECOMMAND } from '@/config/channellist';
import type { NativateDatatype } from '@/entityTypes/commonType';
import { TokenRefreshService } from '@/modules/tokenRefresh';
import { SqliteDb } from '@/config/SqliteDb';
import { ScheduleManager } from '@/modules/ScheduleManager';
import { SearchController } from '@/controller/SearchController';
import { YellowPagesController } from '@/controller/YellowPagesController';
import { YellowPagesProcessManager } from '@/modules/YellowPagesProcessManager';
import { WebSocketClient } from '@/modules/WebSocketClient';
import { VectorDatabasePool } from '@/modules/factories/VectorDatabasePool';

export class User {
    public async removeToken(): Promise<void> {
        // Stop background auto-refresh before clearing tokens
        TokenRefreshService.stopAutoRefresh();

        WebSocketClient.resetInstance();
        await ScheduleManager.destroyInstance();
        SearchController.resetInstance();
        YellowPagesController.resetInstance();
        YellowPagesProcessManager.resetInstance();
        await VectorDatabasePool.clearAllInstances();
        await SqliteDb.destroyInstance();

        // Clear all user tokens and data
        const token = new Token();
        token.setValue(TOKENNAME, "");
        token.setValue(REFRESHTOKEN, "");
        token.setValue(TOKENEXPIRY, "");
        token.setValue(REFRESHTOKENEXPIRY, "");
        token.setValue(USERSDBPATH, "");
        token.setValue(USERLOGPATH, "");
        token.setValue(USEREMAIL, "");
        token.setValue(USERNAME, "");

        // Navigate to login page via IPC
        try {
            const allWindows = BrowserWindow.getAllWindows();
            if (allWindows.length > 0) {
                const mainWindow = allWindows[0] as BrowserWindow;
                if (mainWindow) {
                    const bw = mainWindow as BrowserWindow;
                    if (bw && !(bw as any).isDestroyed?.() && (bw as any).webContents) {
                        log.info("Sending navigation command to renderer");
                        (bw as any).webContents.send(NATIVATECOMMAND, {
                            path: 'login'
                        } as NativateDatatype);
                    }
                }
            }
        } catch (ipcError) {
            log.error('Failed to send navigation command to renderer:', ipcError);
        }
    }
    //private tokenname= "social-market-token";
    public async Signout() {
        try {
            const remoteModel = new RemoteSource()
            await remoteModel.removeRemoteToken()
        } catch (error) {
            log.error("Error removing remote token:", error);
            // Continue with local cleanup even if remote token removal fails
        }
        await this.removeToken()

    }
}
