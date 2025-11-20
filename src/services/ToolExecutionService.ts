import { MessageType } from '@/entityTypes/commonType';
import { AIChatModule } from '@/modules/AIChatModule';

/**
 * Clean search result interface
 */
export interface CleanSearchResult {
    title?: string | null;
    link: string;
    snippet?: string | null;
    visible_link?: string | null;
}

/**
 * Tool execution metadata interface
 */
export interface ToolExecutionMetadata {
    toolName: string;
    toolId: string;
    executionTimeMs?: number;
    success: boolean;
    error?: string;
    summary?: string;
    query?: string;
    engine?: string;
    totalResults?: number;
}

/**
 * Service class for handling tool execution operations
 */
export class ToolExecutionService {

    /**
     * Format search results as a readable list for LLM consumption
     * Extracts only Title, URL, and Snippet/Description
     */
    static formatSearchResultsForLLM(results: CleanSearchResult[]): string {
        if (results.length === 0) {
            return 'No search results found.';
        }

        const formattedResults = results.map((result, index) => {
            const title = result.title || 'No title';
            const url = result.link || '';
            const snippet = result.snippet || result.visible_link || 'No description available';

            // Clean up snippet (remove excessive whitespace, HTML entities if any)
            const cleanSnippet = snippet
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 200); // Limit snippet length

            return `${index + 1}. **${title}**\n   URL: ${url}\n   ${cleanSnippet}`;
        }).join('\n\n');

        return `Found ${results.length} search result${results.length === 1 ? '' : 's'}:\n\n${formattedResults}`;
    }

    /**
     * Format search results summary for tool result metadata
     */
    static formatSearchResultsSummary(results: CleanSearchResult[]): string {
        if (results.length === 0) {
            return 'No results found';
        }

        const topResults = results.slice(0, 3).map((r, i) => {
            const title = r.title || 'Untitled';
            return `${i + 1}. ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`;
        }).join('; ');

        return results.length > 3
            ? `${topResults} ... and ${results.length - 3} more`
            : topResults;
    }

    /**
     * Save tool call message to database with enhanced error handling
     */
    static async saveToolCall(
        chatModule: AIChatModule,
        conversationId: string,
        toolId: string,
        toolName: string,
        toolParams: Record<string, unknown>
    ): Promise<void> {
        try {
            const toolCallMessageId = `tool-call-${toolId}`;
            await chatModule.saveMessage({
                messageId: toolCallMessageId,
                conversationId,
                role: 'assistant',
                content: JSON.stringify({
                    toolName,
                    toolParams,
                    toolId
                }),
                timestamp: new Date(),
                messageType: MessageType.TOOL_CALL,
                metadata: {
                    toolName,
                    toolId,
                    toolParams
                }
            });
        } catch (saveError) {
            const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error';
            console.error('Failed to save tool call to database:', saveError);

            // Retry once with a different message ID if duplicate key error
            if (errorMessage.includes('UNIQUE constraint failed') || errorMessage.includes('Duplicate entry')) {
                try {
                    const retryMessageId = `tool-call-${toolId}-${Date.now()}`;
                    await chatModule.saveMessage({
                        messageId: retryMessageId,
                        conversationId,
                        role: 'assistant',
                        content: JSON.stringify({
                            toolName,
                            toolParams,
                            toolId
                        }),
                        timestamp: new Date(),
                        messageType: MessageType.TOOL_CALL,
                        metadata: {
                            toolName,
                            toolId,
                            toolParams,
                            retryId: true
                        }
                    });
                    console.log('Tool call save retry successful');
                    return;
                } catch (retryError) {
                    console.error('Tool call save retry failed:', retryError);
                }
            }

            throw new Error(`Tool call save failed: ${errorMessage}`);
        }
    }

    /**
     * Save tool result message to database with enhanced error handling
     */
    static async saveToolResult(
        chatModule: AIChatModule,
        conversationId: string,
        toolId: string,
        toolName: string,
        toolResult: unknown,
        metadata: ToolExecutionMetadata
    ): Promise<void> {
        try {
            const toolResultMessageId = `tool-result-${toolId}`;
            await chatModule.saveMessage({
                messageId: toolResultMessageId,
                conversationId,
                role: 'assistant',
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                timestamp: new Date(),
                messageType: MessageType.TOOL_RESULT,
                metadata
            });
        } catch (saveError) {
            const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error';
            console.error('Failed to save tool result to database:', saveError);

            // Retry once with a different message ID if duplicate key error
            if (errorMessage.includes('UNIQUE constraint failed') || errorMessage.includes('Duplicate entry')) {
                try {
                    const retryMessageId = `tool-result-${toolId}-${Date.now()}`;
                    await chatModule.saveMessage({
                        messageId: retryMessageId,
                        conversationId,
                        role: 'assistant',
                        content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                        timestamp: new Date(),
                        messageType: MessageType.TOOL_RESULT,
                        metadata: {
                            ...metadata,
                            retryId: true
                        }
                    });
                    console.log('Tool result save retry successful');
                    return;
                } catch (retryError) {
                    console.error('Tool result save retry failed:', retryError);
                }
            }

            throw new Error(`Tool result save failed: ${errorMessage}`);
        }
    }

    /**
     * Format tool result for LLM consumption
     */
    static formatToolResultForLLM(
        toolName: string,
        toolResult: unknown,
        successFlag: boolean
    ): Record<string, unknown> {
        if (toolName.includes('scrape_urls') &&
            typeof toolResult === 'object' &&
            toolResult !== null &&
            'summary' in toolResult) {

            const searchResult = toolResult as {
                query: string;
                engine: string;
                totalResults: number;
                summary: string;
                results: CleanSearchResult[];
            };

            return {
                query: searchResult.query,
                engine: searchResult.engine,
                totalResults: searchResult.totalResults,
                formatted_summary: searchResult.summary,
                results: searchResult.results.map(r => ({
                    title: r.title || 'No title',
                    url: r.link,
                    description: r.snippet || 'No description'
                }))
            };
        } else {
            // For other tools, exclude success flag but keep other data
            const resultRecord = toolResult as Record<string, unknown>;
            const { success: _s, ...resultWithoutSuccess } = resultRecord;
            return resultWithoutSuccess;
        }
    }

    /**
     * Prepare tool execution metadata
     */
    static prepareToolMetadata(
        toolName: string,
        toolId: string,
        success: boolean,
        executionTimeMs: number,
        toolResult?: unknown,
        errorMessage?: string
    ): ToolExecutionMetadata {
        const metadata: ToolExecutionMetadata = {
            toolName,
            toolId,
            executionTimeMs,
            success
        };

        if (success && toolResult && typeof toolResult === 'object') {
            const result = toolResult as Record<string, unknown>;

            // Add summary for search results
            if (toolName.includes('scrape_urls') && 'summary' in result) {
                metadata.summary = result.summary as string;
                if ('query' in result) metadata.query = result.query as string;
                if ('engine' in result) metadata.engine = result.engine as string;
                if ('totalResults' in result) metadata.totalResults = result.totalResults as number;
            }
        }

        if (!success && errorMessage) {
            metadata.error = errorMessage;
        }

        return metadata;
    }

    /**
     * Extract clean results from search module results
     */
    static extractCleanResults(results: Array<{
        title?: string | null;
        link: string;
        snippet?: string | null;
        visible_link?: string | null;
    }>): CleanSearchResult[] {
        return results.map(r => ({
            title: r.title || null,
            link: r.link,
            snippet: r.snippet || r.visible_link || null,
            visible_link: r.visible_link || null
        }));
    }
}