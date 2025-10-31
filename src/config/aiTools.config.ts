import { ToolFunction } from '@/api/aiChatApi';

// Centralized list of available tool functions advertised to the AI server
export const AVAILABLE_TOOL_FUNCTIONS: ToolFunction[] = [
    {
        name: 'search_knowledge_base',
        description: 'Searches local RAG knowledge base and returns top relevant chunks.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query text' },
                limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 }
            },
            required: ['query']
        }
    },
    {
        name: 'get_conversation_history',
        description: 'Fetches recent messages for a conversation by ID.',
        parameters: {
            type: 'object',
            properties: {
                conversationId: { type: 'string', description: 'Conversation identifier' },
                limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
            },
            required: ['conversationId']
        }
    }
];



