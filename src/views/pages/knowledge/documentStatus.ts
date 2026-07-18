export interface DocumentStatusLike {
  status?: string;
  processingStatus?: string;
}

export function isDocumentProcessing(document: DocumentStatusLike): boolean {
  return (
    document.processingStatus === "processing" ||
    document.status === "processing"
  );
}

export function isDocumentFailure(document: DocumentStatusLike): boolean {
  return (
    document.processingStatus === "failed" ||
    document.processingStatus === "error"
  );
}
