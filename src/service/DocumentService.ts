import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import {
  RAGDocumentModule,
  DocumentUploadOptions,
  DocumentValidationResult,
} from "@/modules/RAGDocumentModule";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { app } from "electron";
import { PDFDocument } from "pdf-lib";
import pdf2md from "pdf2md-ts";
import * as mammoth from "mammoth";
import { HtmlConversionService } from "@/service/HtmlConversionService";
import * as XLSX from "xlsx";
import Papa from "papaparse";

export interface StagedAttachmentReference {
  refId: string;
  fileName: string;
}

export interface StagedAttachmentContent {
  fileName: string;
  markdown: string;
}

export class DocumentService {
  private ragDocumentModule: RAGDocumentModule;
  private htmlConversionService: HtmlConversionService;
  private readonly stagedAttachmentRoot: string;
  private static readonly STAGED_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  private static readonly MAX_STAGED_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2MB

  constructor() {
    this.ragDocumentModule = new RAGDocumentModule();
    this.htmlConversionService = new HtmlConversionService();
    this.stagedAttachmentRoot = path.join(
      app.getPath("userData"),
      "ai-chat-attachments"
    );
  }

  /**
   * Upload and process a document
   */
  async uploadDocument(
    options: DocumentUploadOptions
  ): Promise<RAGDocumentEntity> {
    return await this.ragDocumentModule.uploadDocument(options);
  }

  /**
   * Validate file before processing
   */
  async validateFile(filePath: string): Promise<DocumentValidationResult> {
    return await this.ragDocumentModule.validateFile(filePath);
  }

  /**
   * Extract metadata from document
   */
  async extractMetadata(filePath: string): Promise<Partial<RAGDocumentEntity>> {
    return await this.ragDocumentModule.extractMetadata(filePath);
  }

  /**
   * Find document by file path
   */
  async findDocumentByPath(
    filePath: string
  ): Promise<RAGDocumentEntity | null> {
    return await this.ragDocumentModule.findDocumentByPath(filePath);
  }

  /**
   * Find document by ID
   */
  async findDocumentById(id: number): Promise<RAGDocumentEntity | null> {
    return await this.ragDocumentModule.findDocumentById(id);
  }

  /**
   * Get all documents with optional filtering
   */
  async getDocuments(filters?: {
    status?: string;
    processingStatus?: string;
    fileType?: string;
    name?: string;
    tags?: string[];
    author?: string;
    limit?: number;
    offset?: number;
  }): Promise<RAGDocumentEntity[]> {
    return await this.ragDocumentModule.getDocuments(filters);
  }

  /**
   * Update document status
   */
  async updateDocumentStatus(
    id: number,
    status: string,
    processingStatus?: string
  ): Promise<void> {
    return await this.ragDocumentModule.updateDocumentStatus(
      id,
      status,
      processingStatus
    );
  }

  /**
   * Delete document and cleanup
   * @returns Promise that resolves to true if deletion was successful, false otherwise
   */
  async deleteDocument(id: number, deleteFile = false): Promise<boolean> {
    return await this.ragDocumentModule.deleteDocument(id, deleteFile);
  }

  /**
   * Update document metadata
   */
  async updateDocumentMetadata(
    id: number,
    metadata: {
      title?: string;
      description?: string;
      tags?: string[];
      author?: string;
      vectorIndexPath?: string;
      modelName?: string;
      vectorDimensions?: number;
      log?: string;
    }
  ): Promise<void> {
    return await this.ragDocumentModule.updateDocumentMetadata(id, metadata);
  }

  /**
   * Save error log for a document
   * @param documentId - Document ID
   * @param error - Error object or error message
   * @param context - Additional context about the error
   * @returns Path to the created error log file
   */
  async saveErrorLog(
    documentId: number,
    error: Error | string,
    context?: string
  ): Promise<string> {
    return await this.ragDocumentModule.saveErrorLog(
      documentId,
      error,
      context
    );
  }

  /**
   * Get document error log content
   * @param documentId - Document ID
   * @returns Error log content or null if no log exists
   */
  async getDocumentErrorLog(documentId: number): Promise<string | null> {
    return await this.ragDocumentModule.getDocumentErrorLog(documentId);
  }

  /**
   * Get document statistics
   */
  async getDocumentStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byFileType: Record<string, number>;
    totalSize: number;
  }> {
    return await this.ragDocumentModule.getDocumentStats();
  }

  /**
   * Convert uploaded attachment content to markdown text.
   * Supported: PDF, CSV, DOCX.
   */
  async convertUploadedAttachmentToMarkdown(
    fileName: string,
    mimeType: string,
    contentBase64: string
  ): Promise<string> {
    const ext = this.resolveSupportedExtension(fileName, mimeType);
    const sourcePath = path.join(
      os.tmpdir(),
      `aifetchly-attachment-${Date.now()}-${crypto.randomUUID()}${ext}`
    );

    try {
      const binary = Buffer.from(contentBase64, "base64");
      fs.writeFileSync(sourcePath, binary);

      let markdown = "";
      if (ext === ".pdf") {
        markdown = await this.convertPdfFileToMarkdown(sourcePath);
      } else if (ext === ".docx") {
        markdown = await this.convertDocxFileToMarkdown(sourcePath);
      } else if (ext === ".csv") {
        markdown = this.convertCsvBufferToMarkdown(binary);
      } else if (ext === ".xlsx") {
        markdown = this.convertXlsxBufferToMarkdown(binary, {
          maxRowsPerSheet: 100,
        });
      } else {
        throw new Error(`Unsupported attachment type: ${fileName}`);
      }

      const normalized = markdown.trim();
      if (!normalized) {
        throw new Error(`Empty markdown content after conversion: ${fileName}`);
      }
      return normalized;
    } finally {
      if (fs.existsSync(sourcePath)) {
        fs.unlinkSync(sourcePath);
      }
    }
  }

  /**
   * Persist converted attachment markdown into chat staging directory.
   */
  async stageAttachmentMarkdown(
    conversationId: string,
    fileName: string,
    markdown: string
  ): Promise<StagedAttachmentReference> {
    this.cleanupExpiredStagedFiles();
    const safeConversationId = this.sanitizePathSegment(
      conversationId || "default"
    );
    const stageDir = path.join(this.stagedAttachmentRoot, safeConversationId);
    if (!fs.existsSync(stageDir)) {
      fs.mkdirSync(stageDir, { recursive: true });
    }

    const refId = `${Date.now()}-${crypto.randomUUID()}`;
    const filePath = path.join(stageDir, `${refId}.md`);
    const metadataPath = path.join(stageDir, `${refId}.meta.json`);
    fs.writeFileSync(filePath, markdown, "utf-8");
    fs.writeFileSync(metadataPath, JSON.stringify({ fileName }), "utf-8");

    return {
      refId,
      fileName,
    };
  }

  /**
   * Read staged attachment markdown by conversation-scoped reference ID.
   */
  async readStagedAttachment(
    conversationId: string,
    refId: string
  ): Promise<StagedAttachmentContent> {
    if (!/^[a-zA-Z0-9-]+$/.test(refId)) {
      throw new Error("Invalid attachment reference");
    }

    const safeConversationId = this.sanitizePathSegment(
      conversationId || "default"
    );
    const stageDir = path.join(this.stagedAttachmentRoot, safeConversationId);
    const filePath = path.join(stageDir, `${refId}.md`);
    const metadataPath = path.join(stageDir, `${refId}.meta.json`);

    if (!fs.existsSync(filePath)) {
      throw new Error("Attachment file not found");
    }
    const stats = fs.statSync(filePath);
    if (stats.size > DocumentService.MAX_STAGED_ATTACHMENT_BYTES) {
      throw new Error("Attachment content exceeds maximum allowed size");
    }

    const markdown = fs.readFileSync(filePath, "utf-8").trim();
    if (!markdown) {
      throw new Error("Attachment markdown content is empty");
    }

    let fileName = path.basename(filePath);
    if (fs.existsSync(metadataPath)) {
      try {
        const metadataRaw = fs.readFileSync(metadataPath, "utf-8");
        const metadata = JSON.parse(metadataRaw) as { fileName?: string };
        if (metadata.fileName) {
          fileName = metadata.fileName;
        }
      } catch {
        // Fallback to default filename above if metadata cannot be parsed.
      }
    }

    return {
      fileName,
      markdown,
    };
  }

  private resolveSupportedExtension(
    fileName: string,
    mimeType: string
  ): ".pdf" | ".csv" | ".docx" | ".xlsx" {
    const lowerName = fileName.toLowerCase();
    const lowerMime = mimeType.toLowerCase();

    if (lowerName.endsWith(".pdf") || lowerMime === "application/pdf") {
      return ".pdf";
    }
    if (
      lowerName.endsWith(".csv") ||
      lowerMime === "text/csv" ||
      lowerMime === "application/csv"
    ) {
      return ".csv";
    }
    if (
      lowerName.endsWith(".docx") ||
      lowerMime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return ".docx";
    }
    if (
      lowerName.endsWith(".xlsx") ||
      lowerName.endsWith(".xls") ||
      lowerMime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      lowerMime === "application/vnd.ms-excel"
    ) {
      return ".xlsx";
    }

    throw new Error(`Unsupported attachment mime type: ${mimeType}`);
  }

  private async convertPdfFileToMarkdown(filePath: string): Promise<string> {
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    if (pageCount === 0) {
      return "";
    }

    const allPages: string[] = [];
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const singlePagePdf = await PDFDocument.create();
      const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum - 1]);
      singlePagePdf.addPage(copiedPage);
      const singlePageBytes = await singlePagePdf.save();
      const pageMarkdown = await pdf2md(singlePageBytes);
      if (Array.isArray(pageMarkdown) && pageMarkdown.length > 0) {
        const content = pageMarkdown.join("\n").trim();
        if (content) {
          allPages.push(`--- Page ${pageNum} ---\n${content}`);
        }
      }
    }

    return allPages.join("\n\n").trim();
  }

  private async convertDocxFileToMarkdown(filePath: string): Promise<string> {
    const result = await mammoth.convertToHtml({ path: filePath });
    const htmlContent = result.value || "";
    if (!htmlContent.trim()) {
      return "";
    }
    return this.htmlConversionService.convertHtmlToMarkdown(htmlContent).trim();
  }

  private convertCsvBufferToMarkdown(csvBuffer: Buffer): string {
    const raw = csvBuffer.toString("utf-8").trim();
    if (!raw) {
      return "";
    }

    const result = Papa.parse(raw, {
      skipEmptyLines: true,
      header: false,
    });

    if (!result.data || result.data.length === 0) {
      return "";
    }

    const rows = result.data as string[][];
    const header = rows[0];
    const body = rows.slice(1);
    const escapeCell = (value: string): string =>
      String(value).replace(/\|/g, "\\|");

    const headerLine = `| ${header.map(escapeCell).join(" | ")} |`;
    const dividerLine = `| ${header.map(() => "---").join(" | ")} |`;
    const bodyLines = body.map(
      (row) => `| ${row.map(escapeCell).join(" | ")} |`
    );
    return [headerLine, dividerLine, ...bodyLines].join("\n");
  }

  private convertXlsxBufferToMarkdown(
    xlsxBuffer: Buffer,
    options?: { maxRowsPerSheet?: number }
  ): string {
    const workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return "";
    }

    const sheetMarkdowns: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;

      if (options?.maxRowsPerSheet) {
        const rangeRef = worksheet["!ref"];
        if (rangeRef) {
          const range = XLSX.utils.decode_range(rangeRef);
          const maxEndRow = Math.min(range.e.r, options.maxRowsPerSheet);
          const cappedRef = XLSX.utils.encode_range({
            s: range.s,
            e: { r: maxEndRow, c: range.e.c },
          });
          worksheet["!ref"] = cappedRef;
        }
      }

      const html = XLSX.utils.sheet_to_html(worksheet);
      if (!html || !html.trim()) continue;

      const markdown = this.htmlConversionService.convertHtmlToMarkdown(html);
      if (markdown.trim()) {
        sheetMarkdowns.push(`## Sheet: ${sheetName}\n\n${markdown.trim()}`);
      }
    }

    return sheetMarkdowns.join("\n\n");
  }

  private sanitizePathSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9-_]/g, "_");
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private cleanupExpiredStagedFiles(): void {
    if (!fs.existsSync(this.stagedAttachmentRoot)) {
      return;
    }
    const now = Date.now();
    const conversationDirs = fs.readdirSync(this.stagedAttachmentRoot);
    for (const dir of conversationDirs) {
      const absDir = path.join(this.stagedAttachmentRoot, dir);
      if (!fs.statSync(absDir).isDirectory()) continue;
      const files = fs.readdirSync(absDir);
      for (const file of files) {
        const absFile = path.join(absDir, file);
        const stats = fs.statSync(absFile);
        if (now - stats.mtimeMs > DocumentService.STAGED_ATTACHMENT_TTL_MS) {
          fs.unlinkSync(absFile);
        }
      }
    }
  }
}
