import { describe, expect, it } from "vitest";
import { normalizeToolResult } from "@/service/AIChatQueryLoop";
import type { ToolExecutionResult } from "@/api/aiChatApi";
import type { ImageModelArtifact } from "@/entityTypes/aiImageAttachmentToolTypes";

/**
 * Regression guard for the central invariant of the attach_local_images tool:
 * prepared image bytes travel on a TRANSIENT top-level `modelArtifacts` field
 * that metadata-only serializers must exclude. `normalizeToolResult` is the
 * boundary that feeds both the renderer `tool_result` event and the persisted
 * tool-result content, so it must never surface `data:image/`.
 */
describe("normalizeToolResult artifact isolation", () => {
  function makeResultWithArtifacts(): ToolExecutionResult {
    const artifact: ImageModelArtifact = {
      kind: "image",
      fileName: "product-front.jpg",
      relativePath: "products/product-front.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 800,
      height: 600,
      sha256: "abc123",
      detail: "auto",
      dataUrl: "data:image/jpeg;base64,SGVsbG8gV29ybGQ=", // secret payload
    };
    return {
      tool_call_id: "call_1",
      tool_name: "attach_local_images",
      success: true,
      result: {
        success: true,
        attached_count: 1,
        attachments: [
          {
            file_name: "product-front.jpg",
            relative_path: "products/product-front.jpg",
            mime_type: "image/jpeg",
            prepared_size_bytes: 1024,
            width: 800,
            height: 600,
            sha256: "abc123",
            detail: "auto",
          },
        ],
        summary: "Prepared 1 image for the next AI request.",
      },
      execution_time_ms: 42,
      modelArtifacts: [artifact],
    };
  }

  it("drops modelArtifacts from the normalized payload", () => {
    const normalized = normalizeToolResult(makeResultWithArtifacts());
    expect(normalized).not.toHaveProperty("modelArtifacts");
  });

  it("keeps only safe metadata in the normalized payload", () => {
    const normalized = normalizeToolResult(makeResultWithArtifacts());
    expect(normalized.success).toBe(true);
    expect(normalized.executionTimeMs).toBe(42);
    expect(normalized.attached_count).toBe(1);
  });

  it("produces no data:image/ in the serialized tool-result content", () => {
    const normalized = normalizeToolResult(makeResultWithArtifacts());
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain("data:image/");
    expect(serialized).not.toContain("base64");
    expect(serialized).not.toContain("SGVsbG8gV29ybGQ");
  });

  it("handles results without modelArtifacts unchanged", () => {
    const result: ToolExecutionResult = {
      tool_call_id: "call_2",
      tool_name: "glob_files",
      success: true,
      result: { matches: ["a.txt", "b.txt"] },
      execution_time_ms: 5,
    };
    expect(normalizeToolResult(result)).toEqual({
      success: true,
      executionTimeMs: 5,
      matches: ["a.txt", "b.txt"],
    });
  });
});
