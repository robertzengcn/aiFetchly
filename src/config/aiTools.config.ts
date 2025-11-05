import { ToolFunction } from '@/api/aiChatApi';

// Centralized list of available tool functions advertised to the AI server
export const AVAILABLE_TOOL_FUNCTIONS: ToolFunction[] = [
    {
        type: "function",
        name: 'search_google',
        description: 'Search Google for information using a query string. Returns search results including titles, snippets, and URLs.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to send to Google'
                },
                num_results: {
                    type: 'number',
                    description: 'Number of search results to return (default: 10)',
                    default: 10
                }
            },
            required: ['query']
        }
    },
    {
        type: "function",
        name: 'search_bing',
        description: 'Search Bing for information using a query string. Returns search results including titles, descriptions, and URLs.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to send to Bing'
                },
                num_results: {
                    type: 'number',
                    description: 'Number of search results to return (default: 10)',
                    default: 10
                },
                market: {
                    type: 'string',
                    description: 'Market/region code (e.g., en-US, en-GB)',
                    default: 'en-US'
                }
            },
            required: ['query']
        }
    },
    {
        type: "function",
        name: 'extract_emails_from_results',
        description: 'Extract email addresses from search results or web pages. Can parse HTML content or plain text to find email addresses.',
        parameters: {
            type: 'object',
            properties: {
                urls: {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                    description: 'List of URLs to extract emails from'
                },
                content: {
                    type: 'string',
                    description: 'Raw HTML or text content to extract emails from (alternative to URLs)'
                },
                validate: {
                    type: 'boolean',
                    description: 'Whether to validate extracted email addresses (default: true)',
                    default: true
                }
            },
            required: []
        }
    },
    {
        type: "function",
        name: 'search_yellow_pages',
        description: 'Search Yellow Pages business directory for companies, contact information, and business details by category, name, or location.',
        parameters: {
            type: 'object',
            properties: {
                search_term: {
                    type: 'string',
                    description: 'Business name, category, or keyword to search for'
                },
                location: {
                    type: 'string',
                    description: 'City, state, or ZIP code to search in'
                },
                num_results: {
                    type: 'number',
                    description: 'Number of business results to return (default: 20)',
                    default: 20
                },
                include_emails: {
                    type: 'boolean',
                    description: 'Whether to attempt extracting email addresses from business pages (default: false)',
                    default: false
                }
            },
            required: ['search_term', 'location']
        }
    }
];



