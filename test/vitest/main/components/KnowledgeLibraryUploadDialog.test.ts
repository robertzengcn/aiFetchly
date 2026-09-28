import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgeLibrary from "@/views/pages/knowledge/KnowledgeLibrary.vue";
import {
  buildFileUploadMetadata,
  FileUploadMetadataError,
  normalizeUploadTags,
} from "@/views/pages/knowledge/fileUploadMetadata";

const ragApiMocks = vi.hoisted(() => ({
  copyFileToTempMock: vi.fn(),
  selectFilesNativeMock: vi.fn(),
  uploadDocumentMock: vi.fn(),
  getRAGStatsMock: vi.fn(),
  checkDocumentDuplicateMock: vi.fn(),
}));

vi.mock("@/views/api/rag", () => ({
  getRAGStats: (...args: unknown[]) => ragApiMocks.getRAGStatsMock(...args),
  selectFilesNative: (...args: unknown[]) =>
    ragApiMocks.selectFilesNativeMock(...args),
  copyFileToTemp: (...args: unknown[]) =>
    ragApiMocks.copyFileToTempMock(...args),
  uploadDocument: (...args: unknown[]) =>
    ragApiMocks.uploadDocumentMock(...args),
  checkDocumentDuplicate: (...args: unknown[]) =>
    ragApiMocks.checkDocumentDuplicateMock(...args),
  chunkAndEmbedDocument: vi.fn(),
  getAvailableEmbeddingModelsWithDefault: vi
    .fn()
    .mockResolvedValue({
      models: [],
      defaultModel: "text-embedding-3-small",
    }),
  updateEmbeddingModel: vi.fn(),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  getLocalAiRuntimeStatus: vi.fn().mockResolvedValue({ installed: false }),
  prepareLocalAiRuntimeInstall: vi.fn(),
  installLocalAiRuntime: vi.fn(),
  cancelLocalAiRuntimeInstall: vi.fn(),
  onLocalAiRuntimeProgress: vi.fn().mockReturnValue(() => undefined),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      knowledge: {
        author: "Author",
        tags: "Tags",
        tags_hint: "Press Enter to add tags",
        description: "Description",
        upload_metadata_hint:
          "Optional. Applied to every file in this upload.",
        upload_failed: "Upload failed",
        no_files_selected: "No files selected",
        tag_error_tag_too_long: "Tag #{index} exceeds {max} characters.",
        tag_error_too_many_tags: "At most {maxCount} tags are allowed.",
        tag_error_author_too_long: "Author exceeds {max} characters.",
        tag_error_description_too_long: "Description exceeds {max} characters.",
      },
      common: { cancel: "Cancel" },
    },
  },
});

const stubs = {
  DocumentManagement: {
    template: "<div />",
    methods: { refreshDocuments: () => undefined },
  },
  SearchInterface: { template: "<div />" },
  WebsiteImportDialog: { template: "<div />" },
  VDialog: { template: "<div><slot /></div>" },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<div><slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VBtn: true,
  VIcon: true,
  VList: true,
  VListItem: true,
  VTextField: {
    template: '<div class="v-text-field-stub">{{ label }}</div>',
    props: ["label"],
  },
  VCombobox: {
    template: '<div class="v-combobox-stub">{{ label }} {{ hint }}</div>',
    props: ["label", "hint"],
  },
  VTextarea: {
    template: '<div class="v-textarea-stub">{{ label }}</div>',
    props: ["label"],
  },
  VAlert: { template: "<div><slot /></div>" },
  VSpacer: true,
  VProgressLinear: true,
};

function mountPage(): ReturnType<typeof mount> {
  return mount(KnowledgeLibrary, {
    global: { plugins: [i18n], stubs },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ragApiMocks.getRAGStatsMock.mockResolvedValue({
    defaultEmbeddingModel: "text-embedding-3-small",
    totalDocuments: 0,
  });
  ragApiMocks.checkDocumentDuplicateMock.mockResolvedValue({
    isDuplicate: false,
    existingDocuments: [],
  });
});

describe("KnowledgeLibrary upload metadata", () => {
  it("renders author, tags, and description inputs", async () => {
    const wrapper = mountPage();
    const vm = wrapper.vm as unknown as {
      showUploadDialog: boolean;
      uploadFiles: Array<{ name: string; size: number }>;
    };
    vm.showUploadDialog = true;
    vm.uploadFiles = [{ name: "sample.pdf", size: 5 } as unknown as File];
    await flushPromises();
    const html: string = wrapper.html();
    expect(html).toContain("Author");
    expect(html).toContain("Tags");
    expect(html).toContain("Description");
    expect(html).toContain(
      "Optional. Applied to every file in this upload."
    );
  });

  it("passes typed metadata plus filename-stem title to copyFileToTemp", async () => {
    const wrapper = mountPage();
    const vm = wrapper.vm as unknown as {
      showUploadDialog: boolean;
      uploadFiles: Array<{ name: string; size: number }>;
      uploadAuthor: string;
      uploadDescription: string;
      uploadTags: string[];
      confirmUpload: () => Promise<void>;
    };
    vm.showUploadDialog = true;
    vm.uploadFiles = [
      { name: "refund-policy.pdf", size: 10 } as unknown as File,
    ];
    vm.uploadAuthor = "Alice Chen";
    vm.uploadTags = ["pricing", "enterprise"];
    vm.uploadDescription = "Refund rules";
    ragApiMocks.copyFileToTempMock.mockResolvedValue({
      tempFilePath: "/tmp/x.pdf",
      document: {
        id: 1,
        name: "refund-policy.pdf",
        status: "completed",
      },
    });
    await vm.confirmUpload();
    await flushPromises();
    expect(ragApiMocks.copyFileToTempMock).toHaveBeenCalledTimes(1);
    const metadata = ragApiMocks.copyFileToTempMock.mock.calls[0][1] as {
      title: string;
      description: string;
      tags: string[];
      author: string;
    };
    expect(metadata).toEqual({
      title: "refund-policy",
      description: "Refund rules",
      tags: ["pricing", "enterprise"],
      author: "Alice Chen",
    });
  });

  it("uses defaults when fields are blank", () => {
    const out = buildFileUploadMetadata("memo.pdf", {
      author: "  ",
      description: "",
      tags: [],
    });
    expect(out).toEqual({
      title: "memo",
      description: "Uploaded document: memo.pdf",
      tags: ["uploaded", "knowledge"],
      author: "User",
    });
  });

  it("trims, drops empties, and dedupes tags case-insensitively keeping first spelling", () => {
    const out = buildFileUploadMetadata("a.pdf", {
      author: "Bob",
      description: "d",
      tags: [" Pricing ", "", "pricing", "ENTERPRISE"],
    });
    expect(out.tags).toEqual(["Pricing", "ENTERPRISE"]);
  });

  it("rejects too many tags and over-long tags", () => {
    expect(() =>
      buildFileUploadMetadata("a.pdf", {
        author: "",
        description: "",
        tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
      })
    ).toThrow(FileUploadMetadataError);
    expect(() =>
      buildFileUploadMetadata("a.pdf", {
        author: "",
        description: "",
        tags: ["x".repeat(65)],
      })
    ).toThrow(FileUploadMetadataError);
  });

  it("too-many-tags error carries the translatable code and max count", () => {
    try {
      normalizeUploadTags(Array.from({ length: 21 }, (_, i) => `t${i}`));
      throw new Error("expected normalizeUploadTags to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FileUploadMetadataError);
      const metadataError = error as FileUploadMetadataError;
      expect(metadataError.code).toBe("too_many_tags");
      expect(metadataError.params.maxCount).toBe(20);
    }
  });

  it("over-long tag error carries the translatable code, index, and max length", () => {
    try {
      normalizeUploadTags(["ok", "x".repeat(65)]);
      throw new Error("expected normalizeUploadTags to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FileUploadMetadataError);
      const metadataError = error as FileUploadMetadataError;
      expect(metadataError.code).toBe("tag_too_long");
      expect(metadataError.params.index).toBe(2);
      expect(metadataError.params.tag).toBe("x".repeat(65));
      expect(metadataError.params.max).toBe(64);
    }
  });

  it("shows a translated tag-limit message, does not upload, and keeps typed fields", async () => {
    const wrapper = mountPage();
    const vm = wrapper.vm as unknown as {
      showUploadDialog: boolean;
      uploadFiles: Array<{ name: string; size: number }>;
      uploadAuthor: string;
      uploadDescription: string;
      uploadTags: string[];
      uploadError: string;
      confirmUpload: () => Promise<void>;
    };
    vm.showUploadDialog = true;
    vm.uploadFiles = [
      { name: "report.pdf", size: 10 } as unknown as File,
    ];
    vm.uploadAuthor = "Alice";
    vm.uploadDescription = "desc";
    // 21 distinct tags exceeds the cap of 20.
    vm.uploadTags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    await vm.confirmUpload();
    await flushPromises();
    // Upload must not have started.
    expect(ragApiMocks.copyFileToTempMock).not.toHaveBeenCalled();
    expect(ragApiMocks.uploadDocumentMock).not.toHaveBeenCalled();
    // The active-language message is surfaced (not the raw code).
    expect(vm.uploadError).toContain("Upload failed");
    expect(vm.uploadError).toContain("At most 20 tags are allowed.");
    expect(vm.uploadError).not.toContain("too_many_tags");
    // Typed fields are preserved so the user can correct and retry.
    expect(vm.uploadAuthor).toBe("Alice");
    expect(vm.uploadDescription).toBe("desc");
    expect(vm.uploadTags).toHaveLength(21);
  });

  it("cancel clears the three fields", async () => {
    const wrapper = mountPage();
    const vm = wrapper.vm as unknown as {
      uploadAuthor: string;
      uploadDescription: string;
      uploadTags: string[];
      cancelUpload: () => void;
    };
    vm.uploadAuthor = "Alice";
    vm.uploadDescription = "desc";
    vm.uploadTags = ["pricing"];
    vm.cancelUpload();
    expect(vm.uploadAuthor).toBe("");
    expect(vm.uploadDescription).toBe("");
    expect(vm.uploadTags).toEqual([]);
  });
});
