import {SystemSettingGroupModule} from "@/modules/SystemSettingGroupModule"

export async function runafterbootup(){ 
    // console.log("run after bootup");
    console.log("run after bootup")
    const systemSettingGroupModule=new SystemSettingGroupModule()
    await systemSettingGroupModule.tableInit()

}