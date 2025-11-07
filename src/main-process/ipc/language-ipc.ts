import { ipcMain } from 'electron';
import { LANGUAGE_PREFERENCE_GET, LANGUAGE_PREFERENCE_UPDATE } from '@/config/channellist';
import { SystemSettingController } from '@/controller/SystemSettingController';
import { CommonMessage } from '@/entityTypes/commonType';

/**
 * Register IPC handlers for language preference operations
 */
export function registerLanguagePreferenceIpcHandlers() {
    
    /**
     * Get current language preference
     */
    ipcMain.handle(LANGUAGE_PREFERENCE_GET, async (event) => {
        try {
            const systemSettingCtrl = new SystemSettingController();
            const language = await systemSettingCtrl.getLanguagePreference();
            
            const result: CommonMessage<string> = {
                status: true,
                msg: 'Language preference retrieved successfully',
                data: language
            };
            
            return result;
        } catch (error) {
            console.error('Error getting language preference:', error);
            
            const result: CommonMessage<string> = {
                status: false,
                msg: error instanceof Error ? error.message : 'Unknown error occurred',
                data: 'en' // Default fallback
            };
            
            return result;
        }
    });

    /**
     * Update language preference
     */
    ipcMain.handle(LANGUAGE_PREFERENCE_UPDATE, async (event, jsonData: string) => {
        try {
            // Parse JSON data from frontend
            let parsedData: { language: string };
            try {
                parsedData = JSON.parse(jsonData);
            } catch (parseError) {
                const result: CommonMessage<boolean> = {
                    status: false,
                    msg: 'Invalid JSON data received',
                    data: false
                };
                return result;
            }

            // Extract language from parsed object
            const { language } = parsedData;

            // Validate extracted language
            if (!language || typeof language !== 'string') {
                const result: CommonMessage<boolean> = {
                    status: false,
                    msg: 'Invalid language parameter',
                    data: false
                };
                return result;
            }

            const systemSettingCtrl = new SystemSettingController();
            const success = await systemSettingCtrl.updateLanguagePreference(language);
            
            const result: CommonMessage<boolean> = {
                status: success,
                msg: success ? 'Language preference updated successfully' : 'Failed to update language preference',
                data: success
            };
            
            return result;
        } catch (error) {
            console.error('Error updating language preference:', error);
            
            const result: CommonMessage<boolean> = {
                status: false,
                msg: error instanceof Error ? error.message : 'Unknown error occurred',
                data: false
            };
            
            return result;
        }
    });

    console.log('Language preference IPC handlers registered successfully');
}

