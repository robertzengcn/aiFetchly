import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { RagSearchModule } from "@/modules/RagSearchModule";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";
import { DocumentUploadOptions } from "@/modules/RAGDocumentModule";
import { EmbeddingBillingError } from "@/modules/rag/embeddingErrors";
import { EmbeddingProviderFactory } from "@/service/embedding/EmbeddingProviderFactory";
import type { EmbeddingProvider } from "@/service/embedding/EmbeddingProvider";
import type { EmbeddingResult } from "@/entityTypes/embeddingTypes";
import {
  LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
  LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
} from "@/service/embedding/LocalEmbeddingModels";

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

interface GenerateEmbeddingsHarness {
  generateChunkEmbeddings(
    chunks: RAGChunkEntity[],
    modelName: string,
    dimension: number
  ): Promise<{
    vectorIndexPath: string;
    modelName: string;
    dimensions: number;
  } | null>;
  searchService: {
    vectorStoreService: {
      getDocumentIndexPath(
        documentId: number,
        model: { name: string; dimensions: number }
      ): string;
      deleteDocumentIndexByPath(
        documentId: number,
        model: { name: string; dimensions: number }
      ): Promise<void>;
      storeEmbedding(input: {
        chunkId: number;
        documentId: number;
        content: string;
        embedding: number[];
        model: string;
        dimensions: number;
        metadata: {
          chunkIndex: number;
          pageNumber?: number;
        };
        vectorIndexPath: string;
      }): Promise<void>;
    };
  };
  documentService: {
    saveErrorLog(
      documentId: number,
      error: Error | string,
      context?: string
    ): Promise<string>;
  };
}

describe("RagSearchModule.uploadDocument", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("falls back to the local embedding provider when remote billing is denied", async () => {
    const chunk = Object.assign(new RAGChunkEntity(), {
      id: 7,
      documentId: 42,
      content: "hello",
      chunkIndex: 0,
    });
    const remoteProvider: EmbeddingProvider = {
      provider: "remote-api",
      modelName: "Qwen/Qwen3-Embedding-4B",
      dimensions: 2560,
      embedBatch: sinon
        .stub()
        .rejects(
          new EmbeddingBillingError(
            "Billing reserve failed",
            "embedding_error_billing_denied"
          )
        ),
      embedText: sinon.stub().rejects(new Error("unused")),
    };
    const localEmbedding = new Array(LOCAL_XENOVA_ALL_MINILM_DIMENSIONS).fill(
      0.1
    );
    const localResult: EmbeddingResult = {
      text: "hello",
      embedding: localEmbedding,
      dimensions: LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
      model: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      provider: "local-xenova",
    };
    const localProvider: EmbeddingProvider = {
      provider: "local-xenova",
      modelName: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      dimensions: LOCAL_XENOVA_ALL_MINILM_DIMENSIONS,
      embedBatch: sinon.stub().resolves([localResult]),
      embedText: sinon.stub().resolves(localResult),
    };
    sinon
      .stub(EmbeddingProviderFactory.prototype, "create")
      .onFirstCall()
      .returns(remoteProvider)
      .onSecondCall()
      .returns(localProvider);

    const storeEmbedding = sinon.stub().resolves();
    const deleteDocumentIndexByPath = sinon.stub().resolves();
    const saveErrorLog = sinon.stub().resolves("/tmp/error.log");
    const moduleUnderTest = Object.create(
      RagSearchModule.prototype
    ) as GenerateEmbeddingsHarness;

    Object.assign(moduleUnderTest, {
      searchService: {
        vectorStoreService: {
          getDocumentIndexPath: (
            documentId: number,
            model: { name: string; dimensions: number }
          ): string => `/tmp/${documentId}/${model.name}/${model.dimensions}`,
          deleteDocumentIndexByPath,
          storeEmbedding,
        },
      },
      documentService: {
        saveErrorLog,
      },
    });

    const result = await moduleUnderTest.generateChunkEmbeddings(
      [chunk],
      remoteProvider.modelName,
      remoteProvider.dimensions
    );

    expect(result?.modelName).to.equal(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
    expect(result?.dimensions).to.equal(LOCAL_XENOVA_ALL_MINILM_DIMENSIONS);
    expect(deleteDocumentIndexByPath.calledWith(42)).to.equal(true);
    expect(storeEmbedding.calledOnce).to.equal(true);
    expect(saveErrorLog.called).to.equal(false);
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
