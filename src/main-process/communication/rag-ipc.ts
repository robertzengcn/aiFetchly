import { ipcMain, app, dialog } from "electron";
import { RagSearchController } from "@/controller/RagSearchController";
import { SearchRequest, SearchResponse } from "@/modules/RagSearchModule";
import {
  CommonMessage,
  SaveTempFileResponse,
  DocumentUploadResponse,
  ChunkAndEmbedResponse,
  UploadedDocument,
  RagStatsResponse,
} from "@/entityTypes/commonType";
import { DocumentInfo } from "@/views/api/rag";
import { RagConfigApi, AvailableModelsResponse } from "@/api/ragConfigApi";
import * as fs from "fs";
import * as path from "path";
import {
  RAG_INITIALIZE,
  RAG_QUERY,
  RAG_UPLOAD_DOCUMENT,
  RAG_GET_STATS,
  RAG_TEST_PIPELINE,
  RAG_GET_DOCUMENTS,
  RAG_GET_DOCUMENT,
  RAG_UPDATE_DOCUMENT,
  RAG_DELETE_DOCUMENT,
  RAG_GET_DOCUMENT_STATS,
  RAG_SEARCH,
  RAG_GET_SUGGESTIONS,
  RAG_GET_SEARCH_ANALYTICS,
  RAG_UPDATE_EMBEDDING_MODEL,
  RAG_GET_AVAILABLE_MODELS,
  RAG_TEST_EMBEDDING_SERVICE,
  RAG_CLEAR_CACHE,
  RAG_CLEANUP,
  RAG_CHUNK_AND_EMBED_DOCUMENT,
  RAG_DOWNLOAD_DOCUMENT,
  SHOW_OPEN_DIALOG,
  GET_FILE_STATS,
  SAVE_TEMP_FILE,
  SAVE_TEMP_FILE_PROGRESS,
  SAVE_TEMP_FILE_COMPLETE,
  RAG_GET_DOCUMENT_ERROR_LOG,
  RAG_CHECK_DOCUMENT_DUPLICATE,
} from "@/config/channellist";
import {
  registerValidatedHandler,
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  ragShowOpenDialogInputSchema,
  ragFileStatsInputSchema,
  ragNoInputSchema,
  ragQueryInputSchema,
  ragUploadDocumentInputSchema,
  ragGetDocumentsInputSchema,
  ragDocumentByIdInputSchema,
  ragUpdateDocumentInputSchema,
  ragDeleteDocumentInputSchema,
  ragSearchInputSchema,
  ragSuggestionsInputSchema,
  ragUpdateEmbeddingModelInputSchema,
  ragChunkAndEmbedInputSchema,
  ragDownloadDocumentInputSchema,
  ragDocumentErrorLogInputSchema,
  ragCheckDuplicateInputSchema,
} from "@/schemas/ipc/rag";

/**
 * Helper function to create and initialize a RAG controller
 */
async function createRagController(): Promise<RagSearchController> {
  const controller = new RagSearchController();
  await controller.initialize();
  return controller;
}

/**
 * Register RAG IPC handlers.
 *
 * SAVE_TEMP_FILE (ipcMain.on) stays as-is — complex streaming/progress push
 * pattern. 24 ipcMain.handle handlers migrated to registerValidatedHandler.
 */
export function registerRagIpcHandlers(): void {
  console.log("RAG IPC handlers registered");

  // ── Out-of-scope: streaming on handler ───────────────────────────────
  ipcMain.on(SAVE_TEMP_FILE, async (event, data): Promise<void> => {
    let documentInfo: UploadedDocument | null = null;
    let databaseSaved = false;
    let databaseError: string | null = null;
    let ragController: RagSearchController | null = null;

    try {
      const { fileName, buffer, metadata } = data as {
        fileName: string;
        buffer: Buffer;
        metadata?: unknown;
      };
      if (!fileName || !buffer || buffer.length <= 1) {
        const errorResponse: CommonMessage<SaveTempFileResponse> = {
          status: false,
          msg: "Invalid fileName or buffer: fileName must be provided and buffer must have length > 1",
          data: {
            tempFilePath: "",
            databaseSaved: false,
            databaseError: "Invalid input parameters",
          },
        };
        (
          event as { sender: { send: (c: string, m: string) => void } }
        ).sender.send(SAVE_TEMP_FILE_COMPLETE, JSON.stringify(errorResponse));
        return;
      }

      (
        event as { sender: { send: (c: string, m: string) => void } }
      ).sender.send(
        SAVE_TEMP_FILE_PROGRESS,
        JSON.stringify({
          progress: 10,
          message: "Starting file save...",
          fileName,
        })
      );

      const appDataDir = path.join(app.getPath("userData"), "uploads");
      if (!fs.existsSync(appDataDir)) {
        fs.mkdirSync(appDataDir, { recursive: true });
      }

      (
        event as { sender: { send: (c: string, m: string) => void } }
      ).sender.send(
        SAVE_TEMP_FILE_PROGRESS,
        JSON.stringify({
          progress: 20,
          message: "Directory prepared...",
          fileName,
        })
      );

      const timestamp = Date.now();
      const fileExt = path.extname(fileName);
      const baseName = path.basename(fileName, fileExt);
      const uniqueFileName = `${baseName}_${timestamp}${fileExt}`;
      const appDataFilePath = path.join(appDataDir, uniqueFileName);

      (
        event as { sender: { send: (c: string, m: string) => void } }
      ).sender.send(
        SAVE_TEMP_FILE_PROGRESS,
        JSON.stringify({
          progress: 30,
          message: "Processing file buffer...",
          fileName,
        })
      );

      let uint8Buffer;
      if (buffer instanceof Uint8Array) {
        uint8Buffer = buffer;
      } else if (
        typeof buffer === "object" &&
        buffer !== null &&
        (buffer as { constructor?: unknown }).constructor === Object
      ) {
        const values = Object.values(buffer as Record<string, number>);
        uint8Buffer = new Uint8Array(values);
      } else {
        uint8Buffer = new Uint8Array(buffer);
      }

      const nodeBuffer = Buffer.from(uint8Buffer);
      fs.writeFileSync(appDataFilePath, nodeBuffer);

      (
        event as { sender: { send: (c: string, m: string) => void } }
      ).sender.send(
        SAVE_TEMP_FILE_PROGRESS,
        JSON.stringify({
          progress: 50,
          message: "File saved to disk...",
          fileName,
        })
      );

      if (metadata) {
        try {
          (
            event as { sender: { send: (c: string, m: string) => void } }
          ).sender.send(
            SAVE_TEMP_FILE_PROGRESS,
            JSON.stringify({
              progress: 60,
              message: "Saving to database...",
              fileName,
            })
          );

          ragController = await createRagController();
          const originalFileName = fileName.replace(/^rag_upload_\d+_/, "");
          const metadataTyped = metadata as {
            title?: string;
            description?: string;
            tags?: string[];
            author?: string;
          };
          const uploadOptions = {
            filePath: appDataFilePath,
            name: originalFileName,
            title:
              metadataTyped.title || originalFileName.replace(/\.[^/.]+$/, ""),
            description:
              metadataTyped.description ||
              `Uploaded document: ${originalFileName}`,
            tags: metadataTyped.tags || ["uploaded", "knowledge"],
            author: metadataTyped.author || "User",
          };

          (
            event as { sender: { send: (c: string, m: string) => void } }
          ).sender.send(
            SAVE_TEMP_FILE_PROGRESS,
            JSON.stringify({
              progress: 80,
              message: "Processing document...",
              fileName,
            })
          );

          const uploadResult = await ragController.uploadDocument(
            uploadOptions
          );
          documentInfo = {
            id: uploadResult.document.id,
            name: uploadResult.document.name,
            title: uploadResult.document.title || uploadResult.document.name,
            description: uploadResult.document.description,
            tags: uploadResult.document.tags
              ? JSON.parse(uploadResult.document.tags)
              : [],
            author: uploadResult.document.author,
            filePath: uploadResult.document.filePath,
            fileSize: uploadResult.document.fileSize,
            fileType: uploadResult.document.fileType,
            uploadDate:
              uploadResult.document.uploadedAt?.toISOString() ||
              new Date().toISOString(),
            status: uploadResult.document.status,
            processingStatus: uploadResult.document.processingStatus,
            log: uploadResult.document.log,
          };
          databaseSaved = true;
        } catch (dbError) {
          console.warn("Failed to save document to database:", dbError);
          databaseError =
            dbError instanceof Error
              ? dbError.message
              : "Unknown database error";
          if (documentInfo?.id && ragController) {
            try {
              await ragController.saveDocumentErrorLog(
                documentInfo.id,
                dbError instanceof Error ? dbError : new Error(String(dbError)),
                "SAVE_TEMP_FILE database save error"
              );
            } catch (logError) {
              console.error("Failed to save error log:", logError);
            }
          }
        }
      }

      (
        event as { sender: { send: (c: string, m: string) => void } }
      ).sender.send(
        SAVE_TEMP_FILE_PROGRESS,
        JSON.stringify({ progress: 90, message: "Finalizing...", fileName })
      );

      const response: CommonMessage<SaveTempFileResponse> = {
        status: true,
        msg: "File saved successfully",
        data: {
          tempFilePath: appDataFilePath,
          databaseSaved,
          databaseError,
          document: documentInfo || undefined,
        },
      };
      (
        event as { sender: { send: (c: string, m: string) => void } }
      ).sender.send(SAVE_TEMP_FILE_COMPLETE, JSON.stringify(response));
    } catch (error) {
      console.error("Error saving temporary file:", error);
      if (documentInfo?.id) {
        try {
          if (!ragController) {
            ragController = await createRagController();
          }
          await ragController.saveDocumentErrorLog(
            documentInfo.id,
            error instanceof Error ? error : new Error(String(error)),
            "SAVE_TEMP_FILE general error"
          );
        } catch (logError) {
          console.error("Failed to save error log:", logError);
        }
      }
      const errorResponse: CommonMessage<SaveTempFileResponse> = {
        status: false,
        msg: `Failed to save temporary file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        data: {
          tempFilePath: "",
          databaseSaved: false,
          databaseError:
            error instanceof Error ? error.message : "Unknown error",
        },
      };
      (
        event as { sender: { send: (c: string, m: string) => void } }
      ).sender.send(SAVE_TEMP_FILE_COMPLETE, JSON.stringify(errorResponse));
    }
  });

  // ── Validated handle handlers ────────────────────────────────────────

  registerValidatedHandler(
    SHOW_OPEN_DIALOG,
    ragShowOpenDialogInputSchema,
    async (input) => {
      return dialog.showOpenDialog(
        input as Parameters<typeof dialog.showOpenDialog>[0]
      );
    }
  );

  registerValidatedHandler(
    GET_FILE_STATS,
    ragFileStatsInputSchema,
    async (input) => {
      // F5 fix (bypass) — confine file-stat probing to app-owned directories
      // (RAG upload staging + error logs). Without this, a compromised
      // renderer could stat arbitrary local paths to learn existence, size,
      // and mtime — an information leak.
      const appDataDir = app.getPath("userData");
      const allowedRoots = [
        path.join(appDataDir, "rag_uploads"),
        path.join(appDataDir, "error_logs"),
      ];
      let resolved: string;
      try {
        resolved = fs.realpathSync(input.filePath);
      } catch {
        throw new Error("File not found");
      }
      const isContained = allowedRoots.some((root) => {
        try {
          const realRoot = fs.realpathSync(root);
          const rel = path.relative(realRoot, resolved);
          return !rel.startsWith("..") && !path.isAbsolute(rel) && rel !== "";
        } catch {
          return false;
        }
      });
      if (!isContained) {
        throw new Error("File path is outside allowed directories");
      }
      const stats = fs.statSync(resolved);
      return {
        size: stats.size,
        mtime: stats.mtime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
      };
    }
  );

  registerValidatedHandler(RAG_INITIALIZE, ragNoInputSchema, async () => {
    const ragController = await createRagController();
    await ragController.initializeRagModule();
    return { initialized: true };
  });

  registerValidatedHandler(RAG_GET_STATS, ragNoInputSchema, async () => {
    const ragSearchController = await createRagController();
    const stats = await ragSearchController.getSearchStats();
    const defaultEmbeddingModel =
      await ragSearchController.getDefaultEmbeddingModel();
    const enhancedStats: RagStatsResponse = {
      ...stats,
      defaultEmbeddingModel: defaultEmbeddingModel?.modelName || "",
    };
    return enhancedStats;
  });

  // F6 fix — RAG_QUERY triggers remote embedding/model work; gate on AI flag.
  registerAiValidatedHandler(RAG_QUERY, ragQueryInputSchema, async (input) => {
    const ragSearchController = await createRagController();
    const searchRequest: SearchRequest = {
      query: input.query,
      options: (input as { options?: SearchRequest["options"] }).options,
    };
    return ragSearchController.search(searchRequest);
  });

  // F6 fix — upload triggers chunking + remote embedding; gate on AI flag.
  registerAiValidatedHandler(
    RAG_UPLOAD_DOCUMENT,
    ragUploadDocumentInputSchema,
    async (input): Promise<DocumentUploadResponse> => {
      const ragSearchController = await createRagController();
      const uploadResult = await ragSearchController.uploadDocument(input);
      return {
        documentId: uploadResult.documentId,
        chunksCreated: uploadResult.chunksCreated,
        processingTime: uploadResult.processingTime,
        document: {
          id: uploadResult.document.id,
          name: uploadResult.document.name,
          title: uploadResult.document.title || uploadResult.document.name,
          description: uploadResult.document.description,
          tags: uploadResult.document.tags
            ? JSON.parse(uploadResult.document.tags)
            : [],
          author: uploadResult.document.author,
          filePath: uploadResult.document.filePath,
          fileSize: uploadResult.document.fileSize,
          fileType: uploadResult.document.fileType,
          uploadDate:
            uploadResult.document.uploadedAt?.toISOString() ||
            new Date().toISOString(),
          status: uploadResult.document.status,
          processingStatus: uploadResult.document.processingStatus,
          log: uploadResult.document.log,
        },
      };
    }
  );

  registerValidatedHandler(RAG_TEST_PIPELINE, ragNoInputSchema, async () => {
    // Mock test result (mirrors original)
    return {
      success: true,
      message: "RAG pipeline test completed successfully",
      testQuery: "test query",
      responseTime: Math.floor(Math.random() * 1000),
      resultsFound: Math.floor(Math.random() * 10),
    };
  });

  registerValidatedHandler(
    RAG_GET_DOCUMENTS,
    ragGetDocumentsInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      const documents = await ragSearchController.getDocuments(input);
      return documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        title: doc.title,
        description: doc.description,
        tags: doc.tags ? JSON.parse(doc.tags) : [],
        author: doc.author,
        filePath: doc.filePath,
        fileSize: doc.fileSize,
        fileType: doc.fileType,
        uploadDate: doc.uploadedAt?.toISOString() || new Date().toISOString(),
        status: doc.status as "processing" | "completed" | "error",
        processingStatus: doc.processingStatus,
        log: doc.log,
      })) satisfies DocumentInfo[];
    }
  );

  registerValidatedHandler(
    RAG_GET_DOCUMENT,
    ragDocumentByIdInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      const document = await ragSearchController.getDocument(input.id);
      if (!document) {
        throw new Error("Document not found");
      }
      return {
        id: document.id,
        name: document.name,
        title: document.title,
        description: document.description,
        tags: document.tags ? JSON.parse(document.tags) : [],
        author: document.author,
        filePath: document.filePath,
        fileSize: document.fileSize,
        fileType: document.fileType,
        uploadDate:
          document.uploadedAt?.toISOString() || new Date().toISOString(),
        status: document.status,
        processingStatus: document.processingStatus,
        log: document.log,
      };
    }
  );

  registerValidatedHandler(
    RAG_UPDATE_DOCUMENT,
    ragUpdateDocumentInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      // F5 fix — `log` is write-only from the renderer's perspective. The
      // path is generated server-side by RAGDocumentModule.saveErrorLog under
      // the app's error_logs dir. Allowing the renderer to set it would let a
      // compromised renderer redirect getDocumentErrorLog reads to arbitrary
      // local files.
      const metadata = Object.assign({}, input.metadata) as {
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
        log?: string;
      };
      delete metadata.log;
      await ragSearchController.updateDocument(input.id, metadata);
      return null;
    }
  );

  registerValidatedHandler(
    RAG_DELETE_DOCUMENT,
    ragDeleteDocumentInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      const success = await ragSearchController.deleteDocument(
        input.id,
        input.deleteFile || false
      );
      if (!success) {
        throw new Error("Failed to delete document");
      }
      return null;
    }
  );

  registerValidatedHandler(
    RAG_GET_DOCUMENT_STATS,
    ragNoInputSchema,
    async () => {
      const ragSearchController = await createRagController();
      return ragSearchController.getDocumentStats();
    }
  );

  // F6 fix — RAG_SEARCH runs remote embedding on the query; gate on AI flag.
  registerAiValidatedHandler(
    RAG_SEARCH,
    ragSearchInputSchema,
    async (input) => {
      const req = input as unknown as SearchRequest;
      const ragSearchController = await createRagController();
      return ragSearchController.search({
        query: req.query,
        options: req.options,
        filters: req.filters,
      }) as Promise<SearchResponse>;
    }
  );

  registerValidatedHandler(
    RAG_GET_SUGGESTIONS,
    ragSuggestionsInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      return ragSearchController.getSuggestions(input.query, input.limit || 5);
    }
  );

  registerValidatedHandler(
    RAG_GET_SEARCH_ANALYTICS,
    ragNoInputSchema,
    async () => {
      const ragSearchController = await createRagController();
      return ragSearchController.getAnalytics();
    }
  );

  registerValidatedHandler(
    RAG_UPDATE_EMBEDDING_MODEL,
    ragUpdateEmbeddingModelInputSchema,
    async (input) => {
      const ragConfigApi = new RagConfigApi();
      const modelsResponse = await ragConfigApi.getAvailableEmbeddingModels();
      if (!modelsResponse.status || !modelsResponse.data) {
        throw new Error("Failed to fetch available models for validation");
      }
      const modelInfo = modelsResponse.data.models[input.model];
      if (!modelInfo) {
        const names = Object.keys(modelsResponse.data.models).join(", ");
        throw new Error(
          `Invalid model name "${input.model}". Available models: ${names}`
        );
      }
      const dimension = modelInfo.dimensions;
      const ragSearchController = await createRagController();
      await ragSearchController.updateEmbeddingModel(input.model, dimension);
      return { modelName: input.model, dimension };
    }
  );

  registerValidatedHandler(
    RAG_GET_AVAILABLE_MODELS,
    ragNoInputSchema,
    async () => {
      const ragConfigApi = new RagConfigApi();
      const response = await ragConfigApi.getAvailableEmbeddingModels();
      if (!response.status || !response.data) {
        throw new Error(response.msg || "Failed to retrieve available models");
      }
      const ragController = await createRagController();
      const defaultModelFromSettings =
        await ragController.getDefaultEmbeddingModel();
      if (defaultModelFromSettings) {
        response.data.default_model = defaultModelFromSettings.modelName;
      }
      return response.data satisfies AvailableModelsResponse;
    }
  );

  // F6 fix — embedding-service test issues a remote model call.
  registerAiValidatedHandler(
    RAG_TEST_EMBEDDING_SERVICE,
    ragNoInputSchema,
    async () => {
      const ragSearchController = await createRagController();
      return ragSearchController.testEmbeddingService();
    }
  );

  registerValidatedHandler(RAG_CLEAR_CACHE, ragNoInputSchema, async () => {
    const ragSearchController = await createRagController();
    ragSearchController.clearCache();
    return null;
  });

  // F6 fix — chunk-and-embed issues remote embedding work.
  registerAiValidatedHandler(
    RAG_CHUNK_AND_EMBED_DOCUMENT,
    ragChunkAndEmbedInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      const result = await ragSearchController.chunkAndEmbedDocument(
        input.documentId
      );
      return result satisfies ChunkAndEmbedResponse;
    }
  );

  registerValidatedHandler(
    RAG_DOWNLOAD_DOCUMENT,
    ragDownloadDocumentInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      const document = await ragSearchController.getDocument(input.documentId);
      if (!document) throw new Error("Document not found");
      if (!fs.existsSync(document.filePath)) {
        throw new Error("Document file not found on disk");
      }
      const result = await dialog.showSaveDialog({
        title: "Save Document",
        defaultPath: path.join(app.getPath("downloads"), input.fileName),
        filters: [{ name: "All Files", extensions: ["*"] }],
      });
      if (result.canceled || !result.filePath) {
        return { downloaded: false };
      }
      fs.copyFileSync(document.filePath, result.filePath);
      return { downloaded: true };
    }
  );

  registerValidatedHandler(
    RAG_GET_DOCUMENT_ERROR_LOG,
    ragDocumentErrorLogInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      return ragSearchController.getDocumentErrorLog(input.documentId);
    }
  );

  registerValidatedHandler(
    RAG_CHECK_DOCUMENT_DUPLICATE,
    ragCheckDuplicateInputSchema,
    async (input) => {
      const ragSearchController = await createRagController();
      return ragSearchController.checkDocumentDuplicate(
        input.name,
        input.fileSize
      );
    }
  );

  registerValidatedHandler(RAG_CLEANUP, ragNoInputSchema, async () => {
    // Cleanup is automatic (controllers are request-scoped); kept for compat.
    return null;
  });
}
