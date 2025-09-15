import {windowInvoke} from '@/views/utils/apirequest'
import {SYSTEM_SETTING_LIST,SYSTEM_SETTING_UPDATE} from "@/config/channellist";
import {SystemSettingDisplay,SystemSettingGroupDisplay,OptionSettingDisplay,SetttingUpdate} from "@/entityTypes/systemsettingType";
import { language_preference } from '@/config/settinggroupInit';
import { isValidLanguageCode } from '@/views/api/language';

export async function getSystemSettinglist():Promise<Array<SystemSettingGroupDisplay>>{
    const resp=await windowInvoke(SYSTEM_SETTING_LIST,{});
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    return resp; 

}
export async function updateSystemSetting(id:number, value:string|null):Promise<boolean>{
    const setttingUpdate:SetttingUpdate={id:id,value:value}
    const resp=await windowInvoke(SYSTEM_SETTING_UPDATE,setttingUpdate);
    console.log(resp)
    if(!resp){
       throw new Error("unknow error")
    }
    return resp; 
}

/**
 * Update system setting with validation
 * @param id - Setting ID
 * @param value - New value
 * @param settingKey - Setting key for validation
 * @returns Promise<boolean>
 */
export async function updateSystemSettingWithValidation(
    id: number, 
    value: string | null, 
    settingKey?: string
): Promise<boolean> {
    try {
        // Validate language preference
        if (settingKey === language_preference && value) {
            if (!isValidLanguageCode(value)) {
                throw new Error(`Invalid language code: ${value}. Supported languages: en, zh`);
            }
        }
        
        // Validate input
        if (value === null || value === undefined) {
            throw new Error('Setting value cannot be null or undefined');
        }
        
        const setttingUpdate: SetttingUpdate = { id: id, value: value };
        const resp = await windowInvoke(SYSTEM_SETTING_UPDATE, setttingUpdate);
        
        console.log('System setting update response:', resp);
        
        if (!resp) {
            throw new Error('Failed to update system setting');
        }
        
        return resp;
    } catch (error) {
        console.error('Error updating system setting:', error);
        throw error;
    }
}

/**
 * Get language preference setting from system settings
 * @returns Promise<SystemSettingDisplay | null>
 */
export async function getLanguagePreferenceSetting(): Promise<SystemSettingDisplay | null> {
    try {
        const settings = await getSystemSettinglist();
        
        for (const group of settings) {
            for (const setting of group.items) {
                if (setting.key === language_preference) {
                    return setting;
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error getting language preference setting:', error);
        return null;
    }
}