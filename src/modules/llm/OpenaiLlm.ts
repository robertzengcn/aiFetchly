import OpenAI from 'openai';
import { LlmImpl } from '@/modules/interface/LlmImpl';


export class OpenaiLlm implements LlmImpl {
    private openai: OpenAI;
    private model:string;
    constructor(model:string,baseUrl:string="http://127.0.0.1:11434",apikey?:string) {
        this.model=model
        this.openai = new OpenAI({
            baseURL: baseUrl,
            apiKey: apikey,
        });
    }

    async translate(inputlang:string,outputlang:string,text:string,systemMsg?:string):Promise<string|void>{
            let defaultMsg = "You are a helpful assistant that translates "+inputlang+" to "+outputlang+". Do not include your own opinion or analysis.";
            if(systemMsg){
                defaultMsg = defaultMsg+" "+systemMsg;
            }
            const completion = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                  { role: 'system', content: defaultMsg },
                  { role: 'user', content: text },
                ],
              });
              console.log(completion.choices[0].message.content);
              if(completion.choices[0].message.content){
                  return completion.choices[0].message.content;
              }else{
                    return ""
              }
        }
}