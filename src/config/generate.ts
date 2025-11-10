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

export enum EmbeddingModelEnum {
    // OpenAI Models
    OPENAI_ADA_002 = "text-embedding-ada-002",
    OPENAI_3_SMALL = "text-embedding-3-small",
    OPENAI_3_LARGE = "text-embedding-3-large",
    OPENAI_3_LARGE_256 = "text-embedding-3-large-256",
    OPENAI_3_LARGE_1024 = "text-embedding-3-large-1024",
    
    // HuggingFace Models
    HF_ALL_MINI_LM_L6_V2 = "sentence-transformers/all-MiniLM-L6-v2",
    HF_ALL_MPNET_BASE_V2 = "sentence-transformers/all-mpnet-base-v2",
    HF_PARAPHRASE_MULTILINGUAL_MINI_LM_L12_V2 = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    HF_PARAPHRASE_MULTILINGUAL_MPNET_BASE_V2 = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",
    HF_ALL_MINI_LM_L12_V2 = "sentence-transformers/all-MiniLM-L12-v2",
    HF_MULTI_QA_MINI_LM_L6_COS_V1 = "sentence-transformers/multi-qa-MiniLM-L6-cos-v1",
    HF_MULTI_QA_MPNET_BASE_COS_V1 = "sentence-transformers/multi-qa-mpnet-base-cos-v1",
    
    // Ollama Models
    OLLAMA_NOMIC_EMBED_TEXT = "nomic-embed-text",
    OLLAMA_MXBAI_EMBED_LARGE = "mxbai-embed-large",
    OLLAMA_ALL_MINILM = "all-minilm",
    OLLAMA_BGE_LARGE_EN = "bge-large-en",
    OLLAMA_BGE_BASE_EN = "bge-base-en",
    OLLAMA_BGE_SMALL_EN = "bge-small-en",
}

export enum EmbeddingProviderEnum {
    OPENAI = "openai",
    HUGGINGFACE = "huggingface",
    OLLAMA = "ollama",
    LOCAL = "local",
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