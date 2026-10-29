/**
 * WS-5 R5.1 — DI acceptance test for RagSearchModule.
 *
 * Constructor now accepts Partial<RagSearchModuleDeps>; these tests inject
 * fakes for documentService / searchService and verify the module routes to
 * them (not the real services). All collaborators faked → no DB/Electron.
 */
import { describe, it, expect, vi } from "vitest";
import { RagSearchModule, type RagSearchModuleDeps } from "@/modules/RagSearchModule";
import type { VectorSearchService } from "@/service/VectorSearchService";
import type { ConfigurationService } from "@/modules/ConfigurationService";
import type { DocumentService } from "@/service/DocumentService";
import type { ChunkingService } from "@/service/ChunkingService";
import type { RagConfigApi } from "@/api/ragConfigApi";
import type { SystemSettingModule } from "@/modules/SystemSettingModule";
import type { SystemSettingGroupModule } from "@/modules/SystemSettingGroupModule";

function makeFakeDeps(
  overrides: Partial<RagSearchModuleDeps> = {}
): RagSearchModuleDeps {
  return {
    searchService: {} as unknown as VectorSearchService,
    configurationService: {} as unknown as ConfigurationService,
    documentService: {} as unknown as DocumentService,
    chunkingService: {} as unknown as ChunkingService,
    ragConfigApi: {} as unknown as RagConfigApi,
    systemSettingModule: {} as unknown as SystemSettingModule,
    systemSettingGroupModule: {} as unknown as SystemSettingGroupModule,
    ...overrides,
  };
}

describe("RagSearchModule DI (R5.1)", () => {
  it("substitutes a fake documentService and routes getDocument to it", async () => {
    const fakeDoc = { id: 5, title: "Doc" };
    const fakeFindById = vi.fn().mockResolvedValue(fakeDoc);
    const mod = new RagSearchModule(
      makeFakeDeps({
        documentService: {
          findDocumentById: fakeFindById,
        } as unknown as DocumentService,
      })
    );

    const doc = await mod.getDocument(5);

    expect(fakeFindById).toHaveBeenCalledWith(5);
    expect(doc).toBe(fakeDoc);
  });

  it("substitutes a fake searchService for getSuggestions", async () => {
    const fakeSuggestions = vi.fn().mockResolvedValue(["alpha", "beta"]);
    const mod = new RagSearchModule(
      makeFakeDeps({
        searchService: {
          getSearchSuggestions: fakeSuggestions,
        } as unknown as VectorSearchService,
      })
    );

    const out = await mod.getSuggestions("alp", 2);

    expect(fakeSuggestions).toHaveBeenCalledWith("alp", 2);
    expect(out).toEqual(["alpha", "beta"]);
  });
});
