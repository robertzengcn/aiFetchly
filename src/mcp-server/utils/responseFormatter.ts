import { MCPGoogleSearchResponse, MCPBingSearchResponse, SearchData } from '../schemas/searchSchemas';

/**
 * Response formatter for MCP search tools
 * Transforms raw data from aiFetchlyController into standardized MCP response format
 */

export class SearchResponseFormatter {
    /**
     * Format Google search response
     */
    static formatGoogleResponse(
        rawData: any,
        query: string,
        processingTime: number = 0
    ): MCPGoogleSearchResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    status: false,
                    msg: rawData?.message || 'Search failed',
                    data: null
                };
            }

            const searchData: SearchData = {
                query: query,
                total_results: rawData.data?.total_results || 0,
                results: this.formatSearchResults(rawData.data?.results || []),
                related_searches: rawData.data?.related_searches || [],
                search_metadata: {
                    timestamp: new Date().toISOString(),
                    processing_time: processingTime,
                    page: 1 // Default to page 1 for direct search
                }
            };

            return {
                status: true,
                msg: 'Search completed successfully',
                data: searchData
            };
        } catch (error) {
            console.error('Error formatting Google search response:', error);
            return {
                status: false,
                msg: 'Failed to format search response',
                data: null
            };
        }
    }

    /**
     * Format Bing search response
     */
    static formatBingResponse(
        rawData: any,
        query: string,
        processingTime: number = 0
    ): MCPBingSearchResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    status: false,
                    msg: rawData?.message || 'Search failed',
                    data: null
                };
            }

            const searchData: SearchData = {
                query: query,
                total_results: rawData.data?.total_results || 0,
                results: this.formatSearchResults(rawData.data?.results || []),
                related_searches: rawData.data?.related_searches || [],
                search_metadata: {
                    timestamp: new Date().toISOString(),
                    processing_time: processingTime,
                    page: 1 // Default to page 1 for direct search
                }
            };

            return {
                status: true,
                msg: 'Search completed successfully',
                data: searchData
            };
        } catch (error) {
            console.error('Error formatting Bing search response:', error);
            return {
                status: false,
                msg: 'Failed to format search response',
                data: null
            };
        }
    }

    /**
     * Format search results array
     */
    private static formatSearchResults(rawResults: any[]): any[] {
        return rawResults.map((result, index) => ({
            title: result.title || result.headline || 'No title',
            url: result.url || result.link || '',
            description: result.description || result.snippet || 'No description',
            position: result.position || index + 1,
            domain: this.extractDomain(result.url || result.link || ''),
            type: result.type || (result.is_ad ? 'ad' : 'organic')
        }));
    }

    /**
     * Extract domain from URL
     */
    private static extractDomain(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return 'unknown';
        }
    }

    /**
     * Create error response
     */
    static createErrorResponse(message: string): MCPGoogleSearchResponse {
        return {
            status: false,
            msg: message,
            data: null
        };
    }
}
