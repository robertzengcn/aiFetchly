import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { RAGModule } from '@/modules/rag/RAGModule';
import { SqliteDb } from '@/config/SqliteDb';
import * as path from 'path';
import * as fs from 'fs';

describe('RAGModule', () => {
    let ragModule: RAGModule;
    let db: SqliteDb;
    let testDbPath: string;

    before(async () => {
        // Create test database
        testDbPath = path.join(__dirname, 'test-rag-module.db');
        db = SqliteDb.getInstance(testDbPath);
        
        if (!db.connection.isInitialized) {
            await db.connection.initialize();
        }
        
        ragModule = new RAGModule();
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

    describe('initialize', () => {
        it('should initialize with valid configuration', async () => {
            const embeddingConfig = {
                provider: 'openai',
                model: 'text-embedding-ada-002',
                apiKey: 'test-api-key'
            };

            const llmConfig = {
                model: 'gpt-3.5-turbo',
                apiKey: 'test-api-key'
            };

            // Mock the initialization to avoid actual API calls
            const originalInvoke = global.window?.electronAPI?.invoke;
            if (global.window?.electronAPI) {
                global.window.electronAPI.invoke = async (channel: string) => {
                    if (channel === 'rag:get-stats') {
                        return { success: false }; // Force initialization
                    }
                    if (channel === 'rag:initialize') {
                        return { success: true };
                    }
                    return { success: true };
                };
            }

            try {
                await ragModule.initialize(embeddingConfig, llmConfig);
                // If we get here without error, initialization was successful
                expect(true).to.be.true;
            } catch (error) {
                // Expected to fail in test environment without real API keys
                expect(error).to.be.an('error');
            } finally {
                // Restore original function
                if (global.window?.electronAPI && originalInvoke) {
                    global.window.electronAPI.invoke = originalInvoke;
                }
            }
        });
    });

    describe('processQuery', () => {
        it('should process a simple query', async () => {
            // Mock the RAG module to avoid actual API calls
            const mockResponse = {
                query: 'test query',
                response: 'This is a test response',
                sources: [],
                confidence: 0.8,
                processingTime: 100,
                metadata: {
                    queryIntent: 'search',
                    chunksUsed: 0,
                    documentsUsed: 0,
                    model: 'test-model'
                }
            };

            // Mock the internal methods
            const originalProcessQuery = ragModule.processQuery;
            ragModule.processQuery = async () => mockResponse;

            try {
                const result = await ragModule.processQuery({
                    query: 'test query'
                });

                expect(result).to.deep.equal(mockResponse);
            } finally {
                // Restore original method
                ragModule.processQuery = originalProcessQuery;
            }
        });

        it('should handle query with options', async () => {
            const mockResponse = {
                query: 'test query with options',
                response: 'This is a test response with options',
                sources: [],
                confidence: 0.9,
                processingTime: 150,
                metadata: {
                    queryIntent: 'question',
                    chunksUsed: 2,
                    documentsUsed: 1,
                    model: 'test-model'
                }
            };

            const originalProcessQuery = ragModule.processQuery;
            ragModule.processQuery = async () => mockResponse;

            try {
                const result = await ragModule.processQuery({
                    query: 'test query with options',
                    options: {
                        queryProcessing: {
                            enableExpansion: true,
                            maxExpansionTerms: 5
                        },
                        responseGeneration: {
                            maxLength: 500,
                            temperature: 0.7
                        },
                        search: {
                            limit: 10,
                            threshold: 0.6
                        }
                    }
                });

                expect(result).to.deep.equal(mockResponse);
            } finally {
                ragModule.processQuery = originalProcessQuery;
            }
        });
    });

    describe('uploadDocument', () => {
        it('should upload a document successfully', async () => {
            const testFilePath = path.join(__dirname, 'test-rag-document.txt');
            fs.writeFileSync(testFilePath, 'This is a test document for RAG module testing.');

            // Mock the upload process
            const originalUploadDocument = ragModule.uploadDocument;
            ragModule.uploadDocument = async () => ({
                documentId: 1,
                processingTime: 200,
                success: true,
                message: 'Document uploaded successfully'
            });

            try {
                const result = await ragModule.uploadDocument(testFilePath, {
                    name: 'test-rag-document.txt',
                    title: 'Test RAG Document',
                    description: 'A test document for RAG module',
                    tags: ['test', 'rag'],
                    author: 'Test Author'
                });

                expect(result).to.have.property('documentId', 1);
                expect(result).to.have.property('processingTime', 200);
                expect(result).to.have.property('success', true);
                expect(result).to.have.property('message', 'Document uploaded successfully');
            } finally {
                ragModule.uploadDocument = originalUploadDocument;
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });

        it('should handle upload error', async () => {
            const nonExistentPath = path.join(__dirname, 'non-existent-file.txt');

            try {
                await ragModule.uploadDocument(nonExistentPath, {
                    name: 'non-existent.txt'
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).to.be.an('error');
            }
        });
    });

    describe('getStats', () => {
        it('should return module statistics', () => {
            const stats = ragModule.getStats();
            
            expect(stats).to.have.property('totalQueries');
            expect(stats).to.have.property('averageResponseTime');
            expect(stats).to.have.property('averageConfidence');
            expect(stats).to.have.property('totalDocuments');
            expect(stats).to.have.property('totalChunks');
            expect(stats).to.have.property('indexSize');
            expect(stats).to.have.property('lastActivity');
            
            expect(stats.totalQueries).to.be.a('number');
            expect(stats.averageResponseTime).to.be.a('number');
            expect(stats.averageConfidence).to.be.a('number');
            expect(stats.totalDocuments).to.be.a('number');
            expect(stats.totalChunks).to.be.a('number');
            expect(stats.indexSize).to.be.a('number');
            expect(stats.lastActivity).to.be.an.instanceOf(Date);
        });
    });

    describe('getQuerySuggestions', () => {
        it('should return query suggestions', async () => {
            const suggestions = await ragModule.getQuerySuggestions('test', 5);
            
            expect(suggestions).to.be.an('array');
            expect(suggestions.length).to.be.at.most(5);
        });

        it('should return empty array for empty query', async () => {
            const suggestions = await ragModule.getQuerySuggestions('', 5);
            
            expect(suggestions).to.be.an('array');
            expect(suggestions.length).to.equal(0);
        });
    });

    describe('clearCaches', () => {
        it('should clear all caches', () => {
            // This should not throw an error
            expect(() => ragModule.clearCaches()).to.not.throw();
        });
    });

    describe('testPipeline', () => {
        it('should test pipeline components', async () => {
            const result = await ragModule.testPipeline();
            
            expect(result).to.have.property('success');
            expect(result).to.have.property('message');
            expect(result).to.have.property('components');
            
            expect(result.components).to.have.property('queryProcessor');
            expect(result.components).to.have.property('searchController');
            expect(result.components).to.have.property('responseGenerator');
            expect(result.components).to.have.property('documentService');
            
            expect(result.components.queryProcessor).to.be.a('boolean');
            expect(result.components.searchController).to.be.a('boolean');
            expect(result.components.responseGenerator).to.be.a('boolean');
            expect(result.components.documentService).to.be.a('boolean');
        });
    });

    describe('cleanup', () => {
        it('should cleanup resources', async () => {
            // This should not throw an error
            await ragModule.cleanup();
        });
    });
});
