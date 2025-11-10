// import {LlmFactory} from '@/modules/llm/LlmFactory';
import { LlmImpl } from '@/modules/interface/LlmImpl';
import {LanguageItem} from '@/entityTypes/commonType'
import {LlmCongfig,TraditionalTranslateCongfig} from '@/entityTypes/commonType'
// import {deepseeklocalgroup} from "@/config/settinggroupInit";
import {TranslateToolEnum} from "@/config/generate";


export class TranslateProducer {
    protected avaialableLlm:string[]=Object.values(TranslateToolEnum);
    protected availableApi:string[]=["google","baidu"];

    checkTooltype(name:string):string|void{
        if(this.avaialableLlm.includes(name)){
            return "llm";
        }else if(this.availableApi.includes(name)){
            return "api";
        }
        return undefined;
    }

    async translateText(name:string,sourceLan:LanguageItem,targetLan:LanguageItem,text:string,llmconfig?:LlmCongfig,traditionConfig?:TraditionalTranslateCongfig):Promise<string|void>{
       //console.log("name",name)
    //    console.log(this.avaialableLlm)
        if(this.avaialableLlm.includes(name)){

            if(!llmconfig){
                throw new Error("llmconfig is required");
            }

            return this.translateWithLLM(sourceLan.code,targetLan.code,text,name,llmconfig);
        }else if(this.availableApi.includes(name)){
            //return this.translateWithAPI(name,sourceLan.code,targetLan.code,text,systemMsg);
        }
        return Promise.resolve(undefined);
    }
    /**
     * Get translate tool like llm
     * @deprecated LlmFactory has been removed. This method is no longer functional.
     */
    getTransTool(toolName:string,llmconfig?:LlmCongfig,transConfig?:TraditionalTranslateCongfig):LlmImpl|void{
        console.warn('TranslateProducer.getTransTool() is deprecated. LlmFactory has been removed.');
        throw new Error('LlmFactory has been removed. Use remote API-based translation instead.');
    }
    //translate with translate tool
    async translateWithTool(inputlang:string,outputlang:string,text:string,tool:LlmImpl):Promise<string|void>{
        return tool.translate(inputlang,outputlang,text);

    }
    /**
     * @deprecated LlmFactory has been removed. Use remote API-based translation instead.
     */
    async translateWithLLM(inputlang:string,outputlang:string,text:string,toolName:string,llmconfig:LlmCongfig):Promise<string|void>{
        throw new Error('LlmFactory has been removed. Use remote API-based translation instead.');
    }

}