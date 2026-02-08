/**
 * Contact Extraction IPC Handlers
 *
 * Handles IPC communication between renderer process and main process
 * for contact extraction functionality.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ContactInfoModule } from '@/modules/ContactInfoModule';
import {
    START_CONTACT_EXTRACTION,
    CONTACT_EXTRACTION_PROGRESS,
    GET_CONTACT_INFO,
    RETRY_CONTACT_EXTRACTION
} from '@/config/channellist';

// Type for IPC request with resultIds
interface ContactExtractionRequest {
    resultIds: number[];
}

// Type for worker messages
interface WorkerMessage {
    type: 'worker-ready' | 'extraction-progress';
    [key: string]: unknown;
}

// Worker process reference
let contactExtractionWorker: ChildProcess | null = null;

/**
 * Spawn the contact extraction worker process
 */
function spawnWorker(): ChildProcess {
    // Use compiled JS file from .vite/build directory
    // __dirname already points to .vite/build, so just append the filename
    const workerPath = path.join(__dirname, 'ContactExtractionWorker.js');

    console.log('Spawning contact extraction worker...');

    const worker = spawn('node', [workerPath], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
            ...process.env,
            WORKER_TYPE: 'contact-extraction'
        }
    });

    // Handle worker output
    worker.stdout?.on('data', (data) => {
        console.log(`Worker stdout: ${data}`);
    });

    worker.stderr?.on('data', (data) => {
        console.error(`Worker stderr: ${data}`);
    });

    // Handle worker crashes
    worker.on('exit', (code, signal) => {
        console.log(`Worker exited with code ${code}, signal ${signal}`);
        if (code !== 0 && code !== null && contactExtractionWorker) {
            console.error('Contact extraction worker crashed, restarting...');
            setTimeout(() => {
                contactExtractionWorker = spawnWorker();
                setupWorkerHandlers();
            }, 5000);
        }
    });

    // Handle worker messages
    worker.on('message', async (message: WorkerMessage) => {
        if (message.type === 'worker-ready') {
            console.log('Contact extraction worker is ready');
        } else if (message.type === 'extraction-progress') {
            // Handle progress update from worker
            await handleWorkerProgress(message);
        }
    });

    return worker;
}

/**
 * Setup worker message handlers
 */
function setupWorkerHandlers(): void {
    if (!contactExtractionWorker) return;

    // Worker message handling is done in the spawnWorker function
}

/**
 * Ensure worker is started (lazy initialization)
 */
function ensureWorkerStarted(): void {
    if (!contactExtractionWorker || contactExtractionWorker.killed) {
        console.log('Lazy-initializing contact extraction worker...');
        contactExtractionWorker = spawnWorker();
    }
}

/**
 * Handle worker progress updates and save to database
 */
async function handleWorkerProgress(progress: any): Promise<void> {
    try {
        const { resultId, status, data, error } = progress;

        // Use ContactInfoModule to save/update data in database
        const module = new ContactInfoModule();

        // Update status
        await module.updateExtractionStatus(resultId, status, error);

        // If extraction completed and we have data, save it
        if (status === 'completed' && data) {
            await module.saveContactExtractionResult(resultId, {
                email: data.emails?.[0] || null,
                phone: data.phones?.[0] || null,
                address: data.address || null,
                socialLinks: data.socialLinks || null,
                extractionStatus: 'completed'
            });
        }

        // Forward progress to renderer
        const windows = BrowserWindow.getAllWindows();
        const mainWindow = windows[0];
        if (mainWindow && !(mainWindow as any).isDestroyed()) {
            (mainWindow as any).webContents.send(CONTACT_EXTRACTION_PROGRESS, progress);
        }
    } catch (err) {
        console.error('Failed to handle worker progress:', err);
    }
}

/**
 * Fetch search results from database
 * Uses ContactInfoModule for business logic
 */
async function fetchSearchResults(resultIds: number[]): Promise<any[]> {
    const module = new ContactInfoModule();
    return await module.getSearchResults(resultIds);
}

/**
 * Register IPC handlers for contact extraction
 */
export function registerContactExtractionHandlers(): void {
    console.log('Registering contact extraction IPC handlers...');

    // Worker will be spawned lazily when first needed (not at startup)

    /**
     * Handler: Start contact extraction
     */
    ipcMain.handle(START_CONTACT_EXTRACTION, async (event, request: unknown) => {
        try {
            console.log(request);
            // Parse JSON string if needed (frontend sends JSON.stringify)
            const parsedRequest = typeof request === 'string' ? JSON.parse(request) : request;
            const { resultIds } = parsedRequest as ContactExtractionRequest;
            console.log(resultIds);
            // Validate input
            if (!Array.isArray(resultIds) || resultIds.length === 0) {
                return {
                    success: false,
                    message: 'Invalid result IDs: must be non-empty array'
                };
            }

            // Limit batch size
            if (resultIds.length > 50) {
                return {
                    success: false,
                    message: 'Batch size too large: maximum 50 items per request'
                };
            }

            console.log(`Starting contact extraction for ${resultIds.length} results`);

            // Use ContactInfoModule for business logic
            const module = new ContactInfoModule();

            // Fetch search results from database
            const results = await module.getSearchResults(resultIds);

            if (results.length === 0) {
                return {
                    success: false,
                    message: 'No search results found for given IDs'
                };
            }

            // Create pending contact info records for all results
            await module.createPendingContactInfo(resultIds);

            // Ensure worker is started (lazy initialization)
            ensureWorkerStarted();

            // Generate batch ID
            const batchId = uuidv4();

            // Send to worker process
            if (contactExtractionWorker && contactExtractionWorker.send) {
                contactExtractionWorker.send({
                    type: 'extract-contact',
                    batchId,
                    resultIds,
                    results,
                    priority: 0
                });
            } else {
                return {
                    success: false,
                    message: 'Worker process not available'
                };
            }

            return {
                success: true,
                batchId,
                message: `Extraction started for ${resultIds.length} results`
            };
        } catch (error) {
            console.error('Error starting contact extraction:', error);
            return {
                success: false,
                message: `Failed to start extraction: ${error}`
            };
        }
    });

    /**
     * Handler: Get contact info
     */
    ipcMain.handle(GET_CONTACT_INFO, async (event, request: unknown) => {
        try {
            // Parse JSON string if needed (frontend sends JSON.stringify)
            const parsedRequest = typeof request === 'string' ? JSON.parse(request) : request;
            const { resultIds } = parsedRequest as ContactExtractionRequest;

            // Use ContactInfoModule for business logic
            const module = new ContactInfoModule();
            const contactInfoList = await module.getContactInfoByResultIds(resultIds);

            return {
                success: true,
                data: contactInfoList
            };
        } catch (error) {
            console.error('Error getting contact info:', error);
            return {
                success: false,
                message: `Failed to get contact info: ${error}`
            };
        }
    });

    /**
     * Handler: Retry contact extraction
     */
    ipcMain.handle(RETRY_CONTACT_EXTRACTION, async (event, request: unknown) => {
        try {
            // Parse JSON string if needed (frontend sends JSON.stringify)
            const parsedRequest = typeof request === 'string' ? JSON.parse(request) : request;
            const { resultIds } = parsedRequest as ContactExtractionRequest;

            // Validate input
            if (!Array.isArray(resultIds) || resultIds.length === 0) {
                return {
                    success: false,
                    message: 'Invalid result IDs: must be non-empty array'
                };
            }

            console.log(`Retrying contact extraction for ${resultIds.length} results`);

            // Use ContactInfoModule for business logic
            const module = new ContactInfoModule();

            // Reset contact info for retry
            await module.resetContactInfoForRetry(resultIds);

            // Fetch search results
            const results = await module.getSearchResults(resultIds);

            if (results.length === 0) {
                return {
                    success: false,
                    message: 'No search results found for given IDs'
                };
            }

            // Ensure worker is started (lazy initialization)
            ensureWorkerStarted();

            // Generate batch ID
            const batchId = uuidv4();

            // Send to worker with higher priority
            if (contactExtractionWorker && contactExtractionWorker.send) {
                contactExtractionWorker.send({
                    type: 'extract-contact',
                    batchId,
                    resultIds,
                    results,
                    priority: 10 // Higher priority for retries
                });
            } else {
                return {
                    success: false,
                    message: 'Worker process not available'
                };
            }

            return {
                success: true,
                batchId,
                message: `Retry initiated for ${resultIds.length} results`
            };
        } catch (error) {
            console.error('Error retrying contact extraction:', error);
            return {
                success: false,
                message: `Failed to retry extraction: ${error}`
            };
        }
    });

    console.log('Contact extraction IPC handlers registered successfully');
}

/**
 * Cleanup function to close worker process
 */
export function cleanupContactExtractionWorker(): void {
    if (contactExtractionWorker) {
        console.log('Closing contact extraction worker...');
        contactExtractionWorker.kill();
        contactExtractionWorker = null;
    }
}
