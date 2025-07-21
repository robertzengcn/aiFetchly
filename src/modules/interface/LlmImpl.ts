export interface LlmImpl{
    translate(inputlang:string,outputlang:string,text:string,systemMsg?:string):Promise<string|void>;
}