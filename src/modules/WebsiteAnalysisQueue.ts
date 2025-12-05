import { utilityProcess } from 'electron';
import { AiChatApi, WebsiteAnalysisRequest } from '@/api/aiChatApi';
import { SearchResultModule } from '@/modules/SearchResultModule';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

interface AnalysisJob {
    id: string;
    resultId: number;
    url: string;
    clientBusiness: string;
    temperature?: number;
}

interface AnalysisResult {
    jobId: string;
    resultId: number;
    success: boolean;
    data?: {
        industry: string;
        match_score: number;
        reasoning: string;
    };
    error?: string;
}

interface ScrapeWebsiteMessage {
    type: 'SCRAPE_WEBSITE';
    url: string;
    requestId: string;
}

interface ScrapeWebsiteResponse {
    type: 'SCRAPE_SUCCESS' | 'SCRAPE_ERROR';
    requestId: string;
    markdown?: string;
    error?: string;
}

interface QueueProgress {
    completed: number;
    total: number;
    current?: string; // Current URL being processed
}

type ProgressCallback = (progress: QueueProgress) => void;
type CompleteCallback = (results: AnalysisResult[]) => void;

/**
 * Queue-based system for processing multiple website analysis jobs
 * Processes jobs concurrently with configurable concurrency limit
 */
export class WebsiteAnalysisQueue {
    private static instance: WebsiteAnalysisQueue | null = null;
    private queue: AnalysisJob[] = [];
    private processing: Set<string> = new Set();
    private results: Map<string, AnalysisResult> = new Map();
    private maxConcurrency: number = 3; // Process up to 3 websites concurrently
    private childProcessPath: string | null = null;
    private progressCallbacks: Set<ProgressCallback> = new Set();
    private completeCallbacks: Map<string, CompleteCallback> = new Map();
    private activeBatches: Map<string, Set<string>> = new Map(); // batchId -> Set of jobIds

    private constructor() {
        this.initializeChildProcessPath();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): WebsiteAnalysisQueue {
        if (!WebsiteAnalysisQueue.instance) {
            WebsiteAnalysisQueue.instance = new WebsiteAnalysisQueue();
        }
        return WebsiteAnalysisQueue.instance;
    }

    /**
     * Initialize child process path
     */
    private initializeChildProcessPath(): void {
        let childPath = path.join(__dirname, '../childprocess/websiteContentScraper.js');
        if (!fs.existsSync(childPath)) {
            const altPath = path.join(process.cwd(), 'dist/childprocess/websiteContentScraper.js');
            if (fs.existsSync(altPath)) {
                childPath = altPath;
            } else {
                console.warn(`Child process file not found at path: ${childPath}`);
                return;
            }
        }
        this.childProcessPath = childPath;
    }

    /**
     * Set maximum concurrent processing limit
     */
    public setMaxConcurrency(limit: number): void {
        if (limit > 0 && limit <= 10) {
            this.maxConcurrency = limit;
        }
    }

    /**
     * Add batch of jobs to queue
     * @param jobs Array of analysis jobs
     * @param onProgress Optional callback for progress updates
     * @param onComplete Optional callback when all jobs complete
     * @returns Batch ID for tracking
     */
    public async addBatch(
        jobs: AnalysisJob[],
        onProgress?: ProgressCallback,
        onComplete?: CompleteCallback
    ): Promise<string> {
        const batchId = `batch-${uuidv4()}`;
        const jobIds = new Set<string>();

        // Validate and add jobs to queue
        for (const job of jobs) {
            // Validate URL
            try {
                new URL(job.url);
            } catch {
                // Invalid URL - add error result immediately
                const errorResult: AnalysisResult = {
                    jobId: job.id,
                    resultId: job.resultId,
                    success: false,
                    error: 'Invalid URL format'
                };
                this.results.set(job.id, errorResult);
                continue;
            }

            // Validate required fields
            if (!job.resultId || !job.url || !job.clientBusiness) {
                const errorResult: AnalysisResult = {
                    jobId: job.id,
                    resultId: job.resultId,
                    success: false,
                    error: 'Missing required fields'
                };
                this.results.set(job.id, errorResult);
                continue;
            }

            this.queue.push(job);
            jobIds.add(job.id);
        }

        this.activeBatches.set(batchId, jobIds);

        // Register callbacks
        if (onProgress) {
            this.progressCallbacks.add(onProgress);
        }
        if (onComplete) {
            this.completeCallbacks.set(batchId, onComplete);
        }

        // Start processing
        this.processQueue(batchId);

        return batchId;
    }

    /**
     * Process queue with concurrency control
     */
    private async processQueue(batchId: string): Promise<void> {
        const batchJobIds = this.activeBatches.get(batchId);
        if (!batchJobIds) {
            return;
        }

        // Process jobs up to concurrency limit
        while (this.queue.length > 0 && this.processing.size < this.maxConcurrency) {
            const job = this.queue.shift();
            if (!job) break;

            // Skip if not part of this batch
            if (!batchJobIds.has(job.id)) {
                this.queue.push(job); // Put it back
                continue;
            }

            this.processing.add(job.id);
            this.processJob(job, batchId).finally(() => {
                this.processing.delete(job.id);
                // Continue processing queue
                this.processQueue(batchId);
            });
        }

        // Check if batch is complete
        this.checkBatchComplete(batchId);
    }

    /**
     * Process a single job
     */
    private async processJob(job: AnalysisJob, batchId: string): Promise<void> {
        if (!this.childProcessPath || !fs.existsSync(this.childProcessPath)) {
            const errorResult: AnalysisResult = {
                jobId: job.id,
                resultId: job.resultId,
                success: false,
                error: 'Child process file not found'
            };
            this.results.set(job.id, errorResult);
            this.updateProgress(batchId);
            return;
        }

        try {
            // Update progress with current URL
            this.notifyProgress(batchId, job.url);

            // Scrape website content
            const markdown = await this.scrapeWebsite(job.url, job.id);

            if (!markdown) {
                const errorResult: AnalysisResult = {
                    jobId: job.id,
                    resultId: job.resultId,
                    success: false,
                    error: 'No content extracted from website'
                };
                this.results.set(job.id, errorResult);
                this.updateProgress(batchId);
                return;
            }

            // Call AI analysis API
            const aiChatApi = new AiChatApi();
            const analysisRequest: WebsiteAnalysisRequest = {
                website_content: markdown,
                client_business: job.clientBusiness,
                temperature: job.temperature ?? 0.7
            };

            const response = await aiChatApi.analyzeWebsite(analysisRequest);

            if (!response.status || !response.data) {
                const errorResult: AnalysisResult = {
                    jobId: job.id,
                    resultId: job.resultId,
                    success: false,
                    error: response.msg || 'AI analysis failed'
                };
                this.results.set(job.id, errorResult);
                this.updateProgress(batchId);
                return;
            }

            // Update database
            const searchResultModule = new SearchResultModule();
            await searchResultModule.updateAiAnalysis(job.resultId, {
                industry: response.data.industry,
                match_score: response.data.match_score,
                reasoning: response.data.reasoning,
                client_business: job.clientBusiness
            });

            // Store result
            const successResult: AnalysisResult = {
                jobId: job.id,
                resultId: job.resultId,
                success: true,
                data: {
                    industry: response.data.industry,
                    match_score: response.data.match_score,
                    reasoning: response.data.reasoning
                }
            };
            this.results.set(job.id, successResult);
            this.updateProgress(batchId);
        } catch (error) {
            const errorResult: AnalysisResult = {
                jobId: job.id,
                resultId: job.resultId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
            this.results.set(job.id, errorResult);
            this.updateProgress(batchId);
        }
    }

    /**
     * Scrape website using child process
     */
    private async scrapeWebsite(url: string, jobId: string): Promise<string | null> {
        if (!this.childProcessPath) {
            throw new Error('Child process path not initialized');
        }

        return new Promise((resolve, reject) => {
            const childProcess = utilityProcess.fork(this.childProcessPath!, [], {
                stdio: 'pipe',
                execArgv: ["puppeteer-cluster:*"],
                env: {
                    ...process.env,
                    NODE_OPTIONS: ""
                }
            });

            const requestId = `analyze-${jobId}-${Date.now()}`;
            const timeout = setTimeout(() => {
                childProcess.kill();
                reject(new Error('Website scraping timeout'));
            }, 60000); // 60 second timeout

            const messageHandler = (rawMessage: unknown) => {
                let message: ScrapeWebsiteResponse;
                try {
                    if (typeof rawMessage === 'string') {
                        message = JSON.parse(rawMessage);
                    } else {
                        message = rawMessage as ScrapeWebsiteResponse;
                    }
                } catch (error) {
                    clearTimeout(timeout);
                    childProcess.removeListener('message', messageHandler);
                    childProcess.kill();
                    reject(new Error('Error parsing child process message'));
                    return;
                }

                if (message.requestId !== requestId) {
                    return; // Ignore messages for other requests
                }

                clearTimeout(timeout);
                childProcess.removeListener('message', messageHandler);
                childProcess.kill();

                if (message.type === 'SCRAPE_ERROR') {
                    reject(new Error(message.error || 'Failed to scrape website'));
                    return;
                }

                if (!message.markdown) {
                    reject(new Error('No content extracted from website'));
                    return;
                }

                resolve(message.markdown);
            };

            childProcess.on('message', messageHandler);

            childProcess.on('error', (error: unknown) => {
                clearTimeout(timeout);
                childProcess.removeListener('message', messageHandler);
                const errorMessage = error instanceof Error ? error.message : String(error);
                reject(new Error(`Child process error: ${errorMessage}`));
            });

            childProcess.on('exit', (code) => {
                if (code !== 0 && code !== null) {
                    clearTimeout(timeout);
                    childProcess.removeListener('message', messageHandler);
                    reject(new Error(`Child process exited with code ${code}`));
                }
            });

            childProcess.on('spawn', () => {
                const scrapeMessage: ScrapeWebsiteMessage = {
                    type: 'SCRAPE_WEBSITE',
                    url: url,
                    requestId: requestId
                };
                childProcess.postMessage(JSON.stringify(scrapeMessage));
            });
        });
    }

    /**
     * Update progress and notify callbacks
     */
    private updateProgress(batchId: string): void {
        this.notifyProgress(batchId);
        this.checkBatchComplete(batchId);
    }

    /**
     * Notify progress callbacks
     */
    private notifyProgress(batchId: string, currentUrl?: string): void {
        const batchJobIds = this.activeBatches.get(batchId);
        if (!batchJobIds) return;

        const total = batchJobIds.size;
        const completed = Array.from(batchJobIds).filter(id => this.results.has(id)).length;

        const progress: QueueProgress = {
            completed,
            total,
            current: currentUrl
        };

        this.progressCallbacks.forEach(callback => {
            try {
                callback(progress);
            } catch (error) {
                console.error('Error in progress callback:', error);
            }
        });
    }

    /**
     * Check if batch is complete and notify
     */
    private checkBatchComplete(batchId: string): void {
        const batchJobIds = this.activeBatches.get(batchId);
        if (!batchJobIds) return;

        const allComplete = Array.from(batchJobIds).every(id => this.results.has(id));
        const queueEmpty = this.queue.length === 0;
        const processingEmpty = this.processing.size === 0 || 
            Array.from(this.processing).every(id => !batchJobIds.has(id));

        if (allComplete && queueEmpty && processingEmpty) {
            // Collect results for this batch
            const batchResults: AnalysisResult[] = Array.from(batchJobIds)
                .map(id => this.results.get(id))
                .filter((result): result is AnalysisResult => result !== undefined);

            // Notify complete callback
            const onComplete = this.completeCallbacks.get(batchId);
            if (onComplete) {
                try {
                    onComplete(batchResults);
                } catch (error) {
                    console.error('Error in complete callback:', error);
                }
                this.completeCallbacks.delete(batchId);
            }

            // Clean up
            this.activeBatches.delete(batchId);
            batchJobIds.forEach(id => this.results.delete(id));
        }
    }

    /**
     * Get results for a batch
     */
    public getBatchResults(batchId: string): AnalysisResult[] {
        const batchJobIds = this.activeBatches.get(batchId);
        if (!batchJobIds) {
            return [];
        }

        return Array.from(batchJobIds)
            .map(id => this.results.get(id))
            .filter((result): result is AnalysisResult => result !== undefined);
    }

    /**
     * Clear all queues and results
     */
    public clear(): void {
        this.queue = [];
        this.processing.clear();
        this.results.clear();
        this.activeBatches.clear();
        this.progressCallbacks.clear();
        this.completeCallbacks.clear();
    }
}

