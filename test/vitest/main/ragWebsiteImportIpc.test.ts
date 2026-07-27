import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock KnowledgeLibraryAiTools so we observe delegation without touching the
// real scrape / stage / RAG-upload pipeline.
const importWebsiteMock = vi.fn();
vi.mock("@/service/KnowledgeLibraryAiTools", () => ({
  KnowledgeLibraryAiTools: class {
    importWebsite = importWebsiteMock;
  },
}));

import { handleRagImportWebsite } from "@/main-process/communication/handleRagImportWebsite";
import type {
  ImportKnowledgeWebsiteResult,
  KnowledgeLibraryToolError,
} from "@/entityTypes/knowledgeLibraryAiToolTypes";

describe("handleRagImportWebsite", () => {
  beforeEach(() => {
    importWebsiteMock.mockReset();
  });

  it("delegates to importWebsite with a UI execution context and the raw input", async () => {
    const outcome: ImportKnowledgeWebsiteResult = {
      success: true,
      mode: "single_page",
      imported: [],
      skipped: [],
      importedCount: 0,
      skippedCount: 0,
      requestedCount: 1,
      summary: "Imported 0 webpage(s) into the knowledge library.",
    };
    importWebsiteMock.mockResolvedValue(outcome);

    const input = { mode: "single_page", url: "https://example.com/pricing" };
    const result = await handleRagImportWebsite(input);

    expect(result).toBe(outcome);
    expect(importWebsiteMock).toHaveBeenCalledTimes(1);
    const [passedInput, context] = importWebsiteMock.mock.calls[0];
    expect(passedInput).toEqual(input);
    expect(context).toEqual({
      conversationId: "knowledge-library-ui",
      toolCallId: "ui-website-import",
    });
  });

  it("passes structured error outcomes (e.g. AI_DISABLED) through unchanged", async () => {
    const errorOutcome: KnowledgeLibraryToolError = {
      success: false,
      code: "AI_DISABLED",
      error:
        "AI is not enabled. Importing websites requires an active AI subscription.",
    };
    importWebsiteMock.mockResolvedValue(errorOutcome);

    const result = await handleRagImportWebsite({
      mode: "single_page",
      url: "https://example.com",
    });
    expect(result).toEqual(errorOutcome);
  });

  it("forwards url_list input verbatim (validation happens in the tool)", async () => {
    const outcome: ImportKnowledgeWebsiteResult = {
      success: true,
      mode: "url_list",
      imported: [],
      skipped: [],
      importedCount: 0,
      skippedCount: 0,
      requestedCount: 0,
      summary: "",
    };
    importWebsiteMock.mockResolvedValue(outcome);

    const input = {
      mode: "url_list",
      urls: ["https://a.example", "https://b.example"],
      maxPages: 5,
    };
    await handleRagImportWebsite(input);
    expect(importWebsiteMock.mock.calls[0][0]).toEqual(input);
  });
});
