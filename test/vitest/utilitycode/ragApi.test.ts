import { beforeEach, describe, expect, it, vi } from "vitest";
import { RAG_CHUNK_AND_EMBED_DOCUMENT } from "@/config/channellist";

const { mockWindowInvoke } = vi.hoisted(() => ({
  mockWindowInvoke: vi.fn(),
}));

vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: mockWindowInvoke,
  windowInvokeBinary: vi.fn(),
  windowSend: vi.fn(),
  windowSendBinary: vi.fn(),
  windowReceive: vi.fn(),
  windowRemoveListener: vi.fn(),
}));

import { chunkAndEmbedDocument } from "@/views/api/rag";

describe("views/api/rag chunkAndEmbedDocument", () => {
  beforeEach(() => {
    mockWindowInvoke.mockReset();
  });

  it("treats the unwrapped IPC data payload as a successful chunk/embed result", async () => {
    mockWindowInvoke.mockResolvedValue({
      documentId: 50,
      chunksCreated: 1,
      embeddingsGenerated: 1,
      processingTime: 749,
      success: true,
      message: "Document chunked and embedded successfully",
      steps: {
        chunking: true,
        embedding: true,
      },
    });

    const result = await chunkAndEmbedDocument(50);

    expect(mockWindowInvoke).toHaveBeenCalledWith(
      RAG_CHUNK_AND_EMBED_DOCUMENT,
      { documentId: 50 }
    );
    expect(result.success).toBe(true);
    expect(result.data?.chunksCreated).toBe(1);
    expect(result.data?.embeddingsGenerated).toBe(1);
  });

  it("surfaces backend failure messages from the unwrapped data payload", async () => {
    mockWindowInvoke.mockResolvedValue({
      documentId: 51,
      chunksCreated: 0,
      embeddingsGenerated: 0,
      processingTime: 12,
      success: false,
      message: "Document chunking failed: Unable to extract content",
      steps: {
        chunking: false,
        embedding: false,
      },
    });

    const result = await chunkAndEmbedDocument(51);

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      "Document chunking failed: Unable to extract content"
    );
  });
});
