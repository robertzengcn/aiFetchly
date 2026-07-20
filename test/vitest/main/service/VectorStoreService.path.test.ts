"use strict";
import { describe, expect, it } from "vitest";
import * as path from "path";
import * as os from "os";
import { VectorStoreService } from "@/service/VectorStoreService";
import { LOCAL_XENOVA_ALL_MINILM_MODEL_ID } from "@/service/embedding/LocalEmbeddingModels";

describe("VectorStoreService.getDocumentIndexPath (path-safe model key)", () => {
  // getDocumentIndexPath is pure (it only reads this.indexPath), so a real
  // VectorStoreService constructed against a temp directory is sufficient.
  it("produces a filename with no '/' or ':' for a local model ID", () => {
    const tmpBase = path.join(os.tmpdir(), "aifetchly-path-test", "vector_index");
    const store = new VectorStoreService(tmpBase);
    const indexPath = store.getDocumentIndexPath(42, {
      name: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      dimensions: 384,
    });

    const fileName = path.basename(indexPath);
    expect(fileName).not.toContain("/");
    expect(fileName).not.toContain(":");
    expect(fileName.startsWith("index_doc_42_")).toBe(true);
    expect(fileName.endsWith("_384.db")).toBe(true);
    // The original model ID must NOT appear verbatim (it contains '/' and ':').
    expect(fileName).not.toContain(LOCAL_XENOVA_ALL_MINILM_MODEL_ID);
  });

  it("is deterministic for the same inputs", () => {
    const tmpBase = path.join(os.tmpdir(), "aifetchly-path-test-2", "vector_index");
    const store = new VectorStoreService(tmpBase);
    const a = store.getDocumentIndexPath(7, {
      name: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      dimensions: 384,
    });
    const b = store.getDocumentIndexPath(7, {
      name: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      dimensions: 384,
    });
    expect(a).toBe(b);
  });

  it("produces distinct paths for distinct (documentId, model, dimension)", () => {
    const tmpBase = path.join(os.tmpdir(), "aifetchly-path-test-3", "vector_index");
    const store = new VectorStoreService(tmpBase);
    const local = store.getDocumentIndexPath(1, {
      name: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      dimensions: 384,
    });
    const remote = store.getDocumentIndexPath(1, {
      name: "Qwen/Qwen3-Embedding-4B",
      dimensions: 2560,
    });
    expect(local).not.toBe(remote);
  });
});
