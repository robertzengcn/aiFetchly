import { IScraperEngine, YellowPagesTask, YellowPagesResult, PlatformSelectors, BusinessData, ScrapingProgress, ScrapingError } from '../modules/interface/IScraperEngine';

/**
 * Mock implementation of IScraperEngine for testing purposes.
 * This mock provides predictable behavior for unit testing and development.
 */
export class MockScraperEngine implements IScraperEngine {
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private progressCallbacks: ((progress: ScrapingProgress) => void)[] = [];
    private errorCallbacks: ((error: ScrapingError) => void)[] = [];
    private completionCallbacks: ((results: YellowPagesResult[]) => void)[] = [];

    /**
     * Mock scraping task implementation
     */
    async scrapeTask(task: YellowPagesTask): Promise<YellowPagesResult[]> {
        console.log(`MockScraperEngine: Starting task ${task.id}`);
        
        const mockResults: YellowPagesResult[] = [];
        
        // Generate mock results based on task configuration
        for (let i = 0; i < task.max_pages * 10; i++) {
            mockResults.push({
                id: i + 1,
                task_id: task.id,
                business_name: `Mock Business ${i + 1}`,
                email: `business${i + 1}@example.com`,
                phone: `+1-555-${String(i + 1).padStart(4, '0')}`,
                website: `https://mockbusiness${i + 1}.com`,
                address: {
                    street: `${i + 1} Mock Street`,
                    city: 'Mock City',
                    state: 'MS',
                    zip: '12345',
                    country: 'USA'
                },
                social_media: [`https://facebook.com/mockbusiness${i + 1}`],
                categories: ['Mock Category'],
                business_hours: { monday: { open: '9:00 AM', close: '5:00 PM' } },
                description: `Mock business description ${i + 1}`,
                rating: 4.5,
                review_count: Math.floor(Math.random() * 100),
                scraped_at: new Date(),
                platform: task.platform,
                raw_data: { mock: true, index: i + 1 },
                fax_number: `+1-555-${String(i + 1).padStart(4, '0')}`,
                contact_person: `Mock Contact ${i + 1}`,
                year_established: 2020 + (i % 10),
                number_of_employees: `${Math.floor(Math.random() * 100) + 1} employees`,
                payment_methods: ['Cash', 'Credit Card'],
                specialties: ['Mock Specialty']
            });
        }

        // Simulate progress updates
        for (let page = 1; page <= task.max_pages; page++) {
            if (!this.isRunning) break;
            
            while (this.isPaused && this.isRunning) {
                await this.sleep(100);
            }

            const progress: ScrapingProgress = {
                currentPage: page,
                totalPages: task.max_pages,
                resultsCount: page * 10,
                percentage: (page / task.max_pages) * 100,
                estimatedTimeRemaining: (task.max_pages - page) * 1000
            };

            this.reportProgress(progress);
            await this.sleep(500); // Simulate processing time
        }

        console.log(`MockScraperEngine: Completed task ${task.id} with ${mockResults.length} results`);
        return mockResults;
    }

    /**
     * Mock business data extraction
     */
    async extractBusinessData(page: any, selectors: PlatformSelectors): Promise<BusinessData> {
        return {
            business_name: 'Mock Business',
            email: 'mock@example.com',
            phone: '+1-555-1234',
            website: 'https://mockbusiness.com',
            address: {
                street: '123 Mock Street',
                city: 'Mock City',
                state: 'MS',
                zip: '12345',
                country: 'USA'
            },
            social_media: ['https://facebook.com/mockbusiness'],
            categories: ['Mock Category'],
            business_hours: { monday: { open: '9:00 AM', close: '5:00 PM' } },
            description: 'Mock business description',
            rating: 4.5,
            review_count: 50,
            raw_data: { mock: true }
        };
    }

    /**
     * Mock pagination handling
     */
    async handlePagination(page: any, maxPages: number): Promise<void> {
        console.log(`MockScraperEngine: Handling pagination for ${maxPages} pages`);
        await this.sleep(100);
    }

    /**
     * Start the mock scraper
     */
    async start(): Promise<void> {
        console.log('MockScraperEngine: Starting');
        this.isRunning = true;
        this.isPaused = false;
    }

    /**
     * Stop the mock scraper
     */
    async stop(): Promise<void> {
        console.log('MockScraperEngine: Stopping');
        this.isRunning = false;
    }

    /**
     * Pause the mock scraper
     */
    async pause(): Promise<void> {
        console.log('MockScraperEngine: Pausing');
        this.isPaused = true;
    }

    /**
     * Resume the mock scraper
     */
    async resume(): Promise<void> {
        console.log('MockScraperEngine: Resuming');
        this.isPaused = false;
    }

    /**
     * Register progress callback
     */
    onProgress(callback: (progress: ScrapingProgress) => void): void {
        this.progressCallbacks.push(callback);
    }

    /**
     * Register error callback
     */
    onError(callback: (error: ScrapingError) => void): void {
        this.errorCallbacks.push(callback);
    }

    /**
     * Register completion callback
     */
    onComplete(callback: (results: YellowPagesResult[]) => void): void {
        this.completionCallbacks.push(callback);
    }

    /**
     * Report progress to registered callbacks
     */
    private reportProgress(progress: ScrapingProgress): void {
        this.progressCallbacks.forEach(callback => callback(progress));
    }

    /**
     * Report error to registered callbacks
     */
    private reportError(error: ScrapingError): void {
        this.errorCallbacks.forEach(callback => callback(error));
    }

    /**
     * Report completion to registered callbacks
     */
    private reportCompletion(results: YellowPagesResult[]): void {
        this.completionCallbacks.forEach(callback => callback(results));
    }

    /**
     * Sleep utility for simulating delays
     */
    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
} 