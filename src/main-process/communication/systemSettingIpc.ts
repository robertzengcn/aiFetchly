// import { getSystemSettinglist } from '@/views/api/systemsetting';
import { ipcMain } from 'electron';
import { SYSTEM_SETTING_LIST,SYSTEM_SETTING_UPDATE } from "@/config/channellist";
import { SystemSettingController } from "@/controller/SystemSettingController"
import { CommonMessage } from "@/entityTypes/commonType";
import { SystemSettingGroupDisplay,SetttingUpdate } from '@/entityTypes/systemsettingType';

export function registerSystemSettingIpcHandlers() {
    
    ipcMain.handle(SYSTEM_SETTING_LIST, async (event, data) => {
        try {
            const systemSettingCtrl = new SystemSettingController()
            const res = await systemSettingCtrl.selectAllSystemSettings();
            const result: CommonMessage<Array<SystemSettingGroupDisplay>> = {
                status: true,
                msg: "",
                data: res
            }
            return result;
        } catch (error) {
            if (error instanceof Error) {
            const result: CommonMessage<Array<SystemSettingGroupDisplay>> = {
                status: false,
                msg:error.message,
                data: []
            }
            return result;
        }
        }
    })
    ipcMain.handle(SYSTEM_SETTING_UPDATE, async (event, arg) => {

         const qdata = JSON.parse(arg) as SetttingUpdate;
            try {
                const systemSettingCtrl = new SystemSettingController()
                const res = await systemSettingCtrl.updateSystemSettings(qdata.id, qdata.value);
                const result: CommonMessage<boolean> = {
                    status: res,
                    msg: "",
                    data: res
                  
                }
                return result;
            } catch (error) {
                if (error instanceof Error) {
                const result: CommonMessage<boolean> = {
                    status: false,
                    msg:error.message,
                    data: false
                }
                return result;
            }
        }
    })

}