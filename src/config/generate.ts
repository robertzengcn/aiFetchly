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
    url:"https://www.facebook.com",
    category:"Social Media"
  },
  {
    id:2,
    name:"Youtube",
    url:"https://www.youtube.com",
    category:"Social Media"
  },
  {
    id:3,
    name:"Bilibili",
    url:"https://www.bilibili.com",
    category:"Social Media"
  },
  {
    id:4,
    name:"Google",
    url:"https://www.google.com",
    category:"Search Engine"
  },
  {
    id:5,
    name:"Bing",
    url:"https://www.bing.com",
    category:"Search Engine"
  },
  {
    id:6,
    name:"YellowPages.com",
    url:"https://www.yellowpages.com",
    category:"Business Directory"
  },
  {
    id:7,
    name:"Yelp.com",
    url:"https://www.yelp.com",
    category:"Business Directory"
  },
  {
    id:8,
    name:"192.com",
    url:"https://www.192.com",
    category:"Business Directory"
  },
  {
    id:9,
    name:"Yell.com",
    url:"https://www.yell.com",
    category:"Business Directory"
  },
  {
    id:10,
    name:"11880.de",
    url:"https://www.11880.de",
    category:"Business Directory"
  },
  {
    id:11,
    name:"GelbeSeiten.de",
    url:"https://www.gelbeseiten.de",
    category:"Business Directory"
  },
  {
    id:12,
    name:"PagineGialle.it",
    url:"https://www.paginegialle.it",
    category:"Business Directory"
  },
  {
    id:13,
    name:"PagesJaunes.fr",
    url:"https://www.pagesjaunes.fr",
    category:"Business Directory"
  }
]