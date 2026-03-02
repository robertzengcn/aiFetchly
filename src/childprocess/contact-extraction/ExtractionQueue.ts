import { v4 as uuidv4 } from 'uuid';
import { ExtractionJob, ExtractionProgress } from '@/entityTypes/contactExtractionTypes';
import { discoverAndExtractContactInfo } from './ContactDiscovery';

/**
 * Extraction Queue with Concurrency Control
 * Manages contact extraction jobs with parallel processing and retry logic
 *
 * IMPORTANT: This queue runs in a worker process and does NOT directly access the database.
 * All database operations are handled by the main process via IPC progress updates.
 */

export class ContactExtractionQueue {
    private queue: ExtractionJob[] = [];
    private active = 0;
    private maxRetries = 3;
    private maxConcurrency: number;
    private processing = new Set<number>(); // resultIds currently processing
    private batchId: string | null = null;
    private progressCallback: ((progress: ExtractionProgress) => void) | null = null;

    constructor(maxConcurrency = 3) {
        this.maxConcurrency = maxConcurrency;
    }

    /**
     * Set progress callback for real-time updates
     */
    setProgressCallback(callback: (progress: ExtractionProgress) => void): void {
        this.progressCallback = callback;
    }

    /**
     * Add a single job to the queue
     */
    async add(job: ExtractionJob): Promise<void> {
        this.queue.push(job);
        this.queue.sort((a, b) => b.priority - a.priority); // Priority queue
        this.process();
    }

    /**
     * Add multiple jobs to the queue
     */
    async addBatch(jobs: ExtractionJob[], batchId?: string): Promise<void> {
        this.batchId = batchId || uuidv4();
        this.queue.push(...jobs);
        this.queue.sort((a, b) => b.priority - a.priority);
        this.process();
    }

    /**
     * Process the queue (internal method)
     */
    private async process(): Promise<void> {
        while (this.queue.length > 0 && this.active < this.maxConcurrency) {
            const job = this.queue.shift();
            if (!job) break;

            // Skip if already processing
            if (this.processing.has(job.resultId)) {
                continue;
            }

            this.active++;
            this.processing.add(job.resultId);

            // Process job asynchronously
            this.processJob(job)
                .catch((error: unknown) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error(`Job failed for result ${job.resultId}:`, errorMessage);

                    // Retry logic
                    if (job.retryCount < this.maxRetries) {
                        job.retryCount++;
                        job.priority -= 10; // Lower priority on retry
                        setTimeout(() => {
                            this.queue.push(job);
                            this.process();
                        }, Math.pow(2, job.retryCount) * 1000); // Exponential backoff
                    } else {
                        // Max retries reached - persist failed status with actual error so DB and UI show it
                        this.sendProgressUpdate({
                            batchId: this.batchId || '',
                            resultId: job.resultId,
                            status: 'failed',
                            error: errorMessage
                        });
                    }
                })
                .finally(() => {
                    this.active--;
                    this.processing.delete(job.resultId);
                    this.process();
                });
        }
    }

    /**
     * Process a single job
     */
    private async processJob(job: ExtractionJob): Promise<void> {
        console.log(`Processing job for result ${job.resultId}: ${job.url}`);

        // Send status update to main process (will save to database)
        this.sendProgressUpdate({
            batchId: this.batchId || '',
            resultId: job.resultId,
            status: 'analyzing'
        });

        // Perform extraction
        const startTime = Date.now();
        const result = await discoverAndExtractContactInfo(job.url);
        const duration = Date.now() - startTime;

        if (result.success && result.data) {
            // Validate and clean extracted data
            const validatedEmails = result.data.emails?.filter(email =>
                this.validateEmail(email)
            ) || [];

            const validatedPhones = result.data.phones?.filter(phone =>
                this.validatePhone(phone)
            ) || [];

            // If we have at least one email or phone, send the data to main process
            if (validatedEmails.length > 0 || validatedPhones.length > 0 || result.data.address) {
                // Send progress update with extracted data (main process will save to database)
                this.sendProgressUpdate({
                    batchId: this.batchId || '',
                    resultId: job.resultId,
                    status: 'completed',
                    data: {
                        emails: validatedEmails,
                        phones: validatedPhones,
                        address: result.data.address || null,
                        socialLinks: result.data.socialLinks || null,
                        source: result.data.source,
                        confidence: result.data.confidence
                    },
                    method: result.method
                });

                console.log(`Successfully extracted contact info for result ${job.resultId}`);
            } else {
                // No valid data found after validation
                this.sendProgressUpdate({
                    batchId: this.batchId || '',
                    resultId: job.resultId,
                    status: 'failed',
                    error: 'No valid contact information found'
                });
            }
        } else {
            // Mark as failed
            this.sendProgressUpdate({
                batchId: this.batchId || '',
                resultId: job.resultId,
                status: 'failed',
                error: result.error || 'Unknown error'
            });
        }
    }

    /**
     * Send progress update via callback
     */
    private sendProgressUpdate(progress: ExtractionProgress): void {
        if (this.progressCallback) {
            this.progressCallback(progress);
        }
    }

    /**
     * Get current queue length
     */
    getQueueLength(): number {
        return this.queue.length;
    }

    /**
     * Get number of active jobs
     */
    getActiveCount(): number {
        return this.active;
    }

    /**
     * Validate email format
     */
    private validateEmail(email: string): boolean {
        const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/;
        return emailPattern.test(email);
    }

    /**
     * Validate phone format
     */
    private validatePhone(phone: string): boolean {
        const phonePattern = /^\+?[\d\s\-().]{10,}$/;
        return phonePattern.test(phone);
    }

    /**
     * Clear all pending jobs
     */
    clear(): void {
        this.queue = [];
    }
}

// Export singleton instance
export const extractionQueue = new ContactExtractionQueue(3); // Max 3 concurrent
