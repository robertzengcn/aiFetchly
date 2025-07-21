//import { computed} from 'vue'

export enum LanguageName {
  ENGLISH = 'English',
  SPANISH = 'Spanish',
  FRENCH = 'French',
  GERMAN = 'German',
  CHINESE = 'Chinese',
  JAPANESE = 'Japanese',
  KOREAN = 'Korean',
  RUSSIAN = 'Russian',
  PORTUGUESE = 'Portuguese',
  ITALIAN = 'Italian'
}

export enum LanguageCode {
  EN = 'en',
  ES = 'es',
  FR = 'fr',
  DE = 'de',
  ZH = 'zh',
  JA = 'ja',
  KO = 'ko',
  RU = 'ru',
  PT = 'pt',
  IT = 'it'
}

export type PageSearch={
    page:number,
    size:number
}
export interface CommonResponse <Type>{
    status: boolean
    msg: string
    data?: ListData<Type>|null
}
export interface ListData <Type>{
    records: Array<Type>
    num: number
}
//message used in layout dialog
export type CommonDialogMsg={
    status:boolean,
    code:number,
    msg?:string,
    data?:{
        action?:string,  
        title:string,
        content:string
    }
}
export interface CommonMessage <Type>{
    status: boolean
    msg: string
    data?: Type
}
export interface NumProcessdata{
    // total:number,
    // num:number,
    process:number
}
export type SortBy={
    key:string
    order:string
}
export type CookiesType={
name: string
value: string
domain: string
path: string
}
export type ItemSearchparam={
    page:number
    size:number
    where?:string
    sortby?:SortBy
    search?:string
}
export interface CommonApiresp <Type>{
    status: boolean
    code:number
    msg: string 
    data?: Type
}
export interface CommonIdrequest<Type>{
    id:Type
}
export interface CommonIdrequestType<Type> extends CommonIdrequest<Type>{
    type:string
}
export type Header = {
    title: string
    align?: "start" | "center" | "end" | undefined;
    sortable: boolean;
    key: string;
    width?: string;
    value?:any;
};
export type VslotHeader = {
    step: number;
    title:string
    rules?:	any;
     valid: boolean
}
export enum TaskStatus {
    Notstart = 0,
    Processing = 1,
    Complete = 2,
    Error = 3,
    Cancel = 4
  }
  export interface CommonIdrequestIds<Type> {
   ids:Array<Type>,
}
export type LanguageItem={
    id:number,
    name:LanguageName
    code:LanguageCode
}
export enum InputTypeEnum {
    INPUT = 'input',
    SELECT = 'select',
    RADIO = 'radio',
    CHECKBOX = 'checkbox'
  }
export type LlmCongfig={
    model:string,
    url?:string,
    apikey?:string,
}  
export type TraditionalTranslateCongfig={
    url:string,
    apikey:string,
}  
export type SettingGroup={
    name:string,
}
export type LlmDatatype={
     groupName:string,
        modelName:string,
        url:string,
        apikey:string
}
export type NativateDatatype={
    path:string
}
