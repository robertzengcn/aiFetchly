import { describe, expect, it } from "vitest";
import {
  isDocumentProcessing,
  isDocumentFailure,
} from "@/views/pages/knowledge/documentStatus";

describe("documentStatus helpers", () => {
  it("detects documents that still need refresh polling", () => {
    expect(isDocumentProcessing({ processingStatus: "processing" })).toBe(true);
    expect(isDocumentProcessing({ status: "processing" })).toBe(true);
    expect(isDocumentProcessing({ processingStatus: "completed" })).toBe(false);
    expect(isDocumentProcessing({ processingStatus: "failed" })).toBe(false);
  });

  it("detects failed document processing states", () => {
    expect(isDocumentFailure({ processingStatus: "failed" })).toBe(true);
    expect(isDocumentFailure({ processingStatus: "error" })).toBe(true);
    expect(isDocumentFailure({ processingStatus: "processing" })).toBe(false);
  });
});
