import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { SqliteDb } from '@/config/SqliteDb';
import { RagConfigApi, ChunkingConfig } from '@/api/ragConfigApi';
import { RAGChunkModule } from '@/modules/RAGChunkModule';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import pdf2md from 'pdf2md-ts';
import TurndownService from 'turndown';
import * as mammoth from 'mammoth';

export interface ChunkingOptions {
    chunkSize: number;
    overlapSize: number;
    strategy: 'sentence' | 'paragraph' | 'semantic' | 'fixed';
    preserveWhitespace?: boolean;
    minChunkSize?: number;
}

export interface ChunkResult {
    content: string;
    startPosition: number;
    endPosition: number;
    pageNumber?: number;
    tokenCount: number;
}

export interface DocumentContent {
    content: string;
    contentType: 'text' | 'markdown' | 'html' | 'pdf' | 'docx' | 'unknown';
    originalFormat: string;
    metadata?: {
        pageCount?: number;
        wordCount?: number;
        characterCount?: number;
        conversionMessages?: string[];
    };
}

export class ChunkingService {
    private db: SqliteDb;
    private ragConfigApi: RagConfigApi;
    private ragChunkModule: RAGChunkModule;
    private cachedConfig: ChunkingConfig | null = null;
    private configCacheExpiry: number = 0;
    private readonly CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes
    private readonly defaultOptions: ChunkingOptions = {
        chunkSize: 1000,
        overlapSize: 200,
        strategy: 'sentence',
        preserveWhitespace: true,
        minChunkSize: 100
    };

    constructor(db: SqliteDb) {
        this.db = db;
        this.ragConfigApi = new RagConfigApi();
        this.ragChunkModule = new RAGChunkModule();
        this.initializeConfig();
    }

    /**
     * Initialize chunking configuration from remote API or cache
     */
    private async initializeConfig(): Promise<void> {
        try {
            await this.loadChunkingConfig();
            console.log('ChunkingService initialized with remote configuration');
        } catch (error) {
            console.warn('Failed to load remote chunking configuration, using defaults:', error);
        }
    }

    /**
     * Load chunking configuration from remote API or cache
     */
    private async loadChunkingConfig(): Promise<void> {
        // Check if cache is still valid
        if (this.cachedConfig && Date.now() < this.configCacheExpiry) {
            console.log('Using cached chunking configuration');
            return;
        }

        try {
            // Check if remote service is online
            const healthCheck = await this.ragConfigApi.isOnline();
            if (!healthCheck.status || !healthCheck.data) {
                console.warn('Remote configuration service is offline, using defaults');
                return;
            }

            // Fetch configuration from remote API
            const configResponse = await this.ragConfigApi.getChunkingConfig();
            if (configResponse.status && configResponse.data) {
                this.cachedConfig = configResponse.data.default_config;
                this.configCacheExpiry = Date.now() + this.CACHE_DURATION_MS;
                console.log('Chunking configuration loaded from remote API:', {
                    chunkSize: this.cachedConfig.chunkSize,
                    overlapSize: this.cachedConfig.overlapSize,
                    strategy: this.cachedConfig.strategy
                });
            } else {
                console.warn('Failed to fetch chunking configuration from remote API');
            }
        } catch (error) {
            console.error('Error loading chunking configuration:', error);
            throw error;
        }
    }

    /**
     * Get current chunking configuration (cached or default)
     */
    private async getChunkingConfig(): Promise<ChunkingConfig> {
        await this.loadChunkingConfig();
        
        if (this.cachedConfig) {
            return this.cachedConfig;
        }

        // Return default configuration if no cached config is available
        return {
            chunkSize: this.defaultOptions.chunkSize,
            overlapSize: this.defaultOptions.overlapSize,
            strategy: this.defaultOptions.strategy,
            preserveWhitespace: this.defaultOptions.preserveWhitespace ?? true,
            minChunkSize: this.defaultOptions.minChunkSize || 100,
            maxChunkSize: this.defaultOptions.chunkSize * 2,
            splitOnSentences: true,
            splitOnParagraphs: true
        };
    }

    /**
     * Refresh configuration cache from remote API
     */
    async refreshConfig(): Promise<void> {
        this.cachedConfig = null;
        this.configCacheExpiry = 0;
        await this.loadChunkingConfig();
    }

    /**
     * Get cached configuration info
     */
    getConfigInfo(): { 
        hasCachedConfig: boolean; 
        cacheExpiry: number; 
        config: ChunkingConfig | null 
    } {
        return {
            hasCachedConfig: this.cachedConfig !== null,
            cacheExpiry: this.configCacheExpiry,
            config: this.cachedConfig
        };
    }

    /**
     * Chunk document content into smaller pieces
     */
    async chunkDocument(document: RAGDocumentEntity, options?: Partial<ChunkingOptions>): Promise<RAGChunkEntity[]> {
        // Get configuration from cache or remote API
        const remoteConfig = await this.getChunkingConfig();
        
        // Merge remote config with default options and user-provided options
        const chunkingOptions: ChunkingOptions = {
            ...this.defaultOptions,
            chunkSize: remoteConfig.chunkSize,
            overlapSize: remoteConfig.overlapSize,
            strategy: remoteConfig.strategy,
            preserveWhitespace: remoteConfig.preserveWhitespace,
            minChunkSize: remoteConfig.minChunkSize,
            ...options // User options override everything
        };
        
        // Read document content
        const documentContent = await this.extractDocumentContent(document);
        if (!documentContent) {
            throw new Error('Unable to extract content from document');
        }

        console.log(`Processing document: ${path.basename(document.filePath)}`);
        console.log(`Content type: ${documentContent.contentType}, Original format: ${documentContent.originalFormat}`);
        console.log(`Content length: ${documentContent.content.length} characters, ${documentContent.metadata?.wordCount || 0} words`);
        
        // Generate chunks based on strategy and content type
        const chunks = await this.generateChunks(documentContent.content, documentContent.contentType, chunkingOptions);
        
        // Save chunks to database
        const chunkEntities: RAGChunkEntity[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const contentHash = this.generateContentHash(chunk.content);

            // Check for duplicate chunks
            const existingChunk = await this.ragChunkModule.findChunkByHash(contentHash, document.id);

            if (existingChunk) {
                console.warn(`Duplicate chunk detected for document ${document.id}, chunk ${i}`);
                continue;
            }

            const chunkEntity = new RAGChunkEntity();
            chunkEntity.documentId = document.id;
            chunkEntity.chunkIndex = i;
            chunkEntity.content = chunk.content;
            chunkEntity.contentHash = contentHash;
            chunkEntity.tokenCount = chunk.tokenCount;
            chunkEntity.startPosition = chunk.startPosition;
            chunkEntity.endPosition = chunk.endPosition;
            chunkEntity.pageNumber = chunk.pageNumber;

            const savedChunk = await this.ragChunkModule.saveChunk(chunkEntity);
            chunkEntities.push(savedChunk);
        }

        return chunkEntities;
    }

    /**
     * Convert HTML content to markdown using turndown
     */
    private convertHtmlToMarkdown(htmlContent: string): string {
        try {
            // First, clean the HTML content to remove unwanted elements
            const cleanedHtml = this.cleanHtmlContent(htmlContent);

            const turndownService = new TurndownService({
                headingStyle: 'atx',
                bulletListMarker: '-',
                codeBlockStyle: 'fenced',
                emDelimiter: '*',
                strongDelimiter: '**',
                linkStyle: 'inlined',
                linkReferenceStyle: 'full'
            });

            // Add custom rules for better conversion
            turndownService.addRule('strikethrough', {
                filter: ['del', 's'],
                replacement: (content) => `~~${content}~~`
            });

            turndownService.addRule('highlight', {
                filter: 'mark',
                replacement: (content) => `==${content}==`
            });

            // Add rule to remove script and style content completely
            turndownService.addRule('removeScripts', {
                filter: ['script', 'style', 'noscript'],
                replacement: () => ''
            });

            // Add rule to clean up navigation and header elements
            turndownService.addRule('removeNavigation', {
                filter: ['nav', 'header', 'footer', 'aside'],
                replacement: (content) => content.trim() ? `\n\n${content}\n\n` : ''
            });

            // Convert HTML to markdown
            const markdown = turndownService.turndown(cleanedHtml);
            
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
     */
    private cleanHtmlContent(htmlContent: string): string {
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

    /**
     * Extract DOCX content using mammoth and convert to markdown
     */
    private async extractDocxContent(filePath: string): Promise<string | null> {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                console.error(`DOCX file not found: ${filePath}`);
                return null;
            }

            console.log(`Processing DOCX file: ${path.basename(filePath)}`);

            // Convert DOCX to HTML using mammoth
            const result = await mammoth.convertToHtml({ path: filePath });
            const htmlContent = result.value;

            if (!htmlContent || htmlContent.trim().length === 0) {
                console.warn(`No content extracted from DOCX: ${path.basename(filePath)}`);
                return null;
            }

            // Log any conversion messages/warnings
            if (result.messages && result.messages.length > 0) {
                console.log(`DOCX conversion messages for ${path.basename(filePath)}:`, result.messages);
            }

            // Convert HTML to markdown using our existing method
            const markdownContent = this.convertHtmlToMarkdown(htmlContent);

            if (markdownContent && markdownContent.trim().length > 0) {
                console.log(`Successfully converted DOCX to markdown: ${markdownContent.length} characters`);
                return markdownContent.trim();
            } else {
                console.warn(`No markdown content generated from DOCX: ${path.basename(filePath)}`);
                return null;
            }

        } catch (error) {
            console.error(`Error extracting DOCX content from ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Extract PDF content using pdf-lib and pdf2md-ts
     */
    private async extractPdfContent(filePath: string): Promise<{ content: string; pageCount: number } | null> {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                console.error(`PDF file not found: ${filePath}`);
                return null;
            }

            // Read PDF file
            const pdfBytes = fs.readFileSync(filePath);
            
            if (pdfBytes.length === 0) {
                console.error(`PDF file is empty: ${filePath}`);
                return null;
            }
            
            // Load PDF document
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const pageCount = pdfDoc.getPageCount();
            
            if (pageCount === 0) {
                console.warn(`PDF has no pages: ${filePath}`);
                return null;
            }
            
            console.log(`Processing PDF with ${pageCount} pages: ${path.basename(filePath)}`);
            
            let fullContent = '';
            let processedPages = 0;
            
            // Process each page
            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
                try {
                    // Create a new PDF document with just this page
                    const singlePagePdf = await PDFDocument.create();
                    const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum - 1]);
                    singlePagePdf.addPage(copiedPage);
                    
                    // Convert to bytes
                    const singlePageBytes = await singlePagePdf.save();
                    
                    // Convert PDF page to markdown
                    const markdownContent = await pdf2md(singlePageBytes);
                    
                    if (markdownContent && Array.isArray(markdownContent) && markdownContent.length > 0) {
                        const pageContent = markdownContent.join('\n').trim();
                        if (pageContent) {
                            // Add page separator and page number
                            fullContent += `\n\n--- Page ${pageNum} ---\n\n${pageContent}\n`;
                            processedPages++;
                        }
                    }
                    
                    // Log progress every 10 pages or on the last page
                    if (pageNum % 10 === 0 || pageNum === pageCount) {
                        console.log(`Processed ${pageNum}/${pageCount} pages`);
                    }
                } catch (pageError) {
                    console.warn(`Failed to process page ${pageNum}:`, pageError);
                    // Continue with other pages even if one fails
                }
            }
            
            if (fullContent.trim()) {
                console.log(`Successfully extracted PDF content: ${fullContent.length} characters from ${processedPages}/${pageCount} pages`);
                return {
                    content: fullContent.trim(),
                    pageCount: pageCount
                };
            } else {
                console.warn(`No content extracted from PDF: ${path.basename(filePath)}`);
                return null;
            }
            
        } catch (error) {
            console.error(`Error extracting PDF content from ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Extract content from document based on file type
     */
    private async extractDocumentContent(document: RAGDocumentEntity): Promise<DocumentContent | null> {
        try {
            const fileExt = path.extname(document.filePath).toLowerCase();
            
            switch (fileExt) {
                case '.txt':
                    const txtContent = fs.readFileSync(document.filePath, 'utf-8');
                    return {
                        content: txtContent,
                        contentType: 'text',
                        originalFormat: 'txt',
                        metadata: {
                            characterCount: txtContent.length,
                            wordCount: txtContent.split(/\s+/).filter(word => word.length > 0).length
                        }
                    };
                
                case '.md':
                    const mdContent = fs.readFileSync(document.filePath, 'utf-8');
                    return {
                        content: mdContent,
                        contentType: 'markdown',
                        originalFormat: 'md',
                        metadata: {
                            characterCount: mdContent.length,
                            wordCount: mdContent.split(/\s+/).filter(word => word.length > 0).length
                        }
                    };
                
                case '.xml':
                case '.json':
                    const xmlJsonContent = fs.readFileSync(document.filePath, 'utf-8');
                    return {
                        content: xmlJsonContent,
                        contentType: 'text',
                        originalFormat: fileExt.substring(1),
                        metadata: {
                            characterCount: xmlJsonContent.length,
                            wordCount: xmlJsonContent.split(/\s+/).filter(word => word.length > 0).length
                        }
                    };
                
                case '.html':
                case '.htm':
                    const htmlContent = fs.readFileSync(document.filePath, 'utf-8');
                    console.log(`Converting HTML file to markdown: ${path.basename(document.filePath)}`);
                    const markdownFromHtml = this.convertHtmlToMarkdown(htmlContent);
                    return {
                        content: markdownFromHtml,
                        contentType: 'markdown',
                        originalFormat: fileExt.substring(1),
                        metadata: {
                            characterCount: markdownFromHtml.length,
                            wordCount: markdownFromHtml.split(/\s+/).filter(word => word.length > 0).length
                        }
                    };
                
                case '.pdf':
                    const pdfResult = await this.extractPdfContent(document.filePath);
                    if (!pdfResult) return null;
                    return {
                        content: pdfResult.content,
                        contentType: 'markdown',
                        originalFormat: 'pdf',
                        metadata: {
                            characterCount: pdfResult.content.length,
                            wordCount: pdfResult.content.split(/\s+/).filter(word => word.length > 0).length,
                            pageCount: pdfResult.pageCount
                        }
                    };
                
                case '.docx':
                    const docxContent = await this.extractDocxContent(document.filePath);
                    if (!docxContent) return null;
                    return {
                        content: docxContent,
                        contentType: 'markdown',
                        originalFormat: 'docx',
                        metadata: {
                            characterCount: docxContent.length,
                            wordCount: docxContent.split(/\s+/).filter(word => word.length > 0).length
                        }
                    };
                
                // case '.doc':
                //     // TODO: Implement DOC text extraction (older format)
                //     console.warn('DOC text extraction not yet implemented');
                //     return null;
                
                // case '.rtf':
                //     // TODO: Implement RTF text extraction
                //     console.warn('RTF text extraction not yet implemented');
                //     return null;
                
                default:
                    console.warn(`Unsupported file type for text extraction: ${fileExt}`);
                    return null;
            }
        } catch (error) {
            console.error('Error extracting document content:', error);
            return null;
        }
    }

    /**
     * Determine the optimal chunking strategy based on content type
     */
    private getOptimalChunkingStrategy(contentType: string, userStrategy: string): string {
        // If user explicitly specified a strategy, respect it (unless it's incompatible)
        if (userStrategy !== 'sentence' && userStrategy !== 'paragraph' && userStrategy !== 'semantic' && userStrategy !== 'fixed') {
            return userStrategy;
        }

        // Choose optimal strategy based on content type
        switch (contentType) {
            case 'markdown':
                return 'markdown'; // Use markdown structure-aware chunking
            case 'html':
                return 'html'; // Use HTML structure-aware chunking
            case 'text':
                // For plain text, use paragraph-based chunking for better semantic coherence
                return userStrategy === 'sentence' ? 'sentence' : 'paragraph';
            case 'pdf':
            case 'docx':
                // For converted documents, use markdown structure if available
                return 'markdown';
            default:
                // Fallback to user strategy or paragraph-based
                return userStrategy || 'paragraph';
        }
    }

    /**
     * Generate chunks based on the specified strategy and content type
     */
    private async generateChunks(content: string, contentType: string, options: ChunkingOptions): Promise<ChunkResult[]> {
        // Determine the best chunking strategy based on content type
        const effectiveStrategy = this.getOptimalChunkingStrategy(contentType, options.strategy);
        
        console.log(`Using chunking strategy: ${effectiveStrategy} for content type: ${contentType}`);
        
        switch (effectiveStrategy) {
            case 'sentence':
                return this.chunkBySentences(content, options);
            case 'paragraph':
                return this.chunkByParagraphs(content, options);
            case 'semantic':
                return this.chunkBySemantic(content, options);
            case 'fixed':
                return this.chunkByFixedSize(content, options);
            case 'markdown':
                return this.chunkByMarkdownStructure(content, options);
            case 'html':
                return this.chunkByHtmlStructure(content, options);
            default:
                throw new Error(`Unsupported chunking strategy: ${effectiveStrategy}`);
        }
    }

    /**
     * Chunk content by sentences
     */
    private chunkBySentences(content: string, options: ChunkingOptions): ChunkResult[] {
        const sentences = this.splitIntoSentences(content);
        const chunks: ChunkResult[] = [];
        let currentChunk = '';
        let startPosition = 0;
        let chunkIndex = 0;

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;
            
            if (this.estimateTokenCount(potentialChunk) > options.chunkSize && currentChunk) {
                // Save current chunk
                chunks.push({
                    content: currentChunk.trim(),
                    startPosition,
                    endPosition: startPosition + currentChunk.length,
                    tokenCount: this.estimateTokenCount(currentChunk)
                });

                // Start new chunk with overlap
                const overlapText = this.getOverlapText(currentChunk, options.overlapSize);
                currentChunk = overlapText + (overlapText ? ' ' : '') + sentence;
                startPosition = startPosition + currentChunk.length - overlapText.length - sentence.length;
                chunkIndex++;
            } else {
                currentChunk = potentialChunk;
            }
        }

        // Add final chunk
        if (currentChunk.trim()) {
            chunks.push({
                content: currentChunk.trim(),
                startPosition,
                endPosition: startPosition + currentChunk.length,
                tokenCount: this.estimateTokenCount(currentChunk)
            });
        }

        return chunks;
    }

    /**
     * Chunk content by paragraphs
     */
    private chunkByParagraphs(content: string, options: ChunkingOptions): ChunkResult[] {
        const paragraphs = content.split(/\n\s*\n/);
        const chunks: ChunkResult[] = [];
        let currentChunk = '';
        let startPosition = 0;

        for (let i = 0; i < paragraphs.length; i++) {
            const paragraph = paragraphs[i].trim();
            if (!paragraph) continue;

            const potentialChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;
            
            if (this.estimateTokenCount(potentialChunk) > options.chunkSize && currentChunk) {
                // Save current chunk
                chunks.push({
                    content: currentChunk.trim(),
                    startPosition,
                    endPosition: startPosition + currentChunk.length,
                    tokenCount: this.estimateTokenCount(currentChunk)
                });

                // Start new chunk with overlap
                const overlapText = this.getOverlapText(currentChunk, options.overlapSize);
                currentChunk = overlapText + (overlapText ? '\n\n' : '') + paragraph;
                startPosition = startPosition + currentChunk.length - overlapText.length - paragraph.length;
            } else {
                currentChunk = potentialChunk;
            }
        }

        // Add final chunk
        if (currentChunk.trim()) {
            chunks.push({
                content: currentChunk.trim(),
                startPosition,
                endPosition: startPosition + currentChunk.length,
                tokenCount: this.estimateTokenCount(currentChunk)
            });
        }

        return chunks;
    }

    /**
     * Chunk content by semantic boundaries (simplified implementation)
     */
    private chunkBySemantic(content: string, options: ChunkingOptions): ChunkResult[] {
        // This is a simplified semantic chunking - in a real implementation,
        // you would use more sophisticated NLP techniques
        const sentences = this.splitIntoSentences(content);
        const chunks: ChunkResult[] = [];
        let currentChunk = '';
        let startPosition = 0;

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;
            
            // Use a more conservative approach for semantic chunking
            const maxSize = options.chunkSize * 0.8; // 80% of max size for semantic chunks
            
            if (this.estimateTokenCount(potentialChunk) > maxSize && currentChunk) {
                // Save current chunk
                chunks.push({
                    content: currentChunk.trim(),
                    startPosition,
                    endPosition: startPosition + currentChunk.length,
                    tokenCount: this.estimateTokenCount(currentChunk)
                });

                // Start new chunk with overlap
                const overlapText = this.getOverlapText(currentChunk, options.overlapSize);
                currentChunk = overlapText + (overlapText ? ' ' : '') + sentence;
                startPosition = startPosition + currentChunk.length - overlapText.length - sentence.length;
            } else {
                currentChunk = potentialChunk;
            }
        }

        // Add final chunk
        if (currentChunk.trim()) {
            chunks.push({
                content: currentChunk.trim(),
                startPosition,
                endPosition: startPosition + currentChunk.length,
                tokenCount: this.estimateTokenCount(currentChunk)
            });
        }

        return chunks;
    }

    /**
     * Chunk content by fixed size
     */
    private chunkByFixedSize(content: string, options: ChunkingOptions): ChunkResult[] {
        const chunks: ChunkResult[] = [];
        const charChunkSize = options.chunkSize * 4; // Rough estimate: 4 chars per token
        const overlapChars = options.overlapSize * 4;

        for (let i = 0; i < content.length; i += charChunkSize - overlapChars) {
            const end = Math.min(i + charChunkSize, content.length);
            const chunkContent = content.slice(i, end);
            
            if (chunkContent.trim().length >= (options.minChunkSize || 0)) {
                chunks.push({
                    content: chunkContent.trim(),
                    startPosition: i,
                    endPosition: end,
                    tokenCount: this.estimateTokenCount(chunkContent)
                });
            }
        }

        return chunks;
    }

    /**
     * Chunk markdown content by structure (headings, paragraphs, lists, etc.)
     */
    private chunkByMarkdownStructure(content: string, options: ChunkingOptions): ChunkResult[] {
        const chunks: ChunkResult[] = [];
        const lines = content.split('\n');
        let currentChunk = '';
        let startPosition = 0;
        let chunkIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
            
            // Check if this line starts a new structural element
            const isHeading = /^#{1,6}\s/.test(line);
            const isListStart = /^[-*+]\s/.test(line) || /^\d+\.\s/.test(line);
            const isCodeBlock = /^```/.test(line);
            const isHorizontalRule = /^---+$/.test(line);
            const isTableRow = /^\|.*\|$/.test(line);
            
            // Check if next line continues the current structure
            const isListContinuation = isListStart && (/^[-*+]\s/.test(nextLine) || /^\d+\.\s/.test(nextLine) || /^\s+[-*+]\s/.test(nextLine));
            const isTableContinuation = isTableRow && /^\|.*\|$/.test(nextLine);
            const isCodeContinuation = isCodeBlock || (currentChunk.includes('```') && !currentChunk.endsWith('```'));
            
            // Add current line to chunk
            const lineWithNewline = i === lines.length - 1 ? line : line + '\n';
            const potentialChunk = currentChunk + lineWithNewline;
            
            // Check if we should break the chunk
            const shouldBreak = this.shouldBreakMarkdownChunk(
                line, nextLine, currentChunk, potentialChunk, options, 
                isHeading, isListStart, isCodeBlock, isHorizontalRule, isTableRow,
                isListContinuation, isTableContinuation, isCodeContinuation
            );
            
            if (shouldBreak && currentChunk.trim()) {
                // Save current chunk
                chunks.push({
                    content: currentChunk.trim(),
                    startPosition,
                    endPosition: startPosition + currentChunk.length,
                    tokenCount: this.estimateTokenCount(currentChunk)
                });
                
                // Start new chunk with overlap
                const overlapText = this.getOverlapText(currentChunk, options.overlapSize);
                currentChunk = overlapText + (overlapText ? '\n' : '') + lineWithNewline;
                startPosition = startPosition + currentChunk.length - overlapText.length - lineWithNewline.length;
                chunkIndex++;
            } else {
                currentChunk = potentialChunk;
            }
        }

        // Add final chunk
        if (currentChunk.trim()) {
            chunks.push({
                content: currentChunk.trim(),
                startPosition,
                endPosition: startPosition + currentChunk.length,
                tokenCount: this.estimateTokenCount(currentChunk)
            });
        }

        return chunks;
    }

    /**
     * Determine if a markdown chunk should be broken
     */
    private shouldBreakMarkdownChunk(
        line: string, nextLine: string, currentChunk: string, potentialChunk: string, options: ChunkingOptions,
        isHeading: boolean, isListStart: boolean, isCodeBlock: boolean, isHorizontalRule: boolean, isTableRow: boolean,
        isListContinuation: boolean, isTableContinuation: boolean, isCodeContinuation: boolean
    ): boolean {
        const currentTokenCount = this.estimateTokenCount(currentChunk);
        const potentialTokenCount = this.estimateTokenCount(potentialChunk);
        
        // Break on horizontal rules (page separators) - highest priority
        if (isHorizontalRule) {
            return true;
        }
        
        // CRITICAL: Always break if chunk size exceeds limit, regardless of structural considerations
        // This ensures we never create chunks that exceed the specified size
        if (potentialTokenCount > options.chunkSize) {
            return true;
        }
        
        // Don't break in the middle of code blocks (unless size limit is exceeded)
        if (isCodeContinuation && potentialTokenCount <= options.chunkSize) {
            return false;
        }
        
        // Don't break in the middle of tables (unless size limit is exceeded)
        if (isTableContinuation && potentialTokenCount <= options.chunkSize) {
            return false;
        }
        
        // Break on major structural elements if chunk is getting large (but not if it would exceed size limit)
        if (isHeading && currentTokenCount > options.chunkSize * 0.7 && potentialTokenCount <= options.chunkSize) {
            return true;
        }
        
        // Don't break in the middle of lists (unless size limit is exceeded)
        if (isListContinuation && potentialTokenCount <= options.chunkSize) {
            return false;
        }
        
        return false;
    }

    /**
     * Chunk HTML content by structure (tags, elements, etc.)
     */
    private chunkByHtmlStructure(content: string, options: ChunkingOptions): ChunkResult[] {
        // For HTML content, we'll use a simplified approach that respects HTML structure
        // This is a basic implementation - in production, you might want to use a proper HTML parser
        
        const chunks: ChunkResult[] = [];
        const lines = content.split('\n');
        let currentChunk = '';
        let startPosition = 0;
        let inTag = false;
        let tagDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineWithNewline = i === lines.length - 1 ? line : line + '\n';
            
            // Simple HTML tag detection
            const openTags = (line.match(/<[^/][^>]*>/g) || []).length;
            const closeTags = (line.match(/<\/[^>]*>/g) || []).length;
            tagDepth += openTags - closeTags;
            
            const potentialChunk = currentChunk + lineWithNewline;
            
            // Break on major HTML elements if chunk is getting large
            const isMajorElement = /<(h[1-6]|div|section|article|header|footer|main|nav|aside)/i.test(line);
            const isChunkTooLarge = this.estimateTokenCount(potentialChunk) > options.chunkSize;
            const isEndOfElement = tagDepth === 0 && currentChunk.trim().length > 0;
            
            if ((isMajorElement || isChunkTooLarge || isEndOfElement) && currentChunk.trim()) {
                // Save current chunk
                chunks.push({
                    content: currentChunk.trim(),
                    startPosition,
                    endPosition: startPosition + currentChunk.length,
                    tokenCount: this.estimateTokenCount(currentChunk)
                });
                
                // Start new chunk with overlap
                const overlapText = this.getOverlapText(currentChunk, options.overlapSize);
                currentChunk = overlapText + (overlapText ? '\n' : '') + lineWithNewline;
                startPosition = startPosition + currentChunk.length - overlapText.length - lineWithNewline.length;
            } else {
                currentChunk = potentialChunk;
            }
        }

        // Add final chunk
        if (currentChunk.trim()) {
            chunks.push({
                content: currentChunk.trim(),
                startPosition,
                endPosition: startPosition + currentChunk.length,
                tokenCount: this.estimateTokenCount(currentChunk)
            });
        }

        return chunks;
    }

    /**
     * Split text into sentences
     */
    private splitIntoSentences(text: string): string[] {
        // Simple sentence splitting - in production, use a proper NLP library
        return text
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    /**
     * Get overlap text from the end of a chunk
     */
    private getOverlapText(text: string, overlapSize: number): string {
        const words = text.split(/\s+/);
        const overlapWords = Math.floor(overlapSize / 4); // Rough estimate
        return words.slice(-overlapWords).join(' ');
    }

    /**
     * Estimate token count (rough approximation)
     */
    private estimateTokenCount(text: string): number {
        // Rough estimation: 1 token ≈ 4 characters for English text
        return Math.ceil(text.length / 4);
    }

    /**
     * Generate content hash for deduplication
     */
    private generateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Get chunks for a document
     */
    async getDocumentChunks(documentId: number): Promise<RAGChunkEntity[]> {
        return await this.ragChunkModule.getDocumentChunks(documentId);
    }

    /**
     * Delete chunks for a document
     */
    async deleteDocumentChunks(documentId: number): Promise<void> {
        await this.ragChunkModule.deleteDocumentChunks(documentId);
    }

    /**
     * Get chunk statistics
     */
    async getChunkStats(documentId?: number): Promise<{
        totalChunks: number;
        averageChunkSize: number;
        totalTokens: number;
    }> {
        return await this.ragChunkModule.getChunkStats(documentId);
    }
}
