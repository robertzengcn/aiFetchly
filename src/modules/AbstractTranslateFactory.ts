import {LlmImpl} from '@/modules/interface/LlmImpl';
import {TraditionalTranslateImpl} from '@/modules/interface/TraditionalTranslateImpl';
import {LlmCongfig,TraditionalTranslateCongfig} from '@/entityTypes/commonType'

export abstract class AbstractTranslateFactory{
    public abstract getLlmTool(toolname: string,llmconfig:LlmCongfig): LlmImpl | undefined;
    public abstract getTraditionalTool(name: string,config:TraditionalTranslateCongfig): TraditionalTranslateImpl | undefined;
}