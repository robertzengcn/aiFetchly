import { describe, it, expect } from "vitest";
import {
  ragUploadDocumentInputSchema,
  saveTempFileMetadataSchema,
} from "@/schemas/ipc/rag";

const baseUploadPayload = {
  filePath: "/tmp/doc.pdf",
  name: "doc.pdf",
  modelName: "text-embedding-3-small",
};

describe("ragUploadDocumentInputSchema tags", () => {
  it("accepts a payload with no tags", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
    });
    expect(r.success).toBe(true);
  });

  it("accepts distinct tags", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
      tags: ["Pricing", "Enterprise"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects two tags that differ only by case", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
      tags: ["Pricing", "pricing"],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) =>
          /case-insensitively/i.test(i.message)
        )
      ).toBe(true);
    }
  });

  it("accepts tags that the dialog would have normalized (already unique)", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
      tags: ["uploaded", "knowledge"],
    });
    expect(r.success).toBe(true);
  });
});

describe("saveTempFileMetadataSchema tags", () => {
  it("accepts a payload with no tags", () => {
    const r = saveTempFileMetadataSchema.safeParse({
      title: "doc",
    });
    expect(r.success).toBe(true);
  });

  it("accepts distinct tags", () => {
    const r = saveTempFileMetadataSchema.safeParse({
      tags: ["pricing", "enterprise"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects two tags that differ only by case", () => {
    const r = saveTempFileMetadataSchema.safeParse({
      tags: ["Acme", "ACME"],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a normalized unique tag list", () => {
    const r = saveTempFileMetadataSchema.safeParse({
      tags: ["refund-policy", "enterprise"],
    });
    expect(r.success).toBe(true);
  });
});
