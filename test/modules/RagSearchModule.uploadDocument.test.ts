import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { RagSearchModule } from "@/modules/RagSearchModule";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";
import { DocumentUploadOptions } from "@/modules/RAGDocumentModule";

interface TestableRagSearchModule {
  uploadDocument(options: DocumentUploadOptions): Promise<unknown>;
  checkAndSetDefaultEmbeddingModel(): Promise<void>;
  systemSettingModule: {
    getDefaultEmbeddingModel(): Promise<{ modelName: string; dimension: number } | null>;
  };
  documentService: {
    uploadDocument(options: DocumentUploadOptions): Promise<RAGDocumentEntity>;
    updateDocumentStatus(
      id: number,
      status: string,
      processingStatus?: string
    ): Promise<void>;
    findDocumentByPath(filePath: string): Promise<RAGDocumentEntity | null>;
    saveErrorLog(
      documentId: number,
      error: Error | string,
      context?: string
    ): Promise<string>;
  };
  chunkingService: {
    chunkDocument(document: RAGDocumentEntity): Promise<RAGChunkEntity[]>;
  };
}

describe("RagSearchModule.uploadDocument", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("marks the created document as failed when embedding generation fails after staging", async () => {
    const uploadOptions: DocumentUploadOptions = {
      filePath: "/external/source.pdf",
      name: "source.pdf",
    };
    const savedDocument = Object.assign(new RAGDocumentEntity(), {
      id: 42,
      name: "source.pdf",
      filePath: "/app/rag_uploads/staged.pdf",
      fileType: ".pdf",
      fileSize: 10,
      status: "active",
      processingStatus: "pending",
      uploadedAt: new Date(),
    });
    const chunk = Object.assign(new RAGChunkEntity(), {
      id: 7,
      documentId: 42,
      content: "hello",
      chunkIndex: 0,
    });

    const updateDocumentStatus = sinon.stub().resolves();
    const saveErrorLog = sinon.stub().resolves("/tmp/error.log");
    const moduleUnderTest = Object.create(
      RagSearchModule.prototype
    ) as TestableRagSearchModule;

    Object.assign(moduleUnderTest, {
      checkAndSetDefaultEmbeddingModel: sinon.stub().resolves(),
      systemSettingModule: {
        getDefaultEmbeddingModel: sinon
          .stub()
          .resolves({ modelName: "embedding-model", dimension: 1536 }),
      },
      documentService: {
        uploadDocument: sinon.stub().resolves(savedDocument),
        updateDocumentStatus,
        findDocumentByPath: sinon.stub().resolves(null),
        saveErrorLog,
      },
      chunkingService: {
        chunkDocument: sinon.stub().resolves([chunk]),
      },
      generateChunkEmbeddings: sinon
        .stub()
        .rejects(new Error("Billing reserve failed")),
    });

    try {
      await moduleUnderTest.uploadDocument(uploadOptions);
      expect.fail("Expected uploadDocument to throw");
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.contain("Billing reserve failed");
    }

    expect(
      updateDocumentStatus.calledWith(42, "active", "failed")
    ).to.equal(true);
    expect(saveErrorLog.calledWith(42)).to.equal(true);
  });
});
