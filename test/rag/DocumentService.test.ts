import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { DocumentService } from '@/service/DocumentService';
import { SqliteDb } from '@/config/SqliteDb';
import * as path from 'path';
import * as fs from 'fs';

describe('DocumentService', () => {
    let documentService: DocumentService;
    let db: SqliteDb;
    let testDbPath: string;

    before(async () => {
        // Create test database
        testDbPath = path.join(__dirname, 'test-rag.db');
        db = SqliteDb.getInstance(testDbPath);
        
        if (!db.connection.isInitialized) {
            await db.connection.initialize();
        }
        
        documentService = new DocumentService();
    });

    after(async () => {
        // Clean up test database
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    beforeEach(async () => {
        // Clean up before each test
        const repository = db.connection.getRepository(require('@/entity/RAGDocument.entity').RAGDocumentEntity);
        await repository.clear();
    });

    describe('uploadDocument', () => {
        it('should upload a document successfully', async () => {
            const testFilePath = path.join(__dirname, 'test-document.txt');
            
            // Create test file
            fs.writeFileSync(testFilePath, 'This is a test document content.');
            
            try {
                const document = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-document.txt',
                    title: 'Test Document',
                    description: 'A test document for unit testing',
                    tags: ['test', 'unit'],
                    author: 'Test Author'
                });

                expect(document).to.not.be.null;
                expect(document.name).to.equal('test-document.txt');
                expect(document.title).to.equal('Test Document');
                expect(document.fileType).to.equal('txt');
                expect(document.status).to.equal('active');
            } finally {
                // Clean up test file
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });

        it('should handle file not found error', async () => {
            const nonExistentPath = path.join(__dirname, 'non-existent-file.txt');
            
            try {
                await documentService.uploadDocument({
                    filePath: nonExistentPath,
                    name: 'non-existent.txt'
                });
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).to.be.an('error');
                expect((error as Error).message).to.include('File not found');
            }
        });

        it('should validate file type', async () => {
            const testFilePath = path.join(__dirname, 'test-document.xyz');
            
            // Create test file with unsupported extension
            fs.writeFileSync(testFilePath, 'Test content');
            
            try {
                await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-document.xyz'
                });
                expect.fail('Should have thrown an error for unsupported file type');
            } catch (error) {
                expect(error).to.be.an('error');
                expect((error as Error).message).to.include('Unsupported file type');
            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });
    });

    describe('findDocumentById', () => {
        it('should find document by ID', async () => {
            // First upload a document
            const testFilePath = path.join(__dirname, 'test-document.txt');
            fs.writeFileSync(testFilePath, 'Test content');
            
            try {
                const uploadedDoc = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-document.txt'
                });

                const foundDoc = await documentService.findDocumentById(uploadedDoc.id);
                
                expect(foundDoc).to.not.be.null;
                expect(foundDoc!.id).to.equal(uploadedDoc.id);
                expect(foundDoc!.name).to.equal('test-document.txt');
            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });

        it('should return null for non-existent document', async () => {
            const foundDoc = await documentService.findDocumentById(99999);
            expect(foundDoc).to.be.null;
        });
    });

    describe('updateDocumentStatus', () => {
        it('should update document status', async () => {
            // First upload a document
            const testFilePath = path.join(__dirname, 'test-document.txt');
            fs.writeFileSync(testFilePath, 'Test content');
            
            try {
                const uploadedDoc = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-document.txt'
                });

                await documentService.updateDocumentStatus(
                    uploadedDoc.id,
                    'archived',
                    'completed'
                );

                const updatedDoc = await documentService.findDocumentById(uploadedDoc.id);
                expect(updatedDoc!.status).to.equal('archived');
                expect(updatedDoc!.processingStatus).to.equal('completed');
            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });
    });

    describe('deleteDocument', () => {
        it('should delete document from database', async () => {
            // First upload a document
            const testFilePath = path.join(__dirname, 'test-document.txt');
            fs.writeFileSync(testFilePath, 'Test content');
            
            try {
                const uploadedDoc = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-document.txt'
                });

                await documentService.deleteDocument(uploadedDoc.id, false);

                const deletedDoc = await documentService.findDocumentById(uploadedDoc.id);
                expect(deletedDoc).to.be.null;
            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });

        it('should delete document and file when deleteFile is true', async () => {
            const testFilePath = path.join(__dirname, 'test-document-delete.txt');
            fs.writeFileSync(testFilePath, 'Test content');
            
            const uploadedDoc = await documentService.uploadDocument({
                filePath: testFilePath,
                name: 'test-document-delete.txt'
            });

            await documentService.deleteDocument(uploadedDoc.id, true);

            // Check that file is deleted
            expect(fs.existsSync(testFilePath)).to.be.false;

            // Check that document is deleted from database
            const deletedDoc = await documentService.findDocumentById(uploadedDoc.id);
            expect(deletedDoc).to.be.null;
        });
    });

    describe('getDocumentStats', () => {
        it('should return correct statistics', async () => {
            // Upload some test documents
            const testFiles = [
                { name: 'doc1.txt', content: 'Content 1' },
                { name: 'doc2.pdf', content: 'Content 2' },
                { name: 'doc3.html', content: 'Content 3' }
            ];

            for (const file of testFiles) {
                const filePath = path.join(__dirname, file.name);
                fs.writeFileSync(filePath, file.content);
                
                await documentService.uploadDocument({
                    filePath,
                    name: file.name
                });
            }

            try {
                const stats = await documentService.getDocumentStats();
                
                expect(stats.total).to.equal(3);
                expect(stats.byStatus).to.have.property('active', 3);
                expect(stats.byFileType).to.have.property('txt', 1);
                expect(stats.byFileType).to.have.property('pdf', 1);
                expect(stats.byFileType).to.have.property('html', 1);
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

    describe('getDocuments', () => {
        it('should return all documents when no filters provided', async () => {
            // Upload test documents
            const testFiles = [
                { name: 'doc1.txt', content: 'Content 1' },
                { name: 'doc2.txt', content: 'Content 2' }
            ];

            for (const file of testFiles) {
                const filePath = path.join(__dirname, file.name);
                fs.writeFileSync(filePath, file.content);
                
                await documentService.uploadDocument({
                    filePath,
                    name: file.name
                });
            }

            try {
                const documents = await documentService.getDocuments();
                expect(documents).to.have.length(2);
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

        it('should filter documents by status', async () => {
            // Upload test documents
            const testFilePath = path.join(__dirname, 'test-document.txt');
            fs.writeFileSync(testFilePath, 'Test content');
            
            try {
                const uploadedDoc = await documentService.uploadDocument({
                    filePath: testFilePath,
                    name: 'test-document.txt'
                });

                // Update one document to archived status
                await documentService.updateDocumentStatus(uploadedDoc.id, 'archived');

                const activeDocs = await documentService.getDocuments({ status: 'active' });
                const archivedDocs = await documentService.getDocuments({ status: 'archived' });

                expect(activeDocs).to.have.length(0);
                expect(archivedDocs).to.have.length(1);
            } finally {
                if (fs.existsSync(testFilePath)) {
                    fs.unlinkSync(testFilePath);
                }
            }
        });
    });
});
