"use strict";
import { describe, test, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// DocumentService's constructor instantiates RAGDocumentModule (DB-backed) and
// the conversion services. Mock them so we can exercise the real staging /
// import-source methods against the filesystem without a database.
vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/aifetchly-staged-test") },
}));

vi.mock("@/modules/RAGDocumentModule", () => ({
  RAGDocumentModule: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@/service/HtmlConversionService", () => ({
  HtmlConversionService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@/service/SpreadsheetConversionService", () => ({
  SpreadsheetConversionService: vi.fn().mockImplementation(function () {
    return {};
  }),
  CHAT_MAX_ROWS: 1000,
}));

import { DocumentService } from "@/service/DocumentService";

const STAGED_ROOT = "/tmp/aifetchly-staged-test/ai-chat-attachments";

function ensureCleanRoot(): void {
  if (fs.existsSync(STAGED_ROOT)) {
    fs.rmSync(STAGED_ROOT, { recursive: true, force: true });
  }
}

describe("DocumentService.getStagedAttachmentImportSource", () => {
  test("returns the staged original file when present", async () => {
    ensureCleanRoot();
    const svc = new DocumentService();
    const ref = await svc.stageAttachmentMarkdown(
      "conv-original",
      "pricing-guide.pdf",
      "# pricing markdown",
      {
        attachmentSha256: "sha-abc",
        originalContentBase64: Buffer.from("fake-pdf-bytes").toString("base64"),
      }
    );

    const source = await svc.getStagedAttachmentImportSource(
      "conv-original",
      ref.refId
    );

    expect(source.fileName).toBe("pricing-guide.pdf");
    expect(source.filePath.endsWith(".pdf")).toBe(true);
    expect(source.markdownFallback).toBe(false);
    expect(source.sha256).toBe("sha-abc");
    expect(source.sizeBytes).toBe(Buffer.from("fake-pdf-bytes").length);
    // Resolved path must live under the staged attachment root.
    expect(source.filePath.startsWith(STAGED_ROOT)).toBe(true);
  });

  test("falls back to markdown when the original file was not staged", async () => {
    ensureCleanRoot();
    const svc = new DocumentService();
    const ref = await svc.stageAttachmentMarkdown(
      "conv-fallback",
      "pricing-guide.pdf",
      "# pricing markdown"
      // no originalContentBase64
    );

    const source = await svc.getStagedAttachmentImportSource(
      "conv-fallback",
      ref.refId
    );

    expect(source.markdownFallback).toBe(true);
    expect(source.filePath.endsWith(".md")).toBe(true);
    expect(source.fileName).toBe("pricing-guide.md");
  });

  test("rejects a malformed attachment reference", async () => {
    const svc = new DocumentService();
    await expect(
      svc.getStagedAttachmentImportSource("conv-x", "bad ref!")
    ).rejects.toThrow(/Invalid attachment reference/);
  });

  test("rejects a valid-format ref whose files are missing", async () => {
    const svc = new DocumentService();
    await expect(
      svc.getStagedAttachmentImportSource("conv-missing", "99999999-nope")
    ).rejects.toThrow(/no longer available/);
  });
});

describe("DocumentService.readStagedAttachment (regression)", () => {
  test("still returns fileName + markdown after the metadata-helper refactor", async () => {
    ensureCleanRoot();
    const svc = new DocumentService();
    const ref = await svc.stageAttachmentMarkdown(
      "conv-read",
      "notes.csv",
      "# notes markdown",
      { attachmentSha256: "sha-read" }
    );

    const content = await svc.readStagedAttachment("conv-read", ref.refId);
    expect(content.fileName).toBe("notes.csv");
    expect(content.markdown).toBe("# notes markdown");
    expect(content.sha256).toBe("sha-read");
  });

  test("staging persists the original file alongside markdown", () => {
    ensureCleanRoot();
    const svc = new DocumentService();
    // Use the public staging API then inspect the on-disk layout.
    return svc
      .stageAttachmentMarkdown("conv-disk", "doc.xlsx", "# x", {
        originalContentBase64: Buffer.from("xlsx-bytes").toString("base64"),
      })
      .then((ref) => {
        const dir = path.join(STAGED_ROOT, "conv-disk");
        const files = fs.readdirSync(dir);
        expect(files).toContain(`${ref.refId}.md`);
        expect(files).toContain(`${ref.refId}.xlsx`);
        expect(files).toContain(`${ref.refId}.meta.json`);
      });
  });
});
