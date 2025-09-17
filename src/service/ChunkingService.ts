import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { SqliteDb } from '@/config/SqliteDb';
import * as crypto from 'crypto';

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

export class ChunkingService {
    private db: SqliteDb;
    private readonly defaultOptions: ChunkingOptions = {
        chunkSize: 1000,
        overlapSize: 200,
        strategy: 'sentence',
        preserveWhitespace: true,
        minChunkSize: 100
    };

    constructor(db: SqliteDb) {
        this.db = db;
    }

    /**
     * Chunk document content into smaller pieces
     */
    async chunkDocument(document: RAGDocumentEntity, options?: Partial<ChunkingOptions>): Promise<RAGChunkEntity[]> {
        const chunkingOptions = { ...this.defaultOptions, ...options };
        
        // Read document content
        const content = await this.extractDocumentContent(document);
        if (!content) {
            throw new Error('Unable to extract content from document');
        }

        // Generate chunks based on strategy
        const chunks = await this.generateChunks(content, chunkingOptions);
        
        // Save chunks to database
        const chunkEntities: RAGChunkEntity[] = [];
        const repository = this.db.connection.getRepository(RAGChunkEntity);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const contentHash = this.generateContentHash(chunk.content);

            // Check for duplicate chunks
            const existingChunk = await repository.findOne({
                where: { contentHash, documentId: document.id }
            });

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

            const savedChunk = await repository.save(chunkEntity);
            chunkEntities.push(savedChunk);
        }

        return chunkEntities;
    }

    /**
     * Extract content from document based on file type
     */
    private async extractDocumentContent(document: RAGDocumentEntity): Promise<string | null> {
        try {
            const fs = await import('fs');
            const path = await import('path');
            
            const fileExt = path.extname(document.filePath).toLowerCase();
            
            switch (fileExt) {
                case '.txt':
                case '.md':
                case '.html':
                case '.htm':
                case '.xml':
                case '.json':
                    return fs.readFileSync(document.filePath, 'utf-8');
                
                case '.pdf':
                    // TODO: Implement PDF text extraction
                    // For now, return null to indicate unsupported format
                    console.warn('PDF text extraction not yet implemented');
                    return null;
                
                case '.doc':
                case '.docx':
                    // TODO: Implement DOC/DOCX text extraction
                    console.warn('DOC/DOCX text extraction not yet implemented');
                    return null;
                
                case '.rtf':
                    // TODO: Implement RTF text extraction
                    console.warn('RTF text extraction not yet implemented');
                    return null;
                
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
     * Generate chunks based on the specified strategy
     */
    private async generateChunks(content: string, options: ChunkingOptions): Promise<ChunkResult[]> {
        switch (options.strategy) {
            case 'sentence':
                return this.chunkBySentences(content, options);
            case 'paragraph':
                return this.chunkByParagraphs(content, options);
            case 'semantic':
                return this.chunkBySemantic(content, options);
            case 'fixed':
                return this.chunkByFixedSize(content, options);
            default:
                throw new Error(`Unsupported chunking strategy: ${options.strategy}`);
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
        const repository = this.db.connection.getRepository(RAGChunkEntity);
        return await repository.find({
            where: { documentId },
            order: { chunkIndex: 'ASC' }
        });
    }

    /**
     * Delete chunks for a document
     */
    async deleteDocumentChunks(documentId: number): Promise<void> {
        const repository = this.db.connection.getRepository(RAGChunkEntity);
        await repository.delete({ documentId });
    }

    /**
     * Get chunk statistics
     */
    async getChunkStats(documentId?: number): Promise<{
        totalChunks: number;
        averageChunkSize: number;
        totalTokens: number;
    }> {
        const repository = this.db.connection.getRepository(RAGChunkEntity);
        const queryBuilder = repository.createQueryBuilder('chunk');

        if (documentId) {
            queryBuilder.where('chunk.documentId = :documentId', { documentId });
        }

        const chunks = await queryBuilder.getMany();
        
        const totalChunks = chunks.length;
        const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
        const averageChunkSize = totalChunks > 0 ? totalTokens / totalChunks : 0;

        return {
            totalChunks,
            averageChunkSize,
            totalTokens
        };
    }
}
