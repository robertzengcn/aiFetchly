import { 
    MCPYellowPagesResponse, 
    MCPBusinessDetailsResponse,
    YellowPagesData,
    BusinessListing 
} from '../schemas/yellowPagesSchemas';
import { MCPResponse, MCPYellowPagesData, MCPBusinessListing } from '../types/mcpTypes';

/**
 * Response formatter for Yellow Pages MCP tools
 * Transforms raw data from YellowPagesController into standardized MCP response format
 */
export class YellowPagesResponseFormatter {
    /**
     * Format Yellow Pages search response
     */
    static formatYellowPagesResponse(
        rawData: MCPResponse<MCPYellowPagesData>,
        query: string,
        location: string,
        platform: string,
        processingTime: number = 0
    ): MCPYellowPagesResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    success: false,
                    message: rawData?.message || 'Yellow Pages search failed',
                    data: null,
                    error: {
                        code: 'SEARCH_FAILED',
                        message: rawData?.message || 'Yellow Pages search failed'
                    }
                };
            }

            const yellowPagesData: YellowPagesData = {
                businesses: this.formatBusinessListings(rawData.data?.businesses || []),
                totalFound: rawData.data?.totalFound || 0,
                platform: platform,
                location: location,
                searchQuery: query,
                processingTime: processingTime
            };

            return {
                success: true,
                message: 'Yellow Pages search completed successfully',
                data: yellowPagesData
            };
        } catch (error) {
            console.error('Error formatting Yellow Pages response:', error);
            return {
                success: false,
                message: 'Failed to format Yellow Pages response',
                data: null,
                error: {
                    code: 'FORMAT_ERROR',
                    message: 'Failed to format Yellow Pages response',
                    details: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Format business details response
     */
    static formatBusinessDetailsResponse(
        rawData: MCPResponse<MCPBusinessListing>,
        businessId?: string,
        businessUrl?: string
    ): MCPBusinessDetailsResponse {
        try {
            if (!rawData || !rawData.success) {
                return {
                    success: false,
                    message: rawData?.message || 'Business details retrieval failed',
                    data: null,
                    error: {
                        code: 'DETAILS_FAILED',
                        message: rawData?.message || 'Business details retrieval failed'
                    }
                };
            }

            const businessListing: BusinessListing = this.formatBusinessListing(rawData.data!);

            return {
                success: true,
                message: 'Business details retrieved successfully',
                data: businessListing
            };
        } catch (error) {
            console.error('Error formatting business details response:', error);
            return {
                success: false,
                message: 'Failed to format business details response',
                data: null,
                error: {
                    code: 'FORMAT_ERROR',
                    message: 'Failed to format business details response',
                    details: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    /**
     * Format business listings array
     */
    private static formatBusinessListings(rawListings: MCPBusinessListing[]): BusinessListing[] {
        return rawListings.map(listing => this.formatBusinessListing(listing));
    }

    /**
     * Format individual business listing
     */
    private static formatBusinessListing(rawListing: MCPBusinessListing): BusinessListing {
        return {
            name: rawListing.name || 'Unknown Business',
            address: rawListing.address || 'Address not available',
            phone: rawListing.phone,
            website: rawListing.website,
            email: rawListing.email,
            rating: rawListing.rating,
            reviewCount: rawListing.reviewCount,
            categories: rawListing.categories || [],
            hours: rawListing.hours as Record<string, string> | undefined,
            coordinates: rawListing.coordinates,
            platform: rawListing.platform,
            listingUrl: rawListing.listingUrl
        };
    }

    /**
     * Create error response for Yellow Pages operations
     */
    static createYellowPagesErrorResponse(message: string, code: string = 'YELLOW_PAGES_ERROR'): MCPYellowPagesResponse {
        return {
            success: false,
            message,
            data: null,
            error: {
                code,
                message
            }
        };
    }

    /**
     * Create error response for business details operations
     */
    static createBusinessDetailsErrorResponse(message: string, code: string = 'BUSINESS_DETAILS_ERROR'): MCPBusinessDetailsResponse {
        return {
            success: false,
            message,
            data: null,
            error: {
                code,
                message
            }
        };
    }

    /**
     * Validate and sanitize business data
     */
    private static sanitizeBusinessData(listing: MCPBusinessListing): MCPBusinessListing {
        return {
            ...listing,
            name: this.sanitizeString(listing.name),
            address: this.sanitizeString(listing.address),
            phone: listing.phone ? this.sanitizeString(listing.phone) : undefined,
            website: listing.website ? this.sanitizeUrl(listing.website) : undefined,
            email: listing.email ? this.sanitizeEmail(listing.email) : undefined,
            categories: listing.categories?.map(cat => this.sanitizeString(cat)) || []
        };
    }

    /**
     * Sanitize string data
     */
    private static sanitizeString(str: string): string {
        return str.trim().replace(/\s+/g, ' ');
    }

    /**
     * Sanitize URL
     */
    private static sanitizeUrl(url: string): string | undefined {
        try {
            const urlObj = new URL(url);
            return urlObj.toString();
        } catch {
            return undefined;
        }
    }

    /**
     * Sanitize email
     */
    private static sanitizeEmail(email: string): string | undefined {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email) ? email.toLowerCase() : undefined;
    }
}

