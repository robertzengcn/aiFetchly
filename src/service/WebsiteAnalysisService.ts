import { WebsiteAnalysisQueue } from '@/modules/WebsiteAnalysisQueue';
import { SearchResultModule } from '@/modules/SearchResultModule';
import { AiChatApi, WebsiteAnalysisRequest } from '@/api/aiChatApi';
import { utilityProcess } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Configuration constants for website analysis
 */
const ANALYSIS_CONFIG = {
    // Timeouts
    SCRAPING_TIMEOUT: 600000,        // 10 minutes
    BATCH_COMPLETION_TIMEOUT: 600000, // 10 minutes
    POLL_INTERVAL: 2000,             // 2 seconds

    // Limits
    MAX_BATCH_SIZE: 100,
    MAX_URL_LENGTH: 2048,

    // Default values
    DEFAULT_TEMPERATURE: 0.7
} as const;

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

interface BatchAnalysisOptions {
    resultIds: number[];
    clientBusiness: string;
    temperature?: number;
    onProgress?: (progress: QueueProgress) => void;
}

interface BatchAnalysisResult {
    batchId: string;
    total: number;
    validItems: number;
}

/**
 * Service for batch website analysis
 * Handles the core logic that can be used by both IPC handlers and tool executors
 */
export class WebsiteAnalysisService {
    /**
     * Start batch website analysis
     * @param options Analysis options including result IDs, client business, and optional callbacks
     * @returns Batch ID and analysis information
     */
    static async startBatchAnalysis(options: BatchAnalysisOptions): Promise<BatchAnalysisResult> {
        const { resultIds, clientBusiness, temperature, onProgress } = options;

        // Validate input
        if (!resultIds || !Array.isArray(resultIds) || resultIds.length === 0) {
            throw new Error('Missing or empty resultIds array');
        }

        if (!clientBusiness || clientBusiness.trim().length === 0) {
            throw new Error('Missing required field: clientBusiness');
        }

        // Get search results by IDs
        const searchResultModule = new SearchResultModule();
        const searchResults = await searchResultModule.getSearchResultsByIds(resultIds);

        if (searchResults.length === 0) {
            throw new Error('No search results found for the provided IDs');
        }

        // Validate URLs and create jobs
        const validItems: Array<{ resultId: number; url: string }> = [];
        for (const result of searchResults) {
            if (!result.id || !result.link) {
                continue;
            }
            try {
                new URL(result.link);
                validItems.push({
                    resultId: result.id,
                    url: result.link
                });
            } catch {
                // Invalid URL, skip
                continue;
            }
        }

        if (validItems.length === 0) {
            throw new Error('No valid URLs found in search results');
        }

        // Create jobs for queue
        const jobs: AnalysisJob[] = validItems.map(item => ({
            id: uuidv4(),
            resultId: item.resultId,
            url: item.url,
            clientBusiness: clientBusiness,
            temperature: temperature ?? 0.7
        }));

        // Get queue instance
        const queue = WebsiteAnalysisQueue.getInstance();

        // Generate batch ID
        const batchId = `batch-${uuidv4()}`;

        // Set status to 'analyzing' for all items when batch starts
        const resultIdsToUpdate = validItems.map(item => item.resultId);
        try {
            await searchResultModule.updateAiAnalysisStatusBatch(resultIdsToUpdate, 'analyzing');
        } catch (error) {
            console.error('Failed to update status to analyzing:', error);
            // Continue even if status update fails
        }

        // Set up progress callback if provided
        const progressCallback = onProgress ? (progress: QueueProgress) => {
            onProgress(progress);
        } : undefined;

        // Add batch to queue
        await queue.addBatch(jobs, progressCallback);

        return {
            batchId,
            total: validItems.length,
            validItems: validItems.length
        };
    }

    /**
     * Wait for batch analysis to complete
     * @param batchId Batch ID to wait for
     * @param resultIds Array of result IDs that were part of the batch
     * @param maxWaitTime Maximum time to wait in milliseconds (default: 10 minutes)
     * @param pollInterval Polling interval in milliseconds (default: 2 seconds)
     * @returns Analysis results
     */
    static async waitForBatchCompletion(
        batchId: string,
        resultIds: number[],
        maxWaitTime: number = ANALYSIS_CONFIG.BATCH_COMPLETION_TIMEOUT,
        pollInterval: number = ANALYSIS_CONFIG.POLL_INTERVAL
    ): Promise<Array<{
        resultId: number;
        success: boolean;
        industry?: string;
        match_score?: number;
        reasoning?: string;
        error?: string;
    }>> {
        const searchResultModule = new SearchResultModule();
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            // Check database status for all result IDs
            const searchResults = await searchResultModule.getSearchResultsByIds(resultIds);
            
            // Check if all have completed status (completed or failed)
            const allComplete = searchResults.every(result => 
                result.ai_analysis_status === 'completed' || result.ai_analysis_status === 'failed'
            );

            if (allComplete) {
                // Return formatted results (filter out any without IDs)
                return searchResults
                    .filter((result): result is typeof result & { id: number } => result.id !== undefined && result.id !== null)
                    .map(result => ({
                        resultId: result.id,
                        success: result.ai_analysis_status === 'completed',
                        industry: result.ai_industry ?? undefined,
                        match_score: result.ai_match_score ?? undefined,
                        reasoning: result.ai_reasoning ?? undefined,
                        error: result.ai_analysis_status === 'failed' ? 'Analysis failed' : undefined
                    }));
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Timeout - return current status (filter out any without IDs)
        const searchResults = await searchResultModule.getSearchResultsByIds(resultIds);
        return searchResults
            .filter((result): result is typeof result & { id: number } => result.id !== undefined && result.id !== null)
            .map(result => ({
                resultId: result.id,
                success: result.ai_analysis_status === 'completed',
                industry: result.ai_industry ?? undefined,
                match_score: result.ai_match_score ?? undefined,
                reasoning: result.ai_reasoning ?? undefined,
                error: result.ai_analysis_status === 'failed' 
                    ? 'Analysis failed' 
                    : result.ai_analysis_status === 'analyzing'
                    ? 'Analysis timeout'
                    : undefined
            }));
    }

    /**
     * Scrape website content using child process
     * @param url Website URL to scrape
     * @returns Markdown content of the website
     */
    private static async scrapeWebsite(url: string): Promise<string> {
        const childProcessPath = this.getChildProcessPath();
        if (!childProcessPath) {
            throw new Error('Child process file not found');
        }

        return new Promise((resolve, reject) => {
            const childProcess = utilityProcess.fork(childProcessPath, [], {
                stdio: 'pipe',
                execArgv: ["puppeteer-cluster:*"],
                env: {
                    ...process.env,
                    NODE_OPTIONS: ""
                }
            });

            const requestId = `analyze-${uuidv4()}-${Date.now()}`;
            const timeout = setTimeout(() => {
                childProcess.kill();
                reject(new Error('Website scraping timeout'));
            }, ANALYSIS_CONFIG.SCRAPING_TIMEOUT);

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
     * Get child process path for website scraping
     */
    private static getChildProcessPath(): string | null {
        // Try the same path pattern as WebsiteAnalysisQueue
        const childPath = path.join(__dirname, './childprocess/websiteContentScraper.js');
        if (!fs.existsSync(childPath)) {
            // Try relative path from service directory
            const altPath1 = path.join(__dirname, '../childprocess/websiteContentScraper.js');
            if (fs.existsSync(altPath1)) {
                return altPath1;
            }
            // Try dist directory
            const altPath2 = path.join(process.cwd(), 'dist/childprocess/websiteContentScraper.js');
            if (fs.existsSync(altPath2)) {
                return altPath2;
            }
            console.warn(`Child process file not found. Tried: ${childPath}, ${altPath1}, ${altPath2}`);
            return null;
        }
        return childPath;
    }

    /**
     * Analyze websites directly from URLs without saving to database
     * @param urls Array of URLs to analyze
     * @param clientBusiness Client business description
     * @param temperature Optional temperature for AI analysis
     * @returns Analysis results for each URL
     */
    static async analyzeWebsitesDirectly(
        urls: string[],
        clientBusiness: string,
        temperature: number = ANALYSIS_CONFIG.DEFAULT_TEMPERATURE
    ): Promise<Array<{
        url: string;
        success: boolean;
        industry?: string;
        match_score?: number;
        reasoning?: string;
        error?: string;
    }>> {
        // Validate input
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            throw new Error('Missing or empty urls array');
        }

        if (!clientBusiness || clientBusiness.trim().length === 0) {
            throw new Error('Missing required field: clientBusiness');
        }

        // Validate URLs
        const validUrls: string[] = [];
        for (const url of urls) {
            if (typeof url !== 'string' || url.trim().length === 0) {
                continue;
            }
            try {
                new URL(url);
                validUrls.push(url);
            } catch {
                // Invalid URL, skip
                continue;
            }
        }

        if (validUrls.length === 0) {
            throw new Error('No valid URLs found in urls array');
        }

        // Analyze each URL
        const results: Array<{
            url: string;
            success: boolean;
            industry?: string;
            match_score?: number;
            reasoning?: string;
            error?: string;
        }> = [];

        const aiChatApi = new AiChatApi();

        for (const url of validUrls) {
            try {
                // Scrape website content
                const markdown = await this.scrapeWebsite(url);

                if (!markdown) {
                    results.push({
                        url,
                        success: false,
                        error: 'No content extracted from website'
                    });
                    continue;
                }

                // Call AI analysis API
                const analysisRequest: WebsiteAnalysisRequest = {
                    website_content: markdown,
                    client_business: clientBusiness,
                    temperature: temperature
                };

                const response = await aiChatApi.analyzeWebsite(analysisRequest);

                if (!response.status || !response.data) {
                    results.push({
                        url,
                        success: false,
                        error: response.msg || 'AI analysis failed'
                    });
                    continue;
                }

                // Return result without saving to database
                results.push({
                    url,
                    success: true,
                    industry: response.data.industry,
                    match_score: response.data.match_score,
                    reasoning: response.data.reasoning
                });
            } catch (error) {
                results.push({
                    url,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred'
                });
            }
        }

        return results;
    }
}

