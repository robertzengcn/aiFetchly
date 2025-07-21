import { TranslateToolEnum } from "@/config/generate";
import { LlmCongfig, TraditionalTranslateCongfig } from '@/entityTypes/commonType'
import { SystemSettingGroupModule } from '@/modules/SystemSettingGroupModule'
import { deepseeklocalgroup, deepseeklocalurl, deepseeklocalmodel,volcenginegrouppro,volcengineproapiurl,
    volcengineapipromodel
 } from "@/config/settinggroupInit";
// import { group } from "console";
import {Doubao_PRO_A} from "@/config/settinggroupInit"
export class TranslateController {
    private systemSettingGroupModule: SystemSettingGroupModule
    constructor() {
        this.systemSettingGroupModule = new SystemSettingGroupModule()
    }
    // async translateText(toolName:string, sourceLan: string, targetLan: string, text: string): Promise<string | void> {
    //     if(!toolName){
    //         throw new Error("toolName is required");
    //     }
    //     const llmConfig=await this.getLlmconfig(toolName);

    // }
    // async getLlmconfig(toolName: string): Promise<LlmCongfig | void> {
    //     switch (toolName) {
    //         case TranslateToolEnum.DEEPSEEK_LOCAL:
    //             return await this.getSystemConfigLLM(toolName)
    //             break;
    //         case TranslateToolEnum.OPENAI:

    //             break;
    //         case TranslateToolEnum.XAI:

    //             break;
    //         default:
    //             throw new Error("toolName not found");
    //     }
    // }
    async getTranslateConfig(toolName: string): Promise<TraditionalTranslateCongfig | void> {

    }
    async getSystemLLMConfig(groupName:string,modelKey:string, urlKey:string, apikeykey:string): Promise<LlmCongfig | void> {
        //get deepseek config
        const systemGroupConfig = await this.systemSettingGroupModule.getGroupItembyName(groupName)
        if (!systemGroupConfig) {
            throw new Error("deepseek local config not found");
        }
        let deepmodel = ""
        let deepurl = ""
        let apival=""
        for (const item of systemGroupConfig.settings) {
            if (item.key == modelKey) {
                deepmodel = item.value
            } else if (item.key == urlKey) {
                deepurl = item.value
            } else if (item.key == apikeykey) {
                apival=item.value
            }

        }
        const res: LlmCongfig = {
            model: deepmodel,
            url:deepurl,
            apikey:apival
        }
        return res

    }
    async getSystemConfigLLM(toolName: string): Promise<LlmCongfig | void> {
        let groupName=""
        let modelKey=""
        let urlKey=""
        let apikey=""
        switch (toolName) {
            case TranslateToolEnum.DEEPSEEK_LOCAL:
                groupName=deepseeklocalgroup
                modelKey=deepseeklocalmodel
                urlKey=deepseeklocalurl
                break;
            case TranslateToolEnum.OPENAI:

                break;
            case TranslateToolEnum.XAI:

                break;
            case TranslateToolEnum.Doubao_PRO_A:
                groupName=Doubao_PRO_A.groupName
                modelKey=Doubao_PRO_A.modelName
                urlKey=Doubao_PRO_A.url
                apikey=Doubao_PRO_A.apikey
                break;
            default:
                throw new Error("toolName not found");
        }
        return await this.getSystemLLMConfig(groupName,modelKey,urlKey,apikey)

    }
}