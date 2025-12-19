import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { ANALYZE_WEBSITE, ANALYZE_WEBSITE_PROGRESS } from '@/config/channellist';
import { WebsiteAnalysisService } from '@/service/WebsiteAnalysisService';
import { CommonMessage } from '@/entityTypes/commonType';

interface AnalyzeWebsiteBatchRequest {
    items: Array<{
        resultId: number;
        url: string;
    }>;
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
    ipcMain.handle(ANALYZE_WEBSITE, async (event: IpcMainInvokeEvent, data: string | AnalyzeWebsiteBatchRequest): Promise<CommonMessage<{
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

            // Extract result IDs from items
            const resultIds = requestData.items
                .map(item => item.resultId)
                .filter((id): id is number => typeof id === 'number' && id > 0);

            if (resultIds.length === 0) {
                return {
                    status: false,
                    msg: 'No valid result IDs found in items array',
                    data: null
                };
            }

            // Set up progress callback to send updates via IPC
            let batchId: string | null = null;
            const progressCallback = (progress: QueueProgress) => {
                if (batchId) {
                    event.sender.send(ANALYZE_WEBSITE_PROGRESS, JSON.stringify({
                        batchId: batchId,
                        ...progress
                    }));
                }
            };

            // Start batch analysis using service
            const batchInfo = await WebsiteAnalysisService.startBatchAnalysis({
                resultIds,
                clientBusiness: requestData.clientBusiness,
                temperature: requestData.temperature,
                onProgress: progressCallback
            });

            batchId = batchInfo.batchId;

            return {
                status: true,
                msg: 'Batch analysis started',
                data: {
                    batchId: batchInfo.batchId,
                    total: batchInfo.total
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
