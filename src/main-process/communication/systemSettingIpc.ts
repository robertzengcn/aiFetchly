// import { getSystemSettinglist } from '@/views/api/systemsetting';
import { ipcMain } from 'electron';
import { SYSTEM_SETTING_LIST,SYSTEM_SETTING_UPDATE } from "@/config/channellist";
import { SystemSettingController } from "@/controller/SystemSettingController"
import { CommonMessage } from "@/entityTypes/commonType";
import { SystemSettingGroupDisplay } from '@/entityTypes/systemsettingType';
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { systemSettingUpdateInputSchema } from "@/schemas/ipc/systemSetting";

export function registerSystemSettingIpcHandlers() {

    // LIST: no input arg, stays as raw ipcMain.handle (nothing to validate).
    ipcMain.handle(SYSTEM_SETTING_LIST, async () => {
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

    // UPDATE: validated handler.
    // - id must be a positive int (schema rejects at boundary)
    // - value is string | null (matches SetttingUpdate type)
    // - envelope: handler returns boolean success, wrapper wraps in
    //   {status: true, msg: 'ok', data: <boolean>}.
    //   CAVEAT: original handler returned status: res (the controller's
    //   boolean) at envelope level. The wrapper always sets status:true
    //   on successful handler execution. Callers needing the controller's
    //   success signal should read data (the returned boolean).
    registerValidatedHandler(
        SYSTEM_SETTING_UPDATE,
        systemSettingUpdateInputSchema,
        async (input) => {
            const systemSettingCtrl = new SystemSettingController();
            return systemSettingCtrl.updateSystemSettings(input.id, input.value);
        },
    )

}
