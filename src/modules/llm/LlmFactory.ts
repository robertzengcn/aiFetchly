import {OllamaLlm} from '@/modules/llm/OllamaLlm';
import { LlmImpl } from '@/modules/interface/LlmImpl';
import {AbstractTranslateFactory} from '@/modules/AbstractTranslateFactory';
import {TraditionalTranslateImpl} from '@/modules/interface/TraditionalTranslateImpl';
import {TranslateToolEnum} from "@/config/generate";
import {LlmCongfig,TraditionalTranslateCongfig} from '@/entityTypes/commonType'
import {OpenaiLlm} from '@/modules/llm/OpenaiLlm';
import {ChatDeepSeekLlm} from "@/modules/llm/ChatDeepSeekLlm";

export class LlmFactory extends AbstractTranslateFactory{
    public getTraditionalTool(name: string,config:TraditionalTranslateCongfig): TraditionalTranslateImpl | undefined{
        return undefined;
    }
    
    public getLlmTool(toolname: string, llmconfig: LlmCongfig): LlmImpl | undefined {
        switch (toolname) {
            case TranslateToolEnum.DEEPSEEK_LOCAL:
                return new OllamaLlm(llmconfig.model,llmconfig.url);
           case TranslateToolEnum.DEEPSEEK_API:
                if(!llmconfig.apikey){
                    throw new Error("apikey is required")
                }
                return new ChatDeepSeekLlm(llmconfig.model,llmconfig.apikey);    
            case TranslateToolEnum.LLAMA:
                return new OllamaLlm(llmconfig.model,llmconfig.url);
            case TranslateToolEnum.Doubao_PRO_A:
                return new OpenaiLlm(llmconfig.model,llmconfig.url,llmconfig.apikey);
                default:
                return undefined;
        }
    }
}