import { z } from 'zod';

/**
 * Zod schemas for Yellow Pages MCP tools
 */

// Yellow Pages search parameters
export const YellowPagesSearchSchema = z.object({
    query: z.string().min(1, 'Query cannot be empty'),
    location: z.string().min(1, 'Location cannot be empty'),
    platform: z.enum(['yelp', 'yellowpages', 'google_business'], {
        errorMap: () => ({ message: 'Platform must be one of: yelp, yellowpages, google_business' })
    }),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    radius: z.number().int().min(1).max(100).optional().default(25), // in miles
    sortBy: z.enum(['relevance', 'distance', 'rating']).optional().default('relevance')
});

// Business details request parameters
export const BusinessDetailsSchema = z.object({
    businessId: z.string().min(1, 'Business ID cannot be empty').optional(),
    businessUrl: z.string().url('Invalid business URL format').optional(),
    platform: z.enum(['yelp', 'yellowpages', 'google_business'], {
        errorMap: () => ({ message: 'Platform must be one of: yelp, yellowpages, google_business' })
    })
}).refine(
    (data) => data.businessId || data.businessUrl,
    {
        message: 'Either businessId or businessUrl must be provided',
        path: ['businessId', 'businessUrl']
    }
);

// Business listing data schema
export const BusinessListingSchema = z.object({
    name: z.string(),
    address: z.string(),
    phone: z.string().optional(),
    website: z.string().url().optional(),
    email: z.string().email().optional(),
    rating: z.number().min(0).max(5).optional(),
    reviewCount: z.number().int().min(0).optional(),
    categories: z.array(z.string()),
    hours: z.record(z.string()).optional(),
    coordinates: z.object({
        latitude: z.number(),
        longitude: z.number()
    }).optional(),
    platform: z.string(),
    listingUrl: z.string().url()
});

// Yellow Pages response data schema
export const YellowPagesDataSchema = z.object({
    businesses: z.array(BusinessListingSchema),
    totalFound: z.number().int().min(0),
    platform: z.string(),
    location: z.string(),
    searchQuery: z.string(),
    processingTime: z.number().min(0)
});

// MCP Yellow Pages response schema
export const MCPYellowPagesResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: YellowPagesDataSchema.optional().nullable(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional()
    }).optional()
});

// MCP Business Details response schema
export const MCPBusinessDetailsResponseSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    data: BusinessListingSchema.optional().nullable(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional()
    }).optional()
});

// Type exports
export type YellowPagesSearchParams = z.infer<typeof YellowPagesSearchSchema>;
export type BusinessDetailsParams = z.infer<typeof BusinessDetailsSchema>;
export type BusinessListing = z.infer<typeof BusinessListingSchema>;
export type YellowPagesData = z.infer<typeof YellowPagesDataSchema>;
export type MCPYellowPagesResponse = z.infer<typeof MCPYellowPagesResponseSchema>;
export type MCPBusinessDetailsResponse = z.infer<typeof MCPBusinessDetailsResponseSchema>;


