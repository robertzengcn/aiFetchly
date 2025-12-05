import { ipcMain } from 'electron';
import { ANALYZE_WEBSITE, ANALYZE_WEBSITE_PROGRESS } from '@/config/channellist';
import { WebsiteAnalysisQueue } from '@/modules/WebsiteAnalysisQueue';
import { CommonMessage } from '@/entityTypes/commonType';
import { v4 as uuidv4 } from 'uuid';

interface AnalyzeWebsiteBatchRequest {
    items: Array<{
        resultId: number;
        url: string;
    }>;
    clientBusiness: string;
    temperature?: number;
}

interface AnalysisJob {
    id: string;
    resultId: number;
    url: string;
    clientBusiness: string;
    temperature?: number;
}

interface QueueProgress {
    completed: number;
    total: number;
    current?: string;
}

/**
 * Register IPC handlers for search result operations
 */
export function registerSearchResultIpcHandlers(): void {
    /**
     * Handle batch website analysis request
     * Uses queue system to process multiple URLs concurrently
     */
    ipcMain.handle(ANALYZE_WEBSITE, async (event, data: string | AnalyzeWebsiteBatchRequest): Promise<CommonMessage<{
        batchId: string;
        total: number;
    } | null>> => {
        try {
            // Parse data if it's a string
            const requestData: AnalyzeWebsiteBatchRequest = typeof data === 'string' ? JSON.parse(data) : data;
            
            // Validate input
            if (!requestData.items || !Array.isArray(requestData.items) || requestData.items.length === 0) {
                return {
                    status: false,
                    msg: 'Missing or empty items array',
                    data: null
                };
            }

            if (!requestData.clientBusiness || requestData.clientBusiness.trim().length === 0) {
                return {
                    status: false,
                    msg: 'Missing required field: clientBusiness',
                    data: null
                };
            }

            // Validate URLs
            const validItems: Array<{ resultId: number; url: string }> = [];
            for (const item of requestData.items) {
                if (!item.resultId || !item.url) {
                    continue;
                }
                try {
                    new URL(item.url);
                    validItems.push(item);
                } catch {
                    // Invalid URL, skip
                    continue;
                }
            }

            if (validItems.length === 0) {
                return {
                    status: false,
                    msg: 'No valid URLs found in items array',
                    data: null
                };
            }

            // Create jobs for queue
            const jobs: AnalysisJob[] = validItems.map(item => ({
                id: uuidv4(),
                resultId: item.resultId,
                url: item.url,
                clientBusiness: requestData.clientBusiness,
                temperature: requestData.temperature ?? 0.7
            }));

            // Get queue instance
            const queue = WebsiteAnalysisQueue.getInstance();

            // Generate batch ID
            const batchId = `batch-${uuidv4()}`;

            // Set up progress callback to send updates via IPC
            const progressCallback = (progress: QueueProgress) => {
                event.sender.send(ANALYZE_WEBSITE_PROGRESS, JSON.stringify({
                    batchId: batchId,
                    ...progress
                }));
            };

            // Add batch to queue
            await queue.addBatch(jobs, progressCallback);

            return {
                status: true,
                msg: 'Batch analysis started',
                data: {
                    batchId,
                    total: validItems.length
                }
            };
        } catch (error) {
            console.error('Error in analyze website handler:', error);
            return {
                status: false,
                msg: error instanceof Error ? error.message : 'Unknown error occurred',
                data: null
            };
        }
    });
}
