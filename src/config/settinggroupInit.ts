import { SystemSettingGroupdf } from '@/entityTypes/systemsettingType'
import {LlmDatatype} from '@/entityTypes/commonType'
export const deepseeklocalgroup = 'Deepseek-local'
export const deepseeklocalurl = 'deepseek-local-url'
export const deepseeklocalmodel = 'deepseek-local-model'
export const deepseekapigroup = 'deepseek-api-group'
export const grokaigroup='grokai-group'
export const grokaiapiurl='grokai-url'
export const grokaiapimodel='grokai-model'
export const grokaiapilkey='grokai-api-key'
export const openaigroup='openai-group'
export const openaiapiurl='openai-url'
export const openaiapikey='openai-api-key'
export const volcenginegrouppro='volcengine-group'
export const volcengineproapiurl='volcengine-url'
export const volcengineproapikey='volcengine-key'
export const openaiapimodel='openai-model'
export const volcengineapipromodel='volcengine-model'
export const twocaptcha_enabled='2captcha-enabled'
export const Doubao_PRO_A:LlmDatatype={
    groupName:volcenginegrouppro,
    modelName:volcengineapipromodel,
    url:volcengineproapiurl,
    apikey:volcengineproapikey
}
export const twocaptchagroup='2captcha-group'
export const twocaptchatoken='2captcha-token'   
export const twocaptchadescription='2captcha-description'
export const external_system='external_system'
export const chrome_path='chrome_path'
export const firefox_path='firefox_path'

export const settinggroupInit: Array<SystemSettingGroupdf> = [
    {
        name: deepseeklocalgroup,
        description: 'deepseek-local-group-description',
        items: [
            {
               key:deepseeklocalurl,
               value:'http://localhost:11434',
               description:'deepseek-local-url-description',
               type:'input',
            },  
            {
                key:deepseeklocalmodel,
                value:'deepseek-r1:latest',
                description:'deepseek-local-model-description',
                type:'input',
             },
        ]
    },
    {
        name: twocaptchagroup,
        description: twocaptchadescription,
        items: [
            {
                key: twocaptchatoken,
                value: '',
                description: '2captcha-token-description',
                type: 'input',
            },
            {
                key: twocaptcha_enabled,
                value: '0',
                description: '2captcha-enabled-description',
                type: 'toggle',
            }
        ]
    },
    {
        name: deepseekapigroup,
        description: 'deepseek-api-description',
        items: [
            {
               key:'deepseek-api-url',
               value:'https://api.deepseek.com',
               description:'deepseek-api-description',
               type:'input',
            },
            {
                key:'deepseek-api-model',
                value:'deepseek-chat',
                description:'deepseek-api-model-description',
                type:'input',
             },
             {
                key:'deepseek-api-key',
                value:'',
                description:'deepseek-api-key-description',
                type:'input',
             },
        ]
    },
    {
        name: grokaigroup,
        description: 'grokai-group-description',
        items: [
            {
               key:grokaiapiurl,
               value:'',
               description:'grokai-url-description',
               type:'input',
            },
            {
                key:grokaiapimodel,
                value:'',
                description:'grokai-url-description',
                type:'input',
             },
            {
                key:grokaiapilkey,
                value:'',
                description:'grokai-api-key-description',
                type:'input',
             }
        ]
    },
    {
        name: openaigroup,
        description: 'openai-group-description',
        items: [
            {
               key:openaiapiurl,
               value:'',
               description:'openai-api-url-description',
               type:'input',
            },
            {
                key:openaiapimodel,
                value:'',
                description:'openai-api-key-description',
                type:'input',
             },
            {
                key:openaiapikey,
                value:'',
                description:'openai-api-key-description',
                type:'input',
             }
        ]
    },
    {
        name: volcenginegrouppro,
        description: 'volcengine-group-description',
        items: [
            {
               key:volcengineproapiurl,
               value:'https://ark.cn-beijing.volces.com/api/v3/',
               description:'volcengine-api-url-description',
               type:'input',
            },
            {
                key:volcengineapipromodel,
                value:'doubao-1.5-pro-32k-250115',
                description:'volcengine-api-model-description',
                type:'input',
             },
            {
                key:volcengineproapikey,
                value:'',
                description:'volcengine-api-key-description',
                type:'input',
             }
        ]
    },
    {
        name: external_system,
        description: 'external-system-group-description',
        items: [
            {
                key: 'chrome_path',
                value: '',
                description: 'chrome-path-description',
                type: 'file',
            },
            {
                key: 'firefox_path', 
                value: '',
                description: 'firefox-path-description',
                type: 'file',
            }
        ]
    },

]