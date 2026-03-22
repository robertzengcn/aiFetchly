/**
 * Contact Extraction Worker Process
 *
 * This worker process handles contact extraction requests in isolation
 * from the main Electron process to prevent crashes from affecting the UI.
 *
 * Communication via IPC:
 * - Receives: extract-contact messages with batch data
 * - Sends: extraction-progress messages with results
 */

import { ExtractionJob, ExtractionProgress } from '@/entityTypes/contactExtractionTypes';
import { extractionQueue } from './ExtractionQueue';
import { discoverAndExtractContactInfo } from './ContactDiscovery';

/**
 * Worker message types
 */
interface ExtractContactMessage {
    type: 'extract-contact';
    batchId: string;
    resultIds: number[];
    results: Array<{
        id: number;
        url: string;
        title: string;
    }>;
    priority?: number;
}

interface ExtractContactFromUrlsMessage {
    type: 'extract-contact-from-urls';
    requestId: string;
    urls: string[];
}

type WorkerMessage = ExtractContactMessage | ExtractContactFromUrlsMessage;

/**
 * Initialize the worker process
 */
function initializeWorker(): void {
    console.log('ContactExtractionWorker: Worker process initialized');

    // Listen for messages from main process
    process.on('message', (message: WorkerMessage) => {
        if (message.type === 'extract-contact') {
            handleExtractionRequest(message);
        } else if (message.type === 'extract-contact-from-urls') {
            handleExtractContactFromUrls(message);
        }
    });

    // Handle worker errors
    process.on('uncaughtException', (error) => {
        console.error('ContactExtractionWorker: Uncaught exception:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('ContactExtractionWorker: Unhandled rejection at:', promise, 'reason:', reason);
    });

    // Notify parent that worker is ready
    if (process.send) {
        process.send({ type: 'worker-ready' });
    }
}

/**
 * Handle extraction request from main process
 */
function handleExtractionRequest(message: ExtractContactMessage): void {
    const { batchId, resultIds, results, priority = 0 } = message;

    console.log(`ContactExtractionWorker: Received extraction request for batch ${batchId}`);
    console.log(`ContactExtractionWorker: Processing ${resultIds.length} URLs`);

    // Set up progress callback to send updates back to main process
    extractionQueue.setProgressCallback((progress: ExtractionProgress) => {
        if (process.send) {
            process.send({
                type: 'extraction-progress',
                ...progress
            });
        }
    });

    // Convert results to extraction jobs
    const jobs: ExtractionJob[] = results.map(result => ({
        resultId: result.id,
        url: result.url,
        title: result.title,
        retryCount: 0,
        priority: priority
    }));

    // Add jobs to queue
    extractionQueue.addBatch(jobs, batchId);

    console.log(`ContactExtractionWorker: Jobs added to queue (queue length: ${extractionQueue.getQueueLength()})`);
}

/**
 * Result sent to main process for URL-only extraction (no DB)
 */
interface UrlExtractionResultMessage {
    type: 'extract-contact-url-result';
    requestId: string;
    url: string;
    success: boolean;
    data?: {
        emails?: string[];
        phones?: string[];
        address?: string | null;
        socialLinks?: string[] | null;
    };
    error?: string;
}

/**
 * Handle extract-contact-from-urls: extract contact info from URLs and send results back (no DB).
 * Used by the AI tool extract_contact_info.
 */
async function handleExtractContactFromUrls(message: ExtractContactFromUrlsMessage): Promise<void> {
    const { requestId, urls } = message;
    const validUrls = urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);

    for (const url of validUrls) {
        try {
            const result = await discoverAndExtractContactInfo(url);
            const payload: UrlExtractionResultMessage = {
                type: 'extract-contact-url-result',
                requestId,
                url,
                success: result.success,
                ...(result.data && {
                    data: {
                        emails: result.data.emails,
                        phones: result.data.phones,
                        address: result.data.address ?? null,
                        socialLinks: result.data.socialLinks ?? null
                    }
                }),
                ...(result.error && { error: result.error })
            };
            if (process.send) {
                process.send(payload);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (process.send) {
                process.send({
                    type: 'extract-contact-url-result',
                    requestId,
                    url,
                    success: false,
                    error: errorMessage
                } as UrlExtractionResultMessage);
            }
        }
    }
}

/**
 * Worker startup
 */
if (require.main === module || process.env.WORKER_TYPE === 'contact-extraction') {
    initializeWorker();
}

export { initializeWorker };
