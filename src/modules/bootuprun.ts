import { log } from "@/modules/Logger";
import {SystemSettingGroupModule} from "@/modules/SystemSettingGroupModule"
import {YellowPagesInitModule} from "@/modules/YellowPagesInitModule"

export async function runafterbootup(){ 
    // console.log("run after bootup");
    //console.log("run after bootup")
    const systemSettingGroupModule=new SystemSettingGroupModule()
    await systemSettingGroupModule.tableInit()

    // Initialize Yellow Pages system
    try {
        const yellowPagesInitModule = new YellowPagesInitModule()
        await yellowPagesInitModule.initializeYellowPagesSystem()
        log.info("Yellow Pages system initialized successfully")
    } catch (error) {
        log.error("Failed to initialize Yellow Pages system:", error)
    }
}