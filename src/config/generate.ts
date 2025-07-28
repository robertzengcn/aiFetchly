// import {deepseeklocalgroup,deepseekapigroup,grokaigroup} from "@/config/settinggroupInit";
import {SocialPlatformEntity} from "@/entityTypes/social_platform-type"

export enum TranslateToolEnum {
    DEEPSEEK_LOCAL = "deepseek_local",
    DEEPSEEK_API = "deepseek_api",
    OPENAI = "openai",
    XAI = "xai",
    LLAMA="llama",
    Doubao_PRO_A="Doubao-1.5-pro-32k",
  }

// You can still use the imported variable elsewhere
// export const translateToolMap = {
//   [TranslateToolEnum.DEEPSEEK_LOCAL]: deepseeklocalgroup
// };
export const SocialPlatformList:SocialPlatformEntity[]=[
  {
    id:1,
    name:"Facebook",
    url:"https://facebook.com"
  },
  {
    id:2,
    name:"Youtube",
    url:"https://youtube.com"
  },
  {
    id:3,
    name:"Bilibili",
    url:"https://www.bilibili.com"
  },
  {
    id:4,
    name:"Google",
    url:"https://google.com"
  },
  {
    id:5,
    name:"Bing",
    url:"https://bing.com"
  },
]