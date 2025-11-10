import { windowInvoke, windowSend, windowReceive } from '@/views/utils/apirequest';
import { ChatMessage, ChatHistoryResponse, ChatStreamChunk, CommonMessage } from '@/entityTypes/commonType';
import {
  AI_CHAT_MESSAGE,
  AI_CHAT_STREAM,
  AI_CHAT_STREAM_CHUNK,
  AI_CHAT_STREAM_COMPLETE,
  AI_CHAT_HISTORY,
  AI_CHAT_CLEAR,
  AI_CHAT_CONVERSATIONS
} from '@/config/channellist';

/**
 * AI Chat API response types
 */
export interface AIChatResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

/**
 * Send a chat message to the AI (non-streaming)
 * 
 * @param message - User message to send
 * @param conversationId - Optional conversation ID for context
 * @param model - Optional specific model to use
 * @param useRAG - Optional flag to enable RAG context from knowledge base
 * @param ragLimit - Optional number of RAG chunks to include (default: 3)
 * @returns Promise resolving to AI response
 * 
 * @example
 * ```typescript
 * const response = await sendChatMessage('Hello, how are you?', undefined, undefined, true);
 * if (response.success && response.data) {
 *   console.log('AI:', response.data.content);
 * }
 * ```
 */
export async function sendChatMessage(
  message: string,
  conversationId?: string,
  model?: string,
  useRAG?: boolean,
  ragLimit?: number
): Promise<AIChatResponse<ChatMessage>> {
  try {
    const requestData = {
      message,
      conversationId,
      model,
      useRAG,
      ragLimit
    };

    const response: CommonMessage<ChatMessage> = await windowInvoke(
      AI_CHAT_MESSAGE,
      requestData
    );

    return {
      success: response.status,
      data: response.data || undefined,
      message: response.msg
    };
  } catch (error) {
    console.error('Error sending chat message:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Stream a chat message to the AI with real-time updates
 * 
 * @param message - User message to send
 * @param onChunk - Callback for each chunk received
 * @param onComplete - Callback when streaming is complete
 * @param conversationId - Optional conversation ID for context
 * @param model - Optional specific model to use
 * @param useRAG - Optional flag to enable RAG context from knowledge base
 * @param ragLimit - Optional number of RAG chunks to include (default: 3)
 * @returns Promise that resolves when stream starts
 * 
 * @example
 * ```typescript
 * await streamChatMessage(
 *   'Explain quantum computing',
 *   (chunk) => console.log('Chunk:', chunk.content),
 *   () => console.log('Stream complete'),
 *   undefined,
 *   undefined,
 *   true
 * );
 * ```
 */
export async function streamChatMessage(
  message: string,
  onChunk?: (chunk: ChatStreamChunk) => void,
  onComplete?: () => void,
  conversationId?: string,
  model?: string,
  useRAG?: boolean,
  ragLimit?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let fullContent = '';

    // Set up chunk listener
    const chunkHandler = (chunkData: string) => {
      try {
        const chunk: ChatStreamChunk = JSON.parse(chunkData);
        if (onChunk) {
          onChunk(chunk);
        }
        if (!chunk.isComplete) {
          fullContent += chunk.content;
        }
      } catch (error) {
        console.error('Error parsing chunk data:', error);
      }
    };

    // Set up completion listener
    const completeHandler = (completeData: string) => {
      try {
        const chunk: ChatStreamChunk = JSON.parse(completeData);
        
        // Check if this is an error completion
        if (chunk.eventType === 'error' && chunk.errorMessage) {
          reject(new Error(chunk.errorMessage));
          return;
        }
        
        if (onComplete) {
          onComplete();
        }
        
        resolve();
      } catch (error) {
        console.error('Error parsing completion data:', error);
        reject(error);
      }
    };

    // Register event listeners
    windowReceive(AI_CHAT_STREAM_CHUNK, chunkHandler);
    windowReceive(AI_CHAT_STREAM_COMPLETE, completeHandler);

    // Send the message to start streaming
    const requestData = {
      message,
      conversationId,
      model,
      useRAG,
      ragLimit
    };
    windowSend(AI_CHAT_STREAM, requestData);
  });
}

/**
 * Get chat history for a conversation
 * 
 * @param conversationId - Optional conversation ID (defaults to 'default')
 * @returns Promise resolving to chat history
 * 
 * @example
 * ```typescript
 * const history = await getChatHistory();
 * console.log('Messages:', history.messages);
 * ```
 */
export async function getChatHistory(
  conversationId?: string
): Promise<AIChatResponse<ChatHistoryResponse>> {
  try {
    const requestData = conversationId ? { conversationId } : {};

    const response: ChatHistoryResponse = await windowInvoke(
      AI_CHAT_HISTORY,
      requestData
    );
    console.log('response', response); 
    return {
      success: true,
      data: response || undefined,
      message: ""
    };
  } catch (error) {
    console.error('Error getting chat history:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Clear chat history
 * 
 * @param conversationId - Optional conversation ID to clear (or 'all' to clear all)
 * @returns Promise resolving to success status
 * 
 * @example
 * ```typescript
 * // Clear default conversation
 * await clearChatHistory();
 * 
 * // Clear specific conversation
 * await clearChatHistory('conv-123');
 * 
 * // Clear all conversations
 * await clearChatHistory('all');
 * ```
 */
export async function clearChatHistory(
  conversationId?: string
): Promise<AIChatResponse<void>> {
  try {
    const requestData = conversationId ? { conversationId } : {};

    const response: CommonMessage<void> = await windowInvoke(
      AI_CHAT_CLEAR,
      requestData
    );
console.log('response', response);
    return {
      success: true,
      message: ""
    };
  } catch (error) {
    console.error('Error clearing chat history:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Conversation metadata interface
 */
export interface ConversationMetadata {
  conversationId: string;
  lastMessage: string;
  lastMessageTimestamp: Date;
  messageCount: number;
  createdAt: Date;
}

/**
 * Get all conversations with metadata
 * 
 * @returns Promise resolving to list of conversations with metadata
 * 
 * @example
 * ```typescript
 * const conversations = await getConversations();
 * console.log('Total conversations:', conversations.length);
 * ```
 */
export async function getConversations(): Promise<AIChatResponse<ConversationMetadata[]>> {
  try {
    const response: ConversationMetadata[] = await windowInvoke(
      AI_CHAT_CONVERSATIONS,
      {}
    );
    console.log('conversationsmeata response', response);
    // Convert date strings to Date objects if needed (IPC serializes Date to string)
    const conversations = response?.map(conv => ({
      ...conv,
      lastMessageTimestamp: new Date(conv.lastMessageTimestamp),
      createdAt: new Date(conv.createdAt)
    })) || undefined;

    return {
      success: true,
      data: conversations,
      message: ""
    };
  } catch (error) {
    console.error('Error getting conversations:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}


