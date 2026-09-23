import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmailServiceImportDialog from "@/views/pages/emailservice/widgets/EmailServiceImportDialog.vue";

const apiMocks = vi.hoisted(() => ({
  importEmailServices: vi.fn(),
}));

vi.mock("@/views/api/emailservice", () => ({
  importEmailServices: (...args: unknown[]) =>
    apiMocks.importEmailServices(...args),
}));

const templateMocks = vi.hoisted(() => ({
  buildCsv: vi.fn(() => "name,smtpUsername,from\n"),
  downloadCsv: vi.fn(),
}));

vi.mock("@/views/utils/emailServiceImportTemplate", () => ({
  buildEmailServiceCsvTemplate: (): string => templateMocks.buildCsv(),
  downloadEmailServiceCsvTemplate: (): void => templateMocks.downloadCsv(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      common: {
        import: "Import",
        import_success: "Import successful",
        import_partial: "Imported {imported}, skipped {skipped} invalid rows",
        import_partial_skipped: ": {errors}",
        import_cancelled: "Import cancelled",
        import_failed: "Import failed",
        import_no_valid_rows: "No valid services found in file",
        import_invalid_file: "Invalid file format",
        download_template: "Download Template",
        close: "Close",
        select_file_import: "Select file and import",
      },
      emailservice: {
        import_dialog_title: "Import email services",
        import_dialog_hint:
          "Download the CSV template, fill in your services, then select the file to import.",
      },
    },
  },
});

const stubs = {
  VDialog: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: '<div data-testid="import-dialog" v-if="modelValue"><slot /></div>',
  },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<div><slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VBtn: {
    props: ["loading"],
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  VSpacer: { template: "<div />" },
  NoticeSnackbar: {
    props: ["modelValue", "message", "type"],
    emits: ["update:modelValue"],
    template:
      '<div data-testid="notice-snackbar" :data-message="message" :data-type="type" v-if="modelValue" />',
  },
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(EmailServiceImportDialog, {
    props: { modelValue: true, ...props },
    global: { plugins: [i18n], stubs },
  });
}

describe("EmailServiceImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders download-template and select-file actions", () => {
    const wrapper = mountDialog();
    expect(
      wrapper.find('[data-testid="email-service-import-template-btn"]').exists()
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="email-service-import-select-btn"]').exists()
    ).toBe(true);
  });

  it("downloads the CSV template without calling the import IPC", async () => {
    const wrapper = mountDialog();
    await wrapper
      .find('[data-testid="email-service-import-template-btn"]')
      .trigger("click");
    expect(templateMocks.downloadCsv).toHaveBeenCalledTimes(1);
    expect(apiMocks.importEmailServices).not.toHaveBeenCalled();
  });

  it("calls importEmailServices and emits imported on full success", async () => {
    apiMocks.importEmailServices.mockResolvedValue({
      imported: 2,
      skipped: 0,
      errors: [],
    });
    const wrapper = mountDialog();
    await wrapper
      .find('[data-testid="email-service-import-select-btn"]')
      .trigger("click");
    await vi.waitFor(() => {
      expect(apiMocks.importEmailServices).toHaveBeenCalledTimes(1);
    });
    expect(wrapper.emitted("imported")).toBeTruthy();
    const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
    expect(snackbar.attributes("data-type")).toBe("success");
  });
});
