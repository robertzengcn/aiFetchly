import { RagSearchController } from '@/controller/RagSearchController';
import { SqliteDb } from '@/config/SqliteDb';

export interface ProcessedQuery {
    originalQuery: string;
    processedQuery: string;
    intent: QueryIntent;
    entities: string[];
    expandedTerms: string[];
    filters: QueryFilters;
    confidence: number;
}

export interface QueryIntent {
    type: 'search' | 'question' | 'command' | 'conversation';
    category: string;
    confidence: number;
}

export interface QueryFilters {
    documentTypes?: string[];
    dateRange?: { start: Date; end: Date };
    authors?: string[];
    tags?: string[];
    confidenceThreshold?: number;
}

export interface QueryProcessingOptions {
    enableExpansion?: boolean;
    enableIntentDetection?: boolean;
    enableEntityExtraction?: boolean;
    maxExpansionTerms?: number;
    confidenceThreshold?: number;
}

export class QueryProcessor {
    private searchController: RagSearchController;
    // private db: SqliteDb;
    private processingHistory: Map<string, ProcessedQuery> = new Map();
    private analytics: {
        totalQueries: number;
        averageProcessingTime: number;
        intentDistribution: Map<string, number>;
        commonTerms: Map<string, number>;
    } = {
        totalQueries: 0,
        averageProcessingTime: 0,
        intentDistribution: new Map(),
        commonTerms: new Map()
    };

    constructor(searchController: RagSearchController, db: SqliteDb) {
        this.searchController = searchController;
        // this.db = db;
    }

    /**
     * Process a user query
     * @param query - Raw user query
     * @param options - Processing options
     * @returns Processed query object
     */
    async processQuery(
        query: string, 
        options: QueryProcessingOptions = {}
    ): Promise<ProcessedQuery> {
        const startTime = Date.now();

        try {
            // Check cache first
            const cached = this.processingHistory.get(query.toLowerCase());
            if (cached) {
                return cached;
            }

            // Clean and normalize query
            const cleanedQuery = this.cleanQuery(query);
            
            // Detect intent
            const intent = options.enableIntentDetection !== false 
                ? await this.detectIntent(cleanedQuery)
                : { type: 'search' as const, category: 'general', confidence: 1.0 };

            // Extract entities
            const entities = options.enableEntityExtraction !== false
                ? await this.extractEntities(cleanedQuery)
                : [];

            // Expand query terms
            const expandedTerms = options.enableExpansion !== false
                ? await this.expandQueryTerms(cleanedQuery, options.maxExpansionTerms || 5)
                : [];

            // Extract filters
            const filters = this.extractFilters(cleanedQuery);

            // Create processed query
            const processedQuery = this.buildProcessedQuery(
                cleanedQuery,
                expandedTerms,
                intent,
                filters
            );

            const processedQueryObj: ProcessedQuery = {
                originalQuery: query,
                processedQuery,
                intent,
                entities,
                expandedTerms,
                filters,
                confidence: this.calculateConfidence(intent, entities, expandedTerms)
            };

            // Cache the result
            this.processingHistory.set(query.toLowerCase(), processedQueryObj);

            // Update analytics
            this.updateAnalytics(processedQueryObj, Date.now() - startTime);

            return processedQueryObj;
        } catch (error) {
            console.error('Error processing query:', error);
            throw new Error(`Query processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Clean and normalize the query
     * @param query - Raw query
     * @returns Cleaned query
     */
    private cleanQuery(query: string): string {
        return query
            .trim()
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Remove special characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    /**
     * Detect query intent
     * @param query - Cleaned query
     * @returns Query intent
     */
    private async detectIntent(query: string): Promise<QueryIntent> {
        // Simple rule-based intent detection
        // In production, this could use ML models

        const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which'];
        const commandWords = ['find', 'search', 'show', 'get', 'list', 'display'];
        const conversationWords = ['hello', 'hi', 'thanks', 'thank you', 'help'];

        const words = query.split(' ');

        // Check for question intent
        if (questionWords.some(word => words.includes(word)) || query.includes('?')) {
            return {
                type: 'question',
                category: 'information',
                confidence: 0.8
            };
        }

        // Check for command intent
        if (commandWords.some(word => words.includes(word))) {
            return {
                type: 'command',
                category: 'search',
                confidence: 0.7
            };
        }

        // Check for conversation intent
        if (conversationWords.some(word => words.includes(word))) {
            return {
                type: 'conversation',
                category: 'greeting',
                confidence: 0.9
            };
        }

        // Default to search intent
        return {
            type: 'search',
            category: 'general',
            confidence: 0.6
        };
    }

    /**
     * Extract entities from query
     * @param query - Cleaned query
     * @returns Array of entities
     */
    private async extractEntities(query: string): Promise<string[]> {
        // Simple entity extraction
        // In production, this could use NER models

        const entities: string[] = [];
        const words = query.split(' ');

        // Look for potential entities (capitalized words, numbers, etc.)
        for (const word of words) {
            if (word.length > 2 && /^[A-Z]/.test(word)) {
                entities.push(word);
            }
        }

        // Look for common entity patterns
        const patterns = [
            /\b\d{4}\b/g, // Years
            /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // Names
            /\b[A-Z]{2,}\b/g, // Acronyms
        ];

        for (const pattern of patterns) {
            const matches = query.match(pattern);
            if (matches) {
                entities.push(...matches);
            }
        }

        return [...new Set(entities)]; // Remove duplicates
    }

    /**
     * Expand query terms with synonyms and related terms
     * @param query - Cleaned query
     * @param maxTerms - Maximum number of expansion terms
     * @returns Array of expanded terms
     */
    private async expandQueryTerms(query: string, maxTerms: number): Promise<string[]> {
        // Simple synonym expansion
        // In production, this could use word embeddings or thesauri

        const synonyms: Record<string, string[]> = {
            'ai': ['artificial intelligence', 'machine learning', 'ml'],
            'data': ['information', 'content', 'details'],
            'analysis': ['examination', 'study', 'evaluation'],
            'report': ['document', 'summary', 'findings'],
            'method': ['approach', 'technique', 'process'],
            'result': ['outcome', 'conclusion', 'finding'],
            'system': ['platform', 'framework', 'architecture'],
            'user': ['person', 'individual', 'customer'],
            'interface': ['ui', 'user interface', 'dashboard'],
            'database': ['db', 'data store', 'repository']
        };

        const expandedTerms: string[] = [];
        const words = query.split(' ');

        for (const word of words) {
            if (synonyms[word]) {
                expandedTerms.push(...synonyms[word].slice(0, 2)); // Add up to 2 synonyms
            }
        }

        return expandedTerms.slice(0, maxTerms);
    }

    /**
     * Extract filters from query
     * @param query - Cleaned query
     * @returns Query filters
     */
    private extractFilters(query: string): QueryFilters {
        const filters: QueryFilters = {};

        // Extract document type filters
        const docTypePatterns = {
            pdf: /\bpdf\b/i,
            doc: /\b(doc|document|word)\b/i,
            txt: /\b(text|txt|plain)\b/i,
            html: /\b(html|web|page)\b/i,
            json: /\bjson\b/i
        };

        const documentTypes: string[] = [];
        for (const [type, pattern] of Object.entries(docTypePatterns)) {
            if (pattern.test(query)) {
                documentTypes.push(type);
            }
        }

        if (documentTypes.length > 0) {
            filters.documentTypes = documentTypes;
        }

        // Extract date range filters
        const datePattern = /\b(20\d{2}|19\d{2})\b/g;
        const years = query.match(datePattern);
        if (years && years.length >= 1) {
            const year = parseInt(years[0]);
            filters.dateRange = {
                start: new Date(year, 0, 1),
                end: new Date(year, 11, 31)
            };
        }

        // Extract confidence threshold
        const confidencePattern = /\b(high|medium|low)\s+(confidence|quality|relevance)\b/i;
        const confidenceMatch = query.match(confidencePattern);
        if (confidenceMatch) {
            const level = confidenceMatch[1].toLowerCase();
            filters.confidenceThreshold = level === 'high' ? 0.8 : level === 'medium' ? 0.6 : 0.4;
        }

        return filters;
    }

    /**
     * Build the final processed query
     * @param cleanedQuery - Cleaned query
     * @param expandedTerms - Expanded terms
     * @param intent - Query intent
     * @param filters - Query filters
     * @returns Processed query string
     */
    private buildProcessedQuery(
        cleanedQuery: string,
        expandedTerms: string[],
        intent: QueryIntent,
        filters: QueryFilters
    ): string {
        let processedQuery = cleanedQuery;

        // Add expanded terms
        if (expandedTerms.length > 0) {
            processedQuery += ' ' + expandedTerms.join(' ');
        }

        // Add intent-specific terms
        if (intent.type === 'question') {
            processedQuery += ' explanation answer';
        } else if (intent.type === 'command') {
            processedQuery += ' find search locate';
        }

        return processedQuery;
    }

    /**
     * Calculate confidence score
     * @param intent - Query intent
     * @param entities - Extracted entities
     * @param expandedTerms - Expanded terms
     * @returns Confidence score
     */
    private calculateConfidence(
        intent: QueryIntent,
        entities: string[],
        expandedTerms: string[]
    ): number {
        let confidence = intent.confidence;

        // Boost confidence if entities were found
        if (entities.length > 0) {
            confidence += 0.1;
        }

        // Boost confidence if terms were expanded
        if (expandedTerms.length > 0) {
            confidence += 0.05;
        }

        return Math.min(confidence, 1.0);
    }

    /**
     * Update analytics
     * @param processedQuery - Processed query
     * @param processingTime - Processing time in ms
     */
    private updateAnalytics(processedQuery: ProcessedQuery, processingTime: number): void {
        this.analytics.totalQueries++;
        
        // Update average processing time
        this.analytics.averageProcessingTime = 
            (this.analytics.averageProcessingTime * (this.analytics.totalQueries - 1) + processingTime) 
            / this.analytics.totalQueries;

        // Update intent distribution
        const intentKey = `${processedQuery.intent.type}:${processedQuery.intent.category}`;
        this.analytics.intentDistribution.set(
            intentKey,
            (this.analytics.intentDistribution.get(intentKey) || 0) + 1
        );

        // Update common terms
        const terms = processedQuery.processedQuery.split(' ');
        for (const term of terms) {
            if (term.length > 3) { // Only count meaningful terms
                this.analytics.commonTerms.set(
                    term,
                    (this.analytics.commonTerms.get(term) || 0) + 1
                );
            }
        }
    }

    /**
     * Get processing analytics
     * @returns Analytics data
     */
    getAnalytics(): typeof this.analytics {
        return { ...this.analytics };
    }

    /**
     * Clear processing cache
     */
    clearCache(): void {
        this.processingHistory.clear();
    }

    /**
     * Get query suggestions based on history
     * @param partialQuery - Partial query
     * @param limit - Number of suggestions
     * @returns Array of suggestions
     */
    getQuerySuggestions(partialQuery: string, limit: number = 5): string[] {
        const suggestions: string[] = [];
        const partial = partialQuery.toLowerCase();

        for (const [query, processed] of this.processingHistory.entries()) {
            if (query.startsWith(partial) && query !== partial) {
                suggestions.push(processed.originalQuery);
            }
        }

        return suggestions.slice(0, limit);
    }

    /**
     * Get common terms
     * @param limit - Number of terms to return
     * @returns Array of common terms with counts
     */
    getCommonTerms(limit: number = 10): { term: string; count: number }[] {
        return Array.from(this.analytics.commonTerms.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([term, count]) => ({ term, count }));
    }
}
