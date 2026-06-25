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
import type { SkillDefinition, SkillManifest } from "@/entityTypes/skillTypes";
import { skillDefinitionToToolFunction } from "@/entityTypes/skillTypes";
import * as fs from "fs";
import { SkillManagementModule } from "@/modules/SkillManagementModule";
import { SkillDiagnosticsService } from "@/service/SkillDiagnosticsService";
import { SkillEnvironmentManager } from "@/service/SkillEnvironmentManager";
import { MCPToolService } from "@/service/MCPToolService";
import { ToolExecutor } from "@/service/ToolExecutor";
import { DocSkillScriptRunnerService } from "@/service/DocSkillScriptRunnerService";
import { executeShellCommand } from "@/service/ShellToolService";
import { ShellAuditLogger } from "@/service/ShellAuditLogger";
import {
  getEmailServiceConfig,
  getEmailSearchTaskEmails,
  listEmailSearchTasks,
  listEmailFilters,
  listEmailServices,
  listEmailTemplates,
  startBulkEmailSendTask,
} from "@/service/EmailMarketingAiTools";
import {
  listSchedulesForAi,
  getScheduleDetailsForAi,
  listScheduleExecutionsForAi,
  createScheduleForAi,
  updateScheduleForAi,
  deleteScheduleForAi,
  pauseScheduleForAi,
  resumeScheduleForAi,
  runScheduleNowForAi,
} from "@/service/ScheduleAiTools";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Map of skill name → full definition. */
const registry = new Map<string, SkillDefinition>();

// ---------------------------------------------------------------------------
// Built-in skill definitions (statically imported)
// ---------------------------------------------------------------------------
import { RUN_SUBAGENT_TOOL } from "@/service/agentTools/runSubagentTool";

const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
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
        account: {
          type: "number",
          description:
            "Social account ID to use for authenticated scraping. " +
            "REQUIRED when search_engine is 'google' or 'yandex' (these engines require login cookies). " +
            "Ignored for 'bing' and 'baidu'. The account must have valid cookies stored; " +
            "otherwise the call fails and the user must add account cookies first.",
        },
      },
      required: ["search_engine", "query"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    execute: async (args, context) => {
      const engineRaw =
        typeof args.search_engine === "string"
          ? args.search_engine.trim().toLowerCase()
          : "";
      const requiresAccount = engineRaw === "google" || engineRaw === "yandex";
      const accountId =
        typeof args.account === "number"
          ? args.account
          : typeof args.account === "string" && args.account.trim() !== ""
          ? Number(args.account)
          : NaN;

      if (requiresAccount) {
        if (!Number.isFinite(accountId) || accountId <= 0) {
          return {
            success: false,
            result: {
              error:
                `An account (social account ID) is required when search_engine is "${engineRaw}". ` +
                "Please provide the 'account' parameter and retry.",
            },
          };
        }
        // Verify the account has cookies stored; if not, ask the user to add them.
        try {
          const { AccountCookiesModule } = await import(
            "@/modules/accountCookiesModule"
          );
          const cookiesModule = new AccountCookiesModule();
          const cookies = await cookiesModule.getAccountCookies(accountId);
          if (!cookies || !cookies.cookies) {
            return {
              success: false,
              result: {
                error:
                  `No cookies found for account ID ${accountId}. ` +
                  `Please add account cookies for this ${engineRaw} account in the account management page and retry.`,
              },
            };
          }
        } catch (error: unknown) {
          return {
            success: false,
            result: {
              error:
                "Failed to verify account cookies: " +
                (error instanceof Error ? error.message : String(error)),
            },
          };
        }
      }

      const result = await ToolExecutor.execute(
        "scrape_urls_from_search_engine",
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
    timeoutClass: "network",
    supportsPartialResult: true,
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
    name: "search_maps_businesses",
    description:
      "Search map platforms (Google Maps or Yandex Maps) for local businesses by keyword and location. Returns structured business data including name, rating, review count, category, address, phone, website, and map URL. Use 'google' for global search or 'yandex' for Russian and CIS markets.",
    parameters: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["google", "yandex"],
          description:
            'Map platform to search: "google" for Google Maps (global) or "yandex" for Yandex Maps (Russia/CIS)',
          default: "google",
        },
        query: {
          type: "string",
          description:
            "Business keyword or category to search for (e.g., 'dentist', 'Italian restaurant', 'plumber')",
        },
        location: {
          type: "string",
          description:
            "Target location for the search (e.g., 'New York', 'Moscow', 'London, UK')",
        },
        max_results: {
          type: "number",
          description:
            "Maximum number of business results to return (default: 20, max: 50)",
          default: 20,
        },
        include_website: {
          type: "boolean",
          description:
            "Whether to extract website URLs from business listings (default: true)",
          default: true,
        },
        include_reviews: {
          type: "boolean",
          description:
            "Whether to include review count in results (default: false)",
          default: false,
        },
        language: {
          type: "string",
          description:
            'Language for Yandex Maps UI and results (e.g., "ru", "en", "tr"). Ignored for Google Maps. Defaults to "ru"',
          default: "ru",
        },
        region: {
          type: "string",
          description:
            'Region code for Yandex Maps search context (e.g., "ru", "kz", "by"). Ignored for Google Maps. Optional',
        },
        show_browser: {
          type: "boolean",
          description:
            "Whether to show the browser window during scraping for debugging (default: false)",
          default: false,
        },
      },
      required: ["query", "location"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    timeoutClass: "browser",
    supportsPartialResult: true,
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "search_maps_businesses",
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
    timeoutClass: "network",
    supportsPartialResult: true,
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
      "Fetch the full content of a web page by URL and return it as markdown. Use this to read page content after obtaining URLs from search tools (e.g. scrape_urls_from_search_engine). Not for discovering URLs\u2014use search tools first to get URLs, then call this to read specific pages.",
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
    timeoutClass: "browser",
    supportsPartialResult: true,
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "extract_contact_info",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "file_read",
    description:
      "Read the contents of a file within the allowed workspace. Returns text content with line numbers, " +
      "or binary metadata if the file is not text. Supports offset/limit for reading specific line ranges. " +
      "Files are truncated if they exceed the size limit.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file to read (relative to workspace root or absolute within allowed roots).",
        },
        offset: {
          type: "number",
          description:
            "1-based line number to start reading from (default: 1).",
          default: 1,
        },
        limit: {
          type: "number",
          description:
            "Maximum number of lines to return (default: all lines).",
        },
        encoding: {
          type: "string",
          description: "File encoding (default: utf-8).",
          default: "utf-8",
        },
      },
      required: ["path"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "filesystem",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "file_read",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "glob_files",
    description:
      "Find files matching a glob pattern within the allowed workspace. " +
      "Returns matched file paths with support for ignore patterns and result limiting.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.js').",
        },
        cwd: {
          type: "string",
          description:
            "Base directory for the search (relative to workspace root). Defaults to workspace root.",
        },
        ignore: {
          type: "array",
          items: { type: "string" },
          description:
            "Additional glob patterns to ignore (node_modules, .git, etc. are ignored by default).",
        },
        head_limit: {
          type: "number",
          description:
            "Maximum number of results to return (default: 100). Set truncated=true if more exist.",
          default: 100,
        },
      },
      required: ["pattern"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "filesystem",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "glob_files",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "grep_files",
    description:
      "Search file contents by regex pattern within the allowed workspace. " +
      "Supports multiple output modes: content (matching lines), files_with_matches (file list), " +
      "and count (match counts per file). Includes context line support.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern to search for.",
        },
        path: {
          type: "string",
          description:
            "Directory to search in (relative to workspace root or absolute). Defaults to workspace root.",
        },
        glob: {
          type: "string",
          description:
            "File glob pattern to filter which files to search (default: '**/*').",
          default: "**/*",
        },
        ignore: {
          type: "array",
          items: { type: "string" },
          description:
            "Additional glob patterns to ignore (node_modules, .git, etc. are ignored by default).",
        },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description:
            "Output format: content (default) shows matching lines, files_with_matches shows file paths, count shows match counts.",
          default: "content",
        },
        context_before: {
          type: "number",
          description: "Number of lines to show before each match.",
          default: 0,
        },
        context_after: {
          type: "number",
          description: "Number of lines to show after each match.",
          default: 0,
        },
        case_insensitive: {
          type: "boolean",
          description: "Whether to search case-insensitively (default: false).",
          default: false,
        },
        head_limit: {
          type: "number",
          description: "Maximum number of results to return (default: 100).",
          default: 100,
        },
      },
      required: ["pattern"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "filesystem",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "grep_files",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "file_edit",
    description:
      "Perform a precise string replacement in an existing file within the allowed workspace. " +
      "Requires the exact old_string to find and new_string to replace it with. " +
      "Fails if old_string appears multiple times unless replace_all is true. " +
      "User confirmation is required before any edit is applied.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file to edit (relative to workspace root or absolute within allowed roots).",
        },
        old_string: {
          type: "string",
          description:
            "The exact string to find in the file. Must match exactly including whitespace.",
        },
        new_string: {
          type: "string",
          description: "The string to replace old_string with.",
        },
        replace_all: {
          type: "boolean",
          description:
            "Replace all occurrences of old_string (default: false). When false, fails if multiple matches exist.",
          default: false,
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "filesystem",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "file_edit",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "file_write",
    description:
      "Create a new file or overwrite an existing file within the allowed workspace. " +
      "In 'create' mode, fails if the file already exists. In 'overwrite' mode, replaces the file. " +
      "Parent directories are created automatically. User confirmation is required before any write.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file to write (relative to workspace root or absolute within allowed roots).",
        },
        content: {
          type: "string",
          description: "The content to write to the file.",
        },
        mode: {
          type: "string",
          enum: ["create", "overwrite"],
          description:
            "Write mode: 'create' fails if file exists, 'overwrite' replaces existing file (default: 'create').",
          default: "create",
        },
      },
      required: ["path", "content"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "filesystem",
    source: "built-in",
    execute: async (args, context) => {
      const result = await ToolExecutor.execute(
        "file_write",
        args,
        context.conversationId
      );
      return { success: true, result };
    },
  },
  {
    name: "skill_diagnose",
    description:
      "Classify stderr from a failed Python skill or environment setup (read-only). " +
      "Pass skill_name to enrich hints from the skill manifest when possible.",
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "Installed skill name (kebab-case from manifest.json).",
        },
        stderr: {
          type: "string",
          description: "Error output from the failed run.",
        },
      },
      required: ["skill_name", "stderr"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "pure",
    source: "built-in",
    execute: async (
      args
    ): Promise<{ success: boolean; result: Record<string, unknown> }> => {
      const skillName =
        typeof args.skill_name === "string" ? args.skill_name.trim() : "";
      const stderr = typeof args.stderr === "string" ? args.stderr : "";
      if (!skillName) {
        return { success: false, result: { error: "skill_name is required" } };
      }
      let manifest: SkillManifest | undefined;
      try {
        const module = new SkillManagementModule();
        const row = await module.getSkillByName(skillName);
        if (row) {
          manifest = JSON.parse(row.manifest_json) as SkillManifest;
        }
      } catch {
        manifest = undefined;
      }
      const diagnosed = SkillDiagnosticsService.diagnoseStderr(
        stderr,
        manifest
      );
      return {
        success: true,
        result: { ...diagnosed } as Record<string, unknown>,
      };
    },
  },
  {
    name: "run_skill_script",
    description:
      "Run a Python script from an installed skill's scripts/ directory. " +
      "Use this when a documentation-only skill (e.g. pdf, image, docx) provides SKILL.md guidance " +
      "and you need to actually execute a transformation — for example converting a PDF to images, " +
      "extracting pages, or running OCR. " +
      "First call the skill tool with the attachment to get guidance, then call run_skill_script " +
      "with the script_name and attachment_ref to execute the Python script. " +
      "Scripts follow the convention: python script.py <input_file> <output_dir>. " +
      "Output files are placed in a run directory and listed in the result.",
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description:
            "Name of the installed skill whose scripts/ directory contains the script (e.g. 'pdf', 'image').",
        },
        script_name: {
          type: "string",
          description:
            "Name of the Python script to run without the .py extension (e.g. 'convert_pdf_to_images'). " +
            "If not found, the response lists available_scripts.",
        },
        attachment_ref: {
          type: "string",
          description:
            "Conversation-scoped attachment reference for the input file. " +
            "Pass the attachment_ref from the system prompt when processing an uploaded file.",
        },
      },
      required: ["skill_name", "script_name"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "filesystem",
    source: "built-in",
    execute: async (
      args,
      context
    ): Promise<{ success: boolean; result: Record<string, unknown> }> => {
      const skillName =
        typeof args.skill_name === "string" ? args.skill_name.trim() : "";
      const scriptName =
        typeof args.script_name === "string" ? args.script_name.trim() : "";
      const attachmentRef =
        typeof args.attachment_ref === "string" &&
        args.attachment_ref.trim().length > 0
          ? args.attachment_ref.trim()
          : undefined;

      if (!skillName) {
        return { success: false, result: { error: "skill_name is required" } };
      }
      if (!scriptName) {
        const available =
          DocSkillScriptRunnerService.listAvailableScripts(skillName);
        return {
          success: false,
          result: {
            error: "script_name is required",
            available_scripts: available,
          },
        };
      }

      return DocSkillScriptRunnerService.runSkillScript({
        skillName,
        scriptName,
        attachmentRef,
        conversationId: context.conversationId,
      });
    },
  },
  {
    name: "skill_repair_environment",
    description:
      "Rebuild the local Python venv for an installed Python skill using its hash-pinned requirements file. Requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "Installed skill name from manifest.json.",
        },
      },
      required: ["skill_name"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "filesystem",
    source: "built-in",
    execute: async (
      args
    ): Promise<{ success: boolean; result: Record<string, unknown> }> => {
      const skillName =
        typeof args.skill_name === "string" ? args.skill_name.trim() : "";
      if (!skillName) {
        return { success: false, result: { error: "skill_name is required" } };
      }
      const module = new SkillManagementModule();
      const row = await module.getSkillByName(skillName);
      if (!row) {
        return { success: false, result: { error: "Skill not found" } };
      }
      const manifest = JSON.parse(row.manifest_json) as SkillManifest;
      if (manifest.runtime !== "python") {
        return {
          success: false,
          result: {
            error: "skill_repair_environment applies only to Python skills",
          },
        };
      }
      const skillDir = SkillEnvironmentManager.getInstalledSkillRoot(skillName);
      if (!fs.existsSync(skillDir)) {
        return {
          success: false,
          result: { error: "Skill directory missing on disk" },
        };
      }
      try {
        await SkillEnvironmentManager.repair(skillDir, manifest);
      } catch (error: unknown) {
        return {
          success: false,
          result: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
      return { success: true, result: { repaired: true, skillName } };
    },
  },
  {
    name: "list_email_templates",
    description:
      "List available email marketing templates for AI-assisted campaign setup.",
    parameters: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Zero-based page number.",
          default: 0,
        },
        size: {
          type: "number",
          description: "Page size, from 1 to 100.",
          default: 20,
        },
        search: {
          type: "string",
          description: "Optional title or description search text.",
        },
      },
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await listEmailTemplates(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "list_email_filters",
    description:
      "List available email marketing filters and filter rules for campaign setup.",
    parameters: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Zero-based page number.",
          default: 0,
        },
        size: {
          type: "number",
          description: "Page size, from 1 to 100.",
          default: 20,
        },
        search: {
          type: "string",
          description: "Optional filter name or description search text.",
        },
      },
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await listEmailFilters(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "list_email_services",
    description:
      "List configured email sending services without exposing passwords.",
    parameters: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Zero-based page number.",
          default: 0,
        },
        size: {
          type: "number",
          description: "Page size, from 1 to 100.",
          default: 20,
        },
        search: {
          type: "string",
          description: "Optional service name or sender search text.",
        },
      },
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await listEmailServices(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "get_email_service_config",
    description:
      "Get a single email sending service configuration without exposing passwords.",
    parameters: {
      type: "object",
      properties: {
        service_id: {
          type: "number",
          description: "Email service ID to inspect.",
        },
      },
      required: ["service_id"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await getEmailServiceConfig(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "list_email_search_tasks",
    description:
      "List email search tasks available as recipient sources for email campaigns.",
    parameters: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Zero-based page number.",
          default: 0,
        },
        size: {
          type: "number",
          description: "Page size, from 1 to 100.",
          default: 20,
        },
      },
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await listEmailSearchTasks(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "get_email_search_task_emails",
    description:
      "Get all extracted email recipients from an existing email search task.",
    parameters: {
      type: "object",
      properties: {
        email_search_task_id: {
          type: "number",
          description: "Email search task ID to read recipients from.",
        },
      },
      required: ["email_search_task_id"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await getEmailSearchTaskEmails(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "start_bulk_email_send_task",
    description:
      "Create and start a bulk email send task. Requires confirmation because it sends email. Provide either template_ids or email_subject and email_html_content, not both empty.",
    parameters: {
      type: "object",
      properties: {
        email_search_task_id: {
          type: "number",
          description:
            "Existing email search task ID. Provide exactly one of this or emails.",
        },
        emails: {
          type: "array",
          description:
            "Direct recipient emails. Provide exactly one of this or email_search_task_id.",
          items: {
            oneOf: [
              {
                type: "string",
                format: "email",
              },
              {
                type: "object",
                properties: {
                  address: { type: "string", format: "email" },
                  title: { type: "string" },
                  source: { type: "string" },
                },
                required: ["address"],
              },
            ],
          },
        },
        email_subject: {
          type: "string",
          description:
            "Email subject line (required when not using templates).",
        },
        email_html_content: {
          type: "string",
          description: "Email HTML body (required when not using templates).",
        },
        template_ids: {
          type: "array",
          description:
            "Optional email template IDs. Omit when using email_subject and email_html_content.",
          items: { type: "number" },
        },
        filter_ids: {
          type: "array",
          description: "Optional email filter IDs to apply.",
          items: { type: "number" },
          default: [],
        },
        service_ids: {
          type: "array",
          description: "Email service IDs to send with.",
          items: { type: "number" },
        },
        not_duplicate: {
          type: "boolean",
          description: "Whether to remove duplicate recipients before sending.",
          default: true,
        },
      },
      required: ["service_ids"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await startBulkEmailSendTask(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "shell_execute",
    description:
      "Execute a local shell command with explicit user confirmation and safety controls. " +
      "Supports Bash (Linux/macOS) and PowerShell (Windows) with optional shell override. " +
      "The exact command will be shown to the user for approval before execution.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command text to execute.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory under workspace roots.",
        },
        shell: {
          type: "string",
          enum: ["auto", "bash", "powershell", "cmd"],
          description:
            "Shell interpreter to use. 'auto' selects Bash on Linux/macOS and PowerShell on Windows.",
          default: "auto",
        },
        timeout_ms: {
          type: "number",
          description:
            "Maximum execution time in milliseconds. Default 60000 (60s), max 600000 (10min).",
          default: 60000,
        },
      },
      required: ["command"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "shell",
    source: "built-in",
    execute: async (args, context) => {
      const shellResult = await executeShellCommand(
        args,
        context.conversationId
      );

      // Fire-and-forget audit logging (use validated fields from result)
      const auditLogger = new ShellAuditLogger();
      auditLogger
        .log({
          conversationId: context.conversationId,
          toolCallId: context.toolCallId,
          commandRedacted:
            shellResult.validatedCommand ?? (args.command as string) ?? "",
          cwd: shellResult.validatedCwd ?? (args.cwd as string) ?? "",
          shell: shellResult.validatedShell ?? (args.shell as string) ?? "auto",
          success: shellResult.success,
          exitCode: shellResult.exit_code,
          timedOut: shellResult.timed_out,
          durationMs: shellResult.duration_ms,
        })
        .catch(() => {
          /* audit failure must not block result */
        });

      return {
        success: shellResult.success,
        result: { ...shellResult } as Record<string, unknown>,
      };
    },
  },
  {
    name: "knowledge_library_search",
    description:
      "Search the local knowledge library for factual information from uploaded documents. " +
      "Use this before answering questions that require knowledge-base context. " +
      "Returns relevant passages with source citations.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query to find relevant knowledge-library passages.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of results to return (default: 5, max: 10).",
          default: 5,
        },
        documentIds: {
          type: "array",
          items: { type: "number" },
          description: "Restrict search to these document IDs.",
        },
        documentTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Restrict search to these file types (e.g. pdf, docx, txt).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Restrict search to documents with these tags.",
        },
        author: {
          type: "string",
          description: "Restrict search to documents by this author.",
        },
        dateRange: {
          type: "object",
          properties: {
            start: { type: "string", description: "Start date (ISO 8601)" },
            end: { type: "string", description: "End date (ISO 8601)" },
          },
          description: "Restrict to documents uploaded within this date range.",
        },
        includeNeighborChunks: {
          type: "boolean",
          description:
            "Whether to include neighboring chunks for context (default: true).",
          default: true,
        },
      },
      required: ["query"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "pure",
    source: "built-in",
    execute: async (
      args
    ): Promise<{ success: boolean; result: Record<string, unknown> }> => {
      const { RagSearchModule } = await import("@/modules/RagSearchModule");
      const module = new RagSearchModule();
      const result = await module.searchKnowledgeForTool({
        query: args.query as string,
        limit: args.limit as number | undefined,
        documentIds: args.documentIds as number[] | undefined,
        documentTypes: args.documentTypes as string[] | undefined,
        tags: args.tags as string[] | undefined,
        author: args.author as string | undefined,
        dateRange: args.dateRange as { start: string; end: string } | undefined,
        includeNeighborChunks: args.includeNeighborChunks as
          | boolean
          | undefined,
      });
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  // ── Schedule Management Skills ──────────────────────────────────────────
  {
    name: "list_schedules",
    description:
      "List all automation schedules in the application. Returns paginated schedule data including name, task type, cron expression, active status, execution counts, and next run time. Use this to inspect existing schedules or find a schedule to update.",
    parameters: {
      type: "object",
      properties: {
        page: {
          type: "number",
          description: "Page number (0-based)",
          default: 0,
        },
        size: {
          type: "number",
          description: "Page size (1-100)",
          default: 20,
        },
      },
      required: [],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await listSchedulesForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "get_schedule_details",
    description:
      "Get full details for a single schedule by ID. Returns schedule metadata, cron expression, status, execution statistics, last error message, and next run time. Use this before updating or deleting a schedule.",
    parameters: {
      type: "object",
      properties: {
        schedule_id: {
          type: "number",
          description: "The schedule ID to look up",
        },
      },
      required: ["schedule_id"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await getScheduleDetailsForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "list_schedule_executions",
    description:
      "List execution history for schedules. Returns paginated execution records with status, duration, trigger type, and timestamps. Filter by schedule ID, status, or trigger type. Use this to diagnose why a schedule failed or check recent execution health.",
    parameters: {
      type: "object",
      properties: {
        schedule_id: {
          type: "number",
          description: "Optional schedule ID to filter",
        },
        page: {
          type: "number",
          description: "Page number (0-based)",
          default: 0,
        },
        size: {
          type: "number",
          description: "Page size (1-100)",
          default: 20,
        },
        status: {
          type: "string",
          enum: [
            "pending",
            "running",
            "success",
            "failed",
            "cancelled",
            "timeout",
          ],
          description: "Optional execution status filter",
        },
        triggered_by: {
          type: "string",
          enum: ["cron", "dependency", "manual"],
          description: "Optional trigger type filter",
        },
      },
      required: [],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await listScheduleExecutionsForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "create_schedule",
    description:
      "Create a new automation schedule for an existing task. The schedule defaults to inactive (is_active: false) for safety. Supported task types: search, email_extract, buck_email, yellow_pages, google_maps, yandex_maps. Requires a valid cron expression. This action requires user confirmation because it can trigger future automation.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Schedule name",
        },
        description: {
          type: "string",
          description: "Optional schedule description",
        },
        task_type: {
          type: "string",
          enum: [
            "search",
            "email_extract",
            "buck_email",
            "yellow_pages",
            "google_maps",
            "yandex_maps",
          ],
          description: "Type of task this schedule manages",
        },
        task_id: {
          type: "number",
          description: "ID of the existing task",
        },
        cron_expression: {
          type: "string",
          description: 'Cron expression (e.g. "0 9 * * 1-5")',
        },
        is_active: {
          type: "boolean",
          description: "Whether the schedule should be active immediately",
          default: false,
        },
        trigger_type: {
          type: "string",
          enum: ["cron", "dependency", "manual"],
          description: "Trigger type for the schedule",
          default: "cron",
        },
        parent_schedule_id: {
          type: "number",
          description:
            "Optional parent schedule ID for dependency-triggered schedules",
        },
        dependency_condition: {
          type: "string",
          enum: ["on_success", "on_completion", "on_failure"],
          description:
            "Condition for dependency-triggered schedules (when parent completes, succeeds, or fails)",
        },
        delay_minutes: {
          type: "number",
          description: "Delay in minutes (0-1440)",
          default: 0,
        },
      },
      required: ["name", "task_type", "task_id", "cron_expression"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await createScheduleForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "update_schedule",
    description:
      "Update an existing schedule. Only provided fields are changed. If task_type or task_id changes, the new task reference is validated. If cron or activation state changes, the runtime scheduler is synchronized. This action requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        schedule_id: {
          type: "number",
          description: "Schedule ID to update",
        },
        name: {
          type: "string",
          description: "New schedule name",
        },
        description: {
          type: "string",
          description: "New schedule description",
        },
        task_type: {
          type: "string",
          enum: [
            "search",
            "email_extract",
            "buck_email",
            "yellow_pages",
            "google_maps",
            "yandex_maps",
          ],
          description: "New task type",
        },
        task_id: {
          type: "number",
          description: "New task ID",
        },
        cron_expression: {
          type: "string",
          description: "New cron expression",
        },
        is_active: {
          type: "boolean",
          description: "New active status",
        },
        trigger_type: {
          type: "string",
          enum: ["cron", "dependency", "manual"],
          description: "New trigger type",
        },
        parent_schedule_id: {
          type: "number",
          description: "New parent schedule ID",
        },
        dependency_condition: {
          type: "string",
          enum: ["on_success", "on_completion", "on_failure"],
          description: "New dependency condition",
        },
        delay_minutes: {
          type: "number",
          description: "New delay in minutes (0-1440)",
        },
      },
      required: ["schedule_id"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await updateScheduleForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "delete_schedule",
    description:
      "Delete a schedule. Schedules with child schedules cannot be deleted until the children are removed first. The runtime cron job is stopped before database deletion. This action requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        schedule_id: {
          type: "number",
          description: "Schedule ID to delete",
        },
      },
      required: ["schedule_id"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await deleteScheduleForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "pause_schedule",
    description:
      "Pause an active schedule. Updates the schedule status and removes the runtime cron job. The schedule can be resumed later. This action requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        schedule_id: {
          type: "number",
          description: "Schedule ID to pause",
        },
      },
      required: ["schedule_id"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await pauseScheduleForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "resume_schedule",
    description:
      "Resume a paused schedule. Updates the schedule status and re-adds the runtime cron job if the schedule is active. This action requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        schedule_id: {
          type: "number",
          description: "Schedule ID to resume",
        },
      },
      required: ["schedule_id"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await resumeScheduleForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "run_schedule_now",
    description:
      "Execute an active schedule immediately instead of waiting for the next cron trigger. Uses the existing execution logging and task execution pipeline. The schedule must be active. This action requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        schedule_id: {
          type: "number",
          description: "Schedule ID to execute immediately",
        },
      },
      required: ["schedule_id"],
    },
    tier: "main",
    requiresConfirmation: true,
    permissionCategory: "automation",
    source: "built-in",
    execute: async (args) => {
      const result = await runScheduleNowForAi(args);
      return {
        success: result.success,
        result: result as unknown as Record<string, unknown>,
      };
    },
  },
  RUN_SUBAGENT_TOOL,
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
 *
 * Effective enablement for plugin-owned skills: a skill registered with
 * `pluginOwner` is only included when its owning plugin is enabled.
 * (Design §8.3)
 */
async function getAllToolFunctions(): Promise<ToolFunction[]> {
  // Resolve enabled plugin names once per catalog build.
  let enabledPluginNames: Set<string> | null = null;
  try {
    const { PluginManagementModule } = await import(
      "@/modules/PluginManagementModule"
    );
    const mod = new PluginManagementModule();
    const enabledPlugins = await mod.listEnabledPlugins();
    enabledPluginNames = new Set(enabledPlugins.map((p) => p.name));
  } catch {
    // Plugin module unavailable (e.g. during early boot / tests) — treat as
    // no enabled plugins, which suppresses plugin-owned skills safely.
    enabledPluginNames = new Set();
  }

  const builtInTools: ToolFunction[] = [];
  for (const skill of registry.values()) {
    if (
      skill.pluginOwner &&
      enabledPluginNames &&
      !enabledPluginNames.has(skill.pluginOwner)
    ) {
      continue; // owning plugin is disabled — hide from catalog
    }
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
 * Documentation-only skills are included so the chat system prompt can route
 * staged uploads to them with `attachment_ref` (see ai-chat-ipc).
 *
 * Effective enablement for plugin-owned skills: a skill registered with
 * `pluginOwner` is only returned when its owning plugin is enabled.
 * (Design §8.3 — same rule as getAllToolFunctions.)
 *
 * Returns the first match, or `null` if none found.
 */
async function findSkillForFileExtension(
  ext: string
): Promise<SkillDefinition | null> {
  const normalized = ext.toLowerCase();

  // Resolve enabled plugin names once per lookup so plugin-owned skills
  // whose owner is disabled/uninstalled are hidden from attachment routing.
  let enabledPluginNames: Set<string> | null = null;
  try {
    const { PluginManagementModule } = await import(
      "@/modules/PluginManagementModule"
    );
    const mod = new PluginManagementModule();
    const enabledPlugins = await mod.listEnabledPlugins();
    enabledPluginNames = new Set(enabledPlugins.map((p) => p.name));
  } catch {
    enabledPluginNames = new Set();
  }

  for (const skill of registry.values()) {
    if (
      skill.source === "user" &&
      skill.supportedFileTypes &&
      skill.supportedFileTypes.includes(normalized)
    ) {
      if (
        skill.pluginOwner &&
        enabledPluginNames &&
        !enabledPluginNames.has(skill.pluginOwner)
      ) {
        continue; // owning plugin is disabled/uninstalled — skip
      }
      return skill;
    }
  }
  return null;
}

/**
 * Return all built-in skill definitions (excludes user/marketplace/MCP).
 */
function listBuiltInSkillDefinitions(): SkillDefinition[] {
  return Array.from(registry.values()).filter(
    (skill) => skill.source === "built-in"
  );
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
  listBuiltInSkillDefinitions,
} as const;
