import { sendChatMessage, streamChatMessage } from '@/views/api/aiChat';
import { searchDocuments, SearchRequest } from '@/views/api/rag';
import { ChatMessage, ChatStreamChunk } from '@/entityTypes/commonType';

/**
 * @deprecated Use sendChatMessage() with useRAG=true parameter instead
 * 
 * Send a chat message with RAG context from knowledge base
 * 
 * This function is now deprecated. Use the unified sendChatMessage() function
 * with the useRAG parameter set to true instead.
 * 
 * @param message - User message
 * @param conversationId - Optional conversation ID
 * @param searchLimit - Number of relevant chunks to include (default: 3)
 * @returns Chat response with RAG context
 * 
 * @example
 * ```typescript
 * // Old way (deprecated):
 * const response = await sendChatMessageWithRAG('What is TypeScript?', 'default', 3);
 * 
 * // New way:
 * const response = await sendChatMessage('What is TypeScript?', 'default', undefined, true, 3);
 * ```
 */
export async function sendChatMessageWithRAG(
    message: string,
    conversationId?: string,
    searchLimit: number = 3
): Promise<{ success: boolean; data?: ChatMessage; message?: string }> {
    try {
        // Search knowledge base for relevant context
        const searchRequest: SearchRequest = {
            query: message,
            limit: searchLimit
        };

        const searchResponse = await searchDocuments(searchRequest);

        let contextualMessage = message;

        // If we found relevant documents, add them as context
        if (searchResponse.success && searchResponse.data && searchResponse.data.results.length > 0) {
            const context = searchResponse.data.results
                .map((result, index) => {
                    return `[Source ${index + 1}: ${result.metadata.title}]\n${result.content}`;
                })
                .join('\n\n---\n\n');

            contextualMessage = `Context from knowledge base:\n\n${context}\n\n---\n\nUser question: ${message}`;
        }

        // Send message with context to AI
        return await sendChatMessage(contextualMessage, conversationId);
    } catch (error) {
        console.error('Error sending message with RAG context:', error);
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}

/**
 * @deprecated Use streamChatMessage() with useRAG=true parameter instead
 * 
 * Stream a chat message with RAG context from knowledge base
 * 
 * This function is now deprecated. Use the unified streamChatMessage() function
 * with the useRAG parameter set to true instead.
 * 
 * @param message - User message
 * @param onChunk - Callback for each chunk
 * @param onComplete - Callback when complete
 * @param conversationId - Optional conversation ID
 * @param searchLimit - Number of relevant chunks to include (default: 3)
 * 
 * @example
 * ```typescript
 * // Old way (deprecated):
 * await streamChatMessageWithRAG('Explain quantum computing', onChunk, onComplete, 'default', 3);
 * 
 * // New way:
 * await streamChatMessage('Explain quantum computing', onChunk, onComplete, 'default', undefined, true, 3);
 * ```
 */
export async function streamChatMessageWithRAG(
    message: string,
    onChunk?: (chunk: ChatStreamChunk) => void,
    onComplete?: () => void,
    conversationId?: string,
    searchLimit: number = 3
): Promise<void> {
    try {
        // Search knowledge base for relevant context
        const searchRequest: SearchRequest = {
            query: message,
            limit: searchLimit
        };

        const searchResponse = await searchDocuments(searchRequest);

        let contextualMessage = message;

        // If we found relevant documents, add them as context
        if (searchResponse.success && searchResponse.data && searchResponse.data.results.length > 0) {
            const context = searchResponse.data.results
                .map((result, index) => {
                    return `[Source ${index + 1}: ${result.metadata.title}]\n${result.content}`;
                })
                .join('\n\n---\n\n');

            contextualMessage = `Context from knowledge base:\n\n${context}\n\n---\n\nUser question: ${message}`;
        }

        // Stream message with context to AI
        return await streamChatMessage(contextualMessage, onChunk, onComplete, conversationId);
    } catch (error) {
        console.error('Error streaming message with RAG context:', error);
        throw error;
    }
}

/**
 * Send a chat message with specific document context
 * 
 * @param message - User message
 * @param documentIds - Array of document IDs to include as context
 * @param conversationId - Optional conversation ID
 * @returns Chat response with document context
 */
export async function sendChatMessageWithDocuments(
    message: string,
    documentIds: number[],
    conversationId?: string
): Promise<{ success: boolean; data?: ChatMessage; message?: string }> {
    // This would require implementing a new API endpoint to fetch specific documents
    // For now, returning a stub
    console.warn('sendChatMessageWithDocuments not yet implemented - requires document fetch API');
    return await sendChatMessage(message, conversationId);
}


