/**
 * Contact Extraction IPC Handlers
 *
 * Handles IPC communication between renderer process and main process
 * for contact extraction functionality.
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SearchResultEntity } from '@/entity/SearchResult.entity';
import { ContactInfoEntity } from '@/entity/ContactInfo.entity';
import { SqliteDb } from '@/config/SqliteDb';
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
    const workerPath = path.join(__dirname, '.vite/build/ContactExtractionWorker.js');

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
    worker.on('message', (message: WorkerMessage) => {
        if (message.type === 'worker-ready') {
            console.log('Contact extraction worker is ready');
        } else if (message.type === 'extraction-progress') {
            // Forward progress to renderer
            const windows = BrowserWindow.getAllWindows();
            const mainWindow = windows[0];
            if (mainWindow && !(mainWindow as any).isDestroyed()) {
                (mainWindow as any).webContents.send(CONTACT_EXTRACTION_PROGRESS, message);
            }
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
 * Fetch search results from database
 */
async function fetchSearchResults(resultIds: number[]): Promise<any[]> {
    const userDataPath = app.getPath('userData');
    const dataSource = SqliteDb.getInstance(userDataPath).connection;
    const repository = dataSource.getRepository(SearchResultEntity);
    const results = await repository
        .createQueryBuilder('searchResult')
        .where('searchResult.id IN (:...resultIds)', { resultIds })
        .getMany();

    return results.map(r => ({
        id: r.id,
        url: r.link,
        title: r.title
    }));
}

/**
 * Register IPC handlers for contact extraction
 */
export function registerContactExtractionHandlers(): void {
    console.log('Registering contact extraction IPC handlers...');

    // Spawn worker process
    contactExtractionWorker = spawnWorker();

    /**
     * Handler: Start contact extraction
     */
    ipcMain.handle(START_CONTACT_EXTRACTION, async (event, request: unknown) => {
        try {
            const { resultIds } = request as ContactExtractionRequest;

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

            // Fetch search results from database
            const results = await fetchSearchResults(resultIds);

            if (results.length === 0) {
                return {
                    success: false,
                    message: 'No search results found for given IDs'
                };
            }

            // Create pending contact info records for all results
            const userDataPath = app.getPath('userData');
            const dataSource = SqliteDb.getInstance(userDataPath).connection;
            const contactInfoRepo = dataSource.getRepository(ContactInfoEntity);
            for (const resultId of resultIds) {
                const existing = await contactInfoRepo.findOne({ where: { resultId } as any });
                if (!existing) {
                    const newContactInfo = contactInfoRepo.create({
                        resultId,
                        extractionStatus: 'pending'
                    });
                    await contactInfoRepo.save(newContactInfo);
                }
            }

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
            const { resultIds } = request as ContactExtractionRequest;

            const userDataPath = app.getPath('userData');
            const dataSource = SqliteDb.getInstance(userDataPath).connection;
            const contactInfoList = await dataSource.getRepository(ContactInfoEntity)
                .createQueryBuilder('contactInfo')
                .where('contactInfo.resultId IN (:...resultIds)', { resultIds })
                .getMany();

            return {
                success: true,
                data: contactInfoList.map(ci => ({
                    resultId: ci.resultId,
                    email: ci.email,
                    phone: ci.phone,
                    address: ci.address,
                    socialLinks: ci.socialLinks,
                    extractionStatus: ci.extractionStatus,
                    extractionError: ci.extractionError,
                    extractionDate: ci.extractionDate?.toISOString()
                }))
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
            const { resultIds } = request as ContactExtractionRequest;

            // Validate input
            if (!Array.isArray(resultIds) || resultIds.length === 0) {
                return {
                    success: false,
                    message: 'Invalid result IDs: must be non-empty array'
                };
            }

            console.log(`Retrying contact extraction for ${resultIds.length} results`);

            // Delete existing contact info (reset for re-extraction)
            const userDataPath = app.getPath('userData');
            const dataSource = SqliteDb.getInstance(userDataPath).connection;
            const contactInfoRepo = dataSource.getRepository(ContactInfoEntity);
            for (const resultId of resultIds) {
                await contactInfoRepo.delete({ resultId } as any);

                // Create new pending record
                const newContactInfo = contactInfoRepo.create({
                    resultId,
                    extractionStatus: 'pending'
                });
                await contactInfoRepo.save(newContactInfo);
            }

            // Fetch search results
            const results = await fetchSearchResults(resultIds);

            if (results.length === 0) {
                return {
                    success: false,
                    message: 'No search results found for given IDs'
                };
            }

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
