import {LlmFactory} from '@/modules/llm/LlmFactory';
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
    //get translate tool like llm
    getTransTool(toolName:string,llmconfig?:LlmCongfig,transConfig?:TraditionalTranslateCongfig):LlmImpl|void{
        if(this.avaialableLlm.includes(toolName)){

            if(!llmconfig){
                throw new Error("llmconfig is required");
            }
            let factory=new LlmFactory();
            let tool:LlmImpl|undefined=factory.getLlmTool(toolName,llmconfig); 
            return tool;
        }else if(this.availableApi.includes(toolName)){

        }
    }
    //translate with translate tool
    async translateWithTool(inputlang:string,outputlang:string,text:string,tool:LlmImpl):Promise<string|void>{
        return tool.translate(inputlang,outputlang,text);

    }
    async translateWithLLM(inputlang:string,outputlang:string,text:string,toolName:string,llmconfig:LlmCongfig):Promise<string|void>{
        let factory=new LlmFactory();
        let tool:LlmImpl|undefined=factory.getLlmTool(toolName,llmconfig);
       // console.log("tool",tool)
        if(tool){
            return tool.translate(inputlang,outputlang,text);
        }else{
            throw new Error("llm tool not found");
        }
        
    }

}