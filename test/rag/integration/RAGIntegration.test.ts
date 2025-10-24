import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { RAGModule } from '@/modules/rag/RAGModule';
import { SqliteDb } from '@/config/SqliteDb';
import { DocumentService } from '@/service/DocumentService';
import { ChunkingService } from '@/service/ChunkingService';
import { RagSearchController } from '@/controller/RagSearchController';
import * as path from 'path';
import * as fs from 'fs';

describe('RAG Integration Tests', () => {
    let ragModule: RAGModule;
    let documentService: DocumentService;
    let chunkingService: ChunkingService;
    let searchController: RagSearchController;
    let db: SqliteDb;
    let testDbPath: string;

    before(async () => {
        // Create test database
        testDbPath = path.join(__dirname, 'test-rag-integration.db');
        db = SqliteDb.getInstance(testDbPath);
        
        if (!db.connection.isInitialized) {
            await db.connection.initialize();
        }
        
        ragModule = new RAGModule();
        documentService = new DocumentService();
        chunkingService = new ChunkingService();
        searchController = new RagSearchController();
    });

    after(async () => {
        // Clean up test database
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(async () => {
        // Clean up before each test
        const docRepository = db.connection.getRepository(require('@/entity/RAGDocument.entity').RAGDocumentEntity);
        const chunkRepository = db.connection.getRepository(require('@/entity/RAGChunk.entity').RAGChunkEntity);
        await docRepository.clear();
        await chunkRepository.clear();
    });

    describe('End-to-End RAG Pipeline', () => {
        it('should complete full RAG workflow', async () => {
            // Step 1: Upload a document
            const testFilePath = path.join(__dirname, 'test-integration-doc.txt');
            const testContent = `
            Artificial Intelligence (AI) is a branch of computer science that aims to create intelligent machines.
            Machine Learning is a subset of AI that focuses on algorithms that can learn from data.
            Deep Learning is a subset of machine learning that uses neural networks with multiple layers.
            Natural Language Processing (NLP) is a field of AI that focuses on the interaction between computers and human language.
            `;
            
            fs.writeFileSync(testFilePath, testContent);

            try {
                // Upload document
                const uploadResult = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-integration-doc.txt',
                    title: 'AI and Machine Learning Overview',
                    description: 'A comprehensive overview of AI, ML, and related technologies',
                    tags: ['ai', 'machine-learning', 'deep-learning', 'nlp'],
                    author: 'Integration Test'
                });

                expect(uploadResult).to.not.be.null;
                expect(uploadResult.name).to.equal('test-integration-doc.txt');
                expect(uploadResult.status).to.equal('active');

                // Step 2: Chunk the document
                const chunks = await chunkingService.chunkDocument(uploadResult);
                expect(chunks).to.be.an('array');
                expect(chunks.length).to.be.greaterThan(0);

                // Verify chunks are stored in database
                const chunkRepository = db.connection.getRepository(require('@/entity/RAGChunk.entity').RAGChunkEntity);
                const storedChunks = await chunkRepository.find({
                    where: { documentId: uploadResult.id }
                });
                expect(storedChunks).to.have.length(chunks.length);

                // Step 3: Test document retrieval
                const retrievedDoc = await documentService.findDocumentById(uploadResult.id);
                expect(retrievedDoc).to.not.be.null;
                expect(retrievedDoc!.id).to.equal(uploadResult.id);

                // Step 4: Test document statistics
                const docStats = await documentService.getDocumentStats();
                expect(docStats.total).to.be.greaterThan(0);
                expect(docStats.byStatus.active).to.be.greaterThan(0);

                // Step 5: Test chunk statistics
                const chunkStats = await chunkingService.getChunkStats();
                expect(chunkStats.totalChunks).to.be.greaterThan(0);
                expect(chunkStats.averageChunkSize).to.be.greaterThan(0);

            } finally {
                // Clean up test file
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });

        it('should handle multiple document uploads', async () => {
            const testFiles = [
                {
                    name: 'ai-basics.txt',
                    content: 'Artificial Intelligence is the simulation of human intelligence in machines.'
                },
                {
                    name: 'ml-fundamentals.txt',
                    content: 'Machine Learning enables computers to learn without being explicitly programmed.'
                },
                {
                    name: 'dl-advanced.txt',
                    content: 'Deep Learning uses neural networks with multiple layers to process data.'
                }
            ];

            const uploadedDocs: any[] = [];

            try {
                // Upload multiple documents
                for (const file of testFiles) {
                    const filePath = path.join(__dirname, file.name);
                    fs.writeFileSync(filePath, file.content);
                    
                    const doc = await documentService.uploadDocument({
                        filePath,
                        name: file.name,
                        title: file.name.replace('.txt', ''),
                        tags: ['ai', 'test']
                    });
                    
                    uploadedDocs.push(doc);
                }

                // Verify all documents are uploaded
                expect(uploadedDocs).to.have.length(3);

                // Test document listing
                const allDocs = await documentService.getDocuments();
                expect(allDocs).to.have.length(3);

                // Test filtering by tags
                const aiDocs = await documentService.getDocuments({ tags: ['ai'] });
                expect(aiDocs).to.have.length(3);

                // Test document search by name
                const mlDoc = await documentService.getDocuments({ name: 'ml-fundamentals' });
                expect(mlDoc).to.have.length(1);
                expect(mlDoc[0].name).to.equal('ml-fundamentals.txt');

            } finally {
                // Clean up test files
                for (const file of testFiles) {
                    const filePath = path.join(__dirname, file.name);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        });

        it('should handle document updates and deletions', async () => {
            const testFilePath = path.join(__dirname, 'test-update-delete.txt');
            fs.writeFileSync(testFilePath, 'Original content');

            try {
                // Upload document
                const doc = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-update-delete.txt'
                });

                // Update document metadata
                await documentService.updateDocumentMetadata(doc.id, {
                    title: 'Updated Title',
                    description: 'Updated description',
                    tags: ['updated', 'test']
                });

                // Verify update
                const updatedDoc = await documentService.findDocumentById(doc.id);
                expect(updatedDoc!.title).to.equal('Updated Title');
                expect(updatedDoc!.description).to.equal('Updated description');

                // Update document status
                await documentService.updateDocumentStatus(doc.id, 'archived', 'completed');
                const archivedDoc = await documentService.findDocumentById(doc.id);
                expect(archivedDoc!.status).to.equal('archived');
                expect(archivedDoc!.processingStatus).to.equal('completed');

                // Delete document
                await documentService.deleteDocument(doc.id, false);
                const deletedDoc = await documentService.findDocumentById(doc.id);
                expect(deletedDoc).to.be.null;

            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });
    });

    describe('Chunking Integration', () => {
        it('should chunk different types of content', async () => {
            const testCases = [
                {
                    name: 'short-text.txt',
                    content: 'This is a short text.',
                    expectedChunks: 1
                },
                {
                    name: 'long-text.txt',
                    content: 'This is a very long text that should be split into multiple chunks. '.repeat(100),
                    expectedChunks: 3
                },
                {
                    name: 'structured-text.txt',
                    content: `
                    Chapter 1: Introduction
                    This is the introduction chapter.
                    
                    Chapter 2: Main Content
                    This is the main content chapter.
                    
                    Chapter 3: Conclusion
                    This is the conclusion chapter.
                    `,
                    expectedChunks: 3
                }
            ];

            for (const testCase of testCases) {
                const filePath = path.join(__dirname, testCase.name);
                fs.writeFileSync(filePath, testCase.content);

                try {
                    const doc = await documentService.uploadDocument({
                        filePath,
                        name: testCase.name
                    });

                    const chunks = await chunkingService.chunkDocument(doc);
                    expect(chunks).to.be.an('array');
                    expect(chunks.length).to.be.greaterThan(0);

                    // Verify chunks are properly stored
                    const chunkRepository = db.connection.getRepository(require('@/entity/RAGChunk.entity').RAGChunkEntity);
                    const storedChunks = await chunkRepository.find({
                        where: { documentId: doc.id }
                    });
                    expect(storedChunks).to.have.length(chunks.length);

                    // Verify chunk content
                    for (let i = 0; i < chunks.length; i++) {
                        expect(chunks[i].content).to.be.a('string');
                        expect(chunks[i].content.length).to.be.greaterThan(0);
                        expect(chunks[i].chunkIndex).to.equal(i);
                        expect(chunks[i].documentId).to.equal(doc.id);
                    }

                } finally {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        });

        it('should handle chunking errors gracefully', async () => {
            const testFilePath = path.join(__dirname, 'empty-file.txt');
            fs.writeFileSync(testFilePath, '');

            try {
                const doc = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'empty-file.txt'
                });

                // Empty file should still create at least one chunk
                const chunks = await chunkingService.chunkDocument(doc);
                expect(chunks).to.be.an('array');
                expect(chunks.length).to.be.greaterThan(0);

            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });
    });

    describe('Database Consistency', () => {
        it('should maintain referential integrity', async () => {
            const testFilePath = path.join(__dirname, 'referential-integrity.txt');
            fs.writeFileSync(testFilePath, 'Test content for referential integrity');

            try {
                // Upload document
                const doc = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'referential-integrity.txt'
                });

                // Create chunks
                const chunks = await chunkingService.chunkDocument(doc);

                // Verify document-chunk relationship
                const chunkRepository = db.connection.getRepository(require('@/entity/RAGChunk.entity').RAGChunkEntity);
                const storedChunks = await chunkRepository.find({
                    where: { documentId: doc.id }
                });

                expect(storedChunks).to.have.length(chunks.length);
                for (const chunk of storedChunks) {
                    expect(chunk.documentId).to.equal(doc.id);
                }

                // Delete document and verify chunks are also deleted (CASCADE)
                await documentService.deleteDocument(doc.id, false);
                
                const remainingChunks = await chunkRepository.find({
                    where: { documentId: doc.id }
                });
                expect(remainingChunks).to.have.length(0);

            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });

        it('should handle concurrent operations', async () => {
            const testFiles = Array.from({ length: 5 }, (_, i) => ({
                name: `concurrent-test-${i}.txt`,
                content: `Test content for concurrent operation ${i}`
            }));

            try {
                // Create test files
                for (const file of testFiles) {
                    const filePath = path.join(__dirname, file.name);
                    fs.writeFileSync(filePath, file.content);
                }

                // Upload documents concurrently
                const uploadPromises = testFiles.map(file => 
                    documentService.uploadDocument({
                        filePath: path.join(__dirname, file.name),
                        name: file.name
                    })
                );

                const uploadedDocs = await Promise.all(uploadPromises);
                expect(uploadedDocs).to.have.length(5);

                // Verify all documents are in database
                const allDocs = await documentService.getDocuments();
                expect(allDocs).to.have.length(5);

                // Chunk documents concurrently
                const chunkPromises = uploadedDocs.map(doc => 
                    chunkingService.chunkDocument(doc)
                );

                const chunkResults = await Promise.all(chunkPromises);
                expect(chunkResults).to.have.length(5);

                // Verify all chunks are created
                const chunkRepository = db.connection.getRepository(require('@/entity/RAGChunk.entity').RAGChunkEntity);
                const allChunks = await chunkRepository.find();
                expect(allChunks.length).to.be.greaterThan(0);

            } finally {
                // Clean up test files
                for (const file of testFiles) {
                    const filePath = path.join(__dirname, file.name);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        });
    });
});
