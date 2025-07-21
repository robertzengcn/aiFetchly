export interface TraditionalTranslateImpl{
    translate(inputlang:string,outputlang:string,text:string):Promise<string|void>; 
}