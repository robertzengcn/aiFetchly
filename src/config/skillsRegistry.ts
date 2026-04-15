/**
 * Static Skill Registry — single source of truth for all available skills.
 *
 * This registry maps skill names to their full definitions. Built-in skills
 * are registered at compile time. MCP tools are merged dynamically at
 * enumeration time. Imported skills are registered at runtime.
 *
 * @see research.md Decision 1 (static registry)
 * @see research.md Decision 7 (MCP as dynamic sub-provider)
 * @see research.md Decision 8 (wrap ToolExecutor)
 */

import type { ToolFunction } from "@/api/aiChatApi";
import type {
  SkillDefinition,
  SkillExecutionContext,
} from "@/entityTypes/skillTypes";
import { skillDefinitionToToolFunction } from "@/entityTypes/skillTypes";
import { MCPToolService } from "@/service/MCPToolService";
import { ToolExecutor } from "@/service/ToolExecutor";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Map of skill name → full definition. */
const registry = new Map<string, SkillDefinition>();

// ---------------------------------------------------------------------------
// Built-in skill definitions (statically imported)
// ---------------------------------------------------------------------------

const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
    name: "scrape_urls_from_google",
    description:
      "scrape website, urls in google using a query string. Returns search results including titles, snippets, and URLs.this tool is not use for search information",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to send to Google",
        },
        num_results: {
          type: "number",
          description: "Number of search results to return (default: 10)",
          default: 10,
        },
        show_browser: {
          type: "boolean",
          description:
            "Whether to show the browser window during scraping (default: false, headless)",
          default: false,
        },
      },
      required: ["query"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "scrape_urls_from_google",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "scrape_urls_from_bing",
    description:
      "scrape website, urls in bing using a query string. Returns search results including titles, descriptions, and URLs.this tool is not use for search information",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to send to Bing",
        },
        num_results: {
          type: "number",
          description: "Number of search results to return (default: 10)",
          default: 10,
        },
        market: {
          type: "string",
          description: "Market/region code (e.g., en-US, en-GB)",
          default: "en-US",
        },
        show_browser: {
          type: "boolean",
          description:
            "Whether to show the browser window during scraping (default: false, headless)",
          default: false,
        },
      },
      required: ["query"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "scrape_urls_from_bing",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "scrape_urls_from_yandex",
    description:
      "scrape website, urls in Yandex using a query string. Returns search results including titles, snippets, and URLs.this tool is not use for search information",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to send to Yandex",
        },
        num_results: {
          type: "number",
          description: "Number of search results to return (default: 10)",
          default: 10,
        },
        show_browser: {
          type: "boolean",
          description:
            "Whether to show the browser window during scraping (default: false, headless)",
          default: false,
        },
      },
      required: ["query"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "scrape_urls_from_yandex",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "scrape_urls_from_baidu",
    description:
      "scrape website, urls in Baidu using a query string. Returns search results including titles, snippets, and URLs.this tool is not use for search information",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to send to Baidu",
        },
        num_results: {
          type: "number",
          description: "Number of search results to return (default: 10)",
          default: 10,
        },
        show_browser: {
          type: "boolean",
          description:
            "Whether to show the browser window during scraping (default: false, headless)",
          default: false,
        },
      },
      required: ["query"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "scrape_urls_from_baidu",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "extract_emails_from_urls",
    description:
      "Extract email addresses from url or web pages. Can parse HTML content or plain text to find email addresses.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "extract_emails_from_urls",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "search_yellow_pages",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "get_available_yellow_pages_platforms",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "analyze_website",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "analyze_website_batch",
    description:
      "Analyze multiple websites from search results for business relevance. Use when you have search result IDs and want to determine industry, match score, and reasoning against a client business. Scrapes each website and uses AI; results are saved to the database. For direct URLs without search results use analyze_websites or analyze_website.",
    parameters: {
      type: "object",
      properties: {
        result_ids: {
          type: "array",
          items: { type: "number" },
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "analyze_website_batch",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "analyze_websites",
    description:
      "Analyze multiple websites from URLs for business relevance. Use when you have a list of URLs and want to determine industry, match score, and reasoning against a client business. Scrapes each URL and uses AI; results are NOT saved to the database. For a single URL use analyze_website for convenience.",
    parameters: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "analyze_websites",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "read_url_content",
    description:
      "Fetch the full content of a web page by URL and return it as markdown. Use this to read page content after obtaining URLs from search tools (e.g. scrape_urls_from_google, scrape_urls_from_bing). Not for discovering URLs\u2014use search tools first to get URLs, then call this to read specific pages.",
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "read_url_content",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "read_attachment_content",
    description:
      "Read staged markdown content from a chat attachment file path. Use this when the user message includes attachment references and you need full file content.",
    parameters: {
      type: "object",
      properties: {
        attachment_ref: {
          type: "string",
          description:
            "Conversation-scoped reference ID of the staged attachment content to read.",
        },
        max_length: {
          type: "number",
          description:
            "Optional maximum characters to return to avoid overly large tool results.",
          default: 120000,
        },
      },
      required: ["attachment_ref"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "pure",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "read_attachment_content",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "pure",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "generate_keywords",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
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
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "extract_contact_info",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
];

// Register all built-in skills at module load time
for (const skill of BUILT_IN_SKILLS) {
  registry.set(skill.name, skill);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all registered skills as LLM-facing ToolFunction[].
 * Merges built-in skills with dynamically discovered MCP tools.
 */
async function getAllToolFunctions(): Promise<ToolFunction[]> {
  const builtInTools: ToolFunction[] = [];
  for (const skill of registry.values()) {
    builtInTools.push(skillDefinitionToToolFunction(skill));
  }

  try {
    const mcpService = new MCPToolService();
    const mcpTools = await mcpService.getEnabledMCPToolsAsFunctions();
    // Deduplicate by name (built-in takes precedence)
    const seen = new Set(builtInTools.map((t) => t.name));
    const uniqueMcp = mcpTools.filter((t) => !seen.has(t.name));
    return [...builtInTools, ...uniqueMcp];
  } catch (error) {
    console.error("Failed to load MCP tools:", error);
    return builtInTools;
  }
}

/**
 * Look up a skill by name. Returns null if not found.
 */
function getSkill(name: string): SkillDefinition | null {
  return registry.get(name) ?? null;
}

/**
 * Check if a skill name is registered (regardless of enabled status).
 */
function isRegistered(name: string): boolean {
  return registry.has(name);
}

/**
 * Register a skill at runtime (used for imported skills).
 * Throws if the name is already registered.
 */
function registerSkill(skill: SkillDefinition): void {
  if (registry.has(skill.name)) {
    throw new Error(`Skill already registered: ${skill.name}`);
  }
  registry.set(skill.name, skill);
}

/**
 * Remove a skill from the registry (used for uninstall).
 */
function unregisterSkill(name: string): void {
  registry.delete(name);
}

/**
 * Find a user-installed skill that declares support for the given file extension.
 *
 * Searches skills with `source === "user"` that have a non-empty
 * `supportedFileTypes` array containing the lower-cased extension.
 * Returns the first match, or `null` if none found.
 */
function findSkillForFileExtension(ext: string): SkillDefinition | null {
  const normalized = ext.toLowerCase();
  for (const skill of registry.values()) {
    if (
      skill.source === "user" &&
      skill.supportedFileTypes &&
      skill.supportedFileTypes.includes(normalized)
    ) {
      return skill;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const SkillRegistry = {
  getAllToolFunctions,
  getSkill,
  isRegistered,
  registerSkill,
  unregisterSkill,
  findSkillForFileExtension,
} as const;
