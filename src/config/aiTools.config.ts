import { ToolFunction } from '@/api/aiChatApi';
import { MCPToolService } from '@/service/MCPToolService';

// Static tool functions
const STATIC_TOOL_FUNCTIONS: ToolFunction[] = [
    {
        type: "function",
        name: 'scrape_urls_from_google',
        description: 'scrape website, urls in google using a query string. Returns search results including titles, snippets, and URLs.this tool is not use for search information',
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
        name: 'scrape_urls_from_bing',
        description: 'scrape website, urls in bing using a query string. Returns search results including titles, descriptions, and URLs.this tool is not use for search information',
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
        name: 'scrape_urls_from_yandex',
        description: 'scrape website, urls in Yandex using a query string. Returns search results including titles, snippets, and URLs.this tool is not use for search information',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to send to Yandex'
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
        name: 'scrape_urls_from_baidu',
        description: 'scrape website, urls in Baidu using a query string. Returns search results including titles, snippets, and URLs.this tool is not use for search information',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to send to Baidu'
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
        name: 'extract_emails_from_urls',
        description: 'Extract email addresses from url or web pages. Can parse HTML content or plain text to find email addresses.',
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
        description: 'Search Yellow Pages business directory for companies, contact information, and business details by category, name, or location. Use get_available_yellow_pages_platforms first to see available platforms.',
        parameters: {
            type: 'object',
            properties: {
                platform: {
                    type: 'string',
                    description: 'Platform name (e.g., "yellowpages.com"). Use get_available_yellow_pages_platforms to see available options.'
                },
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
            required: ['platform', 'search_term', 'location']
        }
    },
    {
        type: "function",
        name: 'get_available_yellow_pages_platforms',
        description: 'A function that returns the live, up-to-date, authenticated list of Yellow Pages platforms integrated with the system\'s current APIs, including their latest API version and supported country codes.',
        parameters: {
            type: 'object',
            properties: {
                country_code: {
                    type: 'string',
                    description: 'Optional ISO 3166-1 alpha-2 country code to filter available platforms (e.g., "US", "DE", "FR").'
                }
            }
        }
    },
    {
        type: "function",
        name: 'analyze_website_batch',
        description: 'Analyze multiple websites from search results using AI to determine industry, match score, and reasoning. This tool scrapes website content and uses AI to analyze how well each website matches a given client business description. Results are saved to the database.',
        parameters: {
            type: 'object',
            properties: {
                result_ids: {
                    type: 'array',
                    items: {
                        type: 'number'
                    },
                    description: 'Array of search result IDs to analyze. Each ID should correspond to a search result that has a URL.'
                },
                client_business: {
                    type: 'string',
                    description: 'Description of the client business to match against. This is used by the AI to determine how well each website matches the business.'
                },
                temperature: {
                    type: 'number',
                    description: 'Temperature for AI analysis (0.0-1.0). Higher values make the analysis more creative. Default is 0.7.',
                    default: 0.7,
                    minimum: 0.0,
                    maximum: 1.0
                }
            },
            required: ['result_ids', 'client_business']
        }
    },
    {
        type: "function",
        name: 'analyze_websites',
        description: 'Analyze multiple websites directly from URLs using AI to determine industry, match score, and reasoning. This tool scrapes website content and uses AI to analyze how well each website matches a given client business description. Results are NOT saved to the database - use this for quick analysis without persistence.',
        parameters: {
            type: 'object',
            properties: {
                urls: {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                    description: 'Array of website URLs to analyze. Each URL should be a valid HTTP/HTTPS URL.'
                },
                client_business: {
                    type: 'string',
                    description: 'Description of the client business to match against. This is used by the AI to determine how well each website matches the business.'
                },
                temperature: {
                    type: 'number',
                    description: 'Temperature for AI analysis (0.0-1.0). Higher values make the analysis more creative. Default is 0.7.',
                    default: 0.7,
                    minimum: 0.0,
                    maximum: 1.0
                }
            },
            required: ['urls', 'client_business']
        }
    }
];

/**
 * Get all available tool functions including MCP tools
 * This function dynamically loads MCP tools from the database
 */
export async function getAvailableToolFunctions(): Promise<ToolFunction[]> {
    const staticTools = [...STATIC_TOOL_FUNCTIONS];

    try {
        const mcpService = new MCPToolService();
        const mcpTools = await mcpService.getEnabledMCPToolsAsFunctions();
        return [...staticTools, ...mcpTools];
    } catch (error) {
        console.error('Failed to load MCP tools:', error);
        // Return static tools if MCP tools fail to load
        return staticTools;
    }
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getAvailableToolFunctions() instead
 */
export const AVAILABLE_TOOL_FUNCTIONS: ToolFunction[] = STATIC_TOOL_FUNCTIONS;



