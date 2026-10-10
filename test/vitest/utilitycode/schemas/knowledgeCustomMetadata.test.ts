import { describe, it, expect } from "vitest";
import {
  knowledgeCustomMetadataSchema,
  KNOWLEDGE_CUSTOM_METADATA_KEYS,
  normalizeCustomMetadata,
  serializeCustomMetadata,
} from "@/schemas/knowledge/customMetadata";
import {
  ragUploadDocumentInputSchema,
  saveTempFileMetadataSchema,
} from "@/schemas/ipc/rag";

const baseUploadPayload = {
  filePath: "/tmp/doc.pdf",
  name: "doc.pdf",
  modelName: "text-embedding-3-small",
};

describe("knowledgeCustomMetadataSchema", () => {
  it("lists exactly the four allowlist keys", () => {
    expect(KNOWLEDGE_CUSTOM_METADATA_KEYS).toEqual([
      "product",
      "customer",
      "campaign",
      "category",
    ]);
  });

  it("accepts all four keys with valid values", () => {
    const r = knowledgeCustomMetadataSchema.safeParse({
      product: "Acme",
      customer: "Globex",
      campaign: "Q3 launch",
      category: "pricing",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty object", () => {
    const r = knowledgeCustomMetadataSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects an unknown key", () => {
    const r = knowledgeCustomMetadataSchema.safeParse({
      product: "Acme",
      vendor: "should-be-rejected",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a value longer than 200 characters", () => {
    const r = knowledgeCustomMetadataSchema.safeParse({
      product: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty-string value (min 1)", () => {
    const r = knowledgeCustomMetadataSchema.safeParse({
      product: "  ",
    });
    expect(r.success).toBe(false);
  });
});

describe("normalizeCustomMetadata / serializeCustomMetadata", () => {
  it("returns undefined for empty input so the column stores NULL", () => {
    expect(normalizeCustomMetadata(undefined)).toBeUndefined();
    expect(normalizeCustomMetadata(null)).toBeUndefined();
    expect(normalizeCustomMetadata({})).toBeUndefined();
    expect(serializeCustomMetadata({})).toBeUndefined();
  });

  it("serializes present keys as JSON and omits absent ones", () => {
    // Empty values are omitted by the caller (the dialog builder) before
    // reaching the serializer; passing an empty string is rejected by the
    // schema (min 1). Here we only supply present keys.
    const out = serializeCustomMetadata({
      product: "Acme",
      campaign: "Q3",
    });
    expect(out).toBe(JSON.stringify({ product: "Acme", campaign: "Q3" }));
  });

  it("rejects an empty-string value before storage", () => {
    expect(() =>
      serializeCustomMetadata({ product: "  " })
    ).toThrow();
  });

  it("throws on an unknown key before it reaches storage", () => {
    expect(() =>
      normalizeCustomMetadata({ vendor: "nope" })
    ).toThrow();
  });
});

describe("ragUploadDocumentInputSchema Phase 3 fields", () => {
  it("accepts language, documentDate, and customMetadata together", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
      language: "en",
      documentDate: "2024-03-15",
      customMetadata: { product: "Acme" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid documentDate", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
      documentDate: "03/15/2024",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a language longer than 16 chars", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
      language: "x".repeat(17),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown customMetadata key at the boundary", () => {
    const r = ragUploadDocumentInputSchema().safeParse({
      ...baseUploadPayload,
      customMetadata: { vendor: "nope" },
    });
    expect(r.success).toBe(false);
  });
});

describe("saveTempFileMetadataSchema Phase 3 fields", () => {
  it("accepts language, documentDate, and customMetadata", () => {
    const r = saveTempFileMetadataSchema.safeParse({
      language: "zh-CN",
      documentDate: "2024-01-01",
      customMetadata: { category: "pricing" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown customMetadata key", () => {
    const r = saveTempFileMetadataSchema.safeParse({
      customMetadata: { bogus: "x" },
    });
    expect(r.success).toBe(false);
  });
});
