import { ipcMain } from 'electron';
import { LANGUAGE_PREFERENCE_GET, LANGUAGE_PREFERENCE_UPDATE } from '@/config/channellist';
import { SystemSettingController } from '@/controller/SystemSettingController';
import { CommonMessage } from '@/entityTypes/commonType';
import { registerValidatedHandler } from '@/main-process/communication/_shared/registerValidatedHandler';
import { updateLanguageInputSchema } from '@/schemas/ipc/language';

/**
 * Register IPC handlers for language preference operations.
 *
 * UPDATE handler uses registerValidatedHandler: input is validated by
 * updateLanguageInputSchema (z.enum of supported languages), so any
 * non-supported language code is rejected at the boundary with a clear
 * message rather than reaching the controller.
 */
export function registerLanguagePreferenceIpcHandlers() {

    /**
     * Get current language preference (no input -> raw ipcMain.handle).
     */
    ipcMain.handle(LANGUAGE_PREFERENCE_GET, async () => {
        try {
            const ctrl = new SystemSettingController();
            await ctrl.ensureConnection();

            const language = await ctrl.getLanguagePreference();

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
     * Update language preference (validated handler).
     * Frontend (src/views/api/language.ts) passes `{ language }` object directly.
     */
    registerValidatedHandler(
        LANGUAGE_PREFERENCE_UPDATE,
        updateLanguageInputSchema,
        async (input) => {
            const ctrl = new SystemSettingController();
            await ctrl.ensureConnection();

            const success = await ctrl.updateLanguagePreference(input.language);
            if (!success) {
                throw new Error('Failed to update language preference');
            }
            return success;
        },
    );

    console.log('Language preference IPC handlers registered successfully');
}
