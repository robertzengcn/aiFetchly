import TurndownService from "turndown";
import sanitizeHtml from "sanitize-html";
import { log } from "@/modules/Logger";

/**
 * Service for converting HTML content to markdown format
 *
 * Provides utilities for cleaning HTML and converting it to markdown,
 * making it reusable across different parts of the application.
 *
 * @example
 * ```typescript
 * const htmlService = new HtmlConversionService();
 * const markdown = htmlService.convertHtmlToMarkdown('<h1>Hello</h1>');
 * const cleaned = htmlService.cleanHtmlContent('<script>alert("xss")</script><p>Content</p>');
 * ```
 */
export class HtmlConversionService {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      strongDelimiter: "**",
      linkStyle: "inlined",
      linkReferenceStyle: "full",
    });

    // Add custom rules for better conversion
    this.turndownService.addRule("strikethrough", {
      filter: ["del", "s"],
      replacement: (content) => `~~${content}~~`,
    });

    this.turndownService.addRule("highlight", {
      filter: "mark",
      replacement: (content) => `==${content}==`,
    });

    // Add rule to remove script and style content completely
    this.turndownService.addRule("removeScripts", {
      filter: ["script", "style", "noscript"],
      replacement: () => "",
    });

    // Add rule to clean up navigation and header elements
    this.turndownService.addRule("removeNavigation", {
      filter: ["nav", "header", "footer", "aside"],
      replacement: (content) => (content.trim() ? `\n\n${content}\n\n` : ""),
    });
  }

  /**
   * Convert HTML content to markdown using turndown
   *
   * @param htmlContent - The HTML content to convert
   * @returns The converted markdown content, or original HTML if conversion fails
   *
   * @example
   * ```typescript
   * const html = '<h1>Title</h1><p>Content</p>';
   * const markdown = htmlService.convertHtmlToMarkdown(html);
   * // Returns: "# Title\n\nContent"
   * ```
   */
  convertHtmlToMarkdown(htmlContent: string): string {
    try {
      // First, clean the HTML content to remove unwanted elements
      const cleanedHtml = this.cleanHtmlContent(htmlContent);

      // Convert HTML to markdown
      const markdown = this.turndownService.turndown(cleanedHtml);

      // Clean up extra whitespace and normalize line breaks
      return markdown
        .replace(/\n{3,}/g, "\n\n") // Replace multiple newlines with double newlines
        .replace(/[ \t]+$/gm, "") // Remove trailing whitespace from lines
        .replace(/^\s*\n/gm, "") // Remove empty lines at start
        .trim();
    } catch (error) {
      log.error("Error converting HTML to markdown:", error);
      // Fallback: return the original HTML content if conversion fails
      return htmlContent;
    }
  }

  /**
   * Clean HTML content by removing unwanted elements and scripts
   *
   * Removes potentially dangerous or unnecessary elements including:
   * - Script tags and their content
   * - Style tags and their content
   * - Noscript tags
   * - HTML comments
   * - Meta tags (except viewport)
   * - Link tags (except stylesheets and canonical)
   * - Event handler attributes (onclick, onload, etc.)
   * - Data attributes that might contain scripts
   *
   * @param htmlContent - The HTML content to clean
   * @returns The cleaned HTML content, or original HTML if cleaning fails
   *
   * @example
   * ```typescript
   * const dirtyHtml = '<script>alert("xss")</script><p>Safe content</p>';
   * const cleanHtml = htmlService.cleanHtmlContent(dirtyHtml);
   * // Returns: '<p>Safe content</p>'
   * ```
   */
  cleanHtmlContent(htmlContent: string): string {
    try {
      // Use a parser-based allowlist (sanitize-html) instead of regex tag
      // blocklists, which CodeQL flags as js/bad-tag-filter (#62): regex
      // filtering misses obfuscated/unknown tags and is bypass-prone.
      // script/style/noscript/comments are discarded automatically because
      // they are not in the allowlist; event-handler and data-* attributes
      // are dropped because no attributes beyond the safe set are allowed.
      const CLEAN_OPTIONS: sanitizeHtml.IOptions = {
        allowedTags: [
          "p",
          "br",
          "hr",
          "div",
          "span",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "strong",
          "em",
          "del",
          "s",
          "u",
          "sub",
          "sup",
          "a",
          "img",
          "ul",
          "ol",
          "li",
          "blockquote",
          "code",
          "pre",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
        ],
        allowedAttributes: {
          a: ["href", "title", "name", "target", "rel"],
          img: ["src", "alt", "title", "width", "height"],
          // Allow only dir on block elements; drop every on* / data-* handler.
          "*": ["dir"],
        },
        allowedSchemes: ["http", "https", "mailto"],
        disallowedTagsMode: "discard",
      };

      let cleaned = sanitizeHtml(htmlContent, CLEAN_OPTIONS);

      // Defense-in-depth: strip any inline event-handler attributes that
      // survived (sanitize-html already drops them; this guards future
      // option changes) in a loop for nested cases.
      let prevCleaned: string;
      do {
        prevCleaned = cleaned;
        cleaned = cleaned.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "");
      } while (cleaned !== prevCleaned);

      // Remove data attributes that might carry scripts.
      cleaned = cleaned.replace(/\sdata-[^=]*\s*=\s*["'][^"']*["']/gi, "");

      // Clean up extra whitespace
      cleaned = cleaned.replace(/\s+/g, " ").trim();

      return cleaned;
    } catch (error) {
      log.error("Error cleaning HTML content:", error);
      return htmlContent;
    }
  }
}
