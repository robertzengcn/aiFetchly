// export { default as SyncMsg } from "./sync-msg";
// export { default as AsyncMsg } from "./async-msg";
import {registerExtraModulesIpcHandlers} from "@/main-process/communication/extramodule-ipc";
import {registerVideoIpcHandlers} from "@/main-process/communication/videoIpc";
import {registerScheduleIpcHandlers} from "@/main-process/communication/scheduleIpc";
import SyncMsg from "@/main-process/communication/sync-msg";
import AsyncMsg from "@/main-process/communication/async-msg"
import {BrowserWindow } from 'electron'
import {registerSearchIpcHandlers} from "@/main-process/communication/search-ipc";
import {registeProxyIpcHandlers} from "@/main-process/communication/proxy-ipc";
import {registerEmailextractionIpcHandlers} from "@/main-process/communication/emailextraction-ipc";
import {registerEmailMarketingIpcHandlers} from "@/main-process/communication/emailMarketingIpc";
import {registerBuckEmailIpcHandlers} from "@/main-process/communication/buckEmail-ipc";
import {registerEmailTemplateIpcHandlers} from "@/main-process/communication/emailTemplate-ipc";
import {registerSocialAccountIpcHandlers} from "@/main-process/communication/socialaccount-ipc";
import {registerSystemSettingIpcHandlers} from "@/main-process/communication/systemSettingIpc";
import {registerUserIpcHandlers} from "@/main-process/communication/userIpc";
export function registerCommunicationIpcHandlers(win: BrowserWindow) {
    try{
    SyncMsg(win)
    registerExtraModulesIpcHandlers()
    registerVideoIpcHandlers()
    registerScheduleIpcHandlers()
    registerSearchIpcHandlers()
    registeProxyIpcHandlers()
    registerEmailextractionIpcHandlers()
    registerEmailMarketingIpcHandlers()
    registerBuckEmailIpcHandlers()
    registerEmailTemplateIpcHandlers()
    registerSocialAccountIpcHandlers(win)
    registerSystemSettingIpcHandlers()
    registerUserIpcHandlers()
    AsyncMsg()
    }catch(e){
        console.log("registerCommunicationIpcHandlers error:")
        console.error(e)
    }
    // Register extra modules IPC handlers
    
    
}