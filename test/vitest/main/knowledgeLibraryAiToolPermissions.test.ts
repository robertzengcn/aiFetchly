"use strict";
import { describe, test, expect, vi } from "vitest";

// Same transitive mock set as KnowledgeSearchTool.test.ts — required because
// importing SkillRegistry pulls in KnowledgeLibraryAiTools, which statically
// imports RagSearchModule / RAGDocumentModule.
vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test-appdata") },
}));
vi.mock("@/service/VectorStoreService", () => ({
  VectorStoreService: vi.fn().mockImplementation(function () {
    return { initialize: vi.fn().mockResolvedValue(undefined) };
  }),
}));
vi.mock("@/modules/ConfigurationService", () => ({
  ConfigurationServiceImpl: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@/service/DocumentService", () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return { getDocuments: vi.fn().mockResolvedValue([]) };
  }),
}));
vi.mock("@/service/ChunkingService", () => ({
  ChunkingService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@/api/ragConfigApi", () => ({
  RagConfigApi: vi.fn().mockImplementation(function () {
    return {};
  }),
}));
vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(function () {
    return { getDefaultEmbeddingModel: vi.fn().mockResolvedValue(null) };
  }),
}));
vi.mock("@/modules/SystemSettingGroupModule", () => ({
  SystemSettingGroupModule: vi.fn().mockImplementation(function () {
    return { getOrCreateEmbeddingGroup: vi.fn().mockResolvedValue({}) };
  }),
}));

import { SkillRegistry } from "@/config/skillsRegistry";

describe("knowledge library management tool registration", () => {
  test("list tool is registered as pure and auto-runs", () => {
    const skill = SkillRegistry.getSkill("knowledge_library_list_documents");
    expect(skill).not.toBeNull();
    expect(skill!.permissionCategory).toBe("pure");
    expect(skill!.requiresConfirmation).toBe(false);
    expect(skill!.source).toBe("built-in");
  });

  test("import tool is registered as filesystem and requires confirmation", () => {
    const skill = SkillRegistry.getSkill("knowledge_library_import_attachment");
    expect(skill).not.toBeNull();
    expect(skill!.permissionCategory).toBe("filesystem");
    expect(skill!.requiresConfirmation).toBe(true);
  });

  test("delete tool is registered as filesystem and requires confirmation", () => {
    const skill = SkillRegistry.getSkill("knowledge_library_delete_document");
    expect(skill).not.toBeNull();
    expect(skill!.permissionCategory).toBe("filesystem");
    expect(skill!.requiresConfirmation).toBe(true);
  });

  test("all three tools appear in getAllToolFunctions()", async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("knowledge_library_list_documents");
    expect(names).toContain("knowledge_library_import_attachment");
    expect(names).toContain("knowledge_library_delete_document");
  });

  test("import tool only accepts attachment_ref (no filePath param)", () => {
    const skill = SkillRegistry.getSkill("knowledge_library_import_attachment");
    const params = skill!.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;
    expect(properties.attachment_ref).toBeDefined();
    expect(properties.filePath).toBeUndefined();
    expect((params.required as string[]).sort()).toEqual(["attachment_ref"]);
  });

  test("website import tool is registered as automation and requires confirmation", () => {
    const skill = SkillRegistry.getSkill("knowledge_library_import_website");
    expect(skill).not.toBeNull();
    expect(skill!.permissionCategory).toBe("automation");
    expect(skill!.requiresConfirmation).toBe(true);
    expect(skill!.source).toBe("built-in");
    expect(skill!.timeoutClass).toBe("network");

    // The schema exposes the three import modes and the duplicate policy, but
    // never a filePath parameter (only staged app-owned files are uploaded).
    const params = skill!.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;
    const mode = properties.mode as { enum?: string[] };
    expect(mode.enum).toEqual(["single_page", "url_list", "site_crawl"]);
    expect(properties.filePath).toBeUndefined();
  });

  test("website import tool appears in getAllToolFunctions()", async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("knowledge_library_import_website");
  });
});
