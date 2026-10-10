import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailServiceTagDialog from "@/views/pages/emailservice/widgets/EmailServiceTagDialog.vue";
import en from "@/views/lang/en";

const api = vi.hoisted(() => ({
  getEmailServiceTags: vi.fn(),
  createEmailServiceTag: vi.fn(),
  updateEmailServiceTag: vi.fn(),
  deleteEmailServiceTag: vi.fn(),
}));
vi.mock("@/views/api/emailservice", () => api);

const stubs = {
  VDialog: { props: ["modelValue"], template: "<div v-if='modelValue'><slot /></div>" },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<h2><slot /></h2>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VSpacer: true,
  VAlert: { template: "<p role='alert'><slot /></p>" },
  VForm: { template: "<form><slot /></form>" },
  VTextField: {
    props: ["modelValue", "errorMessages", "disabled"],
    emits: ["update:modelValue"],
    template: '<label><input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" /><span>{{ errorMessages }}</span></label>',
  },
  VBtn: { props: ["icon", "loading", "disabled"], template: "<button :disabled='disabled || loading'><slot />{{ icon }}</button>" },
  VList: { template: "<ul><slot /></ul>" },
  VListItem: { template: "<li><slot name='title' /><slot name='subtitle' /><slot name='append' /><slot /></li>" },
  VListItemTitle: { template: "<span><slot /></span>" },
};

function mountDialog(): ReturnType<typeof mount> {
  return mount(EmailServiceTagDialog, {
    props: { modelValue: true },
    global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })], stubs },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailServiceTags.mockResolvedValue([
    { id: 4, name: "Sales", normalizedName: "sales", serviceCount: 2 },
    { id: 5, name: "Support", normalizedName: "support", serviceCount: 0 },
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("EmailServiceTagDialog", () => {
  it("creates trimmed tags, searches names and emits refresh", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.text()).toContain("Sales");
    await wrapper.get('[data-testid="tag-search"] input').setValue("support");
    expect(wrapper.text()).not.toContain("Sales");
    await wrapper.get('[data-testid="tag-name"] input').setValue("  Campaigns  ");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.createEmailServiceTag).toHaveBeenCalledWith("Campaigns");
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("rejects empty names and displays duplicate errors beside the input", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    expect(api.createEmailServiceTag).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(en.emailservice.tag_required);
    api.createEmailServiceTag.mockRejectedValue(new Error("EMAIL_SERVICE_TAG_DUPLICATE"));
    await wrapper.get('[data-testid="tag-name"] input').setValue("sales");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[data-testid="tag-name"]').text()).toContain(en.emailservice.tag_duplicate);
    expect(wrapper.emitted("changed")).toBeUndefined();
  });

  it("renames the selected tag", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper.findAll('button[aria-label="Rename tag"]')[0].trigger("click");
    await wrapper.get('[data-testid="tag-name"] input').setValue("Campaigns");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.updateEmailServiceTag).toHaveBeenCalledWith(4, "Campaigns");
    expect(api.createEmailServiceTag).not.toHaveBeenCalled();
  });

  it("confirms affected services and respects cancellation before deleting", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    const button = wrapper.get('[data-testid="delete-tag-4"]');
    await button.trigger("click");
    expect(wrapper.text()).toContain("Sales");
    expect(wrapper.text()).toContain("2");
    await wrapper.get('[data-testid="cancel-delete-tag"]').trigger("click");
    expect(api.deleteEmailServiceTag).not.toHaveBeenCalled();
    await button.trigger("click");
    await wrapper.get('[data-testid="confirm-delete-tag"]').trigger("click");
    await flushPromises();
    expect(api.deleteEmailServiceTag).toHaveBeenCalledWith(4);
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("shows localized load failures and disables editing during load", async () => {
    let rejectLoad!: (error: Error) => void;
    api.getEmailServiceTags.mockReturnValue(new Promise((resolve, reject) => {
      void resolve;
      rejectLoad = reject;
    }));
    const wrapper = mountDialog();
    expect(wrapper.get('[data-testid="tag-name"] input').attributes("disabled")).toBeDefined();
    rejectLoad(new Error("private database path"));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(en.emailservice.tag_operation_failed);
    expect(wrapper.text()).not.toContain("private database path");
  });
});
