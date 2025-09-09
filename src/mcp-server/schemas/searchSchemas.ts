import { z } from 'zod';

/**
 * Zod schemas for search engine tools
 */

// Common search parameters
export const SearchQuerySchema = z.object({
    query: z.string().min(1, 'Query cannot be empty'),
    pages: z.number().int().min(1).max(10).optional().default(1),
    language: z.string().optional().default('en'),
    result_type: z.enum(['organic', 'ads', 'all']).optional().default('all')
});

// Google search parameters
export const GoogleSearchSchema = SearchQuerySchema;

// Bing search parameters  
export const BingSearchSchema = SearchQuerySchema;

// Response schemas
export const SearchResultSchema = z.object({
    title: z.string(),
    url: z.string().url(),
    description: z.string(),
    position: z.number().int().positive(),
    domain: z.string(),
    type: z.enum(['organic', 'ad'])
});

export const SearchMetadataSchema = z.object({
    timestamp: z.string(),
    processing_time: z.number(),
    page: z.number().int().positive()
});

export const SearchDataSchema = z.object({
    query: z.string(),
    total_results: z.number().int().nonnegative(),
    results: z.array(SearchResultSchema),
    related_searches: z.array(z.string()),
    search_metadata: SearchMetadataSchema
});

export const MCPGoogleSearchResponseSchema = z.object({
    status: z.boolean(),
    msg: z.string(),
    data: SearchDataSchema.optional().nullable()
});

export const MCPBingSearchResponseSchema = z.object({
    status: z.boolean(),
    msg: z.string(),
    data: SearchDataSchema.optional().nullable()
});

// Type exports
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type GoogleSearchParams = z.infer<typeof GoogleSearchSchema>;
export type BingSearchParams = z.infer<typeof BingSearchSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchMetadata = z.infer<typeof SearchMetadataSchema>;
export type SearchData = z.infer<typeof SearchDataSchema>;
export type MCPGoogleSearchResponse = z.infer<typeof MCPGoogleSearchResponseSchema>;
export type MCPBingSearchResponse = z.infer<typeof MCPBingSearchResponseSchema>;
