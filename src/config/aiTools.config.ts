import { ToolFunction } from "@/api/aiChatApi";
import { MCPToolService } from "@/service/MCPToolService";

// Static tool functions
const STATIC_TOOL_FUNCTIONS: ToolFunction[] = [
  {
    type: "function",
    name: "scrape_urls_from_search_engine",
    description:
      "Scrape search result URLs from a supported engine (Google, Bing, Yandex, or Baidu) using a query string. Returns titles, snippets, and URLs. This tool is for collecting URLs from a SERP, not for answering questions from page text.",
    parameters: {
      type: "object",
      properties: {
        search_engine: {
          type: "string",
          description:
            "Which search engine to scrape: google, bing, yandex, or baidu",
          enum: ["google", "bing", "yandex", "baidu"],
        },
        query: {
          type: "string",
          description: "The search query to run on the selected engine",
        },
        num_results: {
          type: "number",
          description: "Number of search results to return (default: 10)",
          default: 10,
        },
        market: {
          type: "string",
          description:
            "Optional market/region for Bing (e.g. en-US, en-GB); ignored for other engines",
          default: "en-US",
        },
        show_browser: {
          type: "boolean",
          description:
            "Whether to show the browser window during scraping (default: false, headless)",
          default: false,
        },
      },
      required: ["search_engine", "query"],
    },
  },
  {
    type: "function",
    name: "extract_emails_from_urls",
    description:
      "Extract email addresses from url or web pages. Can parse HTML content or plain text to find email addresses.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: {
            type: "string",
          },
          description: "List of URLs to extract emails from",
        },
        content: {
          type: "string",
          description:
            "Raw HTML or text content to extract emails from (alternative to URLs)",
        },
        validate: {
          type: "boolean",
          description:
            "Whether to validate extracted email addresses (default: true)",
          default: true,
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "search_yellow_pages",
    description:
      "Search Yellow Pages business directory for companies, contact information, and business details by category, name, or location. Use get_available_yellow_pages_platforms first to see available platforms.",
    parameters: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          description:
            'Platform name (e.g., "yellowpages.com"). Use get_available_yellow_pages_platforms to see available options.',
        },
        search_term: {
          type: "string",
          description: "Business name, category, or keyword to search for",
        },
        location: {
          type: "string",
          description: "City, state, or ZIP code to search in",
        },
        num_results: {
          type: "number",
          description: "Number of business results to return (default: 20)",
          default: 20,
        },
        include_emails: {
          type: "boolean",
          description:
            "Whether to attempt extracting email addresses from business pages (default: false)",
          default: false,
        },
      },
      required: ["platform", "search_term", "location"],
    },
  },
  {
    type: "function",
    name: "get_available_yellow_pages_platforms",
    description:
      "A function that returns the live, up-to-date, authenticated list of Yellow Pages platforms integrated with the system's current APIs, including their latest API version and supported country codes.",
    parameters: {
      type: "object",
      properties: {
        country_code: {
          type: "string",
          description:
            'Optional ISO 3166-1 alpha-2 country code to filter available platforms (e.g., "US", "DE", "FR").',
        },
      },
    },
  },
  {
    type: "function",
    name: "analyze_website",
    description:
      "Analyze a single website for business relevance. Use when the user wants to understand what business or industry a website represents, or how well it matches a client business. Scrapes the URL, then uses AI to return industry, match score, and reasoning. Results are not saved to the database. For multiple URLs use analyze_websites instead.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The website URL to analyze (must be a valid HTTP/HTTPS URL).",
        },
        client_business: {
          type: "string",
          description:
            "Description of the client or target business to match against. The AI uses this to determine how relevant the website is to the business (match score and reasoning).",
        },
        temperature: {
          type: "number",
          description:
            "Temperature for AI analysis (0.0-1.0). Higher values make the analysis more creative. Default is 0.7.",
          default: 0.7,
          minimum: 0.0,
          maximum: 1.0,
        },
      },
      required: ["url", "client_business"],
    },
  },
  {
    type: "function",
    name: "analyze_website_batch",
    description:
      "Analyze multiple websites from search results for business relevance. Use when you have search result IDs and want to determine industry, match score, and reasoning against a client business. Scrapes each website and uses AI; results are saved to the database. For direct URLs without search results use analyze_websites or analyze_website.",
    parameters: {
      type: "object",
      properties: {
        result_ids: {
          type: "array",
          items: {
            type: "number",
          },
          description:
            "Array of search result IDs to analyze. Each ID should correspond to a search result that has a URL.",
        },
        client_business: {
          type: "string",
          description:
            "Description of the client business to match against. Used to determine how well each website matches the business (industry, match score, reasoning).",
        },
        temperature: {
          type: "number",
          description:
            "Temperature for AI analysis (0.0-1.0). Higher values make the analysis more creative. Default is 0.7.",
          default: 0.7,
          minimum: 0.0,
          maximum: 1.0,
        },
      },
      required: ["result_ids", "client_business"],
    },
  },
  {
    type: "function",
    name: "analyze_websites",
    description:
      "Analyze multiple websites from URLs for business relevance. Use when you have a list of URLs and want to determine industry, match score, and reasoning against a client business. Scrapes each URL and uses AI; results are NOT saved to the database. For a single URL use analyze_website for convenience.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Array of website URLs to analyze. Each URL should be a valid HTTP/HTTPS URL.",
        },
        client_business: {
          type: "string",
          description:
            "Description of the client business to match against. Used to determine how well each website matches the business (industry, match score, reasoning).",
        },
        temperature: {
          type: "number",
          description:
            "Temperature for AI analysis (0.0-1.0). Higher values make the analysis more creative. Default is 0.7.",
          default: 0.7,
          minimum: 0.0,
          maximum: 1.0,
        },
      },
      required: ["urls", "client_business"],
    },
  },
  {
    type: "function",
    name: "read_url_content",
    description:
      "Fetch the full content of a web page by URL and return it as markdown. Use this to read page content after obtaining URLs from search tools (e.g. scrape_urls_from_search_engine). Not for discovering URLs—use search tools first to get URLs, then call this to read specific pages.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The page URL to read (must be a valid HTTP/HTTPS URL).",
        },
        max_length: {
          type: "number",
          description:
            "Optional maximum characters of markdown to return. Use when only an overview is needed to avoid token limits.",
          default: 80000,
        },
      },
      required: ["url"],
    },
  },
  {
    type: "function",
    name: "generate_keywords",
    description:
      "Generate related or expanded keywords from seed keywords using AI. Use this when the user wants keyword ideas for SEO, advertising, or content topics. Returns a list of generated keywords.",
    parameters: {
      type: "object",
      properties: {
        seed_keywords: {
          type: "array",
          items: { type: "string" },
          description:
            'One or more seed keywords or topics to expand (e.g., ["cloud storage", "file sharing"])',
        },
        num_keywords: {
          type: "number",
          description:
            "Maximum number of keywords to generate per seed (default: 15)",
          default: 15,
        },
        keyword_type: {
          type: "string",
          description:
            'Type of keywords to generate: "seo" for search optimization, or other supported types (default: "seo")',
          default: "seo",
        },
      },
      required: ["seed_keywords"],
    },
  },
  {
    type: "function",
    name: "extract_contact_info",
    description:
      "Extract contact information (emails, phones, address, social links) from one or more website URLs. Uses AI-assisted discovery and regex fallback. Call this when the user wants to find contact details for given website URLs.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description:
            'List of website URLs to extract contact information from (e.g., ["https://example.com", "https://company.com/contact"])',
        },
      },
      required: ["urls"],
    },
  },
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
    console.error("Failed to load MCP tools:", error);
    // Return static tools if MCP tools fail to load
    return staticTools;
  }
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getAvailableToolFunctions() instead
 */
export const AVAILABLE_TOOL_FUNCTIONS: ToolFunction[] = STATIC_TOOL_FUNCTIONS;
