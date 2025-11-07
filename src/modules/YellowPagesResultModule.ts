import { BaseModule } from "@/modules/baseModule";
import { YellowPagesResultModel } from "@/model/YellowPagesResult.model";
import { SortBy } from "@/entityTypes/commonType";
import { YellowPagesResultEntity } from "@/entity/YellowPagesResult.entity";
import { YellowPagesResult } from "@/modules/interface/ITaskManager";

export class YellowPagesResultModule extends BaseModule {
    private yellowPagesResultModel: YellowPagesResultModel;

    constructor() {
        super();
        this.yellowPagesResultModel = new YellowPagesResultModel(this.dbpath);
    }

    /**
     * Create a new Yellow Pages result
     * @param result The result data to create
     * @returns The ID of the created result
     */
    async createResult(result: YellowPagesResult): Promise<number> {
        try {
            // Convert result data to entity format
            const resultEntity = this.convertResultToEntity(result);
            
            // Use the model's saveYellowPagesResult method
            const saveResult = await this.yellowPagesResultModel.saveYellowPagesResult({
                task_id: result.task_id,
                business_name: result.business_name,
                email: result.email,
                phone: result.phone,
                website: result.website,
                address: result.address,
                social_media: result.social_media,
                categories: result.categories,
                business_hours: result.business_hours,
                description: result.description,
                rating: result.rating,
                review_count: result.review_count,
                platform: result.platform,
                raw_data: result.raw_data
            });
            
            return saveResult.id;
        } catch (error) {
            console.error('Error creating result:', error);
            throw new Error(`Failed to create result: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get a Yellow Pages result by ID
     * @param id The result ID
     * @returns The result entity
     */
    async getResultById(id: number): Promise<YellowPagesResultEntity | undefined> {
        try {
            const result = await this.yellowPagesResultModel.getResultById(id);
            return result || undefined;
        } catch (error) {
            console.error('Error getting result by ID:', error);
            throw new Error(`Failed to get result by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update a Yellow Pages result
     * @param id The result ID
     * @param updates The result updates
     */
    async updateResult(id: number, updates: Partial<YellowPagesResultEntity>): Promise<void> {
        try {
            const existingResult = await this.getResultById(id);
            if (!existingResult) {
                throw new Error(`Result with ID ${id} not found`);
            }

            // For now, we'll need to implement an update method in the model
            // Since the model doesn't have an update method yet, we'll throw an error
            // TODO: Implement update method in YellowPagesResultModel
            throw new Error("update method not implemented in YellowPagesResultModel");
        } catch (error) {
            console.error('Error updating result:', error);
            throw new Error(`Failed to update result ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Delete a Yellow Pages result
     * @param id The result ID
     */
    async deleteResult(id: number): Promise<void> {
        try {
            const success = await this.yellowPagesResultModel.deleteResult(id);
            if (!success) {
                throw new Error('Failed to delete result');
            }
        } catch (error) {
            console.error('Error deleting result:', error);
            throw new Error(`Failed to delete result ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results by task ID with pagination
     * @param taskId The task ID
     * @param page Page number (0-based)
     * @param size Page size
     * @returns Array of results for the specified task
     */
    async getResultsByTaskId(taskId: number, page: number = 0, size: number = 20): Promise<YellowPagesResult[]> {
        try {
            // The model now expects 0-based pagination, so pass page directly
            const resultEntities = await this.yellowPagesResultModel.getResultsByTaskId(taskId, page, size);
            return resultEntities.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results by task ID:', error);
            throw new Error(`Failed to get results for task ${taskId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results by platform with pagination
     * @param platform The platform to filter by
     * @param page Page number (0-based)
     * @param size Page size
     * @returns Array of results for the specified platform
     */
    async getResultsByPlatform(platform: string, page: number = 0, size: number = 20): Promise<YellowPagesResult[]> {
        try {
            const resultEntities = await this.yellowPagesResultModel.getResultsByPlatform(platform, page, size);
            return resultEntities.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results by platform:', error);
            throw new Error(`Failed to get results for platform ${platform}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search results by business name or other criteria with pagination
     * @param searchTerm The search term
     * @param page Page number (0-based)
     * @param size Page size
     * @returns Array of matching results
     */
    async searchResults(searchTerm: string, page: number = 0, size: number = 20): Promise<YellowPagesResult[]> {
        try {
            const resultEntities = await this.yellowPagesResultModel.searchByBusinessName(searchTerm, page, size);
            return resultEntities.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error searching results:', error);
            throw new Error(`Failed to search results for term "${searchTerm}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results count by task ID
     * @param taskId The task ID
     * @returns Number of results for the specified task
     */
    async getResultsCountByTaskId(taskId: number): Promise<number> {
        try {
            return await this.yellowPagesResultModel.getResultCountByTaskId(taskId);
        } catch (error) {
            console.error('Error getting results count by task ID:', error);
            throw new Error(`Failed to get results count for task ${taskId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get total number of results
     * @returns Total count of results
     */
    async countResults(): Promise<number> {
        try {
            return await this.yellowPagesResultModel.getResultTotal();
        } catch (error) {
            console.error('Error counting results:', error);
            throw new Error(`Failed to count results: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * List results with pagination and sorting
     * @param page Page number (0-based)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns Array of result entities
     */
    async listResults(page: number = 0, size: number = 50, sort?: SortBy): Promise<YellowPagesResultEntity[]> {
        try {
            // The model now expects 0-based pagination, so pass page directly
            return await this.yellowPagesResultModel.listResults(page, size, sort);
        } catch (error) {
            console.error('Error listing results:', error);
            throw new Error(`Failed to list results: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results by date range
     * @param startDate Start date for filtering
     * @param endDate End date for filtering
     * @returns Array of results within the date range
     */
    async getResultsByDateRange(startDate: Date, endDate: Date): Promise<YellowPagesResult[]> {
        try {
            // Get all results and filter those within the date range
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000); // Get a large number to cover all results
            const resultsByDateRange = allResults.filter(result => {
                const scrapedDate = new Date(result.scraped_at);
                return scrapedDate >= startDate && scrapedDate <= endDate;
            });
            return resultsByDateRange.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results by date range:', error);
            throw new Error(`Failed to get results by date range: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results by business category
     * @param category The business category to filter by
     * @returns Array of results for the specified category
     */
    async getResultsByCategory(category: string): Promise<YellowPagesResult[]> {
        try {
            // Get all results and filter those with the specified category
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000); // Get a large number to cover all results
            const resultsByCategory = allResults.filter(result => {
                if (!result.categories) return false;
                try {
                    const categories = JSON.parse(result.categories);
                    return Array.isArray(categories) && categories.some(cat => 
                        cat.toLowerCase().includes(category.toLowerCase())
                    );
                } catch (e) {
                    return result.categories.toLowerCase().includes(category.toLowerCase());
                }
            });
            return resultsByCategory.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results by category:', error);
            throw new Error(`Failed to get results for category "${category}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results by location
     * @param location The location to filter by
     * @returns Array of results for the specified location
     */
    async getResultsByLocation(location: string): Promise<YellowPagesResult[]> {
        try {
            // Get all results and filter those with the specified location
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000); // Get a large number to cover all results
            const resultsByLocation = allResults.filter(result => {
                const city = result.address_city?.toLowerCase() || '';
                const state = result.address_state?.toLowerCase() || '';
                const zip = result.address_zip?.toLowerCase() || '';
                const country = result.address_country?.toLowerCase() || '';
                const searchLocation = location.toLowerCase();
                
                return city.includes(searchLocation) || 
                       state.includes(searchLocation) || 
                       zip.includes(searchLocation) || 
                       country.includes(searchLocation);
            });
            return resultsByLocation.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results by location:', error);
            throw new Error(`Failed to get results for location "${location}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results with email addresses
     * @returns Array of results that have email addresses
     */
    async getResultsWithEmails(): Promise<YellowPagesResult[]> {
        try {
            // Get all results and filter those with emails
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000); // Get a large number to cover all results
            const resultsWithEmails = allResults.filter(result => result.email && result.email.trim() !== '');
            return resultsWithEmails.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results with emails:', error);
            throw new Error(`Failed to get results with emails: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results with phone numbers
     * @returns Array of results that have phone numbers
     */
    async getResultsWithPhones(): Promise<YellowPagesResult[]> {
        try {
            // Get all results and filter those with phone numbers
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000); // Get a large number to cover all results
            const resultsWithPhones = allResults.filter(result => result.phone && result.phone.trim() !== '');
            return resultsWithPhones.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results with phones:', error);
            throw new Error(`Failed to get results with phones: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results with websites
     * @returns Array of results that have websites
     */
    async getResultsWithWebsites(): Promise<YellowPagesResult[]> {
        try {
            // Get all results and filter those with websites
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000); // Get a large number to cover all results
            const resultsWithWebsites = allResults.filter(result => result.website && result.website.trim() !== '');
            return resultsWithWebsites.map(entity => this.convertEntityToResult(entity));
        } catch (error) {
            console.error('Error getting results with websites:', error);
            throw new Error(`Failed to get results with websites: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get results statistics
     * @returns Object with result statistics
     */
    async getResultsStatistics(): Promise<{
        total: number;
        withEmails: number;
        withPhones: number;
        withWebsites: number;
        byPlatform: Record<string, number>;
        byCategory: Record<string, number>;
    }> {
        const total = await this.countResults();
        const withEmails = (await this.getResultsWithEmails()).length;
        const withPhones = (await this.getResultsWithPhones()).length;
        const withWebsites = (await this.getResultsWithWebsites()).length;

        // Calculate platform and category statistics
        const byPlatform: Record<string, number> = {};
        const byCategory: Record<string, number> = {};
        
        try {
            // Get all results for statistics
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000);
            
            // Calculate platform statistics
            allResults.forEach(result => {
                const platform = result.platform || 'Unknown';
                byPlatform[platform] = (byPlatform[platform] || 0) + 1;
            });
            
            // Calculate category statistics
            allResults.forEach(result => {
                if (result.categories) {
                    try {
                        const categories = JSON.parse(result.categories);
                        if (Array.isArray(categories)) {
                            categories.forEach(category => {
                                const cat = category.trim();
                                if (cat) {
                                    byCategory[cat] = (byCategory[cat] || 0) + 1;
                                }
                            });
                        }
                    } catch (e) {
                        // If categories can't be parsed, skip
                    }
                }
            });
        } catch (error) {
            console.warn('Error calculating detailed statistics:', error);
            // Continue with empty statistics if there's an error
        }

        return {
            total,
            withEmails,
            withPhones,
            withWebsites,
            byPlatform,
            byCategory
        };
    }

    /**
     * Delete results by task ID
     * @param taskId The task ID
     * @returns Number of results deleted
     */
    async deleteResultsByTaskId(taskId: number): Promise<number> {
        try {
            // First get the count of results to be deleted
            const count = await this.yellowPagesResultModel.getResultCountByTaskId(taskId);
            
            // Delete the results
            const success = await this.yellowPagesResultModel.deleteResultsByTaskId(taskId);
            
            if (success) {
                return count;
            } else {
                throw new Error('Failed to delete results');
            }
        } catch (error) {
            console.error('Error deleting results by task ID:', error);
            throw new Error(`Failed to delete results for task ${taskId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Clean up old results
     * @param daysOld Number of days old to consider for cleanup
     * @returns Number of results cleaned up
     */
    async cleanupOldResults(daysOld: number = 90): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            
            // Get all results and filter those older than the cutoff date
            const allResults = await this.yellowPagesResultModel.listResults(0, 10000); // Get a large number to cover all results
            const oldResults = allResults.filter(result => result.scraped_at < cutoffDate);
            
            // Delete old results
            let deletedCount = 0;
            for (const result of oldResults) {
                const success = await this.yellowPagesResultModel.deleteResult(result.id);
                if (success) {
                    deletedCount++;
                }
            }
            
            return deletedCount;
        } catch (error) {
            console.error('Error cleaning up old results:', error);
            throw new Error(`Failed to cleanup old results: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Export results to different formats
     * @param taskId Optional task ID to filter results
     * @param format Export format ('json' or 'csv')
     * @returns Exported data
     */
    async exportResults(taskId?: number, format: 'json' | 'csv' = 'json'): Promise<any> {
        let results: YellowPagesResult[];
        
        if (taskId) {
            results = await this.getResultsByTaskId(taskId);
        } else {
            const resultEntities = await this.listResults(0, 10000); // Get all results
            results = resultEntities.map(entity => this.convertEntityToResult(entity));
        }

        if (format === 'csv') {
            return this.convertToCSV(results);
        } else {
            return {
                total: results.length,
                results,
                exportDate: new Date().toISOString()
            };
        }
    }

    /**
     * Convert result data to entity format
     * @param result The result data
     * @returns The result entity
     */
    private convertResultToEntity(result: YellowPagesResult): YellowPagesResultEntity {
        const entity = new YellowPagesResultEntity();
        
        // Set basic properties
        entity.task_id = result.task_id;
        entity.business_name = result.business_name;
        entity.email = result.email || undefined;
        entity.phone = result.phone || undefined;
        entity.website = result.website || undefined;
        
        // Handle address fields
        if (result.address) {
            entity.address_street = result.address.street || undefined;
            entity.address_city = result.address.city || undefined;
            entity.address_state = result.address.state || undefined;
            entity.address_zip = result.address.zip || undefined;
            entity.address_country = result.address.country || undefined;
        }
        
        entity.social_media = result.social_media ? JSON.stringify(result.social_media) : undefined;
        entity.categories = result.categories ? JSON.stringify(result.categories) : undefined;
        entity.business_hours = result.business_hours ? JSON.stringify(result.business_hours) : undefined;
        entity.description = result.description || undefined;
        entity.rating = result.rating || undefined;
        entity.review_count = result.review_count || undefined;
        entity.scraped_at = result.scraped_at || new Date();
        entity.platform = result.platform;
        entity.raw_data = result.raw_data ? JSON.stringify(result.raw_data) : undefined;
        
        return entity;
    }

    /**
     * Convert entity to result format
     * @param entity The result entity
     * @returns The result object
     */
    private convertEntityToResult(entity: YellowPagesResultEntity): YellowPagesResult {
        return {
            id: entity.id,
            task_id: entity.task_id,
            business_name: entity.business_name,
            email: entity.email,
            phone: entity.phone,
            website: entity.website,
            address: {
                street: entity.address_street,
                city: entity.address_city,
                state: entity.address_state,
                zip: entity.address_zip,
                country: entity.address_country
            },
            social_media: entity.social_media ? JSON.parse(entity.social_media) : [],
            categories: entity.categories ? JSON.parse(entity.categories) : [],
            business_hours: entity.business_hours ? JSON.parse(entity.business_hours) : null,
            description: entity.description,
            rating: entity.rating,
            review_count: entity.review_count,
            scraped_at: entity.scraped_at,
            platform: entity.platform,
            raw_data: entity.raw_data ? JSON.parse(entity.raw_data) : {}
        };
    }

    /**
     * Convert results to CSV format
     * @param results Array of result objects
     * @returns CSV string
     */
    private convertToCSV(results: YellowPagesResult[]): string {
        if (results.length === 0) {
            return '';
        }

        // Define CSV headers
        const headers = [
            'Business Name',
            'Email',
            'Phone',
            'Website',
            'Address Street',
            'Address City',
            'Address State',
            'Address Zip',
            'Address Country',
            'Social Media',
            'Categories',
            'Business Hours',
            'Description',
            'Rating',
            'Review Count',
            'Platform',
            'Scraped At'
        ];

        // Convert data to CSV rows
        const csvRows = results.map(result => [
            result.business_name || '',
            result.email || '',
            result.phone || '',
            result.website || '',
            result.address?.street || '',
            result.address?.city || '',
            result.address?.state || '',
            result.address?.zip || '',
            result.address?.country || '',
            Array.isArray(result.social_media) ? result.social_media.join('; ') : '',
            Array.isArray(result.categories) ? result.categories.join('; ') : '',
            result.business_hours ? JSON.stringify(result.business_hours) : '',
            result.description || '',
            result.rating || '',
            result.review_count || '',
            result.platform || '',
            result.scraped_at ? new Date(result.scraped_at).toISOString() : ''
        ]);

        // Combine headers and rows
        const csvContent = [headers, ...csvRows]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');

        return csvContent;
    }
}
