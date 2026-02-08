/**
 * Contact Extraction API
 * Frontend API wrapper for contact extraction IPC communication
 */

import {
    START_CONTACT_EXTRACTION,
    CONTACT_EXTRACTION_PROGRESS,
    GET_CONTACT_INFO,
    RETRY_CONTACT_EXTRACTION
} from '@/config/channellist';
import { ContactInfoDisplay } from '@/entityTypes/contactExtractionTypes';

/**
 * Start contact extraction for selected search results
 */
export async function startContactExtraction(resultIds: number[]): Promise<{
    success: boolean;
    batchId?: string;
    message?: string;
}> {
    const result = await window.api.invoke(START_CONTACT_EXTRACTION, JSON.stringify({ resultIds }));
    return result as {
        success: boolean;
        batchId?: string;
        message?: string;
    };
}

/**
 * Get contact information for search results
 */
export async function getContactInfo(resultIds: number[]): Promise<{
    success: boolean;
    data?: ContactInfoDisplay[];
    message?: string;
}> {
    const result = await window.api.invoke(GET_CONTACT_INFO, JSON.stringify({ resultIds }));
    return result as {
        success: boolean;
        data?: ContactInfoDisplay[];
        message?: string;
    };
}

/**
 * Retry failed contact extraction
 */
export async function retryContactExtraction(resultIds: number[]): Promise<{
    success: boolean;
    batchId?: string;
    message?: string;
}> {
    const result = await window.api.invoke(RETRY_CONTACT_EXTRACTION, JSON.stringify({ resultIds }));
    return result as {
        success: boolean;
        batchId?: string;
        message?: string;
    };
}

/**
 * Listen for contact extraction progress updates
 */
export function onContactExtractionProgress(
    callback: (progress: {
        batchId: string;
        resultId: number;
        status: 'pending' | 'analyzing' | 'completed' | 'failed';
        data?: any;
        error?: string;
        method?: string;
    }) => void
): () => void {
    const listener = (_event: any, data: any) => {
        callback(data);
    };

    // Use window.api for receiving messages (through contextBridge)
    if (window.api && window.api.receive) {
        window.api.receive(CONTACT_EXTRACTION_PROGRESS, listener);
    }

    // Return cleanup function
    return () => {
        if (window.api && window.api.removeListener) {
            window.api.removeListener(CONTACT_EXTRACTION_PROGRESS, listener);
        }
    };
}

/**
 * Contact extraction API object
 */
export const contactExtractionApi = {
    startContactExtraction,
    getContactInfo,
    retryContactExtraction,
    onContactExtractionProgress
};
