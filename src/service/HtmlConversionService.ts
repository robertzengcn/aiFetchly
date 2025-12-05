import TurndownService from 'turndown';

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
            headingStyle: 'atx',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            strongDelimiter: '**',
            linkStyle: 'inlined',
            linkReferenceStyle: 'full'
        });

        // Add custom rules for better conversion
        this.turndownService.addRule('strikethrough', {
            filter: ['del', 's'],
            replacement: (content) => `~~${content}~~`
        });

        this.turndownService.addRule('highlight', {
            filter: 'mark',
            replacement: (content) => `==${content}==`
        });

        // Add rule to remove script and style content completely
        this.turndownService.addRule('removeScripts', {
            filter: ['script', 'style', 'noscript'],
            replacement: () => ''
        });

        // Add rule to clean up navigation and header elements
        this.turndownService.addRule('removeNavigation', {
            filter: ['nav', 'header', 'footer', 'aside'],
            replacement: (content) => content.trim() ? `\n\n${content}\n\n` : ''
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
                .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newlines
                .replace(/[ \t]+$/gm, '') // Remove trailing whitespace from lines
                .replace(/^\s*\n/gm, '') // Remove empty lines at start
                .trim();
        } catch (error) {
            console.error('Error converting HTML to markdown:', error);
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
            // Remove script tags and their content completely
            let cleaned = htmlContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            
            // Remove style tags and their content completely
            cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
            
            // Remove noscript tags and their content
            cleaned = cleaned.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
            
            // Remove comments
            cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
            
            // Remove meta tags (except viewport)
            cleaned = cleaned.replace(/<meta(?![^>]*viewport)[^>]*>/gi, '');
            
            // Remove link tags that are not stylesheets or canonical
            cleaned = cleaned.replace(/<link(?![^>]*(?:stylesheet|canonical))[^>]*>/gi, '');
            
            // Remove script-related attributes from other elements
            cleaned = cleaned.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
            
            // Remove data attributes that might contain scripts
            cleaned = cleaned.replace(/\s*data-[^=]*\s*=\s*["'][^"']*["']/gi, '');
            
            // Clean up extra whitespace
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            
            return cleaned;
        } catch (error) {
            console.error('Error cleaning HTML content:', error);
            return htmlContent;
        }
    }
}


